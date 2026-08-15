"""出卷/评分 agent 单测（mock LLM）。"""

import pytest
from unittest.mock import MagicMock, patch


class TestClassifierAgent:
    """分类器 agent 测试。"""

    @patch("app.agents.classifier.build_llm")
    def test_classify_returns_valid_modules(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"mcq": 3, "blank": 1, "short": 1, "code": 0, "focus_points": ["排序"]}'
        mock_build_llm.return_value = mock_llm

        from app.agents.classifier import classify_exam_scope

        result = classify_exam_scope("数据结构", ["排序", "搜索"], [])
        assert "mcq" in result
        assert result["mcq"] >= 2
        assert result["mcq"] <= 4

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
            kb_context=[],
        )
        assert len(questions) == 1
        assert questions[0]["type"] == "mcq"


class TestSupervisorAgent:
    """分诊 agent 测试。"""

    @patch("app.agents.supervisor.build_llm")
    def test_classify_modules(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"selected": ["explainer", "mindmap", "quiz"], "reason": "概念主题"}'
        mock_build_llm.return_value = mock_llm

        from app.agents.supervisor import classify_modules

        selected, reason = classify_modules("数据结构", [])
        assert "explainer" in selected
        assert "quiz" in selected
        assert len(selected) >= 2

    @patch("app.agents.supervisor.build_llm")
    def test_classify_fallback(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "不是JSON"
        mock_build_llm.return_value = mock_llm

        from app.agents.supervisor import classify_modules

        selected, reason = classify_modules("数据结构", [])
        assert "explainer" in selected
        assert "quiz" in selected
