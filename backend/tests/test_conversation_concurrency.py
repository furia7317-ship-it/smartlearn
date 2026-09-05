import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.learning import ConversationSessionRecord, ConversationSyncState
from app.routers.conversations import ConversationStatePayload, get_conversation_state, save_conversation_state


@pytest.fixture
async def database(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'conversations.sqlite'}")
    async with engine.begin() as conn:
        for model in (ConversationSessionRecord, ConversationSyncState):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def payload(revision=0, ids=("a",), deleted=()):
    return ConversationStatePayload(
        student_id="concurrent-account", revision=revision,
        active_conversation_id=ids[0] if ids else "",
        sessions=[{"id": identifier, "updated_at": revision, "messages": []} for identifier in ids],
        deleted_session_ids=list(deleted),
    )


@pytest.mark.asyncio
async def test_old_snapshot_is_rejected_without_deleting_new_sessions(database):
    async with database() as db:
        await save_conversation_state(payload(), db)
        await save_conversation_state(payload(1, ("a", "b")), db)
        with pytest.raises(HTTPException) as conflict:
            await save_conversation_state(payload(1), db)
        assert conflict.value.status_code == 409
        restored = await get_conversation_state("concurrent-account", db)
        assert {s.id for s in restored.sessions} == {"a", "b"}
        assert restored.revision == 2


@pytest.mark.asyncio
async def test_new_revision_does_not_make_omissions_a_delete(database):
    async with database() as db:
        await save_conversation_state(payload(0, ("a", "b")), db)
        saved = await save_conversation_state(payload(1), db)
        assert {s.id for s in saved.sessions} == {"a", "b"}
        saved = await save_conversation_state(payload(2, ("a",), ("b",)), db)
        assert [s.id for s in saved.sessions] == ["a"]


@pytest.mark.asyncio
async def test_terminal_summary_does_not_preserve_an_explicitly_deleted_active_session(database):
    async with database() as db:
        await save_conversation_state(payload(), db)
        terminal = payload(1, ("finished",), ("a",))
        terminal.sessions[0].messages = [{"role": "assistant", "content": "全部 1 份资料已完成"}]
        saved = await save_conversation_state(terminal, db)
        ids = {session.id for session in saved.sessions}
        assert "a" not in ids
        assert saved.active_conversation_id in ids - {"finished"}


@pytest.mark.asyncio
async def test_only_one_concurrent_writer_can_claim_a_revision(database):
    async with database() as db:
        await save_conversation_state(payload(), db)

    async def write(identifier):
        async with database() as db:
            try:
                return await save_conversation_state(payload(1, (identifier,)), db)
            except HTTPException as exc:
                return exc.status_code

    results = await asyncio.gather(write("b"), write("c"))
    assert sum(result == 409 for result in results) == 1
    async with database() as db:
        restored = await get_conversation_state("concurrent-account", db)
        assert restored.revision == 2
        assert len(restored.sessions) == 2


@pytest.mark.asyncio
async def test_legacy_client_cannot_overwrite_unversioned_existing_history(database):
    async with database() as db:
        db.add(ConversationSessionRecord(id="a", student_id="concurrent-account", messages=[{"content": "keep me"}]))
        await db.commit()
        legacy = payload().model_dump(exclude={"revision"})
        with pytest.raises(HTTPException) as conflict:
            await save_conversation_state(ConversationStatePayload(**legacy), db)
        assert conflict.value.status_code == 409
        restored = await get_conversation_state("concurrent-account", db)
        assert restored.sessions[0].messages == [{"content": "keep me"}]
