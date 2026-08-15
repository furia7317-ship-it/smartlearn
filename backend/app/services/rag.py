"""Hybrid RAG retrieval with versioned Chroma indexes and auditable fallback."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
import unicodedata
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from app.core.config import settings
from app.services.knowledge_documents import (
    CHUNKER_VERSION,
    knowledge_fingerprint,
    load_knowledge_documents,
    source_counts,
)


_client = None
_embedder = None
_embedder_error = ""
_embedder_error_at = 0.0
_document_cache_key: tuple[Any, ...] | None = None
_document_cache: list[dict[str, Any]] = []
_model_identity_cache: tuple[tuple[Any, ...], str] | None = None

_BGE_QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章："
_INDEX_MANIFEST_NAME = "knowledge-index.json"
_QUERY_ALIASES: tuple[tuple[str, str], ...] = (
    ("computer science curriculum", "计算机科学课程体系"),
    ("prerequisite", "先修关系"),
    ("array list", "顺序表"),
    ("linked list", "链表"),
    ("automata", "自动机"),
    ("formal language", "形式语言"),
    ("computability", "可计算性"),
    ("virtual memory", "虚拟内存"),
    ("page replacement", "页面置换"),
    ("cache coherence", "缓存一致性"),
    ("database transaction", "数据库事务"),
    ("software testing", "软件测试"),
    ("backpropagation", "反向传播"),
    ("cnn", "卷积神经网络"),
    ("nlp", "自然语言处理"),
    ("computer vision", "计算机视觉"),
    ("computer ethics", "计算机伦理"),
    ("research integrity", "科研诚信"),
    ("capstone", "毕业设计"),
    ("恢复现场", "回溯 撤销选择"),
)


class RetrievalUnavailable(RuntimeError):
    """The authoritative retrieval path is unavailable."""


class MarkdownKnowledgeUnavailable(RuntimeError):
    """Local Markdown knowledge cannot be enumerated or read."""


@contextmanager
def _chroma_sqlite_compat() -> Iterator[None]:
    if sqlite3.sqlite_version_info >= (3, 35, 0):
        yield
        return
    try:
        import pysqlite3
    except ImportError as exc:
        raise RuntimeError(
            "Chroma requires SQLite 3.35 or newer; install pysqlite3-binary on this server"
        ) from exc
    original_sqlite = sys.modules.get("sqlite3")
    sys.modules["sqlite3"] = pysqlite3
    try:
        yield
    finally:
        if original_sqlite is None:
            sys.modules.pop("sqlite3", None)
        else:
            sys.modules["sqlite3"] = original_sqlite


def _get_client():
    global _client
    if _client is None:
        with _chroma_sqlite_compat():
            try:
                import chromadb
            except ImportError as exc:
                raise RetrievalUnavailable("chromadb is not installed") from exc
        _client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)
    return _client


def _get_embedder():
    """Load the local embedding model once and cache failures briefly."""

    global _embedder, _embedder_error, _embedder_error_at
    if _embedder is not None:
        return _embedder
    retry_seconds = max(1.0, float(settings.RAG_EMBEDDER_RETRY_SECONDS))
    if _embedder_error and time.monotonic() - _embedder_error_at < retry_seconds:
        raise RetrievalUnavailable(_embedder_error)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        from sentence_transformers import SentenceTransformer

        _embedder = SentenceTransformer(
            _embedding_model_reference(),
            local_files_only=True,
        )
        _embedder_error = ""
        return _embedder
    except Exception as exc:
        _embedder_error = f"local embedding model unavailable: {exc}"
        _embedder_error_at = time.monotonic()
        raise RetrievalUnavailable(_embedder_error) from exc


def _embedding_model_reference() -> str:
    """Resolve an explicit, development-runtime or packaged model directory."""

    configured = Path(str(settings.EMBEDDING_MODEL)).expanduser()
    if configured.is_dir():
        return str(configured.resolve())
    backend_root = Path(__file__).resolve().parents[2]
    workspace_root = backend_root.parent
    model_name = str(settings.EMBEDDING_MODEL).rstrip("/\\").split("/")[-1]
    candidates = (
        backend_root / "models" / model_name,
        workspace_root / "frontend" / "runtime" / "assets" / "models" / model_name,
        workspace_root
        / "frontend"
        / "dist-electron"
        / "win-unpacked"
        / "resources"
        / "assets"
        / "models"
        / model_name,
    )
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "modules.json").is_file():
            return str(candidate.resolve())
    return str(settings.EMBEDDING_MODEL)


def _embedding_model_identity() -> str:
    """Return a cached content identity for the resolved local model."""

    global _model_identity_cache
    reference = _embedding_model_reference()
    root = Path(reference)
    if not root.is_dir():
        return reference
    tracked = [
        path
        for name in ("config.json", "modules.json", "pytorch_model.bin", "model.safetensors")
        if (path := root / name).is_file()
    ]
    key = tuple((str(path.resolve()), path.stat().st_mtime_ns, path.stat().st_size) for path in tracked)
    if _model_identity_cache and _model_identity_cache[0] == key:
        return _model_identity_cache[1]
    digest = hashlib.sha256()
    for path in tracked:
        digest.update(path.name.encode("utf-8"))
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    identity = f"{root.name}:{digest.hexdigest()}"
    _model_identity_cache = (key, identity)
    return identity


def reset_rag_runtime() -> None:
    """Reset cached runtime state after configuration/model changes."""

    global _client, _embedder, _embedder_error, _embedder_error_at
    global _document_cache_key, _document_cache, _model_identity_cache
    _client = None
    _embedder = None
    _embedder_error = ""
    _embedder_error_at = 0.0
    _document_cache_key = None
    _document_cache = []
    _model_identity_cache = None


def _query_text(query: str) -> str:
    query = _expand_query(query)
    if "bge" in str(settings.EMBEDDING_MODEL).lower():
        return _BGE_QUERY_INSTRUCTION + query
    return query


def _expand_query(query: str) -> str:
    """Append audited bilingual/domain aliases without an LLM rewrite step."""

    normalized = _normalize_search_text(query)
    additions = [replacement for phrase, replacement in _QUERY_ALIASES if phrase in normalized]
    return f"{query} {' '.join(dict.fromkeys(additions))}".strip()


def _manifest_path() -> Path:
    return Path(settings.CHROMA_PERSIST_DIR) / _INDEX_MANIFEST_NAME


def _read_manifest() -> dict[str, Any]:
    path = _manifest_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_manifest(payload: dict[str, Any]) -> None:
    path = _manifest_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _active_collection_name(name: str) -> str:
    if name != "knowledge":
        return name
    active = str(_read_manifest().get("active_collection") or "").strip()
    return active or name


def get_or_create_collection(name: str = "knowledge", *, resolve_active: bool = True):
    client = _get_client()
    collection_name = _active_collection_name(name) if resolve_active else name
    return client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )


def _flatten_results(results: dict[str, Any]) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    ids = results.get("ids") or [[]]
    documents = results.get("documents") or [[]]
    metadatas = results.get("metadatas") or [[]]
    distances = results.get("distances") or [[]]
    if not ids or not ids[0]:
        return docs
    for index, item_id in enumerate(ids[0]):
        docs.append(
            {
                "id": item_id,
                "content": documents[0][index],
                "metadata": metadatas[0][index] if metadatas and metadatas[0] else {},
                "distance": distances[0][index] if distances and distances[0] else 0,
            }
        )
    return docs


def _knowledge_snapshot_key() -> tuple[Any, ...]:
    root = Path(settings.KNOWLEDGE_DIR)
    if not root.exists():
        raise MarkdownKnowledgeUnavailable("knowledge directory is unavailable")
    try:
        stats = tuple(
            (path.name, path.stat().st_mtime_ns, path.stat().st_size)
            for path in sorted(root.glob("*.md"))
        )
    except OSError as exc:
        raise MarkdownKnowledgeUnavailable("knowledge directory cannot be read") from exc
    return (str(root.resolve()), CHUNKER_VERSION, stats)


def _markdown_chunks() -> list[dict[str, Any]]:
    global _document_cache_key, _document_cache
    key = _knowledge_snapshot_key()
    if key == _document_cache_key:
        return [dict(item, metadata=dict(item.get("metadata", {}))) for item in _document_cache]
    try:
        documents = load_knowledge_documents(settings.KNOWLEDGE_DIR)
    except (OSError, UnicodeError, FileNotFoundError) as exc:
        raise MarkdownKnowledgeUnavailable("knowledge documents cannot be read") from exc
    _document_cache_key = key
    _document_cache = documents
    return [dict(item, metadata=dict(item.get("metadata", {}))) for item in documents]


def _coalesce_markdown_blocks(blocks: list[str], limit: int = 1400) -> list[str]:
    """Retained as a compatibility helper for callers/tests."""

    grouped: list[str] = []
    current = ""
    for raw_block in blocks:
        block = raw_block.strip()
        if not block:
            continue
        if len(block) > limit:
            if current:
                grouped.append(current)
                current = ""
            grouped.extend(block[index : index + limit] for index in range(0, len(block), limit))
            continue
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) <= limit:
            current = candidate
        else:
            grouped.append(current)
            current = block
    if current:
        grouped.append(current)
    return grouped


def _normalize_search_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").lower()


def _compact(value: str) -> str:
    return "".join(character for character in _normalize_search_text(value) if character.isalnum())


def _search_tokens(value: str) -> list[str]:
    normalized = _normalize_search_text(value)
    tokens = re.findall(r"[a-z0-9]+(?:[+.#-][a-z0-9]+)*", normalized)
    for span in re.findall(r"[\u4e00-\u9fff]+", normalized):
        if len(span) <= 12:
            tokens.append(span)
        for size in (2, 3, 4):
            if len(span) >= size:
                tokens.extend(span[index : index + size] for index in range(len(span) - size + 1))
    return tokens


def _topic_segments(metadata: dict[str, Any]) -> list[str]:
    source = re.sub(r"^\d+[-_.\s]*", "", Path(str(metadata.get("source") or "")).stem)
    title = re.sub(r"^第?\d+[章节.\s-]*", "", str(metadata.get("title") or ""))
    candidates = [source, title]
    for value in (source, title):
        candidates.extend(re.split(r"[和与、/|，,：:（）()]+", value))
    return list(dict.fromkeys(_compact(item) for item in candidates if _compact(item)))


def _query_anchor_match(query: str, searchable: str) -> bool:
    normalized_searchable = _compact(searchable)
    for span in re.findall(r"[\u4e00-\u9fff]{4,}", _normalize_search_text(query)):
        for size in range(min(8, len(span)), 3, -1):
            if any(span[index : index + size] in normalized_searchable for index in range(len(span) - size + 1)):
                return True
    english = set(re.findall(r"[a-z][a-z0-9+-]{2,}", _normalize_search_text(query)))
    return bool(english and english.intersection(_search_tokens(searchable)))


def _lexical_retrieve(query: str, n_results: int) -> list[dict[str, Any]]:
    documents = _markdown_chunks()
    if not documents or not query.strip():
        return []

    expanded_query = _expand_query(query)

    searchable_values = [
        f"{doc.get('metadata', {}).get('source', '')}\n{doc.get('metadata', {}).get('title', '')}\n{doc.get('content', '')}"
        for doc in documents
    ]
    token_lists = [_search_tokens(value) for value in searchable_values]
    document_frequencies: Counter[str] = Counter()
    for tokens in token_lists:
        document_frequencies.update(set(tokens))
    query_tokens = list(dict.fromkeys(_search_tokens(expanded_query)))
    if not query_tokens:
        return []
    average_length = sum(map(len, token_lists)) / max(1, len(token_lists))
    query_compact = _compact(expanded_query)
    ranked: list[tuple[float, dict[str, Any]]] = []

    for document, searchable, tokens in zip(documents, searchable_values, token_lists, strict=True):
        frequencies = Counter(tokens)
        score = 0.0
        for token in query_tokens:
            frequency = frequencies.get(token, 0)
            if not frequency:
                continue
            frequency_docs = document_frequencies[token]
            inverse_frequency = math.log(1 + (len(documents) - frequency_docs + 0.5) / (frequency_docs + 0.5))
            denominator = frequency + 1.5 * (1 - 0.75 + 0.75 * len(tokens) / max(1.0, average_length))
            score += inverse_frequency * frequency * 2.5 / denominator

        compact_searchable = _compact(searchable)
        title_match = any(
            segment and segment in query_compact
            for segment in _topic_segments(document.get("metadata", {}))
            if len(segment) >= 2 or segment in {"栈", "图", "树"}
        )
        exact_phrase = len(query_compact) >= 4 and query_compact in compact_searchable
        anchor_match = _query_anchor_match(expanded_query, searchable)
        if title_match:
            score += 12.0
        if exact_phrase:
            score += 8.0
        if anchor_match:
            score += 3.0
        if score <= 0:
            continue
        authoritative = title_match or exact_phrase or (anchor_match and score >= 5.0)
        fallback_score = (
            100.0 + score
            if title_match
            else 50.0 + score
            if exact_phrase
            else 10.0 + score
            if authoritative
            else score
        )
        ranked.append(
            (
                score,
                {
                    **document,
                    "distance": round(1 / (score + 1), 6),
                    "bm25_score": round(score, 6),
                    "fallback_score": round(fallback_score, 6),
                    "exact_match": exact_phrase,
                    "title_match": title_match,
                    "authoritative_match": authoritative,
                    "retrieval_source": "markdown",
                    "retrieval_mode": "lexical_degraded",
                },
            )
        )
    ranked.sort(key=lambda item: (-item[0], str(item[1].get("id") or "")))
    docs = [item[1] for item in ranked[: max(n_results, 0)]]
    for index, doc in enumerate(docs, 1):
        doc["lexical_rank"] = index
    return docs


def _fallback_retrieve(query: str, n_results: int) -> list[dict[str, Any]]:
    return _lexical_retrieve(query, n_results)


def _fallback_retrieve_for_gate(query: str, n_results: int) -> list[dict[str, Any]]:
    return _lexical_retrieve(query, n_results)


def _vector_retrieve(query: str, n_results: int, collection_name: str) -> list[dict[str, Any]]:
    collection = get_or_create_collection(collection_name)
    count = collection.count()
    if count <= 0:
        return []
    embedder = _get_embedder()
    query_embedding = embedder.encode(
        [_query_text(query)],
        normalize_embeddings=True,
    ).tolist()
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=min(max(1, n_results), count),
        include=["documents", "metadatas", "distances"],
    )
    docs = _flatten_results(results)
    for index, doc in enumerate(docs, 1):
        doc["vector_rank"] = index
        doc["vector_similarity"] = max(0.0, min(1.0, 1.0 - float(doc.get("distance") or 0.0) / 2.0))
        doc["retrieval_source"] = "vector"
    return docs


def _candidate_key(document: dict[str, Any]) -> str:
    source = str(document.get("metadata", {}).get("source") or "")
    content = re.sub(r"\s+", " ", str(document.get("content") or "")).strip()
    return f"{source}\0{content}"


def _merge_candidates(
    vector_docs: list[dict[str, Any]],
    lexical_docs: list[dict[str, Any]],
    n_results: int,
) -> list[dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    scores: Counter[str] = Counter()
    rrf_k = max(1, int(settings.RAG_RRF_K))

    for rank, document in enumerate(vector_docs, 1):
        key = _candidate_key(document)
        candidates[key] = dict(document)
        scores[key] += 1.0 / (rrf_k + rank)
    for rank, document in enumerate(lexical_docs, 1):
        key = _candidate_key(document)
        if key in candidates:
            merged = candidates[key]
            for field in (
                "bm25_score",
                "fallback_score",
                "exact_match",
                "title_match",
                "authoritative_match",
                "lexical_rank",
            ):
                if field in document:
                    merged[field] = document[field]
            merged["retrieval_source"] = "hybrid"
        else:
            candidates[key] = dict(document)
        scores[key] += 1.15 / (rrf_k + rank)
        if document.get("authoritative_match"):
            scores[key] += 0.01

    ranked: list[dict[str, Any]] = []
    for key, document in candidates.items():
        document["rrf_score"] = round(scores[key], 8)
        document["retrieval_mode"] = "hybrid"
        ranked.append(document)
    ranked.sort(
        key=lambda item: (
            -float(item.get("rrf_score") or 0.0),
            -float(item.get("vector_similarity") or 0.0),
            str(item.get("id") or ""),
        )
    )

    max_per_source = max(1, int(settings.RAG_MAX_RESULTS_PER_SOURCE))
    selected: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    used_sources: Counter[str] = Counter()
    for document in ranked:
        source = str(document.get("metadata", {}).get("source") or document.get("id") or "")
        if used_sources[source] >= max_per_source:
            deferred.append(document)
            continue
        selected.append(document)
        used_sources[source] += 1
        if len(selected) >= n_results:
            return selected
    for document in deferred:
        selected.append(document)
        if len(selected) >= n_results:
            break
    return selected


def _retrieve_internal(
    query: str,
    n_results: int,
    collection_name: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started = time.perf_counter()
    if n_results <= 0:
        return [], {
            "mode": "empty",
            "index_version": str(_read_manifest().get("fingerprint") or "legacy"),
            "vector_candidates": 0,
            "lexical_candidates": 0,
            "vector_available": _embedder is not None,
            "vector_error": "",
            "latency_ms": round((time.perf_counter() - started) * 1000, 3),
        }
    lexical_count = max(n_results, int(settings.RAG_LEXICAL_CANDIDATES))
    vector_count = max(n_results, int(settings.RAG_VECTOR_CANDIDATES))
    lexical_docs = _lexical_retrieve(query, lexical_count)
    vector_docs: list[dict[str, Any]] = []
    vector_error = ""
    try:
        vector_docs = _vector_retrieve(query, vector_count, collection_name)
    except Exception as exc:
        vector_error = str(exc)

    if vector_docs:
        docs = _merge_candidates(vector_docs, lexical_docs, n_results)
        mode = "hybrid" if lexical_docs else "vector"
    else:
        docs = lexical_docs[:n_results]
        mode = "lexical_degraded"
        for doc in docs:
            doc["retrieval_mode"] = mode
    diagnostics = {
        "mode": mode,
        "index_version": str(_read_manifest().get("fingerprint") or "legacy"),
        "vector_candidates": len(vector_docs),
        "lexical_candidates": len(lexical_docs),
        "vector_available": bool(vector_docs) or not vector_error,
        "vector_error": vector_error[:240],
        "latency_ms": round((time.perf_counter() - started) * 1000, 3),
    }
    for doc in docs:
        doc["retrieval_mode"] = mode
        doc["index_version"] = diagnostics["index_version"]
    return docs, diagnostics


def retrieve(
    query: str,
    student_id: str = "",
    n_results: int = 5,
    collection_name: str = "knowledge",
) -> list[dict[str, Any]]:
    del student_id
    docs, _ = _retrieve_internal(query.strip(), max(0, n_results), collection_name)
    return docs


def retrieve_for_gate(
    query: str,
    student_id: str = "",
    n_results: int = 5,
    collection_name: str = "knowledge",
) -> list[dict[str, Any]]:
    del student_id
    try:
        docs, _ = _retrieve_internal(query.strip(), max(0, n_results), collection_name)
        return docs
    except MarkdownKnowledgeUnavailable as exc:
        raise RetrievalUnavailable("knowledge retrieval unavailable") from exc


def add_documents(
    docs: list[dict[str, Any]],
    collection_name: str = "knowledge",
) -> list[str]:
    if not docs:
        return []
    embedder = _get_embedder()
    collection = get_or_create_collection(collection_name)
    ids = [str(document["id"]) for document in docs]
    texts = [str(document["content"]) for document in docs]
    cleaned_metadatas: list[dict[str, str | int | float | bool]] = []
    for document in docs:
        cleaned: dict[str, str | int | float | bool] = {}
        for key, value in document.get("metadata", {}).items():
            cleaned[key] = value if isinstance(value, (str, int, float, bool)) else str(value)
        cleaned_metadatas.append(cleaned)
    embeddings = embedder.encode(texts, normalize_embeddings=True).tolist()
    collection.upsert(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=cleaned_metadatas,
    )
    return ids


def build_knowledge_index(force: bool = False) -> dict[str, Any]:
    """Build a complete versioned collection and atomically publish its manifest."""

    documents = load_knowledge_documents(settings.KNOWLEDGE_DIR)
    expected_sources = source_counts(documents)
    model_identity = _embedding_model_identity()
    fingerprint = knowledge_fingerprint(settings.KNOWLEDGE_DIR, model_identity)
    collection_name = f"knowledge_{fingerprint[:16]}"
    manifest = _read_manifest()
    if not force and manifest.get("fingerprint") == fingerprint:
        try:
            collection = get_or_create_collection(collection_name, resolve_active=False)
            if collection.count() == len(documents):
                return {
                    "status": "ready",
                    "rebuilt": False,
                    "active_collection": collection_name,
                    "fingerprint": fingerprint,
                    "chunks": len(documents),
                    "sources": len(expected_sources),
                }
        except Exception:
            pass

    embedder = _get_embedder()
    client = _get_client()
    existing_names = {collection.name for collection in client.list_collections()}
    if collection_name in existing_names:
        client.delete_collection(collection_name)
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={
            "hnsw:space": "cosine",
            "fingerprint": fingerprint[:32],
            "chunker_version": CHUNKER_VERSION,
        },
    )

    batch_size = max(1, int(settings.RAG_INDEX_BATCH_SIZE))
    for offset in range(0, len(documents), batch_size):
        batch = documents[offset : offset + batch_size]
        texts = [str(document["content"]) for document in batch]
        embeddings = embedder.encode(texts, normalize_embeddings=True).tolist()
        collection.upsert(
            ids=[str(document["id"]) for document in batch],
            documents=texts,
            embeddings=embeddings,
            metadatas=[document["metadata"] for document in batch],
        )

    actual = collection.get(include=["metadatas"])
    actual_sources = Counter(
        str(metadata.get("source") or "")
        for metadata in (actual.get("metadatas") or [])
        if metadata.get("source")
    )
    if collection.count() != len(documents) or dict(sorted(actual_sources.items())) != expected_sources:
        raise RuntimeError(
            f"knowledge index validation failed: chunks={collection.count()}/{len(documents)}, "
            f"sources={len(actual_sources)}/{len(expected_sources)}"
        )

    payload = {
        "schema_version": 1,
        "active_collection": collection_name,
        "fingerprint": fingerprint,
        "embedding_model": settings.EMBEDDING_MODEL,
        "embedding_model_identity": model_identity,
        "chunker_version": CHUNKER_VERSION,
        "chunks": len(documents),
        "source_counts": expected_sources,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _write_manifest(payload)
    return {
        "status": "ready",
        "rebuilt": True,
        "active_collection": collection_name,
        "fingerprint": fingerprint,
        "chunks": len(documents),
        "sources": len(expected_sources),
    }


def get_retrieval_health(*, load_model: bool = False) -> dict[str, Any]:
    documents = _markdown_chunks()
    expected_sources = source_counts(documents)
    expected_fingerprint = knowledge_fingerprint(settings.KNOWLEDGE_DIR, _embedding_model_identity())
    manifest = _read_manifest()
    active_name = str(manifest.get("active_collection") or "knowledge")
    actual_count = 0
    actual_sources: set[str] = set()
    try:
        collection = get_or_create_collection(active_name, resolve_active=False)
        actual_count = collection.count()
        got = collection.get(include=["metadatas"])
        actual_sources = {
            str(metadata.get("source") or "")
            for metadata in (got.get("metadatas") or [])
            if metadata.get("source")
        }
    except Exception:
        pass

    model_available = _embedder is not None
    model_error = _embedder_error
    if load_model and not model_available:
        try:
            _get_embedder()
            model_available = True
            model_error = ""
        except RetrievalUnavailable as exc:
            model_error = str(exc)

    complete = (
        actual_count == len(documents)
        and actual_sources == set(expected_sources)
        and manifest.get("fingerprint") == expected_fingerprint
    )
    return {
        "status": "ready" if model_available and complete else "degraded",
        "retrieval_mode": "hybrid" if model_available and complete else "lexical_degraded",
        "model_available": model_available,
        "model": settings.EMBEDDING_MODEL,
        "model_error": model_error[:240],
        "index_complete": complete,
        "active_collection": active_name,
        "index_version": str(manifest.get("fingerprint") or "legacy"),
        "expected_chunks": len(documents),
        "actual_chunks": actual_count,
        "expected_sources": len(expected_sources),
        "actual_sources": len(actual_sources),
        "missing_sources": sorted(set(expected_sources) - actual_sources),
    }


def retrieve_with_diagnostics(
    query: str,
    student_id: str = "",
    n_results: int = 5,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    del student_id
    docs, diagnostics = _retrieve_internal(query.strip(), max(0, n_results), "knowledge")
    sources = [
        {
            "index": index,
            "id": document["id"],
            "content": str(document.get("content") or "")[:200],
            "metadata": document.get("metadata", {}),
            "retrieval_source": document.get("retrieval_source"),
            "score": document.get("rrf_score", document.get("bm25_score")),
        }
        for index, document in enumerate(docs, 1)
    ]
    return docs, sources, diagnostics


def retrieve_with_sources(
    query: str,
    student_id: str = "",
    n_results: int = 5,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    docs, sources, _ = retrieve_with_diagnostics(query, student_id, n_results)
    return docs, sources
