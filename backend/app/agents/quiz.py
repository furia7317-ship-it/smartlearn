"""Quiz agent — 即时测验（巩固练习题）。"""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是出题专家。根据主题与「出题要求」生成测验题。

题型与字段约定：
- 选择题 mcq：options 为 ["A.…","B.…","C.…","D.…"] 四项单选，answer 为字母（如 "A"）
- 判断题 judge：options 为 ["A. 正确","B. 错误"]，answer 为 "A" 或 "B"
- 简答题 short：不要 options，answer 为参考答案要点

输出 JSON 数组，每题：
```json
{ "id": "q1", "type": "mcq", "stem": "题干", "options": ["A.…","B.…"], "answer": "A", "explanation": "解析" }
```

规则：
1. **严格按出题要求里各题型的数量出题，数量必须精确匹配，不多不少**
2. 难度适中，每题必须附 explanation 解析
3. 紧扣主题与知识库参考，避免编造"""

# 单次出题各题型上限（防滥用/超长导致失败）
_MAX_PER_TYPE = 30


def _required_quiz_phrases(state: dict[str, Any]) -> list[str]:
    phrases: list[str] = []
    for instruction in state.get("repair_instructions") or []:
        if not isinstance(instruction, dict):
            continue
        target = str(instruction.get("target_field") or "")
        if "questions" not in target or "explanation" not in target:
            continue
        candidates = [
            *(instruction.get("required_terms") or []),
            *(instruction.get("required_evidence") or []),
        ]
        for candidate in candidates:
            phrase = str(candidate).strip()
            if (
                phrase
                and phrase not in phrases
                and not any(marker in phrase for marker in ("questions[]", "字段完整", "满足对应审核规则"))
            ):
                phrases.append(phrase)
    return phrases


def _missing_quiz_phrases(questions: list[Any], required: list[str]) -> list[str]:
    explanations = "\n".join(
        str(question.get("explanation") or "")
        for question in questions
        if isinstance(question, dict)
    )
    return [phrase for phrase in required if phrase not in explanations]


def _quiz_count_issue(
    questions: list[dict[str, Any]],
    *,
    choice: int,
    judge: int,
    short: int,
) -> str:
    actual = {
        "mcq": sum(1 for question in questions if question.get("type") == "mcq"),
        "judge": sum(1 for question in questions if question.get("type") == "judge"),
        "short": sum(1 for question in questions if question.get("type") == "short"),
    }
    expected = {"mcq": choice, "judge": judge, "short": short}
    if actual != expected or len(questions) != choice + judge + short:
        return f"题型数量不匹配，要求 {expected}，实际 {actual}，总数 {len(questions)}"
    field_issues = []
    for index, question in enumerate(questions, 1):
        if not str(question.get("stem") or "").strip():
            field_issues.append(f"第 {index} 题缺少题干")
        if not str(question.get("answer") or "").strip():
            field_issues.append(f"第 {index} 题缺少答案")
        if not str(question.get("explanation") or "").strip():
            field_issues.append(f"第 {index} 题缺少解析")
        if question.get("type") in {"mcq", "judge"} and len(question.get("options") or []) < 2:
            field_issues.append(f"第 {index} 题选项不足")
    return "；".join(field_issues[:8])


def _parse_questions(content: Any) -> list[dict[str, Any]]:
    parsed = parse_json_response(content)
    values = parsed if isinstance(parsed, list) else [parsed]
    questions = [dict(value) for value in values if isinstance(value, dict)]
    for question in questions:
        question.setdefault("id", str(uuid.uuid4())[:8])
    return questions


def _count(cfg: dict[str, Any], key: str) -> int:
    """从配置安全取整数题量：非法/负数 → 0，并夹到上限。"""
    try:
        v = int(cfg.get(key, 0) or 0)
    except (TypeError, ValueError):
        v = 0
    return max(0, min(_MAX_PER_TYPE, v))


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成测验题。按 state['quiz_config'] 的题型数量出题；无配置则默认 5 道选择题。"""
    cfg = state.get("quiz_config") or {}
    choice = _count(cfg, "choice")
    judge = _count(cfg, "judge")
    short = _count(cfg, "short")
    if choice + judge + short == 0:
        choice = 5  # 兜底：未配置时给 5 道选择题

    spec_parts = []
    if choice:
        spec_parts.append(f"{choice} 道选择题（type=mcq）")
    if judge:
        spec_parts.append(f"{judge} 道判断题（type=judge）")
    if short:
        spec_parts.append(f"{short} 道简答题（type=short）")
    spec = "、".join(spec_parts)

    llm = build_llm(temperature=0.3)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    required_phrases = _required_quiz_phrases(state)
    hard_repair = ""
    if required_phrases:
        hard_repair = (
            "\n\n字段级返工硬约束：\n"
            f"- questions[].explanation 必须逐字包含：{'、'.join(required_phrases)}。\n"
            "- 每个必须短语至少对应一道真正讨论该主题的题目；不得把短语硬塞进无关解析。\n"
            "- 使用上一版完整 questions JSON，保留无关题目，只修改或替换最少数量的题目。\n"
            "- 输出前逐项扫描所有 explanation，确认没有遗漏。"
        )

    prompt = (
        f"主题：{state['topic']}\n\n"
        f"出题要求：请精确生成 {spec}，合计 {choice + judge + short} 题。\n\n"
        f"知识库参考：{kb_text}{hard_repair}{prompt_extras(state)}\n\n请按上述数量与题型生成。"
    )

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        questions = _parse_questions(resp.content)
        missing = _missing_quiz_phrases(questions, required_phrases)
        count_issue = _quiz_count_issue(
            questions,
            choice=choice,
            judge=judge,
            short=short,
        )
        for repair_attempt in range(2):
            if not missing and not count_issue:
                break
            repair_prompt = (
                "下面这组题未通过字段级自检。保持题目总数和题型数量不变，"
                "保留无关题目，只修改或替换覆盖缺口所必需的最少题目。\n"
                f"缺失短语：{'、'.join(missing)}\n"
                f"数量自检：{count_issue or '已通过'}\n"
                "硬性要求：每个短语必须逐字出现在 questions[].explanation 中，"
                "且对应题目必须真实讨论该主题。只返回完整 JSON 数组。\n"
                f"当前 questions：{json.dumps(questions, ensure_ascii=False, default=str)}"
            )
            repaired = llm.invoke(
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": repair_prompt},
                ]
            )
            questions = _parse_questions(repaired.content)
            missing = _missing_quiz_phrases(questions, required_phrases)
            count_issue = _quiz_count_issue(
                questions,
                choice=choice,
                judge=judge,
                short=short,
            )
        if missing or count_issue:
            raise ValueError(
                "quiz field-level self-check failed; "
                + (
                    "missing required phrases: " + "、".join(missing)
                    if missing
                    else count_issue
                )
            )
        return {
            "type": "quiz",
            "id": f"quiz_{state['topic'][:20]}",
            "title": f"{state['topic']} - 巩固测验",
            "questions": questions,
        }
    except Exception:
        if required_phrases:
            raise
        return {
            "type": "quiz",
            "id": f"quiz_{state['topic'][:20]}",
            "title": f"{state['topic']} - 巩固测验",
            "questions": [],
        }
