from __future__ import annotations

import pytest

from app.schemas.code_lab import CodeExecuteRequest
from app.services.code_execution import execute_python
from app.services.native_code_execution import compiler_path, execute_native


@pytest.mark.parametrize(("language", "source"), [
    ("c", '#include <stdio.h>\nint main(void) { int a,b; scanf("%d %d", &a, &b); printf("%d\\n", a+b); return 0; }'),
    ("cpp", '#include <iostream>\nint main() { int a,b; std::cin >> a >> b; std::cout << a+b << "\\n"; }'),
    ("java", 'import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt()+s.nextInt()); }}'),
])
def test_real_compilers_accept_stdin_and_return_stdout(language, source):
    if not compiler_path(language):
        pytest.skip(f"{language} compiler not installed")
    result = execute_native(source, language, "17 25\n")
    assert result["error"] is None, result
    assert result["stdout"].strip() == "42"
    assert result["language"] == language
    assert result["trace"] == []
    assert result["execution_time_ms"] > 0


def test_python_stdin_uses_bounded_input_without_enabling_file_access():
    result = execute_python('name = input("姓名：")\nprint("你好", name)', "小明\n")
    assert result["error"] is None
    assert result["stdout"] == "姓名：你好 小明\n"
    assert result["trace"]
    assert execute_python("open('secret')")["error"]["type"] == "ValidationError"
    assert execute_python("input()", "")["error"]["type"] == "EOFError"


@pytest.mark.parametrize("language", ["java", "c", "cpp"])
def test_compilation_failure_has_diagnostics_and_never_reports_success(language):
    if not compiler_path(language):
        pytest.skip(f"{language} compiler not installed")
    result = execute_native("this is not valid code;", language)
    assert result["error"]["type"] == "CompileError", result
    assert result["compile_output"]
    assert result["stdout"] == ""


def test_native_timeout_and_output_limit(monkeypatch):
    if not compiler_path("c"):
        pytest.skip("C compiler not installed")
    monkeypatch.setattr("app.services.native_code_execution.RUN_TIMEOUT", .2)
    result = execute_native("int main(void) { for (;;) {} }", "c")
    assert result["error"]["type"] == "TimeoutError", result
    result = execute_native('#include <stdio.h>\nint main(void) { for (;;) puts("test output"); }', "c")
    assert result["error"]["type"] == "OutputLimitError", result
    assert len(result["stdout"].encode()) <= 16000


def test_missing_toolchain_is_actionable(monkeypatch):
    monkeypatch.setattr("app.services.native_code_execution.compiler_path", lambda _: None)
    assert execute_native("int main() {}", "c")["error"]["type"] == "ToolchainUnavailable"


def test_language_schema_rejects_unknown_runtimes():
    from pydantic import ValidationError
    for language in ("python", "java", "c", "cpp"):
        assert CodeExecuteRequest(code="code", language=language, stdin="输入").language == language
    with pytest.raises(ValidationError):
        CodeExecuteRequest(code="code", language="shell")
