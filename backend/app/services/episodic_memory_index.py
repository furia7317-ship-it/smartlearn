"""Best-effort semantic index for autobiographical memory episodes.

This collection is deliberately separate from the authoritative course
knowledge index. SQLite remains the source of truth; Chroma only supplies a
semantic score and may be unavailable without making tutoring unavailable.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from app.core.config import settings


_pending_tasks: set[asyncio.Task[Any]] = set()
_scheduled_versions: set[tuple[str, str, int, str]] = set()


def _episode_payload(episode: Any) -> dict[str, Any]:
    structured = episode.structured_summary if isinstance(episode.structured_summary, dict) else {}
    return {
        "id": str(episode.id),
        "student_id": str(episode.student_id),
        "conversation_id": str(episode.conversation_id or ""),
        "summary": str(episode.summary or ""),
        "structured_summary": structured,
        "importance": float(episode.importance or 0),
        "occurred_at": int(episode.occurred_at or 0),
        "source_start_index": int(episode.source_start_index or 0),
        "source_end_index": int(episode.source_end_index or 0),
    }


def _embedding_text(payload: dict[str, Any]) -> str:
    structured = payload.get("structured_summary")
    if not isinstance(structured, dict):
        structured = {}
    parts = [
        str(structured.get("topic") or ""),
        str(structured.get("intent") or ""),
        " ".join(str(value) for value in structured.get("entities", []) if value),
        " ".join(str(value) for value in structured.get("decisions", []) if value),
        " ".join(str(value) for value in structured.get("unresolved", []) if value),
        str(payload.get("summary") or ""),
    ]
    return "\n".join(part for part in parts if part).strip()


def _upsert_payload(payload: dict[str, Any]) -> None:
    from app.services import rag

    collection = rag.get_or_create_collection(
        settings.MEMORY_EPISODE_VECTOR_COLLECTION,
        resolve_active=False,
    )
    embedder = rag._get_embedder()
    document = _embedding_text(payload)
    embedding = embedder.encode([document], normalize_embeddings=True).tolist()
    collection.upsert(
        ids=[payload["id"]],
        documents=[document],
        embeddings=embedding,
        metadatas=[{
            "student_id": payload["student_id"],
            "conversation_id": payload["conversation_id"],
            "importance": payload["importance"],
            "occurred_at": payload["occurred_at"],
            "source_start_index": payload["source_start_index"],
            "source_end_index": payload["source_end_index"],
        }],
    )


def _consume_task(task: asyncio.Task[Any], version: tuple[str, str, int, str]) -> None:
    _pending_tasks.discard(task)
    try:
        task.result()
    except (asyncio.CancelledError, Exception):
        # Semantic memory is optional enrichment. The SQLite episode remains
        # available to deterministic fallback retrieval.
        _scheduled_versions.discard(version)


def schedule_episode_index(episode: Any) -> None:
    """Index a committed episode without delaying the response path."""

    if not settings.MEMORY_EPISODE_VECTOR_ENABLED:
        return
    payload = _episode_payload(episode)
    if not payload["summary"]:
        return
    version = (
        payload["student_id"],
        payload["id"],
        payload["source_end_index"],
        hashlib.sha256(payload["summary"].encode("utf-8")).hexdigest()[:16],
    )
    if version in _scheduled_versions:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _scheduled_versions.add(version)
    task = loop.create_task(asyncio.to_thread(_upsert_payload, payload))
    _pending_tasks.add(task)
    task.add_done_callback(lambda completed: _consume_task(completed, version))


def _query_scores(student_id: str, query: str, limit: int) -> dict[str, float]:
    from app.services import rag

    collection = rag.get_or_create_collection(
        settings.MEMORY_EPISODE_VECTOR_COLLECTION,
        resolve_active=False,
    )
    count = int(collection.count())
    if count <= 0:
        return {}
    embedder = rag._get_embedder()
    embedding = embedder.encode(
        [rag._query_text(query)],
        normalize_embeddings=True,
    ).tolist()
    results = collection.query(
        query_embeddings=embedding,
        n_results=max(1, min(limit, count)),
        where={"student_id": student_id},
        include=["distances"],
    )
    ids = (results.get("ids") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]
    return {
        str(item_id): max(0.0, min(1.0, 1.0 - float(distances[index])))
        for index, item_id in enumerate(ids)
        if index < len(distances)
    }


async def semantic_episode_scores(student_id: str, query: str) -> dict[str, float]:
    """Return semantic scores quickly, or an empty mapping on any failure."""

    if not settings.MEMORY_EPISODE_VECTOR_ENABLED or not query.strip():
        return {}
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(
                _query_scores,
                student_id,
                query,
                max(1, settings.MEMORY_EPISODE_RECALL_CANDIDATES),
            ),
            timeout=max(0.05, settings.MEMORY_EPISODE_VECTOR_TIMEOUT_SECONDS),
        )
    except (asyncio.TimeoutError, Exception):
        return {}


def _delete_student(student_id: str) -> None:
    from app.services import rag

    collection = rag.get_or_create_collection(
        settings.MEMORY_EPISODE_VECTOR_COLLECTION,
        resolve_active=False,
    )
    collection.delete(where={"student_id": student_id})


async def delete_student_episode_index(student_id: str) -> bool:
    if not settings.MEMORY_EPISODE_VECTOR_ENABLED:
        return True
    try:
        await asyncio.to_thread(_delete_student, student_id)
        _scheduled_versions.difference_update(
            version for version in _scheduled_versions if version[0] == student_id
        )
        return True
    except Exception:
        return False


def debug_payload(episode: Any) -> str:
    """Stable diagnostic representation used by tests and local inspection."""

    return json.dumps(_episode_payload(episode), ensure_ascii=False, sort_keys=True)
