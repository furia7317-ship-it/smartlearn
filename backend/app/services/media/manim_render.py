"""Manim 渲染服务 — 模板化场景渲染。"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from app.core.config import settings


# ── 预置模板场景 ──

TEMPLATES: dict[str, type] = {}

TEMPLATE_PARAM_KEYS: dict[str, set[str]] = {
    "concept_card": {"title", "items"},
    "array_sort": {"array", "algorithm", "title"},
    "tree_graph_traverse": {"tree", "order", "title"},
    "formula_step": {"formula", "steps", "title"},
    "compare_table": {"columns", "rows", "title"},
}


def normalize_template_params(
    template_name: str,
    params: dict[str, Any] | None,
) -> dict[str, Any]:
    """Keep only the public constructor contract of the selected template.

    Video scripts are model-produced and older stored scripts may contain
    extra keys.  Passing those through ``Scene(**params)`` turns harmless
    metadata into a hard Manim failure, so the renderer is the final contract
    boundary as well as the agent-side normalizer.
    """

    allowed = TEMPLATE_PARAM_KEYS.get(template_name)
    if allowed is None:
        return dict(params or {})
    return {key: value for key, value in (params or {}).items() if key in allowed}


def _register_templates():
    """注册所有 Manim 模板。"""
    from app.services.media.templates.concept_card import ConceptCardScene
    from app.services.media.templates.array_sort import ArraySortScene
    from app.services.media.templates.tree_graph_traverse import TreeGraphTraverseScene
    from app.services.media.templates.formula_step import FormulaStepScene
    from app.services.media.templates.compare_table import CompareTableScene

    TEMPLATES.update({
        "concept_card": ConceptCardScene,
        "array_sort": ArraySortScene,
        "tree_graph_traverse": TreeGraphTraverseScene,
        "formula_step": FormulaStepScene,
        "compare_table": CompareTableScene,
    })


async def render_manim_scene(
    template_name: str,
    params: dict[str, Any],
    task_id: str,
) -> Path:
    """渲染 Manim 场景为 mp4。

    Args:
        template_name: 模板名
        params: 模板参数
        task_id: 任务 ID

    Returns:
        渲染后的 mp4 文件路径
    """
    if not TEMPLATES:
        _register_templates()

    scene_class = TEMPLATES.get(template_name)
    if scene_class is None:
        raise ValueError(f"未知模板: {template_name}，可选: {list(TEMPLATES.keys())}")

    # Each task receives an isolated Manim media directory.  Scene class names
    # are reused across resources, so a shared directory makes concurrent
    # renders delete each other's partial_movie_file_list.txt.
    output_dir = Path(settings.MEDIA_OUTPUT_DIR) / "video_tasks" / task_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # 在线程中运行 Manim 渲染（CPU 密集）
    loop = asyncio.get_event_loop()
    result_path = await loop.run_in_executor(
        None,
        _render_sync,
        scene_class,
        normalize_template_params(template_name, params),
        str(output_dir),
        task_id,
    )

    return Path(result_path)


def _render_sync(
    scene_class: type,
    params: dict[str, Any],
    output_dir: str,
    task_id: str,
) -> str:
    """同步渲染（在线程池中执行）。"""
    from manim import tempconfig

    quality = settings.MANIM_QUALITY
    config = {
        "quality": quality,
        "media_dir": output_dir,
        "output_file": f"{task_id}.mp4",
        "format": "mp4",
    }

    with tempconfig(config):
        scene = scene_class(**params)
        scene.render()
        movie_path = Path(scene.renderer.file_writer.movie_file_path)
        if not movie_path.is_file() or movie_path.suffix.lower() != ".mp4":
            raise RuntimeError("Manim 未产出可播放的 MP4 文件")
        return str(movie_path)


async def fallback_slideshow(
    script: dict[str, Any],
    task_id: str,
) -> Path:
    """兜底：高阶渲染不可用时使用 Pillow 生成图文幻灯。"""
    from PIL import Image, ImageDraw, ImageFont

    output_dir = Path(settings.MEDIA_OUTPUT_DIR) / "video_tasks" / task_id / "fallback"
    output_dir.mkdir(parents=True, exist_ok=True)

    params = script.get("params", {})
    title = params.get("title", script.get("topic", "学习内容"))
    items = params.get("items", ["内容生成失败"])

    # 生成简单的幻灯片图片
    width, height = 1920, 1080
    frames = []

    # 标题帧
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 60)
    except OSError:
        font = ImageFont.load_default()
    draw.text((width // 2, height // 2), title, fill=(0, 0, 0), font=font, anchor="mm")
    title_path = output_dir / f"{task_id}_frame_0.png"
    img.save(title_path)
    frames.append(title_path)

    # 内容帧
    for i, item in enumerate(items[:5]):
        img = Image.new("RGB", (width, height), color=(255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.text((100, 100), title, fill=(50, 50, 50), font=font)
        draw.text((100, 300), f"• {item}", fill=(0, 0, 0), font=font)
        frame_path = output_dir / f"{task_id}_frame_{i + 1}.png"
        img.save(frame_path)
        frames.append(frame_path)

    # Use the same binary resolver as the primary renderer.  The previous
    # fallback depended on an undeclared ``ffmpeg-python`` package, so the
    # fallback itself often failed even when ffmpeg.exe was installed.
    try:
        from app.services.media.ffmpeg import _run_ffmpeg

        concat_path = output_dir / "fallback-frames.txt"
        manifest: list[str] = []
        for frame in frames:
            manifest.extend([f"file '{frame.resolve().as_posix()}'", "duration 4"])
        manifest.append(f"file '{frames[-1].resolve().as_posix()}'")
        concat_path.write_text("\n".join(manifest), encoding="utf-8")
        output_path = output_dir / f"{task_id}_fallback.mp4"
        await _run_ffmpeg(
            [
                "-y", "-f", "concat", "-safe", "0", "-i", str(concat_path.resolve()),
                "-vf", "fps=24,format=yuv420p", "-c:v", "libx264",
                "-preset", "ultrafast", "-crf", "23", str(output_path.resolve()),
            ],
            error_label="兼容视频渲染",
        )
        return output_path
    except Exception as exc:
        # PNG is never returned as a fake completed video.
        detail = str(exc).strip() or type(exc).__name__
        raise RuntimeError(f"视频渲染依赖不可用，无法产出 MP4：{detail}") from exc
