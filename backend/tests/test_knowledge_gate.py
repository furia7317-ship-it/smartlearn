"""Knowledge gate state and hard-short-circuit regression coverage."""

from __future__ import annotations

import json

import pytest


def test_distance_to_similarity_is_bounded() -> None:
    from app.services.knowledge_gate import distance_to_similarity

    assert distance_to_similarity(0) == 1.0
    assert distance_to_similarity(0.58) == 0.71
    assert distance_to_similarity(2) == 0.0
    assert distance_to_similarity("bad") == 0.0


def test_gate_distinguishes_match_miss_and_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import knowledge_gate
    from app.services.rag import RetrievalUnavailable

    monkeypatch.setattr(
        "app.services.rag.retrieve_for_gate",
        lambda *args: [{"distance": 0.4, "content": "可靠内容"}],
    )
    assert knowledge_gate.check_knowledge_gate("栈").status == "matched"

    monkeypatch.setattr("app.services.rag.retrieve_for_gate", lambda *args: [])
    miss = knowledge_gate.check_knowledge_gate("不存在主题")
    assert miss.status == "kb_miss"
    assert miss.error_payload()["retryable"] is False

    def unavailable(*args):
        raise RetrievalUnavailable("internal detail")

    monkeypatch.setattr("app.services.rag.retrieve_for_gate", unavailable)
    outage = knowledge_gate.check_knowledge_gate("栈")
    assert outage.status == "kb_unavailable"
    assert "internal detail" not in str(outage.error_payload())


def test_gate_falls_back_when_vector_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import rag

    class Collection:
        def count(self):
            return 1

        def query(self, **kwargs):
            return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}

    class Embedder:
        def encode(self, *args, **kwargs):
            class Values:
                def tolist(self): return [[0.0]]
            return Values()

    monkeypatch.setattr(rag, "get_or_create_collection", lambda *args: Collection())
    monkeypatch.setattr(rag, "_get_embedder", lambda: Embedder())
    monkeypatch.setattr(rag, "_markdown_chunks", lambda: [{"id": "kb-real", "content": "数据结构课程内容", "metadata": {"title": "数据结构"}}])
    result = rag.retrieve_for_gate("帮我生成一份数据结构的学习路径")
    assert result[0]["id"] == "kb-real"
    assert result[0]["retrieval_source"] == "markdown"


def test_gate_prioritizes_exact_local_evidence_over_stale_vector_hits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rag

    class Collection:
        def count(self):
            return 1

        def query(self, **kwargs):
            return {
                "ids": [["vector-sorting"]],
                "documents": [["排序算法内容"]],
                "metadatas": [[{"title": "排序算法"}]],
                "distances": [[0.2]],
            }

    class Embedder:
        def encode(self, *args, **kwargs):
            class Values:
                def tolist(self):
                    return [[0.0]]

            return Values()

    monkeypatch.setattr(rag, "get_or_create_collection", lambda *args: Collection())
    monkeypatch.setattr(rag, "_get_embedder", lambda: Embedder())
    monkeypatch.setattr(
        rag,
        "_markdown_chunks",
        lambda: [
                {
                    "id": "local-stack",
                    "content": "栈遵循后进先出原则。",
                    "metadata": {"title": "03-栈和队列"},
                }
        ],
    )

    result = rag.retrieve_for_gate("栈的基本概念", n_results=2)

    assert [item["id"] for item in result] == ["local-stack", "vector-sorting"]
    assert result[0]["retrieval_source"] == "markdown"


def test_markdown_blocks_keep_adjacent_definition_and_operations_together() -> None:
    from app.services.rag import _coalesce_markdown_blocks

    chunks = _coalesce_markdown_blocks(
        ["### 定义\n栈遵循后进先出。", "### 操作\npush 入栈，pop 出栈。"],
        limit=100,
    )

    assert chunks == ["### 定义\n栈遵循后进先出。\n\n### 操作\npush 入栈，pop 出栈。"]


@pytest.mark.asyncio
async def test_create_plan_kb_miss_does_not_call_builder(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException
    from app.routers import resource_plans
    from app.schemas.resource import ResourceRequest
    from app.services.knowledge_gate import KnowledgeGateResult

    monkeypatch.setattr(
        resource_plans,
        "_require_knowledge",
        lambda *args: (_ for _ in ()).throw(
            HTTPException(status_code=409, detail=KnowledgeGateResult("kb_miss", "主题", [], 0).error_payload())
        ),
    )
    called = False

    def builder(**kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(resource_plans, "build_resource_plan", builder)
    with pytest.raises(HTTPException) as exc:
        await resource_plans.create_plan(
            ResourceRequest(topic="主题", student_id="student-1"), None
        )
    assert exc.value.status_code == 409
    assert called is False


@pytest.mark.asyncio
async def test_chat_kb_miss_falls_back_to_streamed_general_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.agent import runner
    from app.agent.harness import AgentResult
    from app.schemas.chat import ChatRequest
    from app.services.knowledge_gate import KnowledgeGateResult

    monkeypatch.setattr("app.agents.profiler.get_profile", lambda student_id: {})
    monkeypatch.setattr(
        "app.services.knowledge_gate.check_knowledge_gate",
        lambda *args: KnowledgeGateResult("kb_miss", "未知主题", [], 0.0),
    )
    constructed = False

    class FakeClient:
        def __init__(self, *args, **kwargs):
            nonlocal constructed
            constructed = True

    class FakeHarness:
        def __init__(self, *_args, emit, **_kwargs):
            self.emit = emit

        async def run(self, messages):
            await self.emit("delta", {"agent": "tutor", "text": "我可以按通用知识解释。"})
            await self.emit(
                "content",
                {"agent": "tutor", "type": "answer", "data": "我可以按通用知识解释。"},
            )
            return AgentResult(
                messages=messages,
                answer="我可以按通用知识解释。",
                turns_used=1,
                finished_naturally=True,
            )

    monkeypatch.setattr("app.core.llm.provider_openai_config", lambda: ("key", "url", "model"))
    monkeypatch.setattr("openai.AsyncOpenAI", FakeClient)
    monkeypatch.setattr(runner, "AgentHarness", FakeHarness)
    events = [
        chunk
        async for chunk in runner.agent_chat_sse(
            ChatRequest(student_id="student-1", message="未知主题怎么学")
        )
    ]
    assert constructed is True
    assert any("event: delta" in event and "通用知识" in event for event in events)
    assert not any("event: blocked" in event for event in events)
    done = next(event for event in events if event.startswith("event: done\n"))
    done_payload = json.loads(done.split("data: ", 1)[1].split("\n", 1)[0])
    assert done_payload["status"] == "completed"
    assert done_payload["completed"] is True


@pytest.mark.asyncio
async def test_assess_exam_kb_miss_short_circuits_before_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException
    from app.routers import assess
    from app.schemas.exam import ExamRequest
    from app.services.knowledge_gate import KnowledgeGateResult

    monkeypatch.setattr(
        "app.services.knowledge_gate.check_knowledge_gate",
        lambda *args: KnowledgeGateResult("kb_miss", "未知主题", [], 0.0),
    )
    with pytest.raises(HTTPException) as exc:
        await assess.create_exam(
            ExamRequest(topic="未知主题", student_id="student-1"), None
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "kb_miss"
