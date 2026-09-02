"""Grader agent — 主观题 LLM 评分。"""

from __future__ import annotations

import math
from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是阅卷专家。对填空/简答/编程题进行评分。

输入：题目信息 + 学生答案 + 参考答案
输出 JSON：
```json
{
  "scores": {
    "题目ID": {
      "score": 得分,
      "max_score": 满分,
      "feedback": "详细评语",
      "error_type": "conceptual|calculation|careless|method|none"
    }
  }
}
```

评分标准：
- 完全正确给满分
- 部分正确按比例给分
- 有关键错误扣分
- 给出具体改进建议"""


def grade_subjective(
    questions: list[dict[str, Any]],
    answers: dict[str, str],
) -> list[dict[str, Any]]:
    """对主观题进行 LLM 评分。"""
    # 筛选主观题
    subjective_qs = [q for q in questions if q.get("type") in ("blank", "short", "code")]
    if not subjective_qs:
        return []

    llm = build_llm(temperature=0)

    q_text = ""
    for q in subjective_qs:
        qid = q["id"]
        q_text += f"\n题目({q.get('type')}, {q.get('score', 0)}分):\n{q.get('stem', '')}\n"
        if q.get("answer"):
            q_text += f"参考答案: {q['answer']}\n"
        q_text += f"学生答案: {answers.get(qid, '未作答')}\n"

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": q_text},
    ])

    try:
        parsed = parse_json_response(resp.content)
        scores = parsed.get("scores", parsed) if isinstance(parsed, dict) else {}
        if not isinstance(scores, dict):
            raise ValueError("grader response does not contain a scores object")

        results = []
        for q in subjective_qs:
            qid = q["id"]
            score_info = scores.get(qid)
            if not isinstance(score_info, dict):
                raise ValueError(f"grader response is missing question {qid}")
            try:
                awarded = float(score_info.get("score"))
                maximum = float(q.get("score", 0))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"grader returned an invalid score for {qid}") from exc
            if not math.isfinite(awarded) or not math.isfinite(maximum) or maximum <= 0:
                raise ValueError(f"grader returned a non-finite score for {qid}")
            if awarded < 0 or awarded > maximum:
                raise ValueError(f"grader score is out of range for {qid}")
            results.append({
                "question_id": qid,
                "type": q["type"],
                "score": awarded,
                "max_score": maximum,
                "correct": awarded >= maximum * 0.6,
                "student_answer": answers.get(qid, ""),
                "answer": q.get("answer", ""),
                "knowledge_point": q.get("knowledge_point", ""),
                "feedback": score_info.get("feedback", ""),
                "error_type": score_info.get("error_type", "unknown"),
            })
        return results

    except Exception as exc:
        # 基础设施或协议异常不能伪装成学生答错，否则会污染错题、记忆与画像。
        raise RuntimeError("主观题评分暂时失败，请稍后重试") from exc
