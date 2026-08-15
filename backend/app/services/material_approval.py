"""Server-issued approval markers for externally generated material payloads."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.core.config import settings
from app.schemas.resource_plan import TaskReview
from app.services.resource_grounding import (
    ReviewUnavailable,
    apply_grounding_gate,
    verify_resource_semantics,
)
from app.services.html_sandbox import validate_interactive_payload
from app.services.resource_quality import extract_resource_text

APPROVAL_TTL_SECONDS = 10 * 60
_EPHEMERAL_SECRET = secrets.token_bytes(32)
_ALLOWED_TYPES = {
    "explainer",
    "mindmap",
    "quiz",
    "reading",
    "code",
    "video",
    "courseware",
    "interactive",
}


def _secret() -> bytes:
    configured = str(getattr(settings, "MATERIAL_APPROVAL_SECRET", "") or "").strip()
    return configured.encode("utf-8") if configured else _EPHEMERAL_SECRET


def material_candidate_payload(student_id: str, resource: dict[str, Any]) -> dict[str, Any]:
    """Return the exact client/server fields covered by the approval marker."""

    return {
        "student_id": str(student_id),
        "type": str(resource.get("type") or ""),
        "title": str(resource.get("title") or ""),
        "subtitle": str(resource.get("subtitle") or ""),
        "meta": [str(item) for item in resource.get("meta") or []],
        "sources": int(resource.get("sources") or 0),
        "knowledge_points": str(resource.get("knowledge_points") or ""),
        "data": dict(resource.get("data") or {}),
        "source": str(resource.get("source") or "studio"),
    }


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")


def _digest(student_id: str, resource: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(material_candidate_payload(student_id, resource))).hexdigest()


def _urls(resource: dict[str, Any]) -> list[str]:
    data = dict(resource.get("data") or {})
    urls: list[str] = []
    for item in data.get("sources") or []:
        if isinstance(item, dict):
            value = str(item.get("url") or "").strip()
        else:
            value = str(item).strip()
        if value.startswith(("http://", "https://")):
            urls.append(value)
    for item in data.get("references") or []:
        value = str(item).strip()
        if value.startswith(("http://", "https://")):
            urls.append(value)
    return list(dict.fromkeys(urls))


def _structure_issues(resource: dict[str, Any]) -> list[str]:
    resource_type = str(resource.get("type") or "")
    data = dict(resource.get("data") or {})
    issues: list[str] = []
    if resource_type not in _ALLOWED_TYPES:
        issues.append("资料类型不在允许范围内")
    if not str(resource.get("title") or "").strip():
        issues.append("资料缺少标题")
    if not data:
        issues.append("资料内容为空")

    flattened = {**data, "type": resource_type, "title": resource.get("title")}
    if resource_type == "quiz":
        questions = data.get("questions")
        if not isinstance(questions, list) or not questions:
            issues.append("测验没有题目")
        else:
            for index, question in enumerate(questions, 1):
                if not isinstance(question, dict):
                    issues.append(f"第 {index} 题结构无效")
                    continue
                if not str(question.get("stem") or "").strip():
                    issues.append(f"第 {index} 题缺少题干")
                if not str(question.get("answer") or "").strip():
                    issues.append(f"第 {index} 题缺少答案")
                if len(str(question.get("explanation") or "").strip()) < 8:
                    issues.append(f"第 {index} 题解析不足")
                if question.get("type") in {"mcq", "judge", "tf"} and len(
                    question.get("options") or []
                ) < 2:
                    issues.append(f"第 {index} 题选项不足")
    elif resource_type == "code":
        code = str(data.get("code") or "")
        if not code.strip():
            issues.append("代码资料缺少代码正文")
        elif str(data.get("language") or "python").lower() in {"python", "py"}:
            try:
                compile(code, "<approved-material>", "exec")
            except SyntaxError:
                issues.append("Python 代码无法通过语法检查")
    elif resource_type in {"reading", "explainer"}:
        if len(extract_resource_text(flattened).strip()) < 80:
            issues.append("学习正文过短，无法形成可复习资料")
    elif resource_type == "mindmap" and len(data.get("nodes") or []) < 3:
        issues.append("思维导图分支不足")
    elif resource_type == "courseware" and len(data.get("slides") or []) < 8:
        issues.append("课件页数不足")
    elif resource_type == "video" and len(data.get("scenes") or data.get("narration") or []) < 2:
        issues.append("视频讲解缺少连续的章节内容")
    elif resource_type == "interactive":
        issues.extend(validate_interactive_payload(data))
    return issues


def review_material_candidate(
    resource: dict[str, Any],
    *,
    evidence_context: list[dict[str, Any]],
) -> TaskReview:
    """Apply structure, evidence, semantic-fact, and executable gates."""

    issues = _structure_issues(resource)
    source = str(resource.get("source") or "")
    urls = _urls(resource)
    if source in {"web", "video"} and not urls:
        issues.append("外部学习资料缺少可验证来源链接")
    if int(resource.get("sources") or 0) > 0 and not urls:
        issues.append("资料声明了来源数量，但没有可验证来源")

    base = TaskReview(
        approved=not issues,
        score=max(0.0, 1.0 - 0.35 * len(issues)),
        issues=list(issues),
        blocking_issues=list(issues),
        warnings=[],
        fixes=["补齐结构、证据或可执行字段后重新生成" for _ in issues[:1]],
        gate_status="approved" if not issues else "rejected",
        retryable=False,
        terminal=bool(issues),
    )
    data = dict(resource.get("data") or {})
    flattened = {
        **data,
        "type": resource.get("type"),
        "title": resource.get("title"),
    }
    task = {
        "type": resource.get("type"),
        "title": resource.get("title"),
        "source_ids": [str(item.get("id") or "") for item in evidence_context],
        "outline": {"sections": []},
        "quality_criteria": [],
    }
    try:
        grounded = apply_grounding_gate(
            base,
            flattened,
            task,
            evidence_context,
            semantic_verifier=verify_resource_semantics,
        )
    except ReviewUnavailable as exc:
        # An external web/video candidate never receives a persistence token
        # when the semantic reviewer cannot produce a trustworthy verdict.
        # Keep this distinct from content rejection so the UI can explain the
        # dependency failure and offer a retry after service recovery.
        return TaskReview(
            approved=False,
            score=0.0,
            issues=[f"审核基础设施不可用：{type(exc).__name__}"],
            blocking_issues=[],
            warnings=[],
            fixes=[],
            gate_status="review_unavailable",
            failure_kind="reviewer",
            error_code="review_unavailable",
            retryable=True,
            terminal=False,
            service_recoverable=True,
        )
    grounded.retryable = False
    grounded.terminal = not grounded.approved
    grounded.gate_status = "approved" if grounded.approved else "rejected"
    return grounded


def issue_material_approval(
    student_id: str,
    resource: dict[str, Any],
    *,
    evidence_context: list[dict[str, Any]],
) -> tuple[str | None, TaskReview]:
    review = review_material_candidate(resource, evidence_context=evidence_context)
    if not review.approved:
        return None, review
    claims = {
        "v": 1,
        "student_id": student_id,
        "digest": _digest(student_id, resource),
        "iat": int(time.time()),
        "exp": int(time.time()) + APPROVAL_TTL_SECONDS,
        "nonce": secrets.token_urlsafe(10),
    }
    body = base64.urlsafe_b64encode(_canonical(claims)).decode("ascii").rstrip("=")
    signature = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{signature}", review


def verify_material_approval(
    token: str,
    student_id: str,
    resource: dict[str, Any],
) -> tuple[bool, str]:
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return False, "approval_signature_invalid"
        padded = body + "=" * (-len(body) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except Exception:
        return False, "approval_token_invalid"
    if int(claims.get("exp") or 0) < int(time.time()):
        return False, "approval_token_expired"
    if str(claims.get("student_id") or "") != student_id:
        return False, "approval_student_mismatch"
    if not hmac.compare_digest(str(claims.get("digest") or ""), _digest(student_id, resource)):
        return False, "approval_payload_mismatch"
    return True, "approved"


def attach_material_approvals(
    payload: dict[str, Any],
    *,
    student_id: str,
    evidence_context: list[dict[str, Any]],
) -> dict[str, Any]:
    """Attach per-resource markers without ever marking a rejected item ready."""

    result = dict(payload)
    for key in ("summary_resource", "quiz_resource"):
        resource = dict(result.get(key) or {})
        token, review = issue_material_approval(
            student_id,
            resource,
            evidence_context=evidence_context,
        )
        resource["review_approved"] = bool(token)
        resource["approval_token"] = token
        resource["approval"] = review.model_dump(mode="json")
        result[key] = resource
    return result
