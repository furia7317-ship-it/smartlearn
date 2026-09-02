from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.core.config import get_db
from app.models.base import Base
from app.models.learning import ConversationSessionRecord
from app.routers.auth import router as auth_router
from app.routers.conversations import (
    ConversationSessionPayload,
    ConversationStatePayload,
    get_conversation_state,
    router as conversations_router,
    save_conversation_state,
)


def test_conversation_routes_require_the_authenticated_account_scope(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'conversations.db'}")
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def prepare_database():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    asyncio.run(prepare_database())
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")
    app.include_router(conversations_router, prefix="/api/conversations")
    app.dependency_overrides[get_db] = override_db

    account_id = "local_11111111-1111-4111-8111-111111111111"
    foreign_id = "local_22222222-2222-4222-8222-222222222222"
    with TestClient(app) as client:
        assert client.get(f"/api/conversations/{account_id}").status_code == 401
        registered = client.post(
            "/api/auth/register",
            json={
                "login": "conversation-owner@example.com",
                "password": "password-123",
                "anonymous_student_id": account_id,
            },
        )
        assert registered.status_code == 201
        assert registered.json()["id"] == account_id

        own = client.put(
            "/api/conversations",
            json={
                "student_id": account_id,
                "active_conversation_id": "conversation-owned",
                "sessions": [
                    {
                        "id": "conversation-owned",
                        "title": "自己的会话",
                        "updated_at": 100,
                        "messages": [],
                    },
                ],
            },
        )
        assert own.status_code == 200
        assert client.get(f"/api/conversations/{account_id}").status_code == 200

        forbidden_get = client.get(f"/api/conversations/{foreign_id}")
        assert forbidden_get.status_code == 403
        assert forbidden_get.json()["detail"]["code"] == "student_scope_forbidden"

        forbidden_put = client.put(
            "/api/conversations",
            json={
                "student_id": foreign_id,
                "active_conversation_id": "foreign-conversation",
                "sessions": [
                    {
                        "id": "foreign-conversation",
                        "title": "越权会话",
                        "updated_at": 200,
                        "messages": [],
                    },
                ],
            },
        )
        assert forbidden_put.status_code == 403
        assert forbidden_put.json()["detail"]["code"] == "student_scope_forbidden"

    asyncio.run(engine.dispose())


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
