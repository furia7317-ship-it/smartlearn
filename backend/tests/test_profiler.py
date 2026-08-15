"""Profiler agent 单测：6 维画像抽取 + 增量合并（mock LLM，不触网）。"""

import json
from unittest.mock import MagicMock, patch


def _profile() -> dict:
    """每次取一份独立的默认画像副本。"""
    from app.agents.profiler import _DEFAULT_PROFILE

    return {k: (dict(v) if isinstance(v, dict) else list(v)) for k, v in _DEFAULT_PROFILE.items()}


class TestExtractProfileInfo:
    @patch("app.agents.profiler.build_llm")
    def test_merges_all_six_dimensions(self, mock_build):
        """六维（含第 6 维 error_profile）都要能写入。"""
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = json.dumps({
            "updates": {
                "knowledge_level": {"动态规划": {"score": 0.3}},
                "cognitive_style": {"visual": 0.6},
                "goals": {"target": "期中85分"},
                "error_profile": {"边界条件": {"count": 2}},
                "pace": {"question_count": 8},
                "interests": ["算法竞赛"],
            },
            "complete": False,
            "evidence": "学生自述动态规划弱",
        })
        mock_build.return_value = mock_llm
        from app.agents.profiler import extract_profile_info

        updated, complete = extract_profile_info("我动态规划很弱，想冲期中85", _profile(), 1)
        assert updated["knowledge_level"]["动态规划"]["score"] == 0.3
        # 第 6 维 error_profile 必须真正落入画像
        assert updated["error_profile"]["边界条件"]["count"] == 2
        assert updated["goals"]["target"] == "期中85分"
        assert updated["pace"]["question_count"] == 8
        assert "算法竞赛" in updated["interests"]
        assert complete is False

    @patch("app.agents.profiler.build_llm")
    def test_dict_dimension_merges_not_overwrites(self, mock_build):
        """字典维度按 key 合并，未提及的子项保留。"""
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = json.dumps(
            {"updates": {"cognitive_style": {"visual": 0.8}}, "complete": False, "evidence": ""}
        )
        mock_build.return_value = mock_llm
        from app.agents.profiler import extract_profile_info

        updated, _ = extract_profile_info("我喜欢看图理解", _profile(), 1)
        assert updated["cognitive_style"]["visual"] == 0.8
        assert "verbal" in updated["cognitive_style"]  # 未被覆盖

    @patch("app.agents.profiler.build_llm")
    def test_round_cap_forces_complete(self, mock_build):
        """到达轮次上限即使 LLM 说没完成也强制结束。"""
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = json.dumps({"updates": {}, "complete": False, "evidence": ""})
        mock_build.return_value = mock_llm
        from app.agents.profiler import extract_profile_info

        _, complete = extract_profile_info("随便聊聊", _profile(), 4)
        assert complete is True

    @patch("app.agents.profiler.build_llm")
    def test_bad_json_keeps_profile(self, mock_build):
        """LLM 返回非 JSON 时保持原画像、不崩。"""
        mock_llm = MagicMock()
        mock_llm.invoke.return_value.content = "这不是 JSON"
        mock_build.return_value = mock_llm
        from app.agents.profiler import extract_profile_info

        base = _profile()
        updated, complete = extract_profile_info("x", base, 2)
        assert updated == base
        assert complete is False
