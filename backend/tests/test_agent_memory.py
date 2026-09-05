from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.base import Base
from app.main import _migrate_agent_memory
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
    _select_recent_history,
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


@pytest.mark.asyncio
async def test_agent_memory_migration_upgrades_existing_sqlite_tables(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'legacy-memory.db'}")
    async with engine.begin() as connection:
        await connection.exec_driver_sql(
            "CREATE TABLE conversation_sessions (id VARCHAR(96) PRIMARY KEY)"
        )
        await connection.exec_driver_sql(
            "CREATE TABLE memory_episodes (id VARCHAR(64) PRIMARY KEY)"
        )
        await _migrate_agent_memory(connection)
        session_columns = await connection.exec_driver_sql(
            "PRAGMA table_info(conversation_sessions)"
        )
        episode_columns = await connection.exec_driver_sql(
            "PRAGMA table_info(memory_episodes)"
        )
        assert {row[1] for row in session_columns} >= {"entry_channel", "context_metadata"}
        assert {row[1] for row in episode_columns} >= {
            "structured_summary",
            "source_start_index",
            "source_end_index",
            "updated_at",
        }
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
async def test_conversation_appends_structured_episode_segments_without_rewriting_old(memory_db):
    db, _ = memory_db
    first_messages = [
        {"role": "user", "content": "我想复习二叉树遍历，下周有测验。"},
        {"role": "assistant", "content": "建议先比较前序、中序和后序的访问顺序。"},
        {"role": "user", "content": "中序遍历的迭代写法我还不会。"},
        {"role": "assistant", "content": "下一步用显式栈完成一次迭代演示。"},
    ]
    first = await consolidate_conversation(
        db,
        student_id="segmented-student",
        conversation_id="segmented-conversation",
        messages=first_messages,
        occurred_at=1000,
    )
    await db.commit()
    first_summary = first.summary

    second_messages = [
        *first_messages,
        {"role": "user", "content": "前序已经掌握了，现在继续中序。"},
        {"role": "assistant", "content": "先把当前节点一路压栈到最左侧。"},
        {"role": "user", "content": "弹栈以后为什么要转向右子树？"},
        {"role": "assistant", "content": "接着处理右子树，才能保持左、根、右的顺序。"},
    ]
    second = await consolidate_conversation(
        db,
        student_id="segmented-student",
        conversation_id="segmented-conversation",
        messages=second_messages,
        occurred_at=2000,
    )
    await db.commit()

    rows = list((await db.scalars(
        select(MemoryEpisode)
        .where(MemoryEpisode.conversation_id == "segmented-conversation")
        .order_by(MemoryEpisode.source_start_index)
    )).all())
    assert len(rows) == 2
    assert [(row.source_start_index, row.source_end_index) for row in rows] == [(0, 4), (4, 8)]
    assert rows[0].summary == first_summary
    assert second.structured_summary["source_range"] == [4, 8]
    assert second.structured_summary["topic"]
    assert "学生当前意图" in second.summary


def test_recent_history_window_keeps_complete_question_answer_turns():
    history = [
        {"role": "user", "content": "第一问" * 20},
        {"role": "assistant", "content": "第一答" * 20},
        {"role": "user", "content": "第二问" * 20},
        {"role": "assistant", "content": "第二答" * 20},
    ]
    last_turn_budget = sum(estimate_tokens(item["content"]) + 4 for item in history[-2:])
    selected, overflow = _select_recent_history(history, last_turn_budget)

    assert selected == history[-2:]
    assert overflow == history[:2]
    assert [item["role"] for item in selected] == ["user", "assistant"]


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
async def test_new_conversation_does_not_recall_unrelated_recent_episode(memory_db, monkeypatch):
    db, _ = memory_db
    db.add(MemoryEpisode(
        id="episode-old-topic",
        student_id="isolated-student",
        conversation_id="conversation-old",
        source_fingerprint="old-topic",
        summary="旧会话讨论了二叉树遍历。",
        keywords=["二叉树"],
        importance=0.95,
        occurred_at=2_000_000_000,
    ))
    await db.commit()

    async def no_semantic_scores(_student_id: str, _query: str) -> dict[str, float]:
        return {}

    monkeypatch.setattr(
        "app.services.episodic_memory_index.semantic_episode_scores",
        no_semantic_scores,
    )
    monkeypatch.setattr(
        "app.services.episodic_memory_index.schedule_episode_index",
        lambda _episode: None,
    )
    context, counts = await agent_memory.recall_memory_context(
        db,
        student_id="isolated-student",
        conversation_id="conversation-new",
        query="你好",
        token_limit=500,
    )

    assert counts == {"facts": 0, "episodes": 0}
    assert "旧会话讨论" not in context

    continued_context, continued_counts = await agent_memory.recall_memory_context(
        db,
        student_id="isolated-student",
        conversation_id="conversation-new",
        query="继续讲解当前题目",
        token_limit=500,
    )
    assert continued_counts["episodes"] == 0
    assert "旧会话讨论" not in continued_context


