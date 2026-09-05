"""Authoritative knowledge-base gate for answer and generation paths."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.core.config import settings

KnowledgeGateStatus = Literal["matched", "kb_miss", "kb_unavailable"]


@dataclass(frozen=True)
class KnowledgeGateResult:
    status: KnowledgeGateStatus
    query: str
    context: list[dict[str, Any]]
    best_score: float
    retrieval_mode: str = "unknown"

    @property
    def matched(self) -> bool:
        return self.status == "matched"

    @property
    def retryable(self) -> bool:
        return self.status == "kb_unavailable"

    def error_payload(self) -> dict[str, Any]:
        message = (
            f"知识库尚无与「{self.query[:80]}」可靠匹配的内容"
            if self.status == "kb_miss"
            else "知识库暂时不可用，请稍后重新检索"
        )
        actions = ["retry_search"]
        if self.status == "kb_miss":
            actions.insert(0, "open_kb")
        return {
            "code": self.status,
            "stage": "knowledge_gate",
            "retryable": self.retryable,
            "message": message,
            "best_score": round(self.best_score, 3),
            "retrieval_mode": self.retrieval_mode,
            "actions": actions,
        }


def distance_to_similarity(distance: object) -> float:
    try:
        value = float(distance)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, 1.0 - value / 2.0))


def check_knowledge_gate(
    query: str,
    student_id: str = "",
    n_results: int = 5,
) -> KnowledgeGateResult:
    """Retrieve once and distinguish a miss from an infrastructure outage."""
    from app.services.rag import RetrievalUnavailable, retrieve_for_gate

    normalized_query = query.strip()
    try:
        context = retrieve_for_gate(normalized_query, student_id, n_results)
    except RetrievalUnavailable:
        return KnowledgeGateResult("kb_unavailable", normalized_query, [], 0.0, "unavailable")

    vector_scores = [
        float(item.get("vector_similarity"))
        if item.get("vector_similarity") is not None
        else distance_to_similarity(item.get("distance"))
        for item in context
        if item.get("retrieval_source") != "markdown"
    ]
    lexical_scores = [
        float(item.get("lexical_score") or 0.0)
        for item in context
        if item.get("retrieval_source") in {"markdown", "hybrid"}
    ]
    # Markdown scores are lexical evidence rather than vector distances.  A
    # score >= 1 means at least one meaningful query/topic term matched; exact
    # title matches score much higher and natural-language wrappers therefore
    # do not dilute a known topic into a false miss.
    best_score = max(vector_scores + lexical_scores, default=0.0)
    authoritative_lexical = any(item.get("authoritative_match") is True for item in context)
    matched = max(vector_scores, default=0.0) >= settings.KB_RELEVANCE_THRESHOLD or authoritative_lexical
    status: KnowledgeGateStatus = "matched" if matched else "kb_miss"
    mode = str(context[0].get("retrieval_mode") or "unknown") if context else "unknown"
    return KnowledgeGateResult(status, normalized_query, context, best_score, mode)
