"""RAG 单测：bge 查询指令前缀 + 检索整形 + 元数据清洗（mock 向量库/嵌入器，不触网）。"""

from unittest.mock import MagicMock

import numpy as np
import pytest


class TestQueryText:
    def test_bge_adds_instruction(self, monkeypatch):
        from app.services import rag

        monkeypatch.setattr(rag.settings, "EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5")
        out = rag._query_text("动态规划")
        assert out.endswith("动态规划") and out != "动态规划"
        assert "检索" in out  # 指令前缀

    def test_non_bge_passthrough(self, monkeypatch):
        from app.services import rag

        monkeypatch.setattr(rag.settings, "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
        assert rag._query_text("动态规划") == "动态规划"

    def test_e5_uses_asymmetric_query_and_passage_prefixes(self, monkeypatch):
        from app.services import rag

        monkeypatch.setattr(rag.settings, "EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
        document = {
            "content": "状态转移方程复用子问题答案。",
            "metadata": {"document_title": "算法", "section_title": "动态规划"},
        }

        assert rag._query_text("动态规划").startswith("query: ")
        assert rag._document_embedding_text(document).startswith("passage: 算法\n动态规划\n")

    def test_resolves_explicit_local_embedding_model(self, monkeypatch, tmp_path):
        from app.services import rag

        model = tmp_path / "bge-local"
        model.mkdir()
        monkeypatch.setattr(rag.settings, "EMBEDDING_MODEL", str(model))

        assert rag._embedding_model_reference() == str(model.resolve())

    def test_expands_audited_bilingual_aliases(self):
        from app.services import rag

        expanded = rag._expand_query("array list versus linked list")

        assert "顺序表" in expanded
        assert "链表" in expanded


class TestRetrieve:
    def test_zero_results_does_not_return_a_candidate(self):
        from app.services import rag

        assert rag.retrieve("动态规划", n_results=0) == []

    def test_shapes_results_and_normalizes_query(self, monkeypatch):
        from app.services import rag

        fake_col = MagicMock()
        fake_col.query.return_value = {
            "ids": [["k1", "k2"]],
            "documents": [["栈是后进先出", "队列是先进先出"]],
            "metadatas": [[{"source": "03-栈和队列.md"}, {"source": "03-栈和队列.md"}]],
            "distances": [[0.12, 0.40]],
        }
        fake_col.count.return_value = 2
        monkeypatch.setattr(rag, "get_or_create_collection", lambda *a, **k: fake_col)
        monkeypatch.setattr(rag, "_markdown_chunks", lambda: [])
        fake_emb = MagicMock()
        fake_emb.encode.return_value = np.array([[0.1, 0.2, 0.3]])
        monkeypatch.setattr(rag, "_get_embedder", lambda: fake_emb)

        docs = rag.retrieve("栈和队列", n_results=2)
        assert [d["id"] for d in docs] == ["k1", "k2"]
        assert docs[0]["metadata"]["source"] == "03-栈和队列.md"
        assert docs[0]["distance"] == 0.12
        assert docs[0]["retrieval_mode"] == "vector"
        # 查询侧必须归一化（与文档侧一致，余弦才正确）
        assert fake_emb.encode.call_args.kwargs.get("normalize_embeddings") is True

    def test_embedder_unavailable_does_not_fall_back_to_markdown(self, monkeypatch, tmp_path):
        from app.services import rag

        kb = tmp_path / "knowledge"
        kb.mkdir()
        (kb / "08-动态规划.md").write_text(
            "# 动态规划\n\n动态规划通过状态转移方程复用重叠子问题的答案。",
            encoding="utf-8",
        )
        (kb / "03-栈.md").write_text("# 栈\n\n栈是后进先出的线性结构。", encoding="utf-8")

        fake_col = MagicMock()
        monkeypatch.setattr(rag.settings, "KNOWLEDGE_DIR", str(kb))
        monkeypatch.setattr(rag, "get_or_create_collection", lambda *a, **k: fake_col)
        monkeypatch.setattr(
            rag,
            "_get_embedder",
            lambda: (_ for _ in ()).throw(TimeoutError("huggingface head timed out")),
        )

        with pytest.raises(rag.RetrievalUnavailable):
            rag.retrieve("动态规划状态转移", n_results=2)

        fake_col.query.assert_not_called()


class TestAddDocuments:
    def test_cleans_non_scalar_metadata(self, monkeypatch):
        from app.services import rag

        fake_col = MagicMock()
        monkeypatch.setattr(rag, "get_or_create_collection", lambda *a, **k: fake_col)
        fake_emb = MagicMock()
        fake_emb.encode.return_value = np.array([[0.1, 0.2]])
        monkeypatch.setattr(rag, "_get_embedder", lambda: fake_emb)

        rag.add_documents(
            [{"id": "1", "content": "栈是后进先出", "metadata": {"source": "a.md", "tags": ["栈", "线性表"]}}]
        )
        kwargs = fake_col.upsert.call_args.kwargs
        meta = kwargs["metadatas"][0]
        assert meta["source"] == "a.md"
        assert isinstance(meta["tags"], str)  # chroma 只接受标量 → list 被转字符串
        assert kwargs["ids"] == ["1"]
        # 文档侧也归一化
        assert fake_emb.encode.call_args.kwargs.get("normalize_embeddings") is True

    def test_embeds_context_but_stores_original_chunk(self, monkeypatch):
        from app.services import rag

        fake_col = MagicMock()
        monkeypatch.setattr(rag, "get_or_create_collection", lambda *a, **k: fake_col)
        fake_emb = MagicMock()
        fake_emb.encode.return_value = np.array([[0.1, 0.2]])
        monkeypatch.setattr(rag, "_get_embedder", lambda: fake_emb)

        rag.add_documents(
            [
                {
                    "id": "context-1",
                    "content": "栈遵循后进先出原则。",
                    "metadata": {
                        "source": "数据结构.md",
                        "document_title": "数据结构",
                        "section_title": "栈",
                    },
                }
            ]
        )

        assert fake_emb.encode.call_args.args[0] == ["数据结构\n栈\n栈遵循后进先出原则。"]
        assert fake_col.upsert.call_args.kwargs["documents"] == ["栈遵循后进先出原则。"]

    def test_refuses_false_success_when_embedder_unavailable(self, monkeypatch):
        from app.services import rag

        fake_col = MagicMock()
        monkeypatch.setattr(rag, "get_or_create_collection", lambda *a, **k: fake_col)
        monkeypatch.setattr(
            rag,
            "_get_embedder",
            lambda: (_ for _ in ()).throw(TimeoutError("huggingface head timed out")),
        )

        with pytest.raises(TimeoutError):
            rag.add_documents([{"id": "1", "content": "动态规划", "metadata": {"source": "a.md"}}])

        fake_col.upsert.assert_not_called()


class TestCandidateQuality:
    def test_filters_adjacent_chunks_from_same_source(self, monkeypatch):
        from app.services import rag

        monkeypatch.setattr(rag.settings, "RAG_ADJACENT_CHUNK_DEDUP", True)
        vector_docs = [
            {
                "id": "first",
                "content": "第一段",
                "metadata": {"source": "a.md", "sequence_index": 0},
                "vector_similarity": 0.95,
            },
            {
                "id": "adjacent",
                "content": "相邻段",
                "metadata": {"source": "a.md", "sequence_index": 1},
                "vector_similarity": 0.94,
            },
            {
                "id": "distant",
                "content": "远处段",
                "metadata": {"source": "a.md", "sequence_index": 3},
                "vector_similarity": 0.80,
            },
        ]

        selected = rag._merge_candidates(vector_docs, [], 3)

        assert [document["id"] for document in selected] == ["first", "distant"]

    def test_optional_reranker_reorders_only_candidate_pool(self, monkeypatch):
        from app.services import rag

        class Reranker:
            def predict(self, pairs):
                assert len(pairs) == 2
                return np.array([-2.0, 3.0])

        monkeypatch.setattr(rag.settings, "RAG_RERANKER_MODEL", "local-reranker")
        monkeypatch.setattr(rag.settings, "RAG_RERANKER_CANDIDATES", 2)
        monkeypatch.setattr(rag, "_get_reranker", lambda: Reranker())
        ranked = [
            {"id": "rrf-first", "content": "弱相关", "metadata": {}, "rrf_score": 0.9},
            {"id": "rerank-first", "content": "强相关", "metadata": {}, "rrf_score": 0.8},
            {"id": "outside-pool", "content": "候选池外", "metadata": {}, "rrf_score": 0.7},
        ]

        reranked, diagnostics = rag._rerank_candidates("查询", ranked)

        assert [document["id"] for document in reranked] == [
            "rerank-first",
            "rrf-first",
            "outside-pool",
        ]
        assert diagnostics["reranker_used"] is True
        assert diagnostics["reranker_candidates"] == 2

    def test_reranker_failure_preserves_hybrid_order(self, monkeypatch):
        from app.services import rag

        monkeypatch.setattr(rag.settings, "RAG_RERANKER_MODEL", "missing-reranker")
        monkeypatch.setattr(
            rag,
            "_get_reranker",
            lambda: (_ for _ in ()).throw(RuntimeError("model missing")),
        )
        ranked = [{"id": "first", "content": "正文", "metadata": {}, "rrf_score": 0.9}]

        reranked, diagnostics = rag._rerank_candidates("查询", ranked)

        assert reranked == ranked
        assert diagnostics["reranker_used"] is False
        assert diagnostics["reranker_error"] == "model missing"


def test_versioned_index_validates_all_sources_before_publish(monkeypatch, tmp_path):
    from app.services import rag

    knowledge = tmp_path / "knowledge"
    knowledge.mkdir()
    (knowledge / "01-栈.md").write_text("# 栈\n\n栈遵循后进先出原则。", encoding="utf-8")
    (knowledge / "02-队列.md").write_text("# 队列\n\n队列遵循先进先出原则。", encoding="utf-8")
    model = tmp_path / "bge-test"
    model.mkdir()
    (model / "modules.json").write_text("{}", encoding="utf-8")
    (model / "config.json").write_text("{}", encoding="utf-8")
    (model / "pytorch_model.bin").write_bytes(b"model-v1")

    embedded_batches: list[list[str]] = []

    class Embedder:
        def encode(self, texts, **kwargs):
            assert kwargs.get("normalize_embeddings") is True
            embedded_batches.append(list(texts))
            return np.tile(np.array([[0.1, 0.2, 0.3]]), (len(texts), 1))

    monkeypatch.setattr(rag.settings, "KNOWLEDGE_DIR", str(knowledge))
    monkeypatch.setattr(rag.settings, "CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    monkeypatch.setattr(rag.settings, "EMBEDDING_MODEL", str(model))
    rag.reset_rag_runtime()
    monkeypatch.setattr(rag, "_embedder", Embedder())
    try:
        result = rag.build_knowledge_index(force=True)
        health = rag.get_retrieval_health()

        assert result["rebuilt"] is True
        assert result["active_collection"].startswith("knowledge_")
        assert result["chunks"] == 2
        assert result["sources"] == 2
        assert health["index_complete"] is True
        assert health["actual_chunks"] == 2
        assert health["missing_sources"] == []
        assert any("01-栈\n栈\n# 栈" in text for batch in embedded_batches for text in batch)
    finally:
        rag.reset_rag_runtime()