@pytest.mark.asyncio
async def test_episode_recall_respects_current_and_explicit_cross_session_scope(memory_db, monkeypatch):
    db, _ = memory_db
    db.add_all([
        MemoryEpisode(
            id="episode-current",
            student_id="scope-student",
            conversation_id="conversation-current",
            source_fingerprint="current",
            summary="当前会话较早讨论了栈。",
            keywords=["栈"],
            occurred_at=100,
        ),
        MemoryEpisode(
            id="episode-previous",
            student_id="scope-student",
            conversation_id="conversation-previous",
            source_fingerprint="previous",
            summary="上一会话讨论了二叉树。",
            keywords=["二叉树"],
            occurred_at=200,
        ),
    ])
    await db.commit()

    async def no_semantic_scores(_student_id: str, _query: str) -> dict[str, float]:
        return {}

    monkeypatch.setattr(
        "app.services.episodic_memory_index.semantic_episode_scores",
        no_semantic_scores,
    )
    monkeypatch.setattr(
        "app.services.episodic_memory_index.schedule_episode_index",
        lambda _episode: None,
    )

    current_context, current_counts = await agent_memory.recall_memory_context(
        db,
        student_id="scope-student",
        conversation_id="conversation-current",
        query="你好",
        token_limit=800,
    )
    assert current_counts["episodes"] == 1
    assert "当前会话较早讨论了栈" in current_context
    assert "上一会话讨论了二叉树" not in current_context

    previous_context, previous_counts = await agent_memory.recall_memory_context(
        db,
        student_id="scope-student",
        conversation_id="conversation-new",
        query="继续上次",
        token_limit=800,
    )
    assert previous_counts["episodes"] == 1
    assert "上一会话讨论了二叉树" in previous_context


@pytest.mark.asyncio
async def test_cross_session_episode_requires_explicit_history_reference(memory_db, monkeypatch):
    db, _ = memory_db
    db.add(MemoryEpisode(
        id="episode-binary-tree",
        student_id="topic-student",
        conversation_id="conversation-old",
        source_fingerprint="binary-tree",
        summary="旧会话梳理了二叉树的前序遍历。",
        keywords=["二叉树", "前序遍历"],
        occurred_at=100,
    ))
    await db.commit()

    async def no_semantic_scores(_student_id: str, _query: str) -> dict[str, float]:
        return {}

    monkeypatch.setattr(
        "app.services.episodic_memory_index.semantic_episode_scores",
        no_semantic_scores,
    )
    monkeypatch.setattr(
        "app.services.episodic_memory_index.schedule_episode_index",
        lambda _episode: None,
    )
    isolated_context, isolated_counts = await agent_memory.recall_memory_context(
        db,
        student_id="topic-student",
        conversation_id="conversation-new",
        query="二叉树",
        token_limit=800,
    )
    assert isolated_counts["episodes"] == 0
    assert "前序遍历" not in isolated_context

    context, counts = await agent_memory.recall_memory_context(
        db,
        student_id="topic-student",
        conversation_id="conversation-new",
        query="回到之前聊的二叉树",
        token_limit=800,
    )
    assert counts["episodes"] == 1
    assert "前序遍历" in context


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
