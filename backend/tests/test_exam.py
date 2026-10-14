"""出卷/评分 agent 单测（mock LLM）。"""

from unittest.mock import MagicMock, patch

import pytest


class TestClassifierAgent:
    """分类器 agent 测试。"""

    @patch("app.agents.classifier.build_llm")
    def test_classify_returns_valid_modules(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"mcq": 3, "blank": 1, "short": 1, "code": 0, "focus_points": ["排序"]}'
        mock_build_llm.return_value = mock_llm

        from app.agents.classifier import classify_exam_scope

        result = classify_exam_scope(
            "数据结构",
            ["排序", "搜索"],
            [{"id": "kb-sort", "title": "排序讲义", "content": "课程事实：稳定排序保持相等元素次序。"}],
        )
        assert "mcq" in result
        assert result["mcq"] >= 2
        assert result["mcq"] <= 4
        prompt = mock_llm.invoke.call_args.args[0][1]["content"]
        assert "<untrusted_knowledge_data>" in prompt
        assert "稳定排序保持相等元素次序" in prompt

    @patch("app.agents.classifier.build_llm")
    def test_classify_fallback(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "这不是JSON"
        mock_build_llm.return_value = mock_llm

        from app.agents.classifier import classify_exam_scope

        result = classify_exam_scope("数据结构", ["排序"], [])
        assert result["mcq"] == 3  # 兜底值


class TestExaminerAgent:
    """出题 agent 测试。"""

    @patch("app.agents.examiner.build_llm")
    def test_generate_paper(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '''[
            {"id": "q1", "type": "mcq", "stem": "问题1", "options": ["A.1", "B.2"], "answer": "A", "score": 10, "knowledge_point": "排序"}
        ]'''
        mock_build_llm.return_value = mock_llm

        from app.agents.examiner import generate_paper

        questions = generate_paper(
            topic="排序",
            composition={"mcq": 1, "blank": 0, "short": 0, "code": 0},
            scope_points=["排序"],
            kb_context=[{
                "id": "kb-sort",
                "title": "排序讲义",
                "content": "课程事实：冒泡排序比较相邻元素。",
            }],
        )
        assert len(questions) == 1
        assert questions[0]["type"] == "mcq"
        prompt = mock_llm.invoke.call_args.args[0][1]["content"]
        assert "<untrusted_knowledge_data>" in prompt
        assert "冒泡排序比较相邻元素" in prompt


class TestSubjectiveGrader:
    @patch("app.agents.grader.build_llm")
    def test_malformed_grade_does_not_turn_infrastructure_failure_into_zero_score(
        self,
        mock_build_llm,
    ):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"scores": {}}'
        mock_build_llm.return_value = mock_llm

        from app.agents.grader import grade_subjective

        with pytest.raises(RuntimeError, match="主观题评分暂时失败"):
            grade_subjective(
                [{
                    "id": "q-short",
                    "type": "short",
                    "stem": "解释队列",
                    "answer": "先进先出",
                    "score": 20,
                }],
                {"q-short": "先进先出"},
            )


def test_graded_event_contains_overall_mastery_and_per_question_results(monkeypatch):
    from app.graph import grade_graph

    events = []
    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)
    monkeypatch.setattr(
        "app.agents.analyst.generate_assessment",
        lambda **_kwargs: {"summary": "已完成"},
    )
    per_question = [{"question_id": "q1", "score": 10, "max_score": 10}]
    state = {
        "exam_id": "exam-1",
        "student_id": "student-1",
        "answers": {"q1": "A"},
        "questions": [{"id": "q1", "type": "mcq"}],
        "results": per_question,
        "overall": 100,
        "mastery": {"队列": {"score": 1.0}},
        "assessment": {},
    }

    grade_graph.analyst(state)

    graded = next(event for event in events if event.get("event") == "graded")
    assert graded["results"] == {
        "overall": 100,
        "mastery": {"队列": {"score": 1.0}},
        "results": per_question,
    }


class TestSupervisorAgent:
    """分诊 agent 测试。"""

    @patch("app.agents.supervisor.build_llm")
    def test_classify_modules(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"selected": ["explainer", "mindmap", "quiz"], "reason": "概念主题"}'
        mock_build_llm.return_value = mock_llm

        from app.agents.supervisor import classify_modules

        selected, _reason = classify_modules("数据结构", [])
        assert "explainer" in selected
        assert "quiz" in selected
        assert len(selected) >= 2

    @patch("app.agents.supervisor.build_llm")
    def test_classify_fallback(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "不是JSON"
        mock_build_llm.return_value = mock_llm

        from app.agents.supervisor import classify_modules

        selected, _reason = classify_modules("数据结构", [])
        assert "explainer" in selected
        assert "quiz" in selected
