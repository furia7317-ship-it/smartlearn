"""Permission-scoped evidence shared verbatim by planners, generators and reviewers."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from app.core.config import settings
from app.schemas.orchestration import SourcePolicy
from app.services.knowledge_gate import KnowledgeGateResult, check_knowledge_gate


def personal_collection(student_id: str) -> str:
    if not student_id:
        raise ValueError("个人资料需要登录")
    return "personal_" + hashlib.sha256(student_id.encode()).hexdigest()[:32]


def _allowed(item, policy):
    if not policy.document_ids:
        return True
    metadata = item.get("metadata") or {}
    identifiers = {str(item.get("id") or ""), *[str(metadata.get(k) or "") for k in ("document_id", "source", "url")]}
    return bool(identifiers.intersection(policy.document_ids))


def stamp_evidence(item, scope, owner=""):
    content = str(item.get("content") or "")
    metadata = dict(item.get("metadata") or {})
    return {**item, "metadata": {**metadata, "access_scope": scope, "owner_id": owner},
            "evidence_version": hashlib.sha256(content.encode()).hexdigest(),
            "retrieved_at": datetime.now(timezone.utc).isoformat()}


def collect_evidence(query, student_id, n_results=5, *, policy=None, attachments=None):
    policy = SourcePolicy.model_validate(policy or {})
    context, unavailable = [], False
    if policy.course:
        gate = check_knowledge_gate(query, student_id, n_results)
        unavailable = gate.status == "kb_unavailable"
        if gate.matched:
            context.extend(stamp_evidence(x, "course") for x in gate.context if _allowed(x, policy))
    if policy.personal and student_id:
        from sqlalchemy import select
        from app.core.config import sync_session
        from app.models.learning import GeneratedMaterial
        from app.services.rag import _query_anchor_match
        try:
            with sync_session() as db:
                notes = db.scalars(select(GeneratedMaterial).where(
                    GeneratedMaterial.student_id == student_id,
                    GeneratedMaterial.source.in_(["note", "reflection"]),
                ).order_by(GeneratedMaterial.created_at.desc()).limit(200)).all()
                for note in notes:
                    content = str((note.data or {}).get("content") or "")
                    item = {"id": note.id, "content": content, "metadata": {"source": note.title, "document_id": note.id}}
                    if _allowed(item, policy) and (note.id in policy.document_ids or _query_anchor_match(query, note.title + content)):
                        context.append(stamp_evidence(item, "personal", student_id))
        except Exception:
            unavailable = True
        from app.services.rag import _vector_retrieve
        try:
            personal = _vector_retrieve(query, n_results, personal_collection(student_id))
            context.extend(stamp_evidence(x, "personal", student_id) for x in personal
                           if (x.get("metadata") or {}).get("owner_id") == student_id
                           and float(x.get("vector_similarity") or 0) >= settings.KB_RELEVANCE_THRESHOLD
                           and _allowed(x, policy))
        except Exception:
            unavailable = True
    for item in (attachments or [])[:5]:
        if _allowed(item, policy) and str(item.get("content") or "").strip():
            context.append(stamp_evidence({**item, "content": str(item["content"])[:18000]}, "attachment", student_id))
    # A source restriction never grants access to arbitrary URLs or other users.
    # Search only fills an evidence gap; its results are fetched through the existing SSRF-safe fetcher.
    if not context and policy.web and not policy.document_ids:
        from app.services.web_search import bocha_search, fetch_readable_text, chunk_plain_text
        try:
            for result in bocha_search(query[:240], count=3):
                try:
                    body = fetch_readable_text(result["url"], max_chars=8000)
                except Exception:
                    continue
                if len(body.strip()) < 200:
                    continue
                for index, chunk in enumerate(chunk_plain_text(body, result["title"])[:2]):
                    chunk["id"] = "web-" + hashlib.sha256(f"{result['url']}:{index}:{chunk['content']}".encode()).hexdigest()[:32]
                    chunk["metadata"].update({"url": result["url"], "origin": "web", "document_id": result["url"]})
                    context.append(stamp_evidence(chunk, "web"))
        except Exception:
            unavailable = True
    # Keep supplied material alongside retrieval; it must not be dropped by a full course bucket.
    unique = {str(x["id"]): x for x in context if x.get("id")}
    context = list(unique.values())
    return KnowledgeGateResult("matched" if context else "kb_unavailable" if unavailable else "kb_miss",
                               query, context, 1.0 if context else 0.0, "scoped_evidence")


def evidence_retriever(policy, attachments=None):
    def retrieve(query, student_id, n_results=5):
        return collect_evidence(query, student_id, n_results, policy=policy, attachments=attachments).context
    return retrieve
