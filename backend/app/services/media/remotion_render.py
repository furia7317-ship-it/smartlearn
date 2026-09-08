"""Low-concurrency Remotion renderer for whiteboard lesson videos."""

from __future__ import annotations

import asyncio
import json
import hashlib
import os
import shutil
import zipfile
from pathlib import Path
from typing import Any, Callable

from app.core.config import settings
from app.services.media.ffmpeg import _run_process


ProgressCallback = Callable[[float, str], None]


def _repository_runtime() -> Path:
    return Path(__file__).resolve().parents[4] / "frontend" / "remotion-runtime"


def resolve_runtime_dir() -> Path:
    configured = os.getenv("REMOTION_RUNTIME_DIR", "").strip()
    return Path(configured).resolve() if configured else _repository_runtime().resolve()


def _has_dependencies(runtime: Path) -> bool:
    return (runtime / "node_modules" / "@remotion" / "renderer").is_dir()


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

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()[:12]
    cache_root = Path(settings.MEDIA_OUTPUT_DIR).resolve().parent
    target = cache_root / f"remotion-runtime-{digest}"
    if _has_dependencies(target) and (target / "render.mjs").is_file():
        return target

    temporary = cache_root / f".remotion-runtime-{digest}-{os.getpid()}"
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            destination = (temporary / member.filename).resolve()
            if temporary != destination and temporary not in destination.parents:
                raise RuntimeError("Remotion 运行时压缩包包含非法路径")
        bundle.extractall(temporary)
    if not _has_dependencies(temporary) or not (temporary / "render.mjs").is_file():
        raise RuntimeError("Remotion 运行时压缩包不完整")
    if target.exists():
        shutil.rmtree(temporary)
    else:
        temporary.replace(target)
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
        return bool(
            resolve_node_binary(runtime)
            and (runtime / "render.mjs").is_file()
            and (runtime / "src" / "index.ts").is_file()
            and _has_dependencies(runtime)
        )
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
    if not node or not is_available():
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
