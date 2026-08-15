"""scoring.py 纯函数单测。"""

import pytest

from app.services.scoring import (
    MASTERY_LEVELS,
    calculate_mastery,
    calculate_overall,
    get_mastery_level,
    grade_mcq_questions,
    inject_scope_prompt,
    should_enter_wrongbook,
    trim_composition,
)


class TestGradeMCQ:
    """选择题判分。"""

    def test_all_correct(self):
        questions = [
            {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
            {"id": "q2", "type": "mcq", "answer": "B", "score": 10, "knowledge_point": "排序"},
        ]
        answers = {"q1": "A", "q2": "B"}
        results = grade_mcq_questions(questions, answers)
        assert all(r["correct"] for r in results)
        assert all(r["score"] == 10 for r in results)

    def test_all_wrong(self):
        questions = [
            {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
        ]
        answers = {"q1": "B"}
        results = grade_mcq_questions(questions, answers)
        assert not results[0]["correct"]
        assert results[0]["score"] == 0

    def test_partial_correct(self):
        questions = [
            {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
            {"id": "q2", "type": "mcq", "answer": "C", "score": 10, "knowledge_point": "搜索"},
        ]
        answers = {"q1": "A", "q2": "D"}
        results = grade_mcq_questions(questions, answers)
        assert results[0]["correct"]
        assert not results[1]["correct"]

    def test_empty_answers(self):
        questions = [
            {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
        ]
        results = grade_mcq_questions(questions, {})
        assert not results[0]["correct"]

    def test_skip_non_mcq(self):
        questions = [
            {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
            {"id": "q2", "type": "short", "answer": "答案", "score": 20, "knowledge_point": "排序"},
        ]
        results = grade_mcq_questions(questions, {"q1": "A", "q2": "答案"})
        assert len(results) == 1  # 只返回 mcq


class TestCalculateOverall:
    """总分计算。"""

    def test_perfect_score(self):
        results = [
            {"score": 10, "max_score": 10},
            {"score": 20, "max_score": 20},
        ]
        assert calculate_overall(results) == 100.0

    def test_half_score(self):
        results = [
            {"score": 5, "max_score": 10},
            {"score": 10, "max_score": 20},
        ]
        assert calculate_overall(results) == 50.0

    def test_zero_total(self):
        assert calculate_overall([]) == 0.0
        assert calculate_overall([{"score": 0, "max_score": 0}]) == 0.0


class TestCalculateMastery:
    """掌握度计算。"""

    def test_single_knowledge_point(self):
        results = [
            {"score": 8, "max_score": 10, "knowledge_point": "排序", "correct": True},
            {"score": 6, "max_score": 10, "knowledge_point": "排序", "correct": True},
        ]
        questions = [
            {"id": "q1", "knowledge_point": "排序"},
            {"id": "q2", "knowledge_point": "排序"},
        ]
        mastery = calculate_mastery(results, questions)
        assert "排序" in mastery
        assert mastery["排序"]["score"] == 0.7  # (8/10 + 6/10) / 2

    def test_multiple_knowledge_points(self):
        results = [
            {"score": 10, "max_score": 10, "knowledge_point": "排序"},
            {"score": 5, "max_score": 10, "knowledge_point": "搜索"},
        ]
        questions = []
        mastery = calculate_mastery(results, questions)
        assert len(mastery) == 2


class TestGetMasteryLevel:
    """掌握度等级。"""

    def test_levels(self):
        assert get_mastery_level(1.0) == "完全掌握"
        assert get_mastery_level(0.95) == "完全掌握"
        assert get_mastery_level(0.85) == "优秀"
        assert get_mastery_level(0.70) == "及格"
        assert get_mastery_level(0.50) == "不及格"


class TestShouldEnterWrongbook:
    """错题本入库判断。"""

    def test_low_score(self):
        assert should_enter_wrongbook(3, 10) is True

    def test_high_score(self):
        assert should_enter_wrongbook(8, 10) is False

    def test_from_wrongbook(self):
        assert should_enter_wrongbook(3, 10, source="wrongbook") is False

    def test_zero_max(self):
        assert should_enter_wrongbook(0, 0) is False


class TestTrimComposition:
    """题目组成裁剪。"""

    def test_normal(self):
        raw = {"mcq": 3, "blank": 1, "short": 1, "code": 0}
        result = trim_composition(raw)
        assert result["mcq"] == 3
        assert sum(result.values()) >= 3

    def test_too_many(self):
        raw = {"mcq": 10, "blank": 5, "short": 5, "code": 3}
        result = trim_composition(raw)
        assert sum(result.values()) <= 8

    def test_too_few(self):
        raw = {"mcq": 0, "blank": 0, "short": 0, "code": 0}
        result = trim_composition(raw)
        assert sum(result.values()) >= 3

    def test_adaptive_diagnostic_uses_ai_sized_six_to_fifteen_question_range(self):
        result = trim_composition(
            {"mcq": 7, "blank": 2, "short": 3, "code": 1},
            adaptive=True,
        )
        assert 6 <= sum(result.values()) <= 15
        assert result["short"] >= 1

    def test_adaptive_diagnostic_never_falls_back_to_five_mcqs_only(self):
        result = trim_composition({}, adaptive=True)
        assert sum(result.values()) >= 6
        assert result["short"] >= 1


class TestInjectScopePrompt:
    """Scope 注入。"""

    def test_basic(self):
        prompt = inject_scope_prompt(["排序", "搜索"])
        assert "排序" in prompt
        assert "搜索" in prompt

    def test_with_weak(self):
        prompt = inject_scope_prompt(["排序", "搜索"], weak_points=["快速排序", "二分查找"])
        assert "快速排序" in prompt
        assert "二分查找" in prompt

    def test_weak_limit(self):
        weak = ["a", "b", "c", "d", "e"]
        prompt = inject_scope_prompt(["排序"], weak_points=weak)
        assert "a" in prompt
        assert "b" in prompt
        assert "c" in prompt
