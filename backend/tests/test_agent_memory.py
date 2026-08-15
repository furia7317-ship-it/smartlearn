from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.base import Base
from app.models.learning import (
    LearnerPreferenceSettings,
    LearnerWorkspaceState,
    MemoryEpisode,
    SemanticMemoryFact,
)
from app.routers.memory import (
    WorkspaceStateWrite,
    clear_long_term_agent_memory,
    delete_workspace_state,
    get_workspace_state,
    save_workspace_state,
)
from app.services import agent_memory
from app.services.agent_memory import (
    assemble_chat_context,
    consolidate_conversation,
    estimate_tokens,
    fit_untrusted_context,
)


@pytest.fixture
async def memory_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session, factory
    await engine.dispose()


def test_token_estimator_and_untrusted_truncation_are_bounded():
    text = "<untrusted_attachment_data>\n" + "数据结构" * 1000 + "\n</untrusted_attachment_data>"
    fitted = fit_untrusted_context(text, 120)
    assert estimate_tokens(fitted) <= 120
    assert fitted.endswith("</untrusted_attachment_data>")
    assert "token 预算压缩" in fitted


@pytest.mark.asyncio
async def test_conversation_consolidates_episode_and_versioned_semantic_facts(memory_db):
    db, _ = memory_db
    messages = [
        {"role": "user", "content": "我是软件工程专业学生，下周要考试。"},
        {"role": "assistant", "content": "我会围绕考试目标安排。"},
        {"role": "user", "content": "我更喜欢动画和代码示例，每天学习 45 分钟，递归比较薄弱。"},
        {"role": "assistant", "content": "先建立递归调用栈的直觉。"},
    ]
    episode = await consolidate_conversation(
        db,
        student_id="memory-student",
        conversation_id="conversation-1",
        messages=messages,
        occurred_at=100,
    )
    await db.commit()

    assert episode is not None
    assert "学生" in episode.summary
    assert episode.source_message_count == 4
    facts = list((await db.scalars(select(SemanticMemoryFact))).all())
    assert {fact.category for fact in facts} >= {"identity", "preference", "pace", "weakness"}
    assert all(fact.evidence and 0 <= fact.confidence <= 1 for fact in facts)

    await consolidate_conversation(
        db,
        student_id="memory-student",
        conversation_id="conversation-2",
        messages=[{"role": "user", "content": "我更喜欢先读文字推导再做题。"}],
    )
    await db.commit()
    preference_facts = list((await db.scalars(
        select(SemanticMemoryFact).where(SemanticMemoryFact.category == "preference")
    )).all())
    assert {fact.status for fact in preference_facts} == {"active", "superseded"}


@pytest.mark.asyncio
async def test_global_budget_compresses_old_history_into_sqlite(memory_db, monkeypatch):
    db, factory = memory_db
    await db.close()
    monkeypatch.setattr(agent_memory, "async_session", factory)
    monkeypatch.setattr(agent_memory.settings, "CHAT_CONTEXT_TOKEN_BUDGET", 700)
    monkeypatch.setattr(agent_memory.settings, "CHAT_RESPONSE_TOKEN_RESERVE", 120)
    monkeypatch.setattr(agent_memory.settings, "CHAT_SYSTEM_TOKEN_BUDGET", 90)
    monkeypatch.setattr(agent_memory.settings, "CHAT_MEMORY_TOKEN_BUDGET", 100)
    monkeypatch.setattr(agent_memory.settings, "CHAT_KNOWLEDGE_TOKEN_BUDGET", 100)
    monkeypatch.setattr(agent_memory.settings, "CHAT_ATTACHMENT_TOKEN_BUDGET", 100)
    monkeypatch.setattr(agent_memory.settings, "CHAT_HISTORY_TOKEN_BUDGET", 120)
    monkeypatch.setattr(agent_memory.settings, "CHAT_QUESTION_TOKEN_BUDGET", 50)

    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"第 {index} 轮：" + "二叉树遍历" * 25}
        for index in range(20)
    ]
    knowledge = "<untrusted_knowledge_data>\n" + "树的知识" * 500 + "\n</untrusted_knowledge_data>"
    attachment = "<untrusted_attachment_data>\n" + "附件内容" * 500 + "\n</untrusted_attachment_data>"
    assembled = await assemble_chat_context(
        student_id="budget-student",
        conversation_id="long-conversation",
        system_prompt="你是智能教师。" * 30,
        knowledge_context=knowledge,
        attachment_context=attachment,
        history=history,
        question="请总结二叉树遍历。",
    )

    assert assembled.report["estimated_input_tokens"] <= assembled.report["input_budget"]
    assert assembled.report["compressed_history_messages"] > 0
    assert assembled.report["response_reserve"] == 120
    assert assembled.messages[-1]["content"].startswith("请总结")
    for message in assembled.messages:
        if "<untrusted_" in message["content"]:
            assert "</untrusted_" in message["content"]
    async with factory() as check:
        episode = await check.get(MemoryEpisode, agent_memory._episode_id("budget-student", "long-conversation"))
        assert episode
        assert episode.source_message_count == assembled.report["compressed_history_messages"]


