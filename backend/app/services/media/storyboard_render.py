"""Reliable multi-scene MP4 renderer for generated educational videos.

The model produces narration plus a visual brief per scene.  This renderer
turns that plan into a branded 16:9 storyboard, keeps every scene on screen for
its planned narration duration, and produces one deterministic MP4 before TTS
or subtitle post-processing.  It deliberately has no external media-provider
dependency, so a missing stock-video API can never block a learning path.
"""

from __future__ import annotations

import asyncio
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.core.config import settings
from app.services.media.ffmpeg import _run_ffmpeg
from app.services.media.video_continuity import prepare_scene_continuity

WIDTH = 1280
HEIGHT = 720
PORTRAIT_WIDTH = 720
PORTRAIT_HEIGHT = 1280
FPS = 24
TRANSITION_SECONDS = 0.45
REVEAL_TRANSITION_SECONDS = 0.22

PAPER = "#F7F1E6"
PAPER_DARK = "#E9DDCA"
INK = "#332416"
MUTED = "#786A59"
BROWN = "#7B4D1E"
OCHRE = "#C58A2A"
GREEN = "#56745A"
BLUE = "#5E788C"
WHITE = "#FFFDF8"

ProgressCallback = Callable[[float, str], None]


@lru_cache(maxsize=1)
def _mascot_avatar() -> Image.Image | None:
    """Reuse the approved web red-panda teacher in exported videos."""

    asset = (
        Path(__file__).resolve().parents[4]
        / "frontend"
        / "public"
        / "brand"
        / "animals"
        / "red-panda-plan.webp"
    )
    if not asset.is_file():
        return None
    source = Image.open(asset).convert("RGB")
    width, height = source.size
    face_crop = source.crop((int(width * 0.22), int(height * 0.14), int(width * 0.84), int(height * 0.55)))
    avatar = ImageOps.fit(face_crop, (88, 88), method=Image.Resampling.LANCZOS)
    mask = Image.new("L", avatar.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 87, 87), fill=255)
    avatar.putalpha(mask)
    return avatar


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/msyhbd.ttc") if bold else Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
    *,
    max_lines: int,
) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    lines: list[str] = []
    current = ""
    for char in text:
        candidate = current + char
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current.rstrip())
        current = char.lstrip()
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current.rstrip())
    consumed = "".join(lines)
    if len(consumed) < len(text) and lines:
        lines[-1] = f"{lines[-1].rstrip('…')}…"
    return lines


