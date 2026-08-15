"""Problem-solution agent — questions, answers and explanations as one reading resource."""

from __future__ import annotations

from typing import Any

from app.agents.quiz import generate as generate_quiz


def generate(state: dict[str, Any]) -> dict[str, Any]:
    resource = dict(generate_quiz(state))
    topic = str(state.get("topic") or "学习主题")
    resource["type"] = "solution"
    resource["id"] = f"solution_{topic[:20]}"
    resource["title"] = f"{topic} - 题目解析"
    return resource
