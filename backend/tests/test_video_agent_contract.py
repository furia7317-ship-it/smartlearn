from __future__ import annotations

from types import SimpleNamespace


class _StaticLLM:
    def __init__(self, content: str):
        self.content = content
        self.messages = []

    def invoke(self, messages):
        self.messages = messages
        return SimpleNamespace(content=self.content)


def _state() -> dict:
    return {
        "topic": "数据结构概述",
        "kb_context": [],
        "resource_outline": {
            "objective": "区分数据结构的两种表示",
            "sections": [
                {
                    "title": "结构比较",
                    "goal": "理解两种结构",
                    "must_cover": ["逻辑结构与物理结构"],
                    "target_words": 200,
                }
            ],
        },
    }


def test_video_agent_writes_outline_terms_into_real_narration(monkeypatch):
    from app.agents import video
    from app.services.resource_quality import review_resource

    monkeypatch.setattr(
        video,
        "build_llm",
        lambda **_kwargs: _StaticLLM(
            '{"template":"concept_card","params":{"title":"概述"},'
            '"narration":[{"text":"先看定义。","duration":15},'
            '{"text":"再看例子。","duration":15}]}'
        ),
    )

    resource = video.generate(_state())
    narration = "".join(segment["text"] for segment in resource["narration"])
    review = review_resource(
        resource,
        {
            "type": "video",
            "outline": _state()["resource_outline"],
            "quality_criteria": [],
        },
    )

    assert "逻辑结构与物理结构" in narration
    assert 150 <= sum(segment["duration"] for segment in resource["narration"]) <= 300
    assert len(resource["scenes"]) >= 12
    assert resource["chapters"][0]["start"] == 0
    assert resource["render_config"]["captions"] is True
    assert resource["render_config"]["orientation"] == "landscape"
    assert resource["render_config"]["visual_style"] == "whiteboard-remotion"
    assert resource["render_config"]["animation_engine"] == "remotion"
    assert resource["render_config"]["motion_style"] == "whiteboard-hand-drawn"
    assert resource["render_config"]["render_profile"] == "desktop-balanced"
    assert resource["visual_system"]["stage"] == "16:9"
    assert resource["visual_system"]["drawing_motion"] == "svg-stroke-and-hand"
    assert resource["visual_system"]["skill"].startswith("garden/web-video-presentation@")
    assert len({scene["chapter_id"] for scene in resource["scenes"]}) == 4
    assert {scene["composition"] for scene in resource["scenes"]} == {
        "hero", "split", "process", "comparison", "recap",
    }
    assert all(scene["visual_anchor"] for scene in resource["scenes"])
    assert all(scene["carry_over"] for scene in resource["scenes"][1:])
    assert all(1 <= len(scene["reveal_sequence"]) <= 4 for scene in resource["scenes"])
    assert len(resource["chapters"]) == 4
    assert len({chapter["id"] for chapter in resource["chapters"]}) == 4
    assert all(scene["title"] != scene["chapter_title"] for scene in resource["scenes"])
    assert review.approved is True


def test_video_agent_replaces_placeholder_and_duplicate_chapter_titles(monkeypatch):
    from app.agents import video

    monkeypatch.setattr(
        video,
        "build_llm",
        lambda **_kwargs: _StaticLLM(
            '{"scenes":['
            '{"title":"分镜 1","purpose":"hook","narration":"先提出问题。"},'
            '{"title":"建立核心理解","purpose":"concept",'
            '"chapter_title":"建立核心理解","narration":"解释连续存储。",'
            '"reveal_sequence":["连续存储","随机访问"]}'
            ']}'
        ),
    )

    resource = video.generate(_state())

    assert resource["scenes"][0]["title"] == "先问为什么"
    assert resource["scenes"][1]["title"] == "把冲突摆出来"
    assert all("分镜" not in scene["title"] for scene in resource["scenes"])
    assert all(scene["title"] != scene["chapter_title"] for scene in resource["scenes"])


