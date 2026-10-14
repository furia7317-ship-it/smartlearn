"""Code agent — 代码示例。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是编程教学专家。根据主题生成可运行的代码示例。

输出 JSON：
```json
{
  "title": "代码示例标题",
  "language": "python",
  "code": "完整可运行代码",
  "explanation": "逐行解释",
  "output": "预期输出",
  "variations": [
    {"description": "变体说明", "code": "变体代码"}
  ]
}
```

规则：
1. 代码必须完整可运行
2. 包含注释说明
3. 只在用户允许的范围内提供变体；限制为一种实现时 variations 为空数组
4. 适合初学者理解
5. 复杂度必须按实际代码计算，计入列表复制、拼接等成本；不要把抽象算法的复杂度套到不同实现上"""


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成代码示例。"""
    llm = build_llm(temperature=0.3)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    prompt = f"主题：{state['topic']}\n\n知识库参考：{kb_text}{prompt_extras(state)}\n\n请生成代码示例。"

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        result = parse_json_response(resp.content)
        result["type"] = "code"
        result["id"] = f"code_{state['topic'][:20]}"
        return result
    except Exception:
        return {
            "type": "code",
            "id": f"code_{state['topic'][:20]}",
            "title": f"{state['topic']} - 代码示例",
            "language": "python",
            "code": resp.content,
            "explanation": "",
            "output": "",
            "variations": [],
        }
