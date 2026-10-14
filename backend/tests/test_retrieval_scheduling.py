import asyncio
import threading

import pytest

from app.routers import kb


@pytest.mark.asyncio
async def test_synchronous_retrieval_does_not_block_api_event_loop(monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def retrieve(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return [], [], {"status": "ready"}

    monkeypatch.setattr(kb, "retrieve_with_diagnostics", retrieve)
    task = asyncio.create_task(kb.search_knowledge("test"))
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        assert not task.done()
    finally:
        release.set()
    assert (await task)["retrieval"] == {"status": "ready"}


def test_lexical_statistics_are_cached_and_content_changes_invalidate_them(monkeypatch):
    from app.services import rag

    documents = [{"content": "二叉树 遍历", "metadata": {"source": "trees.md", "title": "二叉树"}}]
    monkeypatch.setattr(rag, "_markdown_chunks", lambda: documents)
    rag._lexical_corpus.cache_clear()
    first = rag._lexical_retrieve("二叉树", 5)
    second = rag._lexical_retrieve("二叉树", 5)
    assert first == second
    assert rag._lexical_corpus.cache_info().hits == 1
    documents[0]["content"] = "二叉树 遍历 搜索"
    changed = rag._lexical_retrieve("二叉树", 5)
    assert changed[0]["content"].endswith("搜索")
    assert rag._lexical_corpus.cache_info().misses == 2
