"""Durable intelligent-teacher conversation sessions."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import ConversationSessionRecord, ConversationSyncState
from app.routers.auth import require_account_student_scope
from app.services.agent_memory import consolidate_conversation

router = APIRouter(dependencies=[Depends(require_account_student_scope)])

TERMINAL_SUMMARY_PREFIXES = ("全部 ", "学习路径已交付 ")


class ConversationSessionPayload(BaseModel):
    id: str = Field(min_length=1, max_length=96)
    title: str = Field(default="新会话", max_length=256)
    updated_at: int = Field(ge=0)
    messages: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    teacher: str = Field(default="raccoon", max_length=32)
    entry_channel: str = Field(default="desktop", max_length=32)
    context_metadata: dict[str, str | int | float | bool | None] = Field(
        default_factory=dict,
        max_length=32,
    )
    kind: Literal["general", "resource_qa"] = "general"
    resource_id: str = Field(default="", max_length=160)
    resource_title: str = Field(default="", max_length=256)
    resource_context: str = Field(default="", max_length=12000)


class ConversationStatePayload(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    active_conversation_id: str = Field(default="", max_length=96)
    sessions: list[ConversationSessionPayload] = Field(default_factory=list, max_length=100)
    revision: int = Field(default=0, ge=0)
    deleted_session_ids: list[str] = Field(default_factory=list, max_length=100)


class ConversationStateResponse(ConversationStatePayload):
    # Writes are bounded batches; the account may hold more than one batch.
    sessions: list[ConversationSessionPayload] = Field(default_factory=list)


async def _claim_revision(db: AsyncSession, student_id: str, expected: int) -> int:
    # This is the first write in the transaction: SQLite serializes writers,
    # including different processes. A Python lock alone cannot protect data.
    await db.execute(insert(ConversationSyncState).values(
        student_id=student_id, revision=0,
    ).on_conflict_do_nothing(index_elements=["student_id"]))
    result = await db.execute(update(ConversationSyncState).where(
        ConversationSyncState.student_id == student_id,
        ConversationSyncState.revision == expected,
    ).values(revision=expected + 1))
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "conversation_conflict",
            "message": "另一个窗口已更新会话，请重新读取后合并保存",
            "retryable": True,
        })
    return expected + 1


def _messages_have_terminal_summary(kind: str, messages: list[Any]) -> bool:
    if kind != "general":
        return False
    last_user_index = -1
    for index, message in enumerate(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            last_user_index = index
    for message in messages[last_user_index + 1:]:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = str(message.get("content") or "").lstrip()
        if content.startswith(TERMINAL_SUMMARY_PREFIXES):
            return True
    return False


def _is_terminal_generation_conversation(record: ConversationSessionRecord) -> bool:
    return isinstance(record.messages, list) and _messages_have_terminal_summary(
        record.kind,
        record.messages,
    )


def _fresh_conversation(student_id: str, teacher: str) -> ConversationSessionRecord:
    return ConversationSessionRecord(
        id=f"conversation_{uuid.uuid4().hex}",
        student_id=student_id,
        title="新会话",
        kind="general",
        teacher=teacher,
        entry_channel="desktop",
        context_metadata={},
        messages=[],
        resource_id="",
        resource_title="",
        resource_context="",
        is_active=True,
        client_updated_at=int(time.time() * 1000),
    )


async def _migrate_terminal_active(
    student_id: str,
    records: list[ConversationSessionRecord],
    db: AsyncSession,
    revision: int,
) -> str:
    active = max(
        (record for record in records if record.is_active),
        key=lambda record: record.client_updated_at,
        default=None,
    )
    if active is None or not _is_terminal_generation_conversation(active):
        return active.id if active is not None else ""

    await _claim_revision(db, student_id, revision)
    active.is_active = False
    fresh = _fresh_conversation(student_id, active.teacher)
    db.add(fresh)
    records.append(fresh)
    await db.commit()
    return fresh.id


def _response(
    student_id: str,
    active_conversation_id: str,
    records: list[ConversationSessionRecord],
    revision: int = 0,
) -> ConversationStateResponse:
    sessions = [
        ConversationSessionPayload(
            id=record.id,
            title=record.title,
            updated_at=record.client_updated_at,
            messages=record.messages if isinstance(record.messages, list) else [],
            teacher=record.teacher,
            entry_channel=record.entry_channel,
            context_metadata=(
                record.context_metadata if isinstance(record.context_metadata, dict) else {}
            ),
            kind="resource_qa" if record.kind == "resource_qa" else "general",
            resource_id=record.resource_id,
            resource_title=record.resource_title,
            resource_context=record.resource_context,
        )
        for record in sorted(records, key=lambda item: item.client_updated_at, reverse=True)
    ]
    return ConversationStateResponse(
        student_id=student_id,
        active_conversation_id=active_conversation_id,
        sessions=sessions,
        revision=revision,
    )


@router.get("/{student_id}", response_model=ConversationStateResponse)
async def get_conversation_state(
    student_id: str,
    db: AsyncSession = Depends(get_db),
) -> ConversationStateResponse:
    revision = (await db.scalar(select(ConversationSyncState.revision).where(
        ConversationSyncState.student_id == student_id,
    ))) or 0
    records = list((await db.scalars(
        select(ConversationSessionRecord).where(
            ConversationSessionRecord.student_id == student_id,
        ),
    )).all())
    count_before_migration = len(records)
    try:
        active = await _migrate_terminal_active(student_id, records, db, revision)
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        # A concurrent save/migration won. Read its committed state.
        return await get_conversation_state(student_id, db)
    return _response(student_id, active, records, revision + int(len(records) > count_before_migration))


@router.put("", response_model=ConversationStateResponse)
async def save_conversation_state(
    payload: ConversationStatePayload,
    db: AsyncSession = Depends(get_db),
) -> ConversationStateResponse:
    session_ids = {session.id for session in payload.sessions}
    if len(session_ids) != len(payload.sessions):
        raise HTTPException(status_code=422, detail="会话 ID 不能重复")
    deleted_ids = set(payload.deleted_session_ids)
    if deleted_ids & session_ids or payload.active_conversation_id in deleted_ids:
        raise HTTPException(status_code=422, detail="不能同时保存或激活已删除的会话")

    revision = await _claim_revision(db, payload.student_id, payload.revision)

    existing_records = list((await db.scalars(
        select(ConversationSessionRecord).where(
            ConversationSessionRecord.student_id == payload.student_id,
        ),
    )).all())
    existing = {record.id: record for record in existing_records}
    if existing and "revision" not in payload.model_fields_set:
        await db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "conversation_conflict",
            "message": "旧版会话客户端不能覆盖已有记录，请刷新或更新应用",
            "retryable": False,
        })
    if payload.active_conversation_id and payload.active_conversation_id not in (session_ids | existing.keys()):
        await db.rollback()
        raise HTTPException(status_code=422, detail="活动会话不存在")
    # IDs are globally unique. Do not overwrite a different account's record.
    foreign_ids = list((await db.scalars(select(ConversationSessionRecord.id).where(
        ConversationSessionRecord.id.in_(session_ids),
        ConversationSessionRecord.student_id != payload.student_id,
    ))).all())
    if foreign_ids:
        await db.rollback()
        raise HTTPException(status_code=409, detail="会话 ID 已存在，请创建新的会话")
    requested_active = next(
        (session for session in payload.sessions if session.id == payload.active_conversation_id),
        None,
    )
    terminal_active_requested = bool(
        requested_active
        and _messages_have_terminal_summary(requested_active.kind, requested_active.messages)
    )
    preserved_active = None
    effective_active_id = payload.active_conversation_id
    if terminal_active_requested:
        preserved_active = max(
            (
                record
                for record in existing_records
                if record.is_active and record.id not in deleted_ids and not _is_terminal_generation_conversation(record)
            ),
            key=lambda record: record.client_updated_at,
            default=None,
        )
        if preserved_active is None:
            preserved_active = _fresh_conversation(
                payload.student_id,
                requested_active.teacher if requested_active else "raccoon",
            )
            db.add(preserved_active)
        effective_active_id = preserved_active.id
        session_ids.add(preserved_active.id)

    if deleted_ids:
        await db.execute(
            delete(ConversationSessionRecord).where(
                ConversationSessionRecord.student_id == payload.student_id,
                ConversationSessionRecord.id.in_(deleted_ids),
            ),
        )

    records = [record for record in existing_records if record.id not in deleted_ids]
    for record in records:
        record.is_active = record.id == effective_active_id
    episodes_to_index = []
    for session in payload.sessions:
        record = existing.get(session.id)
        if record is None:
            record = ConversationSessionRecord(id=session.id, student_id=payload.student_id)
            db.add(record)
        record.title = session.title or "新会话"
        record.kind = session.kind
        record.teacher = session.teacher
        if "entry_channel" in session.model_fields_set or record.id not in existing:
            record.entry_channel = session.entry_channel or "desktop"
        if "context_metadata" in session.model_fields_set or record.id not in existing:
            record.context_metadata = session.context_metadata
        record.messages = session.messages
        record.resource_id = session.resource_id
        record.resource_title = session.resource_title
        record.resource_context = session.resource_context
        record.is_active = session.id == effective_active_id
        record.client_updated_at = session.updated_at
        if record.id not in existing:
            records.append(record)

        # Conversation storage is also the deterministic consolidation point:
        # raw working memory stays intact, while compressed episodic and
        # explicit semantic memory are maintained in separate SQLite tables.
        try:
            # Session persistence must remain usable during a rolling upgrade
            # where the optional memory tables have not been created yet.
            async with db.begin_nested():
                episode = await consolidate_conversation(
                    db,
                    student_id=payload.student_id,
                    conversation_id=session.id,
                    messages=session.messages,
                    occurred_at=session.updated_at,
                )
        except OperationalError as exc:
            if "no such table" not in str(exc).lower():
                raise
            episode = None
        if episode is not None:
            episodes_to_index.append(episode)

    if preserved_active is not None and all(record.id != preserved_active.id for record in records):
        records.append(preserved_active)

    await db.commit()
    if episodes_to_index:
        from app.services.episodic_memory_index import schedule_episode_index

        for episode in episodes_to_index:
            schedule_episode_index(episode)
    return _response(payload.student_id, effective_active_id, records, revision)
