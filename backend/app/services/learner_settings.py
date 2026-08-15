"""Canonical learner preferences stored in SQLite and shared by every agent."""

from __future__ import annotations

from typing import Any

from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import LearnerPreferenceSettings


TEACHING_MODES = {"direct", "socratic", "practice"}
ANSWER_DEPTHS = {"concise", "balanced", "deep"}
DIFFICULTIES = {"foundation", "balanced", "challenge"}
DAILY_MINUTES = {20, 40, 60, 90}
MATERIAL_TYPES = {
    "explainer", "quiz", "solution", "reading", "code", "video", "mindmap", "courseware", "interactive"
}

DEFAULT_LEARNER_SETTINGS: dict[str, Any] = {
    "teaching_mode": "direct",
    "answer_depth": "balanced",
    "difficulty": "balanced",
    "daily_minutes": 40,
    "material_types": ["explainer", "quiz"],
    "long_term_memory_enabled": True,
    "reminder_enabled": False,
    "reminder_time": "20:00",
}


def normalize_learner_settings(value: dict[str, Any] | None) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    normalized = dict(DEFAULT_LEARNER_SETTINGS)
    teaching_mode = str(raw.get("teaching_mode") or "")
    answer_depth = str(raw.get("answer_depth") or "")
    difficulty = str(raw.get("difficulty") or "")
    daily_minutes = raw.get("daily_minutes")
    material_types = raw.get("material_types")
    reminder_time = str(raw.get("reminder_time") or "")

    if teaching_mode in TEACHING_MODES:
        normalized["teaching_mode"] = teaching_mode
    if answer_depth in ANSWER_DEPTHS:
        normalized["answer_depth"] = answer_depth
    if difficulty in DIFFICULTIES:
        normalized["difficulty"] = difficulty
    if daily_minutes in DAILY_MINUTES:
        normalized["daily_minutes"] = int(daily_minutes)
    if isinstance(material_types, list):
        selected = list(dict.fromkeys(
            str(item) for item in material_types if str(item) in MATERIAL_TYPES
        ))
        if selected:
            normalized["material_types"] = selected
    if "long_term_memory_enabled" in raw:
        normalized["long_term_memory_enabled"] = bool(raw["long_term_memory_enabled"])
    if "reminder_enabled" in raw:
        normalized["reminder_enabled"] = bool(raw["reminder_enabled"])
    if len(reminder_time) == 5 and reminder_time[2] == ":":
        try:
            hours, minutes = (int(part) for part in reminder_time.split(":"))
            if 0 <= hours <= 23 and 0 <= minutes <= 59:
                normalized["reminder_time"] = reminder_time
        except ValueError:
            pass
    return normalized


async def get_learner_settings(db: AsyncSession, student_id: str) -> dict[str, Any]:
    try:
        # A savepoint keeps callers usable while a just-upgraded SQLite database
        # is still missing the new preference table. The normal application
        # startup creates it; this fallback also makes rolling upgrades safe.
        async with db.begin_nested():
            row = await db.get(LearnerPreferenceSettings, student_id)
    except OperationalError as exc:
        if "no such table" not in str(exc).lower():
            raise
        return normalize_learner_settings(None)
    return normalize_learner_settings(row.preferences if row is not None else None)


def teaching_preference_prompt(preferences: dict[str, Any]) -> str:
    mode = {
        "direct": "先给出清晰结论，再解释关键步骤",
        "socratic": "优先用启发式问题引导学生推导，不直接包办思考过程",
        "practice": "采用短讲解后立即练习的节奏，并根据作答继续反馈",
    }[preferences["teaching_mode"]]
    depth = {
        "concise": "回答保持简洁，只保留结论、必要推理和下一步",
        "balanced": "回答保持标准深度，兼顾直觉、推理和示例",
        "deep": "回答可以深入展开原理、边界条件、推导与迁移应用",
    }[preferences["answer_depth"]]
    difficulty = {
        "foundation": "默认从基础概念开始，减少未经解释的跳步",
        "balanced": "默认采用适中难度，并根据学生当轮表现动态调整",
        "challenge": "默认提供更具挑战的问题和迁移任务，但仍要解释关键前置知识",
    }[preferences["difficulty"]]
    material_labels = {
        "explainer": "讲义", "quiz": "练习题", "solution": "题目解析", "reading": "扩展阅读",
        "code": "代码示例", "video": "讲解视频", "mindmap": "思维导图", "courseware": "课件",
        "interactive": "交互演示",
    }
    materials = "、".join(material_labels[item] for item in preferences["material_types"])
    return (
        "\n\n【学生主动设置的教学偏好】\n"
        f"- 教学方式：{mode}。\n"
        f"- 回答深度：{depth}。\n"
        f"- 默认难度：{difficulty}。\n"
        f"- 每日学习时长默认值：{preferences['daily_minutes']} 分钟。\n"
        f"- 优先资料类型：{materials}。\n"
        "这些偏好是默认值；学生当前消息中的明确要求优先级更高。"
    )
