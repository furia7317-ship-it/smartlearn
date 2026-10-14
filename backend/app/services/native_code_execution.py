"""Local compiler execution with bounded time/output and private temporary files.

This is an authenticated local development tool, not an untrusted-code sandbox.
Never expose it as a public multi-tenant execution service.
"""
from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from app.services.code_process_limits import attach_process_limits

TOOLCHAIN_ROOT = Path(__file__).resolve().parents[3] / "frontend" / "runtime" / "toolchains"
MAX_OUTPUT = 16000
COMPILE_TIMEOUT = 15
RUN_TIMEOUT = 3


def compiler_path(language: str) -> str | None:
    name = {"java": "javac", "c": "gcc", "cpp": "g++"}[language]
    configured = os.environ.get({"java": "CODE_LAB_JAVAC", "c": "CODE_LAB_CC", "cpp": "CODE_LAB_CXX"}[language])
    if configured:
        return shutil.which(configured)
    suffix = ".exe" if os.name == "nt" else ""
    candidates = [TOOLCHAIN_ROOT / ("jdk" if language == "java" else "w64devkit") / "bin" / (name + suffix)]
    if language == "java" and os.environ.get("JAVA_HOME"):
        candidates.append(Path(os.environ["JAVA_HOME"]) / "bin" / (name + suffix))
    return next((str(path) for path in candidates if path.is_file()), None) or shutil.which(name)


def available_languages() -> list[dict]:
    return [{"language": language, "available": language == "python" or compiler_path(language) is not None}
            for language in ("python", "java", "c", "cpp")]


def _stop_process(process: subprocess.Popen) -> None:
    if os.name == "nt":
        subprocess.run([str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.poll() is None:
        process.kill()


def _run(command: list[str], workdir: str, stdin: str, timeout: float) -> tuple[int, str, str, str | None]:
    # Do not propagate application credentials, JVM options or compiler injection variables.
    environment = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC"}}
    environment.update({"PATH": os.pathsep.join([str(Path(command[0]).parent), str(Path(environment.get("SYSTEMROOT", "/usr")) / ("System32" if os.name == "nt" else "bin"))]),
                        "TEMP": workdir, "TMP": workdir, "HOME": workdir, "LANG": "C.UTF-8"})
    with open(Path(workdir) / "stdin.txt", "wb") as input_file:
        input_file.write(stdin.encode("utf-8"))
    with open(Path(workdir) / "stdin.txt", "rb") as input_file:
        process = subprocess.Popen(command, cwd=workdir, env=environment, stdin=input_file, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0, start_new_session=os.name != "nt")
        try:
            release_limits = attach_process_limits(process)
        except OSError:
            _stop_process(process)
            process.wait(timeout=2)
            process.stdout.close()
            process.stderr.close()
            raise
        buffers: list[bytearray] = [bytearray(), bytearray()]
        exceeded = threading.Event()

        def collect(stream, index):
            try:
                while chunk := stream.read1(4096):
                    room = MAX_OUTPUT - len(buffers[index])
                    buffers[index].extend(chunk[:max(0, room)])
                    if len(chunk) > room:
                        exceeded.set()
                        return
            finally:
                stream.close()

        readers = [threading.Thread(target=collect, args=(stream, index), daemon=True) for index, stream in enumerate((process.stdout, process.stderr))]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + timeout
        reason = None
        while process.poll() is None:
            if exceeded.is_set() or time.monotonic() >= deadline:
                reason = "OutputLimitError" if exceeded.is_set() else "TimeoutError"
                _stop_process(process)
                break
            time.sleep(.02)
        process.wait(timeout=2)
        release_limits()
        if os.name != "nt":
            _stop_process(process)
        for reader in readers:
            reader.join(timeout=1)
        if exceeded.is_set():
            reason = "OutputLimitError"
        return process.returncode, buffers[0].decode("utf-8", "replace"), buffers[1].decode("utf-8", "replace"), reason


def execute_native(code: str, language: str, stdin: str = "") -> dict:
    started = time.perf_counter()
    result = {"language": language, "stdout": "", "stderr": "", "compile_output": "", "error": None,
              "trace": [], "trace_truncated": False, "execution_time_ms": 0.0}

    def fail(kind, message, line=None):
        result["error"] = {"type": kind, "message": message, "line": line}
        result["execution_time_ms"] = round((time.perf_counter() - started) * 1000, 2)
        return result

    if language not in ("java", "c", "cpp") or not code.strip() or len(code) > 10000 or len(stdin) > 10000:
        return fail("ValidationError", "语言、代码或输入不符合要求")
    compiler = compiler_path(language)
    if not compiler:
        return fail("ToolchainUnavailable", f"未找到 {language} 编译器，请配置对应 JDK 或 GCC 工具链")
    try:
        with tempfile.TemporaryDirectory(prefix="smartlearn-native-") as directory:
            source = Path(directory) / {"java": "Main.java", "c": "main.c", "cpp": "main.cpp"}[language]
            source.write_text(code, encoding="utf-8")
            binary = str(Path(directory) / ("main.exe" if os.name == "nt" else "main"))
            if language == "java":
                command = [compiler, "-J-Xmx256m", "-encoding", "UTF-8", "-d", directory, str(source)]
                java = str(Path(compiler).with_name("java.exe" if os.name == "nt" else "java"))
                run_command = [java, "-Xmx128m", "-Xss1m", "-Dfile.encoding=UTF-8", "-cp", directory, "Main"]
            else:
                command = [compiler, "-std=c17" if language == "c" else "-std=c++17", "-O0", "-Wall", "-Wextra", "-fdiagnostics-color=never", str(source), "-o", binary]
                if os.name == "nt":
                    command += ["-static"]
                run_command = [binary]
            status, stdout, stderr, reason = _run(command, directory, "", COMPILE_TIMEOUT)
            diagnostics = (stdout + stderr).replace(directory, "").strip()
            result["compile_output"] = diagnostics
            if reason or status:
                line = re.search(r"(?:Main\.java|main\.(?:c|cpp)):(\d+)", diagnostics)
                return fail(reason or "CompileError", diagnostics or "编译超时或输出超过限制", int(line[1]) if line else None)
            status, stdout, stderr, reason = _run(run_command, directory, stdin, RUN_TIMEOUT)
            result.update(stdout=stdout, stderr=stderr.replace(directory, ""))
            if reason:
                return fail(reason, "程序运行超过 3 秒，已停止" if reason == "TimeoutError" else "程序输出超过 16000 字节，已停止")
            if status:
                return fail("RuntimeError", result["stderr"] or f"程序异常退出，退出码 {status}")
    except (OSError, subprocess.SubprocessError) as exc:
        return fail("RunnerError", f"编译运行服务异常：{type(exc).__name__}")
    result["execution_time_ms"] = round((time.perf_counter() - started) * 1000, 2)
    return result
