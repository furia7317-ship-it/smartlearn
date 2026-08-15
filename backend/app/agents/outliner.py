"""Outline agent for resource generation planning."""

from __future__ import annotations

import math
import re
from typing import Any


_CN_NUMBERS = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


def _cn_or_int(value: str) -> int | None:
    value = value.strip()
    if value.isdigit():
        return int(value)
    if value in _CN_NUMBERS:
        return _CN_NUMBERS[value]
    if value.startswith("十") and len(value) == 2 and value[1] in _CN_NUMBERS:
        return 10 + _CN_NUMBERS[value[1]]
    if value.endswith("十") and len(value) == 2 and value[0] in _CN_NUMBERS:
        return _CN_NUMBERS[value[0]] * 10
    return None


def _extract_days(text: str) -> int | None:
    if re.search(r"下周|一周|1\s*周", text):
        return 7
    if "明天" in text:
        return 1
    match = re.search(r"([0-9]+|[一二两三四五六七八九十]+)\s*(天|日)", text)
    if match:
        return _cn_or_int(match.group(1))
    match = re.search(r"([0-9]+|[一二两三四五六七八九十]+)\s*周", text)
    if match:
        weeks = _cn_or_int(match.group(1))
        return weeks * 7 if weeks else None
    return None


def _extract_daily_minutes(text: str) -> int | None:
    if re.search(r"每天\s*半\s*(小时|个小时)", text):
        return 30
    match = re.search(r"每天[^，。；;,.!?！？]{0,12}?([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十]+)\s*(小时|个小时|h)", text, re.I)
    if match:
        raw = match.group(1)
        hours = float(raw) if re.match(r"^[0-9.]+$", raw) else float(_cn_or_int(raw) or 0)
        return max(15, int(hours * 60))
    match = re.search(r"每天[^，。；;,.!?！？]{0,12}?([0-9]+|[一二两三四五六七八九十]+)\s*(分钟|分)", text)
    if match:
        minutes = _cn_or_int(match.group(1))
        return minutes if minutes else None
    return None


def _delegates_schedule(text: str) -> bool:
    return bool(re.search(r"你看着安排|看着安排|你安排|默认|都行|随便|按默认|自动安排", text))


def infer_study_constraints(text: str) -> dict[str, Any]:
    """Infer schedule constraints from natural language."""
    days = _extract_days(text)
    daily_minutes = _extract_daily_minutes(text)
    delegated = _delegates_schedule(text)

    if delegated:
        days = days or 7
        daily_minutes = daily_minutes or 90

    missing: list[str] = []
    if not days:
        missing.append("days")
    if not daily_minutes:
        missing.append("daily_minutes")

    return {
        "days": days,
        "daily_minutes": daily_minutes,
        "missing": missing,
        "delegated": delegated,
        "needs_clarification": bool(missing),
    }


def _clean_topic(text: str) -> str:
    cleaned = re.sub(r"补充安排[:：].*$", "", text, flags=re.S)
    cleaned = re.sub(r"每天.*?(小时|分钟|分)|[0-9一二两三四五六七八九十]+\s*(天|日|周)|下周|明天", "", cleaned)

    topic_match = re.search(
        r"(?:帮我|给我|请|麻烦)?\s*"
        r"(?:生成|整理|做|出|来)?\s*"
        r"(?:一份|一套)?\s*"
        r"([A-Za-z0-9+#\u4e00-\u9fff]{2,30}?)的?"
        r"(?:学习路径|学习计划|学习资料|复习资料|资料包|讲义|笔记|题库)",
        cleaned,
    )
    if topic_match:
        cleaned = topic_match.group(1)
    else:
        cleaned = re.sub(
            r"帮我|给我|请|麻烦|生成|整理|来一份|来一套|一份|一套|"
            r"学习路径|学习计划|学习资料|复习资料|资料包|你看着安排|看着安排|默认|自动安排",
            "",
            cleaned,
        )
        cleaned = re.sub(r"告诉我.*$|怎么学习.*$|怎么学.*$|不要.*$", "", cleaned)

    cleaned = re.sub(r"[，。；;,.!?！？\s]+", " ", cleaned).strip()
    cleaned = re.sub(r"^的|的$", "", cleaned).strip()
    return cleaned[:20] or text.strip()[:40] or "本次学习主题"


def _chapter_count(days: int) -> int:
    if days <= 2:
        return 3
    if days <= 5:
        return 4
    return 5


def _chapter_modules(index: int) -> list[str]:
    presets = [
        ["explainer", "mindmap"],
        ["explainer", "code"],
        ["mindmap", "reading"],
        ["code", "quiz"],
        ["quiz", "courseware"],
    ]
    return presets[index % len(presets)]


def build_learning_outline(state: dict[str, Any]) -> dict[str, Any]:
    """Build a chapter outline or a clarification request."""
    text = "\n".join(
        part
        for part in [
            str(state.get("topic") or ""),
            str(state.get("requirements") or ""),
        ]
        if part.strip()
    )
    forced = state.get("forced_modules") or []
    constraints = infer_study_constraints(text)
    if forced and constraints["needs_clarification"]:
        constraints = {
            **constraints,
            "days": constraints["days"] or 7,
            "daily_minutes": constraints["daily_minutes"] or 90,
            "missing": [],
            "delegated": True,
            "needs_clarification": False,
        }

    if constraints["needs_clarification"]:
        missing_labels = []
        if "days" in constraints["missing"]:
            missing_labels.append("你希望按几天学习，或考试/截止日期是什么时候")
        if "daily_minutes" in constraints["missing"]:
            missing_labels.append("每天大概能学习多久")
        return {
            "needs_clarification": True,
            "missing": constraints["missing"],
            "question": "我先确认一下学习安排：" + "；".join(missing_labels) + "？如果你想让我决定，也可以直接说“你看着安排”。",
            "defaults": {"days": 7, "daily_minutes": 90},
        }

    topic = _clean_topic(text)
    days = int(constraints["days"] or 7)
    daily_minutes = int(constraints["daily_minutes"] or 90)
    count = _chapter_count(days)
    raw_titles = ["基础定位", "核心框架", "方法拆解", "实战应用", "综合检测"]
    chapters = []
    for i in range(count):
        chapter_id = f"c{i + 1}"
        title = f"{topic}{raw_titles[i]}"
        modules = [m for m in (forced or _chapter_modules(i)) if m in {"explainer", "mindmap", "quiz", "solution", "reading", "code", "video", "courseware", "interactive"}]
        chapters.append(
            {
                "id": chapter_id,
                "index": i + 1,
                "title": title,
                "goal": f"完成「{title}」的理解、练习和输出",
                "modules": modules or ["explainer", "quiz"],
                "minutes": max(30, math.ceil(daily_minutes / max(1, min(count, days)))),
            }
        )

    selected = sorted({module for chapter in chapters for module in chapter["modules"]})
    return {
        "needs_clarification": False,
        "title": f"{topic}学习大纲",
        "topic": topic,
        "constraints": {"days": days, "daily_minutes": daily_minutes},
        "chapters": chapters,
        "selected_modules": selected,
        "reason": f"先按 {count} 个章节模块拆解，再由对应资源 agent 并行生成，最后统一整合并排入 {days} 天学习路径。",
    }
