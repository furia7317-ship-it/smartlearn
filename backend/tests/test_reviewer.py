"""Reviewer agent 集成测试（mock LLM）。"""

from unittest.mock import MagicMock, patch


class TestReviewerIntegration:
    @patch("app.agents.reviewer.build_llm")
    def test_review_with_rule_check(self, mock_build_llm):
        """测试规则审核 + LLM 审核的集成流程。"""
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"approved": true, "issues": [], "fixes": {}}'
        mock_build_llm.return_value = mock_llm

        from app.agents.reviewer import review_resources

        resources = [
            {
                "id": "explainer_1",
                "type": "explainer",
                "content": {
                    "explanation": "冒泡排序是一种简单的排序算法[来源1]",
                    "title": "冒泡排序",
                },
            }
        ]
        kb = [{"content": "冒泡排序是最基础的排序算法"}]

        result = review_resources(resources, kb)
        assert len(result) == 1
        assert result[0]["reviewed"] is True

    @patch("app.agents.reviewer.build_llm")
    def test_review_with_sensitive_content(self, mock_build_llm):
        """测试包含敏感内容的资源审核。"""
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"approved": false, "issues": ["敏感内容"], "fixes": {}}'
        mock_build_llm.return_value = mock_llm

        from app.agents.reviewer import review_resources

        resources = [
            {
                "id": "test_1",
                "type": "explainer",
                "content": {"explanation": "涉及赌博的解释"},
            }
        ]

        result = review_resources(resources, [])
        assert result[0]["reviewed"] is True
        # 应该有审核问题记录
        assert len(result[0].get("review_notes", [])) > 0 or not result[0]["review_approved"]

    def test_review_empty_resources(self):
        """测试空资源列表。"""
        from app.agents.reviewer import review_resources

        result = review_resources([], [])
        assert result == []

    @patch("app.agents.reviewer.build_llm")
    def test_reviewer_infrastructure_failure_is_not_approved(self, mock_build_llm):
        mock_build_llm.side_effect = RuntimeError("provider offline")

        from app.agents.reviewer import review_resources

        result = review_resources(
            [{"id": "r1", "type": "explainer", "content": {"explanation": "栈是后进先出。"}}],
            [{"id": "kb-1", "content": "栈遵循后进先出。"}],
        )

        assert result[0]["review_approved"] is False
        assert result[0]["review_status"] == "review_unavailable"
        assert result[0]["review_error_code"] == "review_unavailable"

    @patch("app.agents.reviewer.build_llm")
    def test_reviewer_missing_explicit_verdict_fails_closed(self, mock_build_llm):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = '{"issues": [], "fixes": {}}'
        mock_build_llm.return_value = mock_llm

        from app.agents.reviewer import review_resources

        result = review_resources(
            [{"id": "r2", "type": "explainer", "content": {"explanation": "栈是后进先出。"}}],
            [{"id": "kb-1", "content": "栈遵循后进先出。"}],
        )

        assert result[0]["review_approved"] is False
        assert result[0]["review_status"] == "review_unavailable"
        assert result[0]["review_error_code"] == "review_unavailable"
