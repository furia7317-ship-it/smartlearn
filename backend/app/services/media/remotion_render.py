"""Low-concurrency Remotion renderer for whiteboard lesson videos."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import threading
import uuid
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from app.core.config import settings
from app.services.media.ffmpeg import _run_process


ProgressCallback = Callable[[float, str], None]
_RUNTIME_CACHE_PATTERN = re.compile(r"remotion-runtime-[0-9a-f]{12}")
_RUNTIME_MARKER = ".xueshu-remotion-runtime.json"
_RUNTIME_PREPARE_LOCK = threading.Lock()
_PREPARED_RUNTIME_CACHE: dict[tuple[str, int, int, str], Path] = {}


def _repository_runtime() -> Path:
    return Path(__file__).resolve().parents[4] / "frontend" / "remotion-runtime"


def resolve_runtime_dir() -> Path:
    configured = os.getenv("REMOTION_RUNTIME_DIR", "").strip()
    return Path(configured).resolve() if configured else _repository_runtime().resolve()


def _has_dependencies(runtime: Path) -> bool:
    return all(
        (runtime / "node_modules" / "@remotion" / package).is_dir()
        for package in ("bundler", "renderer")
    )


def _runtime_is_ready(runtime: Path, digest: str | None = None) -> bool:
    if not (
        _has_dependencies(runtime)
        and (runtime / "render.mjs").is_file()
        and (runtime / "src" / "index.ts").is_file()
    ):
        return False
    if digest is None:
        return True
    try:
        marker = json.loads((runtime / _RUNTIME_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return False
    return isinstance(marker, dict) and marker.get("archive_sha256") == digest


def _calculate_archive_digest(archive: Path) -> str:
    hasher = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


@lru_cache(maxsize=8)
def _cached_archive_digest(path: str, size: int, modified_ns: int) -> str:
    del size, modified_ns
    return _calculate_archive_digest(Path(path))


def _cleanup_stale_runtime_dirs(cache_root: Path, current: Path) -> None:
    """Remove only old hash-addressed Remotion caches inside cache_root."""

    try:
        candidates = list(cache_root.iterdir())
    except OSError:
        return
    for candidate in candidates:
        if candidate == current or not _RUNTIME_CACHE_PATTERN.fullmatch(candidate.name):
            continue
        try:
            # Do not follow a symlink or junction out of the application cache.
            if candidate.is_symlink() or candidate.resolve().parent != cache_root:
                continue
            if candidate.is_dir():
                shutil.rmtree(candidate)
        except OSError:
            # A previous renderer may still have the directory open. It can be
            # retried on the next preparation without blocking this render.
            continue


def prepare_runtime_dir() -> Path:
    """Return a ready runtime, lazily extracting packaged dependencies.

    Electron packaging intentionally carries one archive instead of hundreds
    of dependency files. Extraction happens only after the learner explicitly
    starts a video render, never during desktop startup.
    """

    source = resolve_runtime_dir()
    if _has_dependencies(source):
        return source
    archive = source / "runtime.zip"
    if not archive.is_file():
        return source

    cache_root = Path(settings.MEDIA_OUTPUT_DIR).resolve().parent
    cache_root.mkdir(parents=True, exist_ok=True)
    archive = archive.resolve()
    archive_stat = archive.stat()
    cache_key = (
        str(archive),
        archive_stat.st_size,
        archive_stat.st_mtime_ns,
        str(cache_root),
    )

    with _RUNTIME_PREPARE_LOCK:
        cached = _PREPARED_RUNTIME_CACHE.get(cache_key)
        if cached is not None and _runtime_is_ready(cached):
            return cached

        digest = _cached_archive_digest(
            str(archive), archive_stat.st_size, archive_stat.st_mtime_ns
        )
        target = cache_root / f"remotion-runtime-{digest[:12]}"
        if _runtime_is_ready(target, digest):
            _PREPARED_RUNTIME_CACHE.clear()
            _PREPARED_RUNTIME_CACHE[cache_key] = target
            _cleanup_stale_runtime_dirs(cache_root, target)
            return target

        temporary = cache_root / (
            f".remotion-runtime-{digest[:12]}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        )
        temporary.mkdir(parents=True, exist_ok=False)
        try:
            with zipfile.ZipFile(archive) as bundle:
                for member in bundle.infolist():
                    destination = (temporary / member.filename).resolve()
                    if temporary != destination and temporary not in destination.parents:
                        raise RuntimeError("Remotion 运行时压缩包包含非法路径")
                bundle.extractall(temporary)
            if not _runtime_is_ready(temporary):
                raise RuntimeError("Remotion 运行时压缩包不完整")
            (temporary / _RUNTIME_MARKER).write_text(
                json.dumps({"archive_sha256": digest}, ensure_ascii=False),
                encoding="utf-8",
            )

            if target.exists():
                if target.is_symlink() or target.resolve().parent != cache_root:
                    raise RuntimeError("Remotion 运行时缓存目录不安全")
                shutil.rmtree(target)
            temporary.replace(target)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary, ignore_errors=True)

        _PREPARED_RUNTIME_CACHE.clear()
        _PREPARED_RUNTIME_CACHE[cache_key] = target
        _cleanup_stale_runtime_dirs(cache_root, target)
        return target


def resolve_node_binary(runtime_dir: Path | None = None) -> str | None:
    configured = os.getenv("REMOTION_NODE_BINARY", "").strip()
    if configured and Path(configured).is_file():
        return str(Path(configured).resolve())

    runtime_dir = runtime_dir or resolve_runtime_dir()
    candidates = [
        runtime_dir.parent / "node" / "node.exe",
        Path("D:/enviment/node.exe"),
        Path("C:/Program Files/nodejs/node.exe"),
    ]
    discovered = shutil.which("node") or shutil.which("node.exe")
    if discovered:
        candidates.insert(0, Path(discovered))
    return next((str(path.resolve()) for path in candidates if path.is_file()), None)


def resolve_browser_executable() -> str | None:
    configured = os.getenv("REMOTION_BROWSER_EXECUTABLE", "").strip()
    candidates = [
        Path(configured) if configured else None,
        Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
        Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
        Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
        Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
    ]
    return next((str(path.resolve()) for path in candidates if path and path.is_file()), None)


def is_available() -> bool:
    try:
        runtime = prepare_runtime_dir()
        return bool(resolve_node_binary(runtime) and _runtime_is_ready(runtime))
    except (OSError, RuntimeError, zipfile.BadZipFile):
        return False


def build_input_props(script: dict[str, Any]) -> dict[str, Any]:
    scenes = [dict(scene) for scene in script.get("scenes") or [] if isinstance(scene, dict)]
    if not scenes:
        scenes = [
            {
                "title": str(script.get("title") or script.get("topic") or "核心概念"),
                "narration": str(script.get("narration_text") or ""),
                "duration": 8,
                "composition": "hero",
                "reveal_sequence": ["核心问题", "关键关系", "迁移应用"],
            }
        ]
    return {
        "title": str(script.get("title") or script.get("topic") or "学枢白板讲解"),
        "scenes": scenes,
        "visual_system": (
            dict(script.get("visual_system"))
            if isinstance(script.get("visual_system"), dict)
            else {}
        ),
    }


async def render_remotion_video(
    script: dict[str, Any],
    task_id: str,
    *,
    on_progress: ProgressCallback | None = None,
) -> Path:
    runtime = await asyncio.to_thread(prepare_runtime_dir)
    node = resolve_node_binary(runtime)
    if not node or not _runtime_is_ready(runtime):
        raise RuntimeError("Remotion 桌面渲染运行时不可用")

    task_dir = Path(settings.MEDIA_OUTPUT_DIR) / "video_tasks" / task_id / "remotion"
    task_dir.mkdir(parents=True, exist_ok=True)
    props_path = task_dir / "input-props.json"
    output_path = task_dir / "visual.mp4"
    props_path.write_text(
        json.dumps(build_input_props(script), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if on_progress:
        on_progress(0.03, "正在准备 Remotion 白板动画")
    args = [str(runtime / "render.mjs"), str(props_path), str(output_path)]
    browser = resolve_browser_executable()
    if browser:
        args.append(browser)
    returncode, stdout, stderr = await _run_process(node, args, cwd=runtime)
    if returncode != 0:
        detail = (stderr or stdout).decode(errors="replace")[-1200:]
        raise RuntimeError(f"Remotion 白板动画渲染失败: {detail}")
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        raise RuntimeError("Remotion 白板动画未产出有效 MP4")
    if on_progress:
        on_progress(1.0, "Remotion 白板动画已完成")
    return output_path
