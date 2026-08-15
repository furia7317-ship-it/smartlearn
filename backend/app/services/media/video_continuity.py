"""Continuity defaults shared by generated and legacy video scripts."""

from __future__ import annotations

import re
from typing import Any

COMPOSITIONS = {"hero", "split", "process", "comparison", "recap"}
RELATIONS = {"new_chapter", "progressive", "detail", "contrast", "transfer", "return"}

_PURPOSE_STRUCTURE = {
    "hook": ("01-discovery", "问题与反差", "hero", "contrast"),
    "concept": ("02-model", "建立核心理解", "split", "progressive"),
    "example": ("03-demo", "跟着案例推进", "process", "progressive"),
    "pitfall": ("04-practice", "修正并迁移", "comparison", "contrast"),
    "application": ("04-practice", "修正并迁移", "split", "transfer"),
    "recap": ("04-practice", "修正并迁移", "recap", "return"),
}

_TRANSITIONS = {
    "new_chapter": "fade",
    "progressive": "dissolve",
    "detail": "circleopen",
    "contrast": "wipeleft",
    "transfer": "fade",
    "return": "dissolve",
}

_MOTIONS = {
    "hero": "fixed",
    "split": "fixed",
    "process": "fixed",
    "comparison": "fixed",
    "recap": "fixed",
}

_PURPOSE_SECTION_TITLES = {
    "hook": "先问为什么",
    "concept": "拆解核心概念",
    "example": "跟着例子推进",
    "pitfall": "识别并修正误区",
    "application": "迁移到真实应用",
    "recap": "串联重点并自测",
}

_GENERIC_SECTION_TITLE = re.compile(
    r"^(?:(?:分镜|场景|镜头|scene|shot)\s*[-_#：:]?\s*\d+|"
    r"第?\s*\d+\s*(?:镜|个?分镜|场景|镜头))$",
    re.IGNORECASE,
)


def _is_section_placeholder(value: Any, chapter_title: str = "") -> bool:
    text = str(value or "").strip()
    return (
        not text
        or bool(_GENERIC_SECTION_TITLE.fullmatch(text))
        or bool(chapter_title and text == chapter_title.strip())
    )


def _section_title(scene: dict[str, Any], purpose: str, chapter_title: str) -> str:
    params = scene.get("visual_params") if isinstance(scene.get("visual_params"), dict) else {}
    candidates: list[Any] = [scene.get("title"), params.get("title")]
    candidates.extend(scene.get("reveal_sequence") or [])
    candidates.extend(scene.get("focus_terms") or [])
    for candidate in candidates:
        if isinstance(candidate, dict):
            candidate = candidate.get("label") or candidate.get("text")
        if not _is_section_placeholder(candidate, chapter_title):
            return str(candidate).strip()
    return _PURPOSE_SECTION_TITLES.get(purpose, _PURPOSE_SECTION_TITLES["concept"])


def prepare_scene_continuity(scenes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill chapter, visual-anchor, and carry-over fields for every scene."""

    prepared = [dict(scene) for scene in scenes]
    previous: dict[str, Any] | None = None
    chapter_anchors: dict[str, str] = {}
    for scene in prepared:
        purpose = str(scene.get("purpose") or "concept")
        default = _PURPOSE_STRUCTURE.get(purpose, _PURPOSE_STRUCTURE["concept"])
        chapter_id = str(scene.get("chapter_id") or default[0])
        chapter_title = str(scene.get("chapter_title") or default[1])
        section_title = _section_title(scene, purpose, chapter_title)
        composition = str(scene.get("composition") or default[2]).lower()
        relation = str(scene.get("relation_to_previous") or default[3]).lower()
        if composition not in COMPOSITIONS:
            composition = default[2]
        if relation not in RELATIONS:
            relation = default[3]

        same_chapter = previous is not None and previous.get("chapter_id") == chapter_id
        if previous is None or not same_chapter:
            relation = "new_chapter"
        focus_terms = [str(item) for item in scene.get("focus_terms") or [] if str(item).strip()]
        proposed_anchor = str(scene.get("visual_anchor") or "").strip()
        if _is_section_placeholder(proposed_anchor, chapter_title):
            proposed_anchor = ""
        if chapter_id not in chapter_anchors:
            chapter_anchors[chapter_id] = proposed_anchor or (focus_terms[0] if focus_terms else "") or str(
                section_title
            )
        anchor = chapter_anchors[chapter_id]
        carry_over = str(scene.get("carry_over") or "").strip()
        if not carry_over and previous is not None:
            carry_over = str(
                previous.get("visual_anchor") if same_chapter else previous.get("title") or ""
            )

        scene.update(
            title=section_title,
            chapter_id=chapter_id,
            chapter_title=chapter_title,
            composition=composition,
            relation_to_previous=relation,
            visual_anchor=anchor,
            carry_over=carry_over,
            transition=_TRANSITIONS[relation],
            motion=_MOTIONS[composition],
        )
        params = scene.get("visual_params")
        if isinstance(params, dict):
            scene["visual_params"] = {**params, "title": section_title}
        previous = scene

    chapter_totals: dict[str, int] = {}
    for scene in prepared:
        chapter_id = str(scene["chapter_id"])
        chapter_totals[chapter_id] = chapter_totals.get(chapter_id, 0) + 1
    chapter_offsets: dict[str, int] = {}
    for scene in prepared:
        chapter_id = str(scene["chapter_id"])
        beat_index = chapter_offsets.get(chapter_id, 0) + 1
        chapter_offsets[chapter_id] = beat_index
        scene["beat_index"] = beat_index
        scene["beat_total"] = chapter_totals[chapter_id]
    return prepared
