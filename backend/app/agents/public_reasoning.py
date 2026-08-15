"""Generate public reasoning summaries for resource generation.

This module asks the model for a user-visible summary of inputs, tradeoffs, and
generation choices. It must not request or expose raw chain-of-thought.
"""

from __future__ import annotations

import json
from typing import Any

from app.core.llm import build_llm

SYSTEM_PROMPT = """你是学习资源生成流程的说明员。

你的任务是写一段可公开展示给学生看的「推理摘要」，说明本次资源生成基于哪些输入、做了哪些取舍、为什么这样组织。

安全边界：
- 不要输出原始思考链、逐步内心推理、隐藏推理 token 或任何私密推理。
- 只输出可公开的依据、取舍和结论。
- 不要编造知识库来源；只概括输入中出现的依据。

输出要求：
- 2 到 4 句中文。
- 具体说明：参考了什么、资料大纲如何约束内容、最终资源为什么这样组织。
- 不要使用“我先……然后……”的模板腔，直接写生成依据。"""


def generate_public_reasoning_summary(
    *,
    state: dict[str, Any],
    agent: str,
    material_outline: dict[str, Any],
    result: dict[str, Any],
    llm: Any | None = None,
) -> str:
    """Ask the model for a public, user-visible reasoning summary."""

    try:
        model = llm or build_llm(temperature=0.2)
        prompt = _build_prompt(state=state, agent=agent, material_outline=material_outline, result=result)
        response = model.invoke(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]
        )
    except Exception:
        return ""

    content = getattr(response, "content", response)
    if isinstance(content, list):
        text = "".join(str(item.get("text", item)) if isinstance(item, dict) else str(item) for item in content)
    else:
        text = str(content)
    return text.strip()


def _build_prompt(
    *,
    state: dict[str, Any],
    agent: str,
    material_outline: dict[str, Any],
    result: dict[str, Any],
) -> str:
    kb_context = []
    for index, ctx in enumerate((state.get("kb_context") or [])[:4], 1):
        content = str(ctx.get("content") or "").strip()
        if content:
            kb_context.append(f"[来源{index}] {content[:300]}")

    return "\n\n".join(
        [
            f"主题：{state.get('topic', '')}",
            f"资源 agent：{agent}",
            f"用户要求：{str(state.get('requirements') or '').strip()[:500] or '无额外要求'}",
            "知识库参考：\n" + ("\n".join(kb_context) if kb_context else "无"),
            "资料大纲：\n" + _json_preview(material_outline, 1800),
            "最终资源内容：\n" + _json_preview(result, 2200),
            "请基于以上真实输入，写可公开展示的推理摘要。不要输出原始思考链。",
        ]
    )


def _json_preview(value: Any, limit: int) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        text = str(value)
    return text[:limit]
