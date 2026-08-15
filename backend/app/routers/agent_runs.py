"""Authenticated Agent Run replay and protocol discovery."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.account import UserAccount
from app.routers.auth import get_current_account
from app.schemas.agent_run import AgentRunEventsResponse, AgentRunSummary, AgentTraceEvent
from app.services.agent_run_store import owned_run, replay_agent_events

router = APIRouter()


def _summary(run) -> AgentRunSummary:
    return AgentRunSummary(
        run_id=run.id,
        owner_id=run.owner_id,
        conversation_id=run.conversation_id,
        parent_run_id=run.parent_run_id,
        schema_version=run.schema_version,
        status=run.status,
        title=run.title,
        input_summary=run.input_summary,
        last_sequence=run.last_sequence,
        event_count=run.event_count,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


@router.get("/schema")
async def get_agent_protocol_schema(
    _: UserAccount = Depends(get_current_account),
) -> dict:
    return AgentTraceEvent.model_json_schema()


@router.get("/{run_id}", response_model=AgentRunSummary)
async def get_agent_run(
    run_id: str,
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
) -> AgentRunSummary:
    run = await owned_run(db, run_id, account.id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    return _summary(run)


@router.get("/{run_id}/events", response_model=AgentRunEventsResponse)
async def get_agent_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    include_children: bool = True,
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
) -> AgentRunEventsResponse:
    run = await owned_run(db, run_id, account.id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    events = await replay_agent_events(
        db,
        run=run,
        after_sequence=after_sequence,
        include_children=include_children,
    )
    return AgentRunEventsResponse(
        run=_summary(run),
        events=events,
        last_sequence=run.last_sequence,
    )
