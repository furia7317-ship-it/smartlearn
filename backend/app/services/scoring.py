"""纯函数：算分 / 掌握度 / 解析 / 裀剪 — 可单测，节点只编排不算分。"""

from __future__ import annotations

from typing import Any

# ── 题型分值 ──
SCORE_MAP = {
    "mcq": 10,
    "blank": 10,
    "short": 20,
    "code": 25,
}

# ── 完成度阈值 ──
MASTERY_LEVELS = [
    (0.95, "完全掌握"),
    (0.80, "优秀"),
    (0.60, "及格"),
    (0.0, "不及格"),
]

# ── 判题型裁剪范围 ──
COMPOSITION_RANGE = {
    "mcq": (2, 4),
    "blank": (0, 2),
    "short": (0, 2),
    "code": (0, 1),
}
TOTAL_RANGE = (3, 8)
DEFAULT_COMPOSITION = {"mcq": 3, "blank": 1, "short": 1, "code": 0}
ADAPTIVE_COMPOSITION_RANGE = {
    "mcq": (3, 8),
    "blank": (0, 3),
    "short": (1, 3),
    "code": (0, 2),
}
ADAPTIVE_TOTAL_RANGE = (6, 15)
ADAPTIVE_DEFAULT_COMPOSITION = {"mcq": 5, "blank": 1, "short": 2, "code": 0}


def grade_mcq_questions(
    questions: list[dict[str, Any]],
    answers: dict[str, str],
) -> list[dict[str, Any]]:
    """选择题规则判分：比 answer_index。"""
    results = []
    for q in questions:
        if q.get("type") != "mcq":
            continue
        qid = q["id"]
        student_answer = answers.get(qid, "")
        correct_answer = str(q.get("answer", ""))
        is_correct = student_answer.strip() == correct_answer.strip()
        score = q.get("score", SCORE_MAP["mcq"]) if is_correct else 0
        results.append({
            "question_id": qid,
            "type": "mcq",
            "score": score,
            "max_score": q.get("score", SCORE_MAP["mcq"]),
            "correct": is_correct,
            "student_answer": student_answer,
            "answer": correct_answer,
            "knowledge_point": q.get("knowledge_point", ""),
            "feedback": "正确！" if is_correct else f"错误，正确答案是 {correct_answer}",
        })
    return results


def calculate_overall(results: list[dict[str, Any]]) -> float:
    """总分 = Σ(points·score) / Σ(points)，百分制。"""
    total_weighted = 0.0
    total_max = 0.0
    for r in results:
        max_score = r.get("max_score", 0)
        if max_score > 0:
            total_weighted += r.get("score", 0)
            total_max += max_score
    if total_max == 0:
        return 0.0
    return round(total_weighted / total_max * 100, 1)


def calculate_mastery(
    results: list[dict[str, Any]],
    questions: list[dict[str, Any]],
) -> dict[str, Any]:
    """分项掌握度：按 knowledge_point 加权 + evidence。"""
    kp_scores: dict[str, list[float]] = {}
    for r in results:
        kp = r.get("knowledge_point", "未分类")
        if kp not in kp_scores:
            kp_scores[kp] = []
        max_score = r.get("max_score", 1)
        if max_score > 0:
            kp_scores[kp].append(r.get("score", 0) / max_score)

    mastery = {}
    for kp, scores in kp_scores.items():
        avg = sum(scores) / len(scores) if scores else 0
        level = "不及格"
        for threshold, label in MASTERY_LEVELS:
            if avg >= threshold:
                level = label
                break
        mastery[kp] = {
            "score": round(avg, 3),
            "level": level,
            "question_count": len(scores),
        }
    return mastery


def get_mastery_level(score: float) -> str:
    """根据分数返回掌握度等级。"""
    for threshold, label in MASTERY_LEVELS:
        if score >= threshold:
            return label
    return "不及格"


def should_enter_wrongbook(score: float, max_score: float, source: str = "") -> bool:
    """判断是否入错题本：< 0.6 且来源不是 wrongbook。"""
    if source == "wrongbook":
        return False
    if max_score <= 0:
        return False
    return (score / max_score) < 0.6


def trim_composition(raw: dict[str, int], *, adaptive: bool = False) -> dict[str, int]:
    """裁剪题目组成到合法范围。"""
    composition_range = ADAPTIVE_COMPOSITION_RANGE if adaptive else COMPOSITION_RANGE
    total_range = ADAPTIVE_TOTAL_RANGE if adaptive else TOTAL_RANGE
    default_composition = ADAPTIVE_DEFAULT_COMPOSITION if adaptive else DEFAULT_COMPOSITION
    trimmed = {}
    for qtype, (lo, hi) in composition_range.items():
        try:
            val = int(raw.get(qtype, 0) or 0)
        except (TypeError, ValueError):
            val = 0
        trimmed[qtype] = max(lo, min(hi, val))

    total = sum(trimmed.values())
    if total < total_range[0]:
        # 补兜底
        for qtype, count in default_composition.items():
            trimmed[qtype] = max(trimmed.get(qtype, 0), count)
        total = sum(trimmed.values())

    if total > total_range[1]:
        # 按比例裁剪
        ratio = total_range[1] / total
        for qtype in trimmed:
            lo = composition_range[qtype][0]
            trimmed[qtype] = max(lo, int(trimmed[qtype] * ratio))

    return trimmed


def inject_scope_prompt(
    scope_points: list[str],
    weak_points: list[str] | None = None,
) -> str:
    """生成 scope 注入 prompt 片段。"""
    lines = ["【知识点范围】"]
    for sp in scope_points:
        lines.append(f"- {sp}")
    if weak_points:
        lines.append("\n【重点关注薄弱点】")
        for wp in weak_points[:3]:
            lines.append(f"- {wp}")
    return "\n".join(lines)
