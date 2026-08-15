"""Explainer agent — 概念讲解（文字解释+类比+引用角标）。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是概念讲解专家。用清晰易懂的方式解释学习主题。

要求：
1. 用通俗语言解释核心概念
2. 提供生活类比帮助理解
3. 引用知识库内容时加角标 [来源n]
4. 结构化输出：概述→详解→要点总结

输出 JSON：
```json
{
  "title": "概念标题",
  "overview": "一句话概述",
  "explanation": "详细解释（支持 Markdown）",
  "analogy": "类比说明",
  "key_points": ["要点1", "要点2"],
  "sources": ["来源1引用", "来源2引用"]
}
```"""


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成概念讲解。"""
    llm = build_llm(temperature=0.7)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    prompt = f"主题：{state['topic']}\n\n知识库参考：{kb_text}{prompt_extras(state)}\n\n请生成概念讲解。"

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        result = parse_json_response(resp.content)
        result["type"] = "explainer"
        result["id"] = f"explainer_{state['topic'][:20]}"
        return result
    except Exception:
        return {
            "type": "explainer",
            "id": f"explainer_{state['topic'][:20]}",
            "title": state["topic"],
            "overview": "概念讲解生成中...",
            "explanation": resp.content,
            "analogy": "",
            "key_points": [],
            "sources": [],
        }
