from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.learning import ConversationSessionRecord
from app.routers.conversations import (
    ConversationSessionPayload,
    ConversationStatePayload,
    get_conversation_state,
    save_conversation_state,
)


@pytest.mark.asyncio
async def test_conversation_state_persists_separate_general_and_resource_sessions():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(ConversationSessionRecord.__table__.create)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        await save_conversation_state(
            ConversationStatePayload(
                student_id="student-conversation-test",
                active_conversation_id="resource-1",
                sessions=[
                    ConversationSessionPayload(
                        id="general-1",
                        title="数据结构学习路径",
                        updated_at=100,
                        messages=[{"id": "m1", "role": "user", "kind": "text", "content": "生成学习路径"}],
                    ),
                    ConversationSessionPayload(
                        id="resource-1",
                        title="资料问答 · 链表讲义",
                        updated_at=200,
                        messages=[{"id": "m2", "role": "user", "kind": "text", "content": "链表是什么？"}],
                        kind="resource_qa",
                        resource_id="material-1",
                        resource_title="链表讲义",
                        resource_context="当前章节：链表定义",
                    ),
                ],
            ),
            db,
        )

        restored = await get_conversation_state("student-conversation-test", db)
        assert restored.active_conversation_id == "resource-1"
        assert len(restored.sessions) == 2
        resource_session = next(session for session in restored.sessions if session.id == "resource-1")
        assert resource_session.kind == "resource_qa"
        assert resource_session.resource_title == "链表讲义"
        assert resource_session.messages[0]["content"] == "链表是什么？"

        await save_conversation_state(
            ConversationStatePayload(
                student_id="student-conversation-test",
                active_conversation_id="general-2",
                sessions=[
                    ConversationSessionPayload(
                        id="general-2",
                        title="新会话",
                        updated_at=300,
                    ),
                ],
            ),
            db,
        )
        replaced = await get_conversation_state("student-conversation-test", db)
        assert replaced.active_conversation_id == "general-2"
        assert [session.id for session in replaced.sessions] == ["general-2"]

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_archives_a_terminal_generation_conversation_and_opens_fresh_active():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(ConversationSessionRecord.__table__.create)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        await save_conversation_state(
            ConversationStatePayload(
                student_id="student-terminal-migration",
                active_conversation_id="failed-plan-chat",
                sessions=[
                    ConversationSessionPayload(
                        id="failed-plan-chat",
                        title="帮我生成学习路径",
                        updated_at=100,
                        messages=[
                            {"id": "m1", "role": "user", "kind": "text", "content": "帮我生成学习路径"},
                            {
                                "id": "m2",
                                "role": "assistant",
                                "kind": "text",
                                "content": "学习路径已交付 82/84 份资料；另有 2 份未完成。",
                            },
                        ],
                    ),
                ],
            ),
            db,
        )

        restored = await get_conversation_state("student-terminal-migration", db)
        assert restored.active_conversation_id != "failed-plan-chat"
        assert len(restored.sessions) == 2
        active = next(session for session in restored.sessions if session.id == restored.active_conversation_id)
        archived = next(session for session in restored.sessions if session.id == "failed-plan-chat")
        assert active.title == "新会话"
        assert active.messages == []
        assert archived.messages[-1]["content"].startswith("学习路径已交付 82/84")

        stale_write = await save_conversation_state(
            ConversationStatePayload(
                student_id="student-terminal-migration",
                active_conversation_id="failed-plan-chat",
                sessions=[
                    ConversationSessionPayload(
                        id="failed-plan-chat",
                        title="帮我生成学习路径",
                        updated_at=100,
                        messages=archived.messages,
                    ),
                ],
            ),
            db,
        )
        assert stale_write.active_conversation_id == restored.active_conversation_id
        assert {session.id for session in stale_write.sessions} == {
            "failed-plan-chat",
            restored.active_conversation_id,
        }

    await engine.dispose()
