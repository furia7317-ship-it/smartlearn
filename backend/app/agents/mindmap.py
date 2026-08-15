"""Mindmap agent — 思维导图（知识结构可视化）。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是知识结构专家。为学习主题生成思维导图的节点结构。

输出 JSON 树形结构：
```json
{
  "title": "中心主题",
  "nodes": [
    {
      "id": "1",
      "label": "分支1",
      "children": [
        {"id": "1.1", "label": "子节点1"},
        {"id": "1.2", "label": "子节点2"}
      ]
    }
  ]
}
```

规则：
1. 3-5 个一级分支
2. 每个分支 2-4 个子节点
3. 节点标签简洁（10字以内）
4. 体现知识间的层次和关联"""


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成思维导图结构。"""
    llm = build_llm(temperature=0.5)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    prompt = f"主题：{state['topic']}\n\n知识库参考：{kb_text}{prompt_extras(state)}\n\n请生成思维导图结构。"

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        result = parse_json_response(resp.content)
        result["type"] = "mindmap"
        result["id"] = f"mindmap_{state['topic'][:20]}"
        return result
    except Exception:
        return {
            "type": "mindmap",
            "id": f"mindmap_{state['topic'][:20]}",
            "title": state["topic"],
            "nodes": [],
        }
