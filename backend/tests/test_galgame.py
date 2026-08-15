from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from app.routers import galgame as galgame_router
from app.schemas.galgame import GalgameGenerateRequest
from app.services.galgame import build_source_refs, generate_galgame_project


SOURCE = """[第 1 页]
二叉树是每个节点至多有两个子树的有序树。两个子树分别称为左子树和右子树。

[第 2 页]
二叉树的第 i 层至多有二的 i 减一次方个节点。深度为 k 的二叉树至多有二的 k 次方减一个节点。

[第 3 页]
前序遍历先访问根节点，再遍历左子树，最后遍历右子树。中序遍历先访问左子树，再访问根节点。
"""


class _StaticLLM:
    def __init__(self, content: str):
        self.content = content

    def invoke(self, _messages):
        return SimpleNamespace(content=self.content)


def _request() -> GalgameGenerateRequest:
    return GalgameGenerateRequest(
        student_id="student-test",
        source_title="二叉树讲义",
        source_text=SOURCE,
        resource_id="resource-1",
        source_kind="resource",
    )


def test_source_refs_keep_page_locators_and_bounded_excerpts():
    refs = build_source_refs("二叉树讲义", SOURCE)

    assert [ref.locator for ref in refs] == ["第 1 页", "第 2 页", "第 3 页"]
    assert all(len(ref.excerpt) <= 900 for ref in refs)


def test_galgame_model_output_is_grounded_and_playable():
    llm = _StaticLLM(
        '{"title":"二叉树课堂",'
        '"learning_objectives":["理解二叉树"],'
        '"key_takeaways":["每个节点至多两个子树"],'
        '"scenes":['
        '{"title":"定义","speaker":"知夏","expression":"smile",'
        '"text":"先抓住定义。","blackboard_points":["至多两个子树"],'
        '"source_ids":["source-1"],"choices":[]},'
        '{"title":"左右有序","speaker":"知夏","expression":"thinking",'
        '"text":"左右子树不能随意交换。","source_ids":["source-1"],"choices":[]},'
        '{"title":"节点上限","speaker":"知夏","expression":"neutral",'
        '"text":"再看层数与节点上限。","source_ids":["source-2"],"choices":[]},'
        '{"title":"遍历","speaker":"知夏","expression":"encourage",'
        '"text":"最后比较遍历顺序。","source_ids":["source-3"],"choices":[]}'
        ']}'
    )

    project = generate_galgame_project(_request(), llm=llm)

    assert project.generation_provider == "configured-llm"
    assert len(project.scenes) == 4
    assert all(set(scene.source_ids) <= {ref.id for ref in project.sources} for scene in project.scenes)
    assert any(choice.correct is not None for scene in project.scenes for choice in scene.choices)
    assert project.video_script["render_config"]["animation_engine"] == "remotion"
    assert len(project.video_script["scenes"]) == len(project.scenes)


def test_invalid_model_output_falls_back_without_losing_source_evidence():
    project = generate_galgame_project(_request(), llm=_StaticLLM("not json"))

    assert project.generation_provider == "deterministic-fallback"
    assert len(project.scenes) >= 4
    assert all(scene.source_ids for scene in project.scenes)
    assert project.scenes[-1].choices == []


@pytest.mark.asyncio
async def test_generate_endpoint_keeps_blocking_model_work_off_the_event_loop(monkeypatch):
    event_loop_thread = threading.get_ident()

    def fake_generate(request):
        assert request.source_title == "二叉树讲义"
        assert threading.get_ident() != event_loop_thread
        return "thread-result"

    monkeypatch.setattr(galgame_router, "generate_galgame_project", fake_generate)

    assert await galgame_router.generate_galgame(_request()) == "thread-result"
