"""Persistence and replay for sanitized Agent Run events."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import async_session
from app.models.agent_run import AgentRun, AgentRunEvent
from app.schemas.agent_run import AgentTraceEvent

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"completed", "failed", "blocked", "cancelled"}


def _parse_timestamp(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _root_terminal(payload: dict[str, Any]) -> bool:
    return (
        str(payload.get("status") or "") in TERMINAL_STATUSES
        and str(payload.get("action_type") or "") in {"run", "runtime", "orchestration"}
    )


async def persist_agent_event(
    payload: dict[str, Any],
    *,
    owner_id: str,
    conversation_id: str = "",
) -> None:
    """Append one validated public event before it is exposed to a client."""

    try:
        event = AgentTraceEvent.model_validate(payload)
    except Exception:  # noqa: BLE001
        logger.exception("rejecting invalid public agent event")
        return

    normalized = event.model_dump(mode="json", exclude_none=True)
    try:
        await _write_agent_event(
            event,
            normalized,
            payload=payload,
            owner_id=owner_id,
            conversation_id=conversation_id,
        )
    except SQLAlchemyError:
        # Trace durability must never strand the live answer. This also lets a
        # hot-reloaded backend keep serving while the new table is created on
        # the next normal application restart.
        logger.exception("failed to persist public agent event run_id=%s", event.run_id)
        return

    logger.info(
        "agent_event run_id=%s sequence=%s type=%s status=%s agent=%s",
        event.run_id,
        event.sequence,
        event.event_type,
        event.status,
        event.agent_id,
    )


async def _write_agent_event(
    event: AgentTraceEvent,
    normalized: dict[str, Any],
    *,
    payload: dict[str, Any],
    owner_id: str,
    conversation_id: str,
) -> None:
    async with async_session() as db:
        run = await db.get(AgentRun, event.run_id)
        if run is None:
            run = AgentRun(
                id=event.run_id,
                owner_id=owner_id,
                conversation_id=conversation_id,
                parent_run_id=str(payload.get("parent_run_id") or ""),
                schema_version=event.schema_version,
                status="running",
                title=event.title,
                input_summary=event.input_summary or "",
                started_at=_parse_timestamp(event.started_at) or datetime.utcnow(),
            )
            db.add(run)
            await db.flush()
        elif run.owner_id and owner_id and run.owner_id != owner_id:
            logger.warning("agent run owner mismatch run_id=%s", event.run_id)
            return
        else:
            if not run.owner_id:
                run.owner_id = owner_id
            if conversation_id and not run.conversation_id:
                run.conversation_id = conversation_id
            parent_run_id = str(payload.get("parent_run_id") or "")
            if parent_run_id and not run.parent_run_id:
                run.parent_run_id = parent_run_id

        if await db.get(AgentRunEvent, event.event_id) is None:
            db.add(
                AgentRunEvent(
                    event_id=event.event_id,
                    run_id=event.run_id,
                    sequence=event.sequence,
                    span_id=event.span_id,
                    event_type=event.event_type,
                    payload=normalized,
                    created_at=datetime.utcnow(),
                )
            )
            run.event_count += 1
        run.last_sequence = max(run.last_sequence, event.sequence)
        run.schema_version = event.schema_version
        if _root_terminal(normalized):
            run.status = event.status
            run.ended_at = _parse_timestamp(event.ended_at) or datetime.utcnow()
        elif run.status not in TERMINAL_STATUSES:
            run.status = "running"

        try:
            await db.commit()
        except IntegrityError:
            # Reconnects and nested streams may deliver the same immutable
            # event twice. The unique event and sequence constraints make the
            # operation idempotent.
            await db.rollback()


async def persist_stream_event(
    event: str,
    payload: dict[str, Any],
    *,
    owner_id: str,
    conversation_id: str = "",
) -> None:
    """Persist only public trace-compatible stream events."""

    if event not in {"trace", "run_event"}:
        return
    await persist_agent_event(
        payload,
        owner_id=owner_id,
        conversation_id=conversation_id,
    )


async def owned_run(
    db: AsyncSession,
    run_id: str,
    owner_id: str,
) -> AgentRun | None:
    return (await db.scalars(
        select(AgentRun).where(
            AgentRun.id == run_id,
            AgentRun.owner_id == owner_id,
        ),
    )).one_or_none()


async def replay_agent_events(
    db: AsyncSession,
    *,
    run: AgentRun,
    after_sequence: int = 0,
    include_children: bool = True,
) -> list[dict[str, Any]]:
    run_ids = [run.id]
    if include_children:
        run_ids.extend((await db.scalars(
            select(AgentRun.id).where(
                AgentRun.owner_id == run.owner_id,
                AgentRun.parent_run_id == run.id,
            ),
        )).all())

    condition = AgentRunEvent.run_id.in_(run_ids)
    if after_sequence > 0 and len(run_ids) == 1:
        condition = and_(
            AgentRunEvent.run_id == run.id,
            AgentRunEvent.sequence > after_sequence,
        )
    rows = (await db.scalars(
        select(AgentRunEvent)
        .where(condition)
        .order_by(AgentRunEvent.created_at, AgentRunEvent.sequence, AgentRunEvent.event_id),
    )).all()
    return [dict(row.payload or {}) for row in rows]
