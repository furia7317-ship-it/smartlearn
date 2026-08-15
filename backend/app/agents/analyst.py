"""Analyst agent — 生成学习评估报告。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是学习分析专家。根据测评结果生成详细的学习评估报告。

输出 JSON：
```json
{
  "summary": "总体评价",
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["薄弱点1", "薄弱点2"],
  "suggestions": ["建议1", "建议2"],
  "next_steps": ["下一步行动1", "行动2"],
  "encouragement": "鼓励语"
}
```"""


def generate_assessment(
    results: list[dict[str, Any]],
    overall: float,
    mastery: dict[str, Any],
    questions: list[dict[str, Any]],
) -> dict[str, Any]:
    """生成学习评估报告。"""
    llm = build_llm(temperature=0.7)

    # 构建分析上下文
    mastery_text = "\n".join(
        f"- {kp}: {info['score']:.0%} ({info['level']})"
        for kp, info in mastery.items()
    )

    wrong_text = ""
    for r in results:
        if not r.get("correct", True):
            wrong_text += f"\n- {r.get('knowledge_point', '未知')}: {r.get('feedback', '')[:100]}"

    prompt = f"""测评总分：{overall}
分项掌握度：
{mastery_text}

错题分析：
{wrong_text or '无错题'}

请生成学习评估报告。"""

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        return parse_json_response(resp.content)
    except Exception:
        return {
            "summary": f"本次测评得分 {overall} 分",
            "strengths": [],
            "weaknesses": [],
            "suggestions": ["继续努力"],
            "next_steps": [],
            "encouragement": "加油！",
        }
