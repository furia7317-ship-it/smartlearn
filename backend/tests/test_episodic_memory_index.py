from __future__ import annotations

import pytest

from app.models.learning import MemoryEpisode
from app.services import episodic_memory_index, rag


class _FakeEmbedder:
    def encode(self, values, **_kwargs):
        class _Encoded(list):
            def tolist(self):
                return list(self)

        return _Encoded([[0.1, 0.2, 0.3] for _value in values])


class _FakeCollection:
    def __init__(self):
        self.upserts = []

    def upsert(self, **kwargs):
        self.upserts.append(kwargs)

    def count(self):
        return 1

    def query(self, **kwargs):
        assert kwargs["where"] == {"student_id": "student-one"}
        return {"ids": [["episode-one"]], "distances": [[0.2]]}


@pytest.mark.asyncio
async def test_episode_vectors_use_a_separate_student_filtered_collection(monkeypatch):
    collection = _FakeCollection()
    calls = []

    def fake_collection(name, *, resolve_active=True):
        calls.append((name, resolve_active))
        return collection

    monkeypatch.setattr(rag, "get_or_create_collection", fake_collection)
    monkeypatch.setattr(rag, "_get_embedder", lambda: _FakeEmbedder())
    monkeypatch.setattr(rag, "_query_text", lambda value: f"query:{value}")
    monkeypatch.setattr(episodic_memory_index.settings, "MEMORY_EPISODE_VECTOR_ENABLED", True)
    monkeypatch.setattr(episodic_memory_index.settings, "MEMORY_EPISODE_VECTOR_COLLECTION", "memory-test")
    monkeypatch.setattr(episodic_memory_index.settings, "MEMORY_EPISODE_VECTOR_TIMEOUT_SECONDS", 2)

    episode = MemoryEpisode(
        id="episode-one",
        student_id="student-one",
        conversation_id="conversation-one",
        source_fingerprint="fingerprint-one",
        summary="学生正在复习二叉树遍历。",
        structured_summary={"topic": "二叉树遍历", "entities": ["中序遍历"]},
        importance=0.8,
        source_start_index=0,
        source_end_index=4,
    )
    episodic_memory_index._upsert_payload(episodic_memory_index._episode_payload(episode))
    scores = await episodic_memory_index.semantic_episode_scores("student-one", "中序遍历")

    assert calls == [("memory-test", False), ("memory-test", False)]
    assert collection.upserts[0]["metadatas"][0]["student_id"] == "student-one"
    assert scores == {"episode-one": pytest.approx(0.8)}