@pytest.mark.asyncio
async def test_workspace_state_is_sqlite_authoritative_and_rejects_stale_version(memory_db):
    db, _ = memory_db
    first = await save_workspace_state(
        WorkspaceStateWrite(
            student_id="workspace-student",
            state={"resources": [{"id": "r1"}]},
            client_updated_at=200,
            expected_version=0,
        ),
        db,
    )
    assert first["version"] == 1

    with pytest.raises(HTTPException) as stale:
        await save_workspace_state(
            WorkspaceStateWrite(
                student_id="workspace-student",
                state={"resources": []},
                client_updated_at=100,
                expected_version=0,
            ),
            db,
        )
    assert stale.value.status_code == 409
    restored = await get_workspace_state("workspace-student", db)
    assert restored["client_updated_at"] == 200
    assert await db.get(LearnerWorkspaceState, "workspace-student")

    await delete_workspace_state("workspace-student", db)
    assert (await get_workspace_state("workspace-student", db))["state"] == {}


@pytest.mark.asyncio
async def test_clear_long_term_memory_preserves_workspace(memory_db):
    db, _ = memory_db
    db.add(LearnerWorkspaceState(
        student_id="privacy-student",
        version=1,
        state={"active_conversation_id": "conversation-1"},
        client_updated_at=100,
    ))
    db.add(MemoryEpisode(
        id="episode-1",
        student_id="privacy-student",
        conversation_id="conversation-1",
        source_fingerprint="privacy-fingerprint",
        summary="较早学习经历",
        occurred_at=100,
    ))
    db.add(SemanticMemoryFact(
        id="fact-1",
        student_id="privacy-student",
        category="preference",
        key="prefers_examples",
        value={"statement": "喜欢示例"},
        evidence="我喜欢示例",
    ))
    await db.commit()

    result = await clear_long_term_agent_memory("privacy-student", db)

    assert result == {"deleted": True, "semantic_facts": 1, "episodes": 1}
    assert await db.get(LearnerWorkspaceState, "privacy-student") is not None
    assert await db.get(MemoryEpisode, "episode-1") is None
    assert await db.get(SemanticMemoryFact, "fact-1") is None


@pytest.mark.asyncio
async def test_disabled_long_term_memory_stops_consolidation_and_recall(memory_db):
    db, _ = memory_db
    db.add(LearnerPreferenceSettings(
        student_id="private-student",
        preferences={"long_term_memory_enabled": False},
    ))
    await db.commit()

    episode = await consolidate_conversation(
        db,
        student_id="private-student",
        conversation_id="private-conversation",
        messages=[
            {"role": "user", "content": "我喜欢用视频学习。"},
            {"role": "assistant", "content": "收到。"},
            {"role": "user", "content": "递归是我的薄弱点。"},
            {"role": "assistant", "content": "我们从调用栈开始。"},
        ],
        force=True,
    )
    context, counts = await agent_memory.recall_memory_context(
        db,
        student_id="private-student",
        query="递归",
        token_limit=300,
    )

    assert episode is None
    assert context == ""
    assert counts == {"facts": 0, "episodes": 0}
    assert list((await db.scalars(select(SemanticMemoryFact))).all()) == []


@pytest.mark.asyncio
async def test_chat_context_includes_sqlite_teaching_preferences(memory_db, monkeypatch):
    db, factory = memory_db
    db.add(LearnerPreferenceSettings(
        student_id="preference-student",
        preferences={
            "teaching_mode": "socratic",
            "answer_depth": "deep",
            "difficulty": "challenge",
            "daily_minutes": 60,
            "material_types": ["video", "quiz"],
        },
    ))
    await db.commit()
    await db.close()
    monkeypatch.setattr(agent_memory, "async_session", factory)

    assembled = await assemble_chat_context(
        student_id="preference-student",
        conversation_id="preference-conversation",
        system_prompt="你是智能教师。",
        knowledge_context="",
        attachment_context="",
        history=[],
        question="解释二叉树。",
    )

    assert "学生主动设置的教学偏好" in assembled.messages[0]["content"]
    assert "启发式问题" in assembled.messages[0]["content"]
    assert "60 分钟" in assembled.messages[0]["content"]
