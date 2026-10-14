from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from openai import APIConnectionError
from app.agent.harness import AgentHarness


@pytest.mark.asyncio
async def test_transient_stream_open_recovers_without_replaying_output(monkeypatch):
    async def chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="已连接", tool_calls=None))])
    create = AsyncMock(side_effect=[APIConnectionError(request=httpx.Request("POST", "https://example.test")), chunks()])
    emit = AsyncMock()
    monkeypatch.setattr("app.agent.harness.asyncio.sleep", AsyncMock())
    harness = AgentHarness(SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
                           "test", [], set(), emit=emit, dispatch=AsyncMock(), student_id="student-1")
    content, calls = await harness._stream_turn([{"role": "user", "content": "学习资料"}])
    assert content == "已连接" and not calls
    assert create.await_count == 2
    assert sum(args.args[0] == "delta" for args in emit.await_args_list) == 1


@pytest.mark.asyncio
async def test_stream_connection_retries_are_bounded_and_cancellable(monkeypatch):
    create = AsyncMock(side_effect=APIConnectionError(request=httpx.Request("POST", "https://example.test")))
    monkeypatch.setattr("app.agent.harness.asyncio.sleep", AsyncMock())
    harness = AgentHarness(SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
                           "test", [], set(), emit=AsyncMock(), dispatch=AsyncMock(), student_id="student-1")
    with pytest.raises(APIConnectionError):
        await harness._stream_turn([])
    assert create.await_count == 3
    create.reset_mock()
    harness.is_cancelled = lambda: True
    import asyncio
    with pytest.raises(asyncio.CancelledError):
        await harness._stream_turn([])
    create.assert_not_awaited()
