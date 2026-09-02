"""Classifier agent — 考试范围分类。"""

from __future__ import annotations

from typing import Any

from app.agents.common import format_untrusted_knowledge_context
from app.core.llm import build_llm, parse_json_response
from app.services.scoring import trim_composition

SYSTEM_PROMPT = """你是出题范围分析专家。根据主题和知识点列表，确定各类题目的数量。

输出 JSON：
```json
{
  "mcq": 3,
  "blank": 1,
  "short": 1,
  "code": 0,
  "focus_points": ["重点知识点1", "重点知识点2"]
}
```

规则：
- 普通练习：mcq 2-4、blank 0-2、short 0-2、code 0-1，总数 3-8 题
- adaptive 客观摸底：由主题广度和学习背景决定题量，总数 6-15 题；不得固定为 5 道选择题
- 编程相关主题适当增加 code 题，概念型主题增加 short 或 blank
- 输出数量必须与用途匹配"""


def classify_exam_scope(
    topic: str,
    scope_points: list[str],
    kb_context: list[dict[str, Any]],
    *,
    paper_type: str = "mixed",
    weak_points: list[str] | None = None,
) -> dict[str, Any]:
    """确定试卷组成。"""
    llm = build_llm(temperature=0)

    points_text = "\n".join(f"- {p}" for p in scope_points) if scope_points else "（无指定范围）"

    adaptive = paper_type == "adaptive"
    count_rule = (
        "这是客观学情摸底。根据主题广度、学习目标、已有薄弱点和知识范围，在 6-15 题内自主决定题量；"
        "不要固定成 5 道选择题，应混合选择、填空、简答，编程主题可加入编程题。"
        if adaptive
        else "普通练习卷，总题数控制在 3-8 题。"
    )
    weak_text = "、".join(weak_points or []) or "（暂无）"
    knowledge_text = format_untrusted_knowledge_context(
        kb_context,
        max_sources=20,
        max_content_chars=700,
        max_total_chars=10_000,
    )
    prompt = (
        f"主题：{topic}\n试卷用途：{paper_type}\n\n知识点范围：\n{points_text}\n\n"
        f"已有薄弱点：{weak_text}\n\n题量规则：{count_rule}\n\n"
        f"课程知识依据：\n{knowledge_text}\n\n"
        "请只依据给定主题、范围和课程知识依据确定各类题目的数量。"
    )

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        raw = parse_json_response(resp.content)
        composition = trim_composition(raw, adaptive=adaptive)
        composition["focus_points"] = raw.get("focus_points", scope_points[:3])
        return composition
    except Exception:
        return {
            "mcq": 5 if adaptive else 3,
            "blank": 1,
            "short": 2 if adaptive else 1,
            "code": 0,
            "focus_points": scope_points[:3] if scope_points else [topic],
        }