def _rounded(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    *,
    fill: str,
    outline: str | None = None,
    radius: int = 18,
    width: int = 1,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def _draw_focus_visual(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    box: tuple[int, int, int, int],
) -> None:
    left, top, right, bottom = box
    template = str(scene.get("visual_template") or "concept_card")
    params = scene.get("visual_params") if isinstance(scene.get("visual_params"), dict) else {}
    focus = [str(item) for item in scene.get("focus_terms") or [] if str(item).strip()]
    items = [str(item) for item in params.get("items") or [] if str(item).strip()]
    labels = list(dict.fromkeys([*focus, *items]))[:5]
    title_font = _font(24, bold=True)
    body_font = _font(20)

    _rounded(draw, box, fill=WHITE, outline=PAPER_DARK, radius=24, width=2)
    if template == "compare_table":
        columns = [str(item) for item in params.get("columns") or []][:3] or ["要点", "做法", "结果"]
        rows = [row for row in params.get("rows") or [] if isinstance(row, list)][:3]
        rows = rows[:_scene_reveal_count(scene, len(rows))]
        col_width = (right - left - 48) // max(1, len(columns))
        y = top + 40
        for index, label in enumerate(columns):
            x = left + 24 + index * col_width
            draw.text((x, y), label, font=title_font, fill=BROWN)
        y += 48
        draw.line((left + 24, y, right - 24, y), fill=PAPER_DARK, width=2)
        for row in rows:
            y += 44
            for index, value in enumerate(row[: len(columns)]):
                x = left + 24 + index * col_width
                draw.text((x, y), str(value)[:12], font=body_font, fill=INK)
        return

    if template == "formula_step":
        formula = str(params.get("formula") or (labels[0] if labels else "关键关系"))
        draw.text((left + 28, top + 36), formula, font=_font(34, bold=True), fill=BROWN)
        steps = [str(item) for item in params.get("steps") or labels][:4]
        steps = steps[:_scene_reveal_count(scene, len(steps))]
        y = top + 115
        for index, step in enumerate(steps, 1):
            _rounded(draw, (left + 28, y, right - 28, y + 54), fill="#F3E7D4", radius=12)
            draw.text((left + 46, y + 13), f"{index}. {step[:20]}", font=body_font, fill=INK)
            y += 68
        return

    if template == "array_sort":
        values = params.get("array") if isinstance(params.get("array"), list) else [7, 3, 9, 2, 5]
        values = values[:7]
        visible_values = _scene_reveal_count(scene, len(values))
        cell = min(62, (right - left - 70) // max(1, len(values)))
        start_x = left + (right - left - cell * len(values)) // 2
        y = top + 100
        for index, value in enumerate(values):
            if index >= visible_values:
                continue
            fill = "#F2D8AE" if index in {1, 2} else "#EEE7DA"
            _rounded(draw, (start_x + index * cell, y, start_x + (index + 1) * cell - 8, y + 58), fill=fill, radius=10)
            draw.text((start_x + index * cell + 18, y + 14), str(value), font=title_font, fill=INK)
        draw.text((left + 34, y + 95), str(params.get("algorithm") or "观察 → 比较 → 更新"), font=body_font, fill=MUTED)
        return

    if template == "tree_graph_traverse":
        points = [
            ((left + right) // 2, top + 70),
            (left + 105, top + 185),
            (right - 105, top + 185),
            (left + 55, top + 305),
            (left + 165, top + 305),
            (right - 165, top + 305),
            (right - 55, top + 305),
        ]
        visible_levels = _scene_reveal_count(scene, 4)
        visible_nodes = (1, 3, 7, 7)[visible_levels - 1]
        for child, parent in ((1, 0), (2, 0), (3, 1), (4, 1), (5, 2), (6, 2)):
            if child >= visible_nodes:
                continue
            draw.line((*points[parent], *points[child]), fill="#A99882", width=4)
        for index, (x, y) in enumerate(points):
            if index >= visible_nodes:
                continue
            color = OCHRE if index < 3 else GREEN
            draw.ellipse((x - 25, y - 25, x + 25, y + 25), fill=color)
            draw.text((x, y), str(index + 1), font=_font(18, bold=True), fill=WHITE, anchor="mm")
        return

    # Default concept-card visual: one focal term plus supporting cards.
    support_labels = {
        "hook": ["问题", "冲突", "学习目标"],
        "concept": ["定义", "作用", "判断方法"],
        "example": ["输入", "过程", "结果"],
        "pitfall": ["错误表现", "原因", "检查方法"],
        "application": ["使用条件", "真实场景", "迁移方法"],
        "recap": ["关键结论", "一分钟回忆", "自测问题"],
    }
    if not labels:
        labels = [str(scene.get("title") or "本段重点")]
    labels = list(dict.fromkeys([
        *labels,
        *support_labels.get(str(scene.get("purpose") or "concept"), support_labels["concept"]),
    ]))[:5]
    visible_labels = _scene_reveal_count(scene, len(labels))
    draw.text((left + 30, top + 30), "本段只记住", font=_font(20, bold=True), fill=MUTED)
    if visible_labels:
        draw.text((left + 30, top + 72), labels[0][:16], font=_font(36, bold=True), fill=BROWN)
    y = top + 142
    colors = ("#F3E1C4", "#E4EBDD", "#DEE8EC", "#EEE4D9")
    for index, label in enumerate(labels[1:visible_labels]):
        _rounded(draw, (left + 30, y, right - 30, y + 57), fill=colors[index % len(colors)], radius=13)
        draw.ellipse((left + 48, y + 22, left + 60, y + 34), fill=(OCHRE, GREEN, BLUE, BROWN)[index % 4])
        draw.text((left + 76, y + 15), label[:22], font=body_font, fill=INK)
        y += 68


def _render_portrait_scene_frame(
    scene: dict[str, Any],
    *,
    video_title: str,
    index: int,
    total: int,
    output_path: Path,
) -> None:
    """Render a native 9:16 teaching overlay for short-video workflows."""

    image = Image.new("RGB", (PORTRAIT_WIDTH, PORTRAIT_HEIGHT), PAPER)
    draw = ImageDraw.Draw(image)
    for y in range(0, PORTRAIT_HEIGHT, 18):
        shade = 242 + (y // 18 % 2)
        draw.line((0, y, PORTRAIT_WIDTH, y), fill=(shade, shade - 4, shade - 10), width=1)
    draw.rectangle((0, 0, PORTRAIT_WIDTH, 18), fill=INK)

    purpose_labels = {
        "hook": "问题钩子", "concept": "概念拆解", "example": "例子演示",
        "pitfall": "易错提醒", "application": "真实应用", "recap": "总结自测",
    }
    purpose = purpose_labels.get(str(scene.get("purpose") or ""), "重点讲解")
    _rounded(draw, (42, 54, 174, 96), fill=INK, radius=20)
    draw.text((108, 75), purpose, font=_font(17, bold=True), fill=WHITE, anchor="mm")
    draw.text((678, 65), f"{index + 1:02d} / {total:02d}", font=_font(18, bold=True), fill=BROWN, anchor="ra")
    draw.text((42, 124), video_title[:26], font=_font(18, bold=True), fill=MUTED)

    title = str(scene.get("title") or "章节内容")
    title_lines = _wrap_text(draw, title, _font(42, bold=True), 636, max_lines=2)
    for line_index, line in enumerate(title_lines):
        draw.text((42, 175 + line_index * 56), line, font=_font(42, bold=True), fill=INK)
    divider_y = 185 + len(title_lines) * 58
    draw.line((42, divider_y, 678, divider_y), fill=OCHRE, width=5)

    narration = str(scene.get("narration") or scene.get("text") or "")
    summary_lines = _wrap_text(draw, narration, _font(23), 636, max_lines=3)
    for line_index, line in enumerate(summary_lines):
        draw.text((44, divider_y + 30 + line_index * 38), line, font=_font(23), fill=MUTED)

    visual_top = min(430, divider_y + 30 + len(summary_lines) * 42 + 20)
    _draw_focus_visual(draw, scene, (42, visual_top, 678, 870))

    focus_terms = [str(item) for item in scene.get("focus_terms") or [] if str(item).strip()]
    x, y = 42, 906
    for term in focus_terms[:5]:
        term_width = min(200, draw.textbbox((0, 0), term, font=_font(17, bold=True))[2] + 34)
        if x + term_width > 678:
            x, y = 42, y + 48
        _rounded(draw, (x, y, x + term_width, y + 38), fill="#F0DEBE", radius=18)
        draw.text((x + 17, y + 9), term[:12], font=_font(17, bold=True), fill=BROWN)
        x += term_width + 10

    steps = ("问题", "概念", "例子", "易错", "应用", "总结")
    active = min(len(steps) - 1, round(index * (len(steps) - 1) / max(1, total - 1)))
    route_y = 1070
    for route_index, label in enumerate(steps):
        route_x = 50 + route_index * 108
        draw.ellipse(
            (route_x, route_y, route_x + 18, route_y + 18),
            fill=OCHRE if route_index == active else PAPER_DARK,
        )
        if route_index < len(steps) - 1:
            draw.line((route_x + 18, route_y + 9, route_x + 96, route_y + 9), fill=PAPER_DARK, width=3)
        draw.text((route_x - 4, route_y + 28), label, font=_font(14), fill=INK if route_index == active else MUTED)

    draw.rounded_rectangle((42, 1216, 678, 1224), radius=4, fill=PAPER_DARK)
    progress_width = int(636 * (index + 1) / total)
    draw.rounded_rectangle((42, 1216, 42 + progress_width, 1224), radius=4, fill=BROWN)
    draw.text((678, 1170), f"约 {float(scene.get('duration') or 0):g} 秒", font=_font(14), fill=MUTED, anchor="ra")
    mascot = _mascot_avatar()
    if mascot is not None:
        draw.ellipse((42, 1135, 136, 1229), fill=WHITE, outline=PAPER_DARK, width=3)
        image.paste(mascot, (45, 1138), mascot)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, optimize=True)


def _render_legacy_scene_frame(
    scene: dict[str, Any],
    *,
    video_title: str,
    index: int,
    total: int,
    output_path: Path,
    orientation: str = "landscape",
) -> None:
    if orientation == "portrait":
        _render_portrait_scene_frame(
            scene,
            video_title=video_title,
            index=index,
            total=total,
            output_path=output_path,
        )
        return
    image = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(image)

    # Paper texture without external assets.
    for y in range(0, HEIGHT, 18):
        shade = 242 + (y // 18 % 2)
        draw.line((0, y, WIDTH, y), fill=(shade, shade - 4, shade - 10), width=1)
    draw.rectangle((0, 0, 22, HEIGHT), fill=INK)

    purpose_labels = {
        "hook": "问题钩子",
        "concept": "概念拆解",
        "example": "例子演示",
        "pitfall": "易错提醒",
        "application": "真实应用",
        "recap": "总结自测",
    }
    purpose = purpose_labels.get(str(scene.get("purpose") or ""), "重点讲解")
    _rounded(draw, (58, 42, 180, 78), fill=INK, radius=18)
    draw.text((119, 60), purpose, font=_font(16, bold=True), fill=WHITE, anchor="mm")
    draw.text((206, 47), video_title[:32], font=_font(18, bold=True), fill=MUTED)
    draw.text((1182, 48), f"{index + 1:02d} / {total:02d}", font=_font(18, bold=True), fill=BROWN, anchor="ra")

    title = str(scene.get("title") or "章节内容")
    draw.text((58, 112), title[:28], font=_font(43, bold=True), fill=INK)
    draw.line((58, 175, 717, 175), fill=OCHRE, width=5)

    narration = str(scene.get("narration") or scene.get("text") or "")
    lines = _wrap_text(draw, narration, _font(23), 650, max_lines=5)
    for line_index, line in enumerate(lines):
        draw.text((60, 205 + line_index * 40), line, font=_font(23), fill=MUTED)

    focus_terms = [str(item) for item in scene.get("focus_terms") or [] if str(item).strip()]
    x = 58
    for term in focus_terms[:4]:
        term_width = min(190, draw.textbbox((0, 0), term, font=_font(16, bold=True))[2] + 34)
        if x + term_width > 720:
            break
        _rounded(draw, (x, 438, x + term_width, 474), fill="#F0DEBE", radius=18)
        draw.text((x + 17, 447), term[:12], font=_font(16, bold=True), fill=BROWN)
        x += term_width + 10

    _draw_focus_visual(draw, scene, (760, 112, 1218, 548))

    # Story arc and progress provide continuity across scene cuts.
    steps = ("问题", "概念", "例子", "易错", "应用", "总结")
    draw.text((60, 548), "本节路线", font=_font(15, bold=True), fill=MUTED)
    route_y = 594
    for route_index, label in enumerate(steps):
        route_x = 65 + route_index * 112
        active = min(
            len(steps) - 1,
            round(index * (len(steps) - 1) / max(1, total - 1)),
        )
        color = OCHRE if route_index == active else PAPER_DARK
        draw.ellipse((route_x, route_y, route_x + 18, route_y + 18), fill=color)
        if route_index < len(steps) - 1:
            draw.line((route_x + 18, route_y + 9, route_x + 99, route_y + 9), fill=PAPER_DARK, width=3)
        draw.text((route_x - 3, route_y + 30), label, font=_font(14), fill=INK if route_index == active else MUTED)

    progress_left, progress_right = 58, 1218
    draw.rounded_rectangle((progress_left, 675, progress_right, 683), radius=4, fill=PAPER_DARK)
    width = int((progress_right - progress_left) * (index + 1) / total)
    draw.rounded_rectangle((progress_left, 675, progress_left + width, 683), radius=4, fill=BROWN)
    draw.text((1218, 646), f"约 {float(scene.get('duration') or 0):g} 秒", font=_font(14), fill=MUTED, anchor="ra")
    stock_credit = str(scene.get("stock_credit") or "").strip()
    if stock_credit:
        draw.text((1050, 646), stock_credit[:30], font=_font(12), fill=MUTED, anchor="ra")

    mascot = _mascot_avatar()
    if mascot is not None:
        draw.ellipse((1093, 557, 1187, 651), fill=WHITE, outline=PAPER_DARK, width=3)
        image.paste(mascot, (1096, 560), mascot)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, optimize=True)


_CHAPTER_ACCENTS = ("#C95F32", "#32736B", "#476E91", "#B27A24", "#704C8A", "#6A7044")


def _scene_accent(scene: dict[str, Any]) -> str:
    chapter_id = str(scene.get("chapter_id") or "01")
    match = re.search(r"\d+", chapter_id)
    chapter_index = int(match.group()) - 1 if match else 0
    return _CHAPTER_ACCENTS[chapter_index % len(_CHAPTER_ACCENTS)]


def _scene_visual_labels(scene: dict[str, Any], *, maximum: int = 5) -> list[str]:
    params = scene.get("visual_params") if isinstance(scene.get("visual_params"), dict) else {}
    explicit_labels: list[str] = []
    for key in ("steps", "items"):
        values = params.get(key)
        if isinstance(values, list):
            explicit_labels.extend(str(value).strip() for value in values if str(value).strip())
    if explicit_labels:
        return list(dict.fromkeys(explicit_labels))[:maximum]

    labels: list[str] = []
    labels.extend(str(value).strip() for value in scene.get("focus_terms") or [] if str(value).strip())
    labels.append(str(scene.get("visual_anchor") or "").strip())
    return list(dict.fromkeys(label for label in labels if label))[:maximum]


def _scene_reveal_units(scene: dict[str, Any], *, maximum: int = 4) -> list[str]:
    raw_sequence = scene.get("reveal_sequence")
    sequence = [
        str(item.get("label") or item.get("text") or "").strip()
        if isinstance(item, dict)
        else str(item).strip()
        for item in raw_sequence or []
    ] if isinstance(raw_sequence, list) else []
    sequence = list(dict.fromkeys(item for item in sequence if item))
    if sequence:
        return sequence[:maximum]

    params = scene.get("visual_params") if isinstance(scene.get("visual_params"), dict) else {}
    template = str(scene.get("visual_template") or "concept_card")
    units: list[str] = []
    if template == "compare_table":
        units.extend(
            str(row[0]).strip()
            for row in params.get("rows") or []
            if isinstance(row, list) and row and str(row[0]).strip()
        )
    for key in ("steps", "items"):
        values = params.get(key)
        if isinstance(values, list):
            units.extend(str(value).strip() for value in values if str(value).strip())
    if template == "tree_graph_traverse" and not units:
        units.extend(("根节点", "展开第一层", "展开第二层", "完成遍历"))
    units.extend(str(value).strip() for value in scene.get("focus_terms") or [] if str(value).strip())
    if not units:
        units.append(str(scene.get("visual_anchor") or scene.get("title") or "本段重点"))
    return list(dict.fromkeys(unit for unit in units if unit))[:maximum]


def _scene_reveal_count(scene: dict[str, Any], total: int) -> int:
    if total <= 0:
        return 0
    try:
        reveal_index = int(scene.get("_reveal_index") or total)
    except (TypeError, ValueError):
        reveal_index = total
    return max(1, min(total, reveal_index))


def _scene_reveal_plan(scene: dict[str, Any], duration: float) -> list[dict[str, Any]]:
    units = _scene_reveal_units(scene)
    phase_count = max(1, min(len(units), int(max(duration, 1.0) / 0.8)))
    units = units[:phase_count]
    phase_duration = duration / phase_count
    durations = [phase_duration] * phase_count
    durations[-1] += duration - sum(durations)
    return [
        {
            "index": index + 1,
            "total": phase_count,
            "label": label,
            "duration": phase_duration,
        }
        for index, (label, phase_duration) in enumerate(zip(units, durations, strict=True))
    ]


def _draw_stage_context(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
) -> None:
    chapter_title = str(scene.get("chapter_title") or "重点讲解")
    beat_index = max(1, int(scene.get("beat_index") or 1))
    beat_total = max(1, int(scene.get("beat_total") or 1))
    draw.text((66, 42), chapter_title, font=_font(18, bold=True), fill=accent)
    draw.text((1214, 42), f"{beat_index:02d} / {beat_total:02d}", font=_font(17, bold=True), fill=MUTED, anchor="ra")
    start_x, end_x, y = 66, 1214, 78
    draw.line((start_x, y, end_x, y), fill=PAPER_DARK, width=3)
    step_width = (end_x - start_x) / max(1, beat_total - 1)
    for step in range(beat_total):
        x = int(start_x + step * step_width) if beat_total > 1 else start_x
        radius = 7 if step + 1 == beat_index else 4
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=accent if step + 1 <= beat_index else PAPER_DARK)


def _draw_carry_over(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
    y: int = 612,
) -> None:
    carry_over = str(scene.get("carry_over") or "").strip()
    anchor = str(scene.get("visual_anchor") or "").strip()
    if not carry_over or str(scene.get("relation_to_previous") or "") == "new_chapter":
        return
    draw.text((68, y), f"承接  {carry_over[:18]}", font=_font(16, bold=True), fill=MUTED)
    draw.line((285, y + 11, 352, y + 11), fill=accent, width=3)
    draw.polygon(((352, y + 5), (366, y + 11), (352, y + 17)), fill=accent)
    draw.text((386, y), f"推进  {anchor[:20]}", font=_font(16, bold=True), fill=accent)


def _draw_hero_composition(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
) -> None:
    title = str(scene.get("title") or "本段重点")
    title_lines = _wrap_text(draw, title, _font(64, bold=True), 1080, max_lines=2)
    for line_index, line in enumerate(title_lines):
        draw.text((70, 135 + line_index * 76), line, font=_font(64, bold=True), fill=INK)
    underline_y = 146 + len(title_lines) * 78
    draw.rectangle((70, underline_y, 340, underline_y + 8), fill=accent)
    labels = _scene_reveal_units(scene, maximum=3)
    visible_count = _scene_reveal_count(scene, len(labels))
    current_label = labels[visible_count - 1] if visible_count else str(scene.get("narration") or "")
    summary = _wrap_text(draw, current_label, _font(30, bold=True), 760, max_lines=2)
    for line_index, line in enumerate(summary):
        draw.text((72, underline_y + 36 + line_index * 44), line, font=_font(30, bold=True), fill=MUTED)
    anchor = str(scene.get("visual_anchor") or title)
    _rounded(draw, (850, 170, 1190, 510), fill="#EFE2CC", outline=PAPER_DARK, radius=8, width=2)
    draw.text((1020, 290), anchor[:9], font=_font(52, bold=True), fill=accent, anchor="mm")
    draw.text((1020, 350), "本章视觉锚点", font=_font(17, bold=True), fill=MUTED, anchor="mm")
    for index, label in enumerate(labels[:visible_count]):
        x = 72 + index * 240
        draw.text((x, 515), label[:12], font=_font(22, bold=True), fill=accent if index == 0 else INK)
        draw.line((x, 550, x + 190, 550), fill=accent if index == 0 else PAPER_DARK, width=4)


def _draw_split_composition(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
) -> None:
    title = str(scene.get("title") or "本段重点")
    title_lines = _wrap_text(draw, title, _font(48, bold=True), 600, max_lines=2)
    for line_index, line in enumerate(title_lines):
        draw.text((68, 130 + line_index * 60), line, font=_font(48, bold=True), fill=INK)
    units = _scene_reveal_units(scene, maximum=4)
    visible_count = _scene_reveal_count(scene, len(units))
    current_label = units[visible_count - 1] if visible_count else title
    summary = _wrap_text(draw, current_label, _font(30, bold=True), 580, max_lines=2)
    summary_y = 160 + len(title_lines) * 62
    draw.text((70, summary_y - 30), "当前讲到", font=_font(16, bold=True), fill=accent)
    for line_index, line in enumerate(summary):
        draw.text((70, summary_y + line_index * 42), line, font=_font(30, bold=True), fill=INK)
    previous = units[:max(0, visible_count - 1)]
    for line_index, label in enumerate(previous[-2:]):
        draw.text((72, summary_y + 104 + line_index * 34), f"已建立  {label[:20]}", font=_font(18), fill=MUTED)
    anchor = str(scene.get("visual_anchor") or title)
    draw.text((70, 474), anchor[:18], font=_font(34, bold=True), fill=accent)
    _draw_focus_visual(draw, scene, (700, 126, 1212, 572))


def _draw_process_composition(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
) -> None:
    title = str(scene.get("title") or "过程推进")
    draw.text((68, 126), title[:30], font=_font(47, bold=True), fill=INK)
    anchor = str(scene.get("visual_anchor") or title)
    draw.text((1212, 138), anchor[:18], font=_font(22, bold=True), fill=accent, anchor="ra")
    labels = _scene_reveal_units(scene, maximum=5) or ["输入", "判断", "处理", "结果"]
    visible_count = _scene_reveal_count(scene, len(labels))
    active = visible_count - 1
    left, right, y = 110, 1170, 338
    step = (right - left) / max(1, len(labels) - 1)
    draw.line((left, y, right, y), fill=PAPER_DARK, width=10)
    for index, label in enumerate(labels):
        if index >= visible_count:
            continue
        x = int(left + index * step) if len(labels) > 1 else (left + right) // 2
        is_current = index == active
        is_done = index < active
        radius = 38 if is_current else 27
        color = accent if is_current else GREEN
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
        draw.text((x, y), str(index + 1), font=_font(22, bold=True), fill=WHITE if is_current or is_done else MUTED, anchor="mm")
        label_lines = _wrap_text(draw, label, _font(20, bold=is_current), 180, max_lines=2)
        for line_index, line in enumerate(label_lines):
            draw.text((x, y + 62 + line_index * 30), line, font=_font(20, bold=is_current), fill=INK if is_current else MUTED, anchor="ma")
    summary = _wrap_text(draw, labels[active], _font(25, bold=True), 1050, max_lines=2)
    for line_index, line in enumerate(summary):
        draw.text((640, 532 + line_index * 36), line, font=_font(25, bold=True), fill=MUTED, anchor="ma")


def _draw_comparison_composition(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
) -> None:
    title = str(scene.get("title") or "对照与修正")
    draw.text((68, 124), title[:30], font=_font(47, bold=True), fill=INK)
    params = scene.get("visual_params") if isinstance(scene.get("visual_params"), dict) else {}
    columns = [str(item) for item in params.get("columns") or []][:2]
    rows = [row for row in params.get("rows") or [] if isinstance(row, list)]
    labels = _scene_visual_labels(scene, maximum=4)
    left_title = columns[0] if columns else "容易忽略"
    right_title = columns[1] if len(columns) > 1 else "更稳做法"
    left_items = [str(row[0]) for row in rows if row] or labels[:2] or ["只看表面结果"]
    right_items = [str(row[1]) for row in rows if len(row) > 1] or labels[2:] or ["检查条件与过程"]
    visible_count = _scene_reveal_count(scene, max(len(left_items), len(right_items)))
    left_items = left_items[:visible_count]
    right_items = right_items[:visible_count]
    _rounded(draw, (66, 210, 610, 548), fill="#F1E2DA", outline="#D8B7A8", radius=8, width=2)
    _rounded(draw, (670, 210, 1214, 548), fill="#E2ECE4", outline="#AFC4B3", radius=8, width=2)
    draw.text((104, 246), left_title[:16], font=_font(29, bold=True), fill="#924C3A")
    draw.text((708, 246), right_title[:16], font=_font(29, bold=True), fill=accent)
    for index, item in enumerate(left_items[:3]):
        draw.text((106, 320 + index * 64), f"×  {item[:20]}", font=_font(22), fill=INK)
    for index, item in enumerate(right_items[:3]):
        draw.text((710, 320 + index * 64), f"+  {item[:20]}", font=_font(22, bold=index == 0), fill=INK)
    draw.text((640, 380), "→", font=_font(42, bold=True), fill=accent, anchor="mm")


def _draw_recap_composition(
    draw: ImageDraw.ImageDraw,
    scene: dict[str, Any],
    *,
    accent: str,
) -> None:
    title = str(scene.get("title") or "串联与自测")
    draw.text((640, 126), title[:28], font=_font(48, bold=True), fill=INK, anchor="ma")
    labels = _scene_reveal_units(scene, maximum=5) or ["问题", "概念", "例子", "应用", "自测"]
    visible_count = _scene_reveal_count(scene, len(labels))
    center_x, center_y = 640, 365
    radius_x = 430
    for index, label in enumerate(labels):
        if index >= visible_count:
            continue
        angle_ratio = index / max(1, len(labels) - 1)
        x = int(center_x - radius_x + 2 * radius_x * angle_ratio)
        y = int(center_y + (45 if index % 2 else -45))
        if index:
            previous_ratio = (index - 1) / max(1, len(labels) - 1)
            previous_x = int(center_x - radius_x + 2 * radius_x * previous_ratio)
            previous_y = int(center_y + (45 if (index - 1) % 2 else -45))
            draw.line((previous_x + 28, previous_y, x - 28, y), fill=PAPER_DARK, width=5)
        is_current = index == visible_count - 1
        draw.ellipse((x - 30, y - 30, x + 30, y + 30), fill=accent if is_current else WHITE, outline=accent, width=4)
        draw.text((x, y), str(index + 1), font=_font(20, bold=True), fill=WHITE if is_current else accent, anchor="mm")
        draw.text((x, y + 54), label[:10], font=_font(19, bold=is_current), fill=INK, anchor="ma")
    summary = _wrap_text(draw, labels[visible_count - 1], _font(23, bold=True), 1040, max_lines=2)
    for line_index, line in enumerate(summary):
        draw.text((640, 560 + line_index * 34), line, font=_font(23), fill=MUTED, anchor="ma")


def _render_landscape_scene_frame(
    scene: dict[str, Any],
    *,
    video_title: str,
    index: int,
    total: int,
    output_path: Path,
) -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(image)
    theme = str(scene.get("visual_theme") or "chalk-garden")
    if theme == "blueprint":
        for x in range(0, WIDTH, 40):
            draw.line((x, 0, x, HEIGHT), fill="#E3E9EC", width=1)
        for y in range(0, HEIGHT, 40):
            draw.line((0, y, WIDTH, y), fill="#E3E9EC", width=1)
    elif theme == "split-canvas":
        draw.rectangle((0, 0, WIDTH // 2, HEIGHT), fill="#F7E9DE")
        draw.rectangle((WIDTH // 2, 0, WIDTH, HEIGHT), fill="#E7EEF0")
    else:
        for y in range(0, HEIGHT, 22):
            shade = 245 - (y // 22 % 2)
            draw.line((0, y, WIDTH, y), fill=(shade, shade - 3, shade - 8), width=1)

    accent = _scene_accent(scene)
    _draw_stage_context(draw, scene, accent=accent)
    composition = str(scene.get("composition") or "split")
    drawers = {
        "hero": _draw_hero_composition,
        "split": _draw_split_composition,
        "process": _draw_process_composition,
        "comparison": _draw_comparison_composition,
        "recap": _draw_recap_composition,
    }
    drawers.get(composition, _draw_split_composition)(draw, scene, accent=accent)
    _draw_carry_over(draw, scene, accent=accent)
    if composition in {"hero", "recap"}:
        mascot = _mascot_avatar()
        if mascot is not None:
            resized_mascot = mascot.resize((70, 70), Image.Resampling.LANCZOS)
            image.paste(resized_mascot, (1170, 620), resized_mascot)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, optimize=True)


def _render_scene_frame(
    scene: dict[str, Any],
    *,
    video_title: str,
    index: int,
    total: int,
    output_path: Path,
    orientation: str = "landscape",
) -> None:
    if orientation == "portrait":
        _render_portrait_scene_frame(
            scene,
            video_title=video_title,
            index=index,
            total=total,
            output_path=output_path,
        )
        return
    _render_landscape_scene_frame(
        scene,
        video_title=video_title,
        index=index,
        total=total,
        output_path=output_path,
    )


def _scenes_from_script(script: dict[str, Any]) -> list[dict[str, Any]]:
    scenes = [
        dict(scene)
        for scene in script.get("scenes") or []
        if isinstance(scene, dict)
    ]
    if scenes:
        return scenes
    params = script.get("params") if isinstance(script.get("params"), dict) else {}
    return [
        {
            "title": str(segment.get("title") or ""),
            "purpose": "concept",
            "narration": str(segment.get("text") or ""),
            "duration": max(5.0, float(segment.get("duration") or 20)),
            "visual_template": str(script.get("template") or "concept_card"),
            "visual_params": params,
            "focus_terms": [],
        }
        for index, segment in enumerate(script.get("narration") or [])
        if isinstance(segment, dict)
    ]


def _static_motion_filter(
    scene: dict[str, Any],
    *,
    duration: float,
    width: int,
    height: int,
    fade_in: bool,
    fade_out: bool,
) -> str:
    filters = [
        f"scale={width}:{height}",
        f"fps={FPS}",
    ]
    if fade_in:
        filters.append("fade=t=in:st=0:d=0.25")
    if fade_out:
        filters.append(f"fade=t=out:st={max(0.0, duration - 0.3):.3f}:d=0.3")
    filters.append("format=yuv420p")
    return ",".join(filters)


async def _render_progressive_scene_clip(
    frame_paths: list[Path],
    phase_durations: list[float],
    output_path: Path,
    *,
    stock_path: Path | None = None,
    extra_duration: float = 0.0,
    fade_in: bool = False,
    fade_out: bool = False,
) -> None:
    if not frame_paths or len(frame_paths) != len(phase_durations):
        raise ValueError("逐步揭示帧与时长不匹配")

    inputs: list[str] = []
    filters: list[str] = []
    phase_labels: list[str] = []
    phase_start = 0.0
    for index, (frame_path, phase_duration) in enumerate(
        zip(frame_paths, phase_durations, strict=True)
    ):
        clip_duration = phase_duration
        if index < len(frame_paths) - 1:
            clip_duration += REVEAL_TRANSITION_SECONDS
        elif extra_duration:
            clip_duration += extra_duration

        phase_label = f"phase{index}"
        phase_labels.append(f"[{phase_label}]")
        if stock_path is None:
            input_index = index
            inputs.extend([
                "-loop", "1", "-framerate", str(FPS), "-i", str(frame_path.resolve()),
            ])
            filters.append(
                f"[{input_index}:v]scale={WIDTH}:{HEIGHT},fps={FPS},setsar=1,settb=AVTB,"
                f"trim=duration={clip_duration:.3f},setpts=PTS-STARTPTS,format=yuv420p[{phase_label}]"
            )
        else:
            stock_input = index * 2
            frame_input = stock_input + 1
            inputs.extend([
                "-stream_loop", "-1", "-ss", f"{phase_start:.3f}", "-i", str(stock_path.resolve()),
                "-loop", "1", "-framerate", str(FPS), "-i", str(frame_path.resolve()),
            ])
            filters.extend([
                f"[{stock_input}:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1,settb=AVTB,"
                f"trim=duration={clip_duration:.3f},setpts=PTS-STARTPTS[bg{index}]",
                f"[{frame_input}:v]scale={WIDTH}:{HEIGHT},fps={FPS},setsar=1,settb=AVTB,"
                f"trim=duration={clip_duration:.3f},setpts=PTS-STARTPTS,"
                f"format=rgba,colorchannelmixer=aa=0.74[ui{index}]",
                f"[bg{index}][ui{index}]overlay=shortest=1,format=yuv420p[{phase_label}]",
            ])
        phase_start += phase_duration

    current = phase_labels[0]
    offset = phase_durations[0]
    for index in range(1, len(phase_labels)):
        output_label = f"reveal{index}"
        filters.append(
            f"{current}{phase_labels[index]}xfade=transition=dissolve:"
            f"duration={REVEAL_TRANSITION_SECONDS:.3f}:offset={offset:.3f}[{output_label}]"
        )
        current = f"[{output_label}]"
        offset += phase_durations[index]

    total_duration = sum(phase_durations) + extra_duration
    final_filters: list[str] = []
    if fade_in:
        final_filters.append("fade=t=in:st=0:d=0.25")
    if fade_out:
        final_filters.append(f"fade=t=out:st={max(0.0, total_duration - 0.3):.3f}:d=0.3")
    final_filters.append("format=yuv420p")
    filters.append(f"{current}{','.join(final_filters)}[out]")
    await _run_ffmpeg(
        [
            "-y", *inputs,
            "-filter_complex", ";".join(filters),
            "-map", "[out]", "-an", "-r", str(FPS),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "21",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(output_path.resolve()),
        ],
        error_label="镜内逐步揭示渲染",
    )


async def _compose_storyboard(
    clips: list[Path],
    scenes: list[dict[str, Any]],
    durations: list[float],
    output_path: Path,
) -> None:
    if len(clips) == 1:
        await _run_ffmpeg(
            ["-y", "-i", str(clips[0].resolve()), "-c", "copy", str(output_path.resolve())],
            error_label="单镜合片",
        )
        return

    inputs = [argument for clip in clips for argument in ("-i", str(clip.resolve()))]
    filters: list[str] = []
    current = "[0:v]"
    offset = durations[0]
    for index in range(1, len(clips)):
        output_label = f"v{index}"
        transition = str(scenes[index].get("transition") or "fade")
        filters.append(
            f"{current}[{index}:v]xfade=transition={transition}:"
            f"duration={TRANSITION_SECONDS:.3f}:offset={offset:.3f}[{output_label}]"
        )
        current = f"[{output_label}]"
        offset += durations[index]
    try:
        await _run_ffmpeg(
            [
                "-y", *inputs,
                "-filter_complex", ";".join(filters),
                "-map", current,
                "-an", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(output_path.resolve()),
            ],
            error_label="连续镜间转场",
        )
    except RuntimeError:
        trim_filters = [
            f"[{index}:v]trim=duration={duration:.3f},setpts=PTS-STARTPTS[t{index}]"
            for index, duration in enumerate(durations)
        ]
        concat_inputs = "".join(f"[t{index}]" for index in range(len(clips)))
        trim_filters.append(f"{concat_inputs}concat=n={len(clips)}:v=1:a=0[out]")
        await _run_ffmpeg(
            [
                "-y", *inputs,
                "-filter_complex", ";".join(trim_filters),
                "-map", "[out]",
                "-an", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(output_path.resolve()),
            ],
            error_label="兼容章节内容合片",
        )
async def render_storyboard_video(
    script: dict[str, Any],
    task_id: str,
    *,
    on_progress: ProgressCallback | None = None,
) -> Path:
    """Render all planned scenes and concatenate them into one MP4."""

    scenes = prepare_scene_continuity(_scenes_from_script(script))
    if not scenes:
        raise RuntimeError("视频脚本没有可渲染的章节内容")
    output_dir = Path(settings.MEDIA_OUTPUT_DIR) / "video_tasks" / task_id / "storyboard"
    output_dir.mkdir(parents=True, exist_ok=True)
    video_title = str(script.get("title") or (script.get("params") or {}).get("title") or "智能讲解")
    visual_system = script.get("visual_system") if isinstance(script.get("visual_system"), dict) else {}
    visual_theme = str(visual_system.get("theme") or "chalk-garden")
    orientation = "landscape"
    loop = asyncio.get_running_loop()
    clips: list[Path] = []
    stock_attributions: list[dict[str, str]] = []
    used_stock_ids: set[str] = set()
    total = len(scenes)
    durations: list[float] = []

    for index, scene in enumerate(scenes):
        from app.services.media.stock_video import fetch_scene_stock_video

        stock = await fetch_scene_stock_video(
            [
                str(term)
                for term in scene.get("visual_search_terms") or []
                if str(term).strip()
            ],
            output_dir / "stock",
            orientation=orientation,
            excluded_video_ids=used_stock_ids,
        )
        if stock is not None:
            used_stock_ids.add(stock.video_id)
            scene = dict(scene)
            scene["stock_credit"] = f"动态素材 · Pexels / {stock.creator}"
            stock_attributions.append({
                "scene": str(scene.get("title") or f"章节内容 {index + 1}"),
                "creator": stock.creator,
                "url": stock.page_url,
                "query": stock.query,
                "video_id": stock.video_id,
            })
        scene["visual_theme"] = visual_theme
        try:
            duration = max(1.0, float(scene.get("duration") or 20))
        except (TypeError, ValueError):
            duration = 20.0
        durations.append(duration)
        reveal_plan = _scene_reveal_plan(scene, duration)
        frame_paths: list[Path] = []
        render_jobs = []
        for phase_index, phase in enumerate(reveal_plan):
            is_final_phase = phase_index == len(reveal_plan) - 1
            frame_path = output_dir / (
                f"scene-{index + 1:02d}.png"
                if is_final_phase
                else f"scene-{index + 1:02d}-reveal-{phase_index + 1:02d}.png"
            )
            phase_scene = {
                **scene,
                "_reveal_index": phase["index"],
                "_reveal_total": phase["total"],
                "_reveal_label": phase["label"],
            }
            frame_paths.append(frame_path)
            render_jobs.append(
                loop.run_in_executor(
                    None,
                    lambda current=phase_scene, current_index=index, target=frame_path: _render_scene_frame(
                        current,
                        video_title=video_title,
                        index=current_index,
                        total=total,
                        output_path=target,
                        orientation=orientation,
                    ),
                )
            )
        await asyncio.gather(*render_jobs)

        clip_path = output_dir / f"scene-{index + 1:02d}.mp4"
        await _render_progressive_scene_clip(
            frame_paths,
            [float(phase["duration"]) for phase in reveal_plan],
            clip_path,
            stock_path=stock.path if stock is not None else None,
            extra_duration=TRANSITION_SECONDS if index < total - 1 else 0.0,
            fade_in=index == 0,
            fade_out=index == total - 1,
        )
        clips.append(clip_path)
        if on_progress:
            on_progress(
                (index + 1) / total,
                f"已渲染 {index + 1}/{total} 个章节内容 · {len(reveal_plan)} 段逐步揭示",
            )

    output_path = output_dir / f"{task_id}_storyboard.mp4"
    await _compose_storyboard(clips, scenes, durations, output_path)
    if not output_path.is_file():
        raise RuntimeError("章节内容渲染器未产出 MP4")
    if stock_attributions:
        (output_dir / "stock-attribution.json").write_text(
            json.dumps(stock_attributions, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return output_path
