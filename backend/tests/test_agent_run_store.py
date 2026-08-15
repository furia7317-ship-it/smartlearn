"""Durable Agent Run event persistence and replay."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.mark.agent_run_db
@pytest.mark.asyncio
async def test_agent_run_events_are_idempotent_and_replayable(monkeypatch) -> None:
    from app.core.agent_trace import finish_trace_run, start_trace_run, trace_event
    from app.models.agent_run import AgentRun
    from app.models.base import Base
    from app.services import agent_run_store

    engine = create_async_engine("sqlite+aiosqlite://")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(agent_run_store, "async_session", session_factory)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    run_id = "persistent-run"
    events = [
        start_trace_run(run_id, agent="tutor", input_summary="解释动态规划"),
        trace_event(
            run_id=run_id,
            agent="tutor",
            kind="reasoning_summary",
            action_type="reasoning",
            event_type="reasoning",
            title="先核对课程定义",
            status="completed",
            reasoning_text="先确认状态、转移和边界条件。",
            reasoning_source="model_narration",
        ),
        *finish_trace_run(run_id, status="completed", observation="回答已交付"),
    ]
    for event in events:
        await agent_run_store.persist_agent_event(
            event,
            owner_id="owner-1",
            conversation_id="conversation-1",
        )
    await agent_run_store.persist_agent_event(
        events[1],
        owner_id="owner-1",
        conversation_id="conversation-1",
    )

    async with session_factory() as db:
        run = await db.get(AgentRun, run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.event_count == len(events)
        replay = await agent_run_store.replay_agent_events(
            db,
            run=run,
            include_children=False,
        )
        after_first = await agent_run_store.replay_agent_events(
            db,
            run=run,
            after_sequence=events[0]["sequence"],
            include_children=False,
        )

    assert [item["event_id"] for item in replay] == [item["event_id"] for item in events]
    assert all(
        item["sequence"] > events[0]["sequence"]
        for item in after_first
    )
    assert replay[1]["reasoning_text"] == "先确认状态、转移和边界条件。"
    await engine.dispose()
