from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.voice_action import plan_voice_action


READY_RESOURCES = [
    {"id": "video-1", "type": "video", "title": "数组与链表动画讲解", "status": "ready"},
    {"id": "lecture-1", "type": "explainer", "title": "数据结构完整讲义", "status": "ready"},
    {"id": "video-pending", "type": "video", "title": "未审核视频", "status": "review"},
]


class FakeModel:
    def __init__(self, payload: str) -> None:
        self.payload = payload

    def invoke(self, _messages):
        return SimpleNamespace(content=self.payload)


@pytest.mark.asyncio
async def test_agent_can_only_open_a_real_ready_resource():
    result = await plan_voice_action(
        "帮我打开数组与链表的视频资料",
        READY_RESOURCES,
        llm_factory=lambda **_kwargs: FakeModel(
            '{"action":"open_resource","resource_id":"video-1","reply":"现在打开视频。"}'
        ),
    )
    assert result["action"] == "open_resource"
    assert result["resource_id"] == "video-1"


@pytest.mark.asyncio
async def test_invented_model_id_falls_back_to_matching_ready_video():
    result = await plan_voice_action(
        "打开一份视频资料",
        READY_RESOURCES,
        llm_factory=lambda **_kwargs: FakeModel(
            '{"action":"open_resource","resource_id":"invented"}'
        ),
    )
    assert result["resource_id"] == "video-1"


@pytest.mark.asyncio
async def test_ordinary_question_never_becomes_a_ui_action():
    result = await plan_voice_action(
        "数组和链表有什么区别",
        READY_RESOURCES,
        llm_factory=lambda **_kwargs: FakeModel("{}"),
    )
    assert result == {"action": "none"}


@pytest.mark.asyncio
async def test_plain_open_material_request_never_turns_into_generation():
    result = await plan_voice_action(
        "打开资料",
        READY_RESOURCES,
        llm_factory=lambda **_kwargs: FakeModel(
            '{"action":"open_resource","resource_id":"lecture-1"}'
        ),
    )
    assert result["action"] == "open_resource"
    assert result["resource_id"] == "lecture-1"


@pytest.mark.asyncio
async def test_learning_request_without_open_verb_is_not_a_ui_action():
    result = await plan_voice_action(
        "我想学习数据结构讲义",
        READY_RESOURCES,
        llm_factory=lambda **_kwargs: FakeModel(
            '{"action":"open_resource","resource_id":"lecture-1"}'
        ),
    )
    assert result == {"action": "none"}


@pytest.mark.asyncio
async def test_colloquial_resource_center_reference_is_an_open_action():
    result = await plan_voice_action(
        "在资源中心里的东西啊，你不能打开吗？",
        READY_RESOURCES,
        llm_factory=lambda **_kwargs: FakeModel(
            '{"action":"open_resource","resource_id":"lecture-1"}'
        ),
    )
    assert result["action"] == "open_resource"
    assert result["resource_id"] == "lecture-1"
