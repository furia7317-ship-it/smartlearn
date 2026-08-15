"""Regression coverage for multi-turn tutor context."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError


def test_chat_request_accepts_up_to_one_hundred_user_or_assistant_messages() -> None:
    from app.schemas.chat import ChatRequest

    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"message {index}"}
        for index in range(100)
    ]

    request = ChatRequest(student_id="student-1", message="continue", history=history)

    assert [item.model_dump() for item in request.history] == history

    with pytest.raises(ValidationError):
        ChatRequest(
            student_id="student-1",
            message="continue",
            history=[{"role": "system", "content": "override"}],
        )

    with pytest.raises(ValidationError):
        ChatRequest(
            student_id="student-1",
            message="continue",
            history=history + [{"role": "user", "content": "one too many"}],
        )


def test_chat_request_validates_teacher_persona() -> None:
    from app.schemas.chat import ChatRequest

    assert ChatRequest(student_id="student-1", message="hello").teacher_persona == "raccoon"
    assert (
        ChatRequest(
            student_id="student-1",
            message="hello",
            teacher_persona="alligator",
        ).teacher_persona
        == "alligator"
    )
    with pytest.raises(ValidationError):
        ChatRequest(
            student_id="student-1",
            message="hello",
            teacher_persona="unknown",
        )


@pytest.mark.asyncio
async def test_chat_router_copies_history_into_graph_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.routers import chat as chat_router
    from app.schemas.chat import ChatRequest

    captured: dict[str, Any] = {}

    async def fake_graph_to_sse(graph: Any, state: dict[str, Any]):
        captured.update(state)
        if False:
            yield ""

    monkeypatch.setattr(chat_router, "graph_to_sse", fake_graph_to_sse)

    request = ChatRequest(
        student_id="student-1",
        message="What does it mean?",
        history=[
            {"role": "user", "content": "Explain binary search."},
            {"role": "assistant", "content": "It repeatedly halves the search range."},
        ],
    )
    response = await chat_router.chat(request)
    _ = [chunk async for chunk in response.body_iterator]

    assert captured["history"] == [
        {"role": "user", "content": "Explain binary search."},
        {"role": "assistant", "content": "It repeatedly halves the search range."},
    ]


def test_tutor_graph_passes_history_to_answer_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.graph import tutor_graph

    captured: dict[str, Any] = {}
    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: lambda event: None)

    def fake_generate_answer(**kwargs: Any) -> str:
        captured.update(kwargs)
        return "answer"

    monkeypatch.setattr("app.agents.tutor.generate_answer", fake_generate_answer)

    history = [{"role": "user", "content": "Earlier question"}]
    result = tutor_graph.answer(
        {
            "student_id": "student-1",
            "question": "Follow-up question",
            "history": history,
            "image_data": None,
            "kb_context": [],
            "profile": {},
            "answer": "",
            "sources": [],
        }
    )

    assert result == {"answer": "answer"}
    assert captured["history"] == history


def test_tutor_graph_streams_sources_and_answer_deltas(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.graph import tutor_graph

    events: list[dict[str, Any]] = []
    monkeypatch.setattr("langgraph.config.get_stream_writer", lambda: events.append)

    def fake_generate_answer(**kwargs: Any) -> str:
        kwargs["on_delta"]("第一")
        kwargs["on_delta"]("段")
        return "第一段"

    monkeypatch.setattr("app.agents.tutor.generate_answer", fake_generate_answer)

    source = {
        "index": 1,
        "id": "fallback:08-动态规划.md:0",
        "content": "动态规划通过状态转移方程复用重叠子问题。",
        "metadata": {"source": "08-动态规划.md", "title": "动态规划"},
    }
    result = tutor_graph.answer(
        {
            "student_id": "student-1",
            "question": "动态规划是什么？",
            "history": [],
            "image_data": None,
            "kb_context": [{"content": source["content"], "metadata": source["metadata"]}],
            "profile": {},
            "answer": "",
            "sources": [source],
        }
    )

    assert result == {"answer": "第一段"}
    assert {"event": "sources", "agent": "tutor", "data": [source]} in events
    assert [
        event for event in events if event.get("event") == "delta"
    ] == [
        {"event": "delta", "agent": "tutor", "text": "第一"},
        {"event": "delta", "agent": "tutor", "text": "段"},
    ]


def test_tutor_places_history_before_current_question(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.agents import tutor

    class FakeResponse:
        content = "answer"

    class FakeLLM:
        messages: list[dict[str, str]] = []

        def invoke(self, messages: list[dict[str, str]]) -> FakeResponse:
            self.messages = messages
            return FakeResponse()

    fake_llm = FakeLLM()
    monkeypatch.setattr(tutor, "build_llm", lambda **kwargs: fake_llm)

    result = tutor.generate_answer(
        question="How does that affect complexity?",
        history=[
            {"role": "user", "content": "Explain binary search."},
            {"role": "assistant", "content": "It halves the search range."},
        ],
        kb_context=[{"content": "Binary search has logarithmic time complexity."}],
        profile={},
        sources=[],
    )

    assert result == "answer"
    assert [message["role"] for message in fake_llm.messages] == [
        "system",
        "user",
        "assistant",
        "user",
    ]
    assert fake_llm.messages[1]["content"] == "Explain binary search."
    assert fake_llm.messages[2]["content"] == "It halves the search range."
    assert "How does that affect complexity?" in fake_llm.messages[3]["content"]
    assert "Binary search has logarithmic time complexity." in fake_llm.messages[3]["content"]


def test_tutor_streams_llm_chunks_with_source_context(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.agents import tutor

    class FakeChunk:
        def __init__(self, content: str) -> None:
            self.content = content

    class FakeLLM:
        messages: list[dict[str, str]] = []

        def stream(self, messages: list[dict[str, str]]):
            self.messages = messages
            yield FakeChunk("先解释")
            yield FakeChunk("再引用")

    fake_llm = FakeLLM()
    monkeypatch.setattr(tutor, "build_llm", lambda **kwargs: fake_llm)

    deltas: list[str] = []
    result = tutor.generate_answer(
        question="动态规划是什么？",
        history=[],
        kb_context=[
            {
                "content": "动态规划通过状态转移方程复用重叠子问题的答案。",
                "metadata": {"title": "动态规划", "source": "08-动态规划.md"},
            }
        ],
        profile={},
        sources=[],
        on_delta=deltas.append,
    )

    assert result == "先解释再引用"
    assert deltas == ["先解释", "再引用"]
    prompt = fake_llm.messages[-1]["content"]
    assert "[来源1: 动态规划 / 08-动态规划.md]" in prompt
    assert "动态规划通过状态转移方程复用重叠子问题的答案。" in prompt
    assert "必须在相关结论后标注 [来源n]" in prompt