def test_video_agent_parse_fallback_is_still_reviewable(monkeypatch):
    from app.agents import video
    from app.services.resource_quality import review_resource

    monkeypatch.setattr(video, "build_llm", lambda **_kwargs: _StaticLLM("not json"))

    resource = video.generate(_state())
    review = review_resource(
        resource,
        {
            "type": "video",
            "outline": _state()["resource_outline"],
            "quality_criteria": [],
        },
    )

    assert len(resource["narration"]) >= 12
    assert 150 <= sum(segment["duration"] for segment in resource["narration"]) <= 300
    assert review.approved is True


def test_video_agent_forces_landscape_and_preserves_other_render_config(monkeypatch):
    from app.agents import video

    monkeypatch.setattr(
        video,
        "build_llm",
        lambda **_kwargs: _StaticLLM(
            '{"title":"API 入门","pronunciation_hints":[{"term":"API","spoken":"A P I"}],'
            '"render_config":{"orientation":"portrait","caption_position":"center",'
            '"music_mood":"upbeat","music_volume":0.12},'
            '"narration":[{"text":"先理解 API。","duration":20}]}'
        ),
    )

    resource = video.generate(_state())

    assert resource["render_config"]["orientation"] == "landscape"
    assert resource["render_config"]["caption_position"] == "center"
    assert resource["render_config"]["caption_style"] == "active_phrase"
    assert resource["pronunciation_hints"] == [{"term": "API", "spoken": "A P I"}]


def test_video_planning_and_repair_share_the_same_duration_contract():
    from app.services.planned_resource_pipeline import _TYPE_CRITERIA
    from app.services.resource_quality import _positive_repair_evidence

    criteria = "；".join(_TYPE_CRITERIA["video"])
    repair = "；".join(
        _positive_repair_evidence(
            "video",
            "视频旁白总时长不合理",
            "scenes/narration",
        )
    )

    assert "150 到 300 秒" in criteria
    assert "150 到 300 秒" in repair


def test_video_agent_expands_many_short_segments_into_a_bounded_lesson(monkeypatch):
    from app.agents import video

    narration = ",".join(
        f'{{"text":"第 {index} 段。","duration":5}}'
        for index in range(1, 11)
    )
    monkeypatch.setattr(
        video,
        "build_llm",
        lambda **_kwargs: _StaticLLM(
            '{"template":"concept_card","params":{},"narration":[' + narration + "]}"
        ),
    )

    resource = video.generate(_state())

    total = sum(segment["duration"] for segment in resource["narration"])
    assert len(resource["scenes"]) == 12
    assert 150 <= total <= 300


def test_video_agent_loads_the_pinned_garden_skill(monkeypatch):
    from app.agents import video

    llm = _StaticLLM("not json")
    monkeypatch.setattr(video, "build_llm", lambda **_kwargs: llm)

    video.generate(_state())

    system_prompt = llm.messages[0]["content"]
    assert '<loaded_skill id="garden/web-video-presentation"' in system_prompt
    assert "固定 16:9 横屏舞台" in system_prompt
    assert "逐步揭示" in system_prompt
    assert "relation_to_previous" in system_prompt


def test_video_agent_does_not_inject_concept_card_params_into_compare_table(monkeypatch):
    from app.agents import video

    monkeypatch.setattr(
        video,
        "build_llm",
        lambda **_kwargs: _StaticLLM(
            '{"template":"compare_table","params":{"columns":["类型","A","B"],'
            '"rows":[["存储","连续","离散"]]},"narration":['
            '{"text":"先比较两类结构。","duration":15},'
            '{"text":"再看适用场景。","duration":15}]}'
        ),
    )

    resource = video.generate(_state())

    assert "items" not in resource["params"]
    assert "逻辑结构与物理结构" in "".join(
        segment["text"] for segment in resource["narration"]
    )


def test_manim_renderer_drops_unknown_model_params():
    from app.services.media.manim_render import normalize_template_params

    params = normalize_template_params(
        "compare_table",
        {
            "title": "顺序表 vs 链表",
            "columns": ["特征", "顺序表", "链表"],
            "rows": [["存储", "连续", "离散"]],
            "items": ["不应传给 Scene"],
        },
    )

    assert params == {
        "title": "顺序表 vs 链表",
        "columns": ["特征", "顺序表", "链表"],
        "rows": [["存储", "连续", "离散"]],
    }
