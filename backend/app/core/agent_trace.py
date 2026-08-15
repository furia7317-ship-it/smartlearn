"""Public trace payload helpers for agent orchestration.

These helpers intentionally build user-visible execution summaries, not raw
model chain-of-thought. Provider-private reasoning state must stay outside SSE.
"""

from __future__ import annotations

import json
import re
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

TraceKind = Literal[
    "outline",
    "plan",
    "retrieval",
    "generation",
    "review",
    "integration",
    "schedule",
    "reasoning_summary",
    "tool",
]
TraceStatus = Literal[
    "pending",
    "running",
    "rework",
    "completed",
    "failed",
    "blocked",
    "cancelled",
    "error",
]

SCHEMA_VERSION = "2.0"
TERMINAL_STATUSES = frozenset({"completed", "failed", "blocked", "cancelled"})


def _canonical_status(status: str) -> str:
    return "failed" if status == "error" else status


def _stable_span_id(run_id: str, key: str) -> str:
    value = uuid.uuid5(uuid.NAMESPACE_URL, f"smartlearn:{run_id}:{key}").hex
    return f"span_{value[:20]}"


def root_span_id(run_id: str) -> str:
    """Return the stable root span for one run without sharing cross-run state."""

    return _stable_span_id(run_id, "root")


def trace_span_id(run_id: str, key: str) -> str:
    """Return a stable span for a logical operation such as a public phase."""

    return _stable_span_id(run_id, key)


def new_trace_span(run_id: str, *, prefix: str = "operation") -> str:
    """Create a unique span instance, including for repeated same-name tools."""

    return f"span_{prefix}_{uuid.uuid4().hex[:20]}"


@dataclass
class _OpenSpan:
    span_id: str
    parent_span_id: str | None
    agent_id: str
    task_id: str | None
    attempt: int
    action_type: str
    kind: str
    title: str
    phase: str
    started_at: str


@dataclass
class _RunTraceState:
    """Small in-process event sequencer; state is strictly keyed by run_id."""

    run_id: str
    sequence: int = 0
    open_spans: dict[str, _OpenSpan] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)

    def next_sequence(self) -> int:
        self.sequence += 1
        return self.sequence


_RUNS: dict[str, _RunTraceState] = {}
_RUNS_LOCK = threading.RLock()


def _run_state(run_id: str) -> _RunTraceState:
    with _RUNS_LOCK:
        state = _RUNS.get(run_id)
        if state is None:
            state = _RunTraceState(run_id=run_id)
            _RUNS[run_id] = state
        return state


def reset_trace_run(run_id: str) -> None:
    """Forget one completed run. Primarily useful at explicit lifecycle boundaries."""

    with _RUNS_LOCK:
        _RUNS.pop(run_id, None)

_PHASE_BY_KIND: dict[str, str] = {
    "outline": "planning",
    "plan": "planning",
    "retrieval": "retrieval",
    "generation": "generation",
    "review": "review",
    "integration": "integration",
    "schedule": "formatting",
    "reasoning_summary": "summary",
    "tool": "tool",
}

_ACTION_BY_KIND: dict[str, str] = {
    "outline": "梳理任务与资料大纲",
    "plan": "编排参与的智能体",
    "retrieval": "检索课程知识库和上下文",
    "generation": "生成或组织回答内容",
    "review": "检查内容准确性和完整性",
    "integration": "整合已通过审核的内容",
    "schedule": "写入学习路径",
    "reasoning_summary": "思考",
    "tool": "调用工具并读取结果",
}

PHASE_KIND: dict[str, str] = {
    "understanding": "retrieval",
    "planning": "plan",
    "generation": "generation",
    "review": "review",
    "integration": "integration",
    "delivery": "schedule",
}

PHASE_LABEL: dict[str, str] = {
    "understanding": "理解需求",
    "planning": "制定规划",
    "generation": "生成资料",
    "review": "质量审核",
    "integration": "统一整合",
    "delivery": "交付学习路径",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;}]+"),
    re.compile(r"(?i)((?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)[^\s,;}]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"),
)


def _redact_secrets(value: str) -> str:
    redacted = value
    for pattern in _SECRET_PATTERNS:
        redacted = pattern.sub(lambda match: f"{match.group(1) if match.lastindex else ''}[REDACTED]", redacted)
    return redacted


def _structured_summary(value: str) -> str | None:
    """Turn raw tool JSON into a bounded public observation, not a data dump."""

    stripped = value.strip()
    if not stripped or stripped[0] not in "[{":
        return None
    try:
        parsed = json.loads(stripped)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if isinstance(parsed, dict):
        if parsed.get("error"):
            return "工具返回错误，原始错误数据已隐藏"
        keys = [str(key) for key in parsed if str(key).casefold() not in {
            "password", "secret", "token", "access_token", "refresh_token", "api_key", "authorization"
        }]
        return f"工具返回结构化结果，包含字段：{'、'.join(keys[:12]) or '无公开字段'}"
    if isinstance(parsed, list):
        return f"工具返回 {len(parsed)} 项结构化结果"
    return "工具返回结构化结果"


def _compact_public_text(value: str | None, fallback: str) -> str:
    text = _redact_secrets((value or "").strip())
    if not text:
        return fallback
    structured = _structured_summary(text)
    if structured:
        text = structured
    return text[:500]


def _compact_reasoning_text(value: str | None) -> str:
    """Keep a readable provider summary while applying the public redactor."""

    return _redact_secrets((value or "").strip())[:12000]


def _event_type(kind: str, action_type: str) -> str:
    if kind == "reasoning_summary" or action_type == "reasoning":
        return "reasoning"
    if kind == "tool" or action_type == "tool_call":
        return "tool"
    if action_type in {"delegate", "subrun", "handoff"}:
        return "delegate"
    if kind == "review" or action_type in {"review", "verification"}:
        return "verification"
    if action_type in {"result", "delivery"}:
        return "result"
    return "operation"


def _public_tool_policy(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if not value:
        return None
    allowed = {"effect", "destructive", "open_world", "approval"}
    return {str(key): item for key, item in value.items() if str(key) in allowed}


def _public_usage(usage: dict[str, Any] | None) -> dict[str, Any]:
    if not usage:
        return {}
    allowed = {
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "cached_tokens",
        "cost",
        "cost_usd",
    }
    return {
        str(key): value
        for key, value in usage.items()
        if str(key) in allowed and isinstance(value, (int, float))
    }


def _source_label(source_count: int | None) -> str:
    if source_count is None:
        return "现有上下文"
    return f"{source_count} 处知识库来源"


def _fallback_narrative(
    *,
    kind: str,
    title: str,
    status: str,
    detail: str | None,
    source_count: int | None,
) -> str:
    """Return safe, public process copy instead of private model reasoning."""

    sources = _source_label(source_count)
    if kind == "outline":
        if status == "completed":
            return "学习范围已拆成可执行章节，后续资源会按章节推进，而不是一次性堆材料。"
        return "我会先确认学习目标、时间和章节范围，避免直接生成一批没有节奏的资料。"
    if kind == "plan":
        return f"我会根据章节目标和{sources}判断需要哪些资源类型，再决定哪些 agent 参与。"
    if kind == "retrieval":
        return f"我会先把可用资料和{sources}核出来，后面的讲解、练习和路径都要围绕这些依据。"
    if kind == "generation":
        if status == "rework":
            return "我会按审核意见重做这一项资源，优先修正不准确、不完整或不够可操作的部分。"
        return "我会把章节目标、知识库参考和个性化要求合在一起，生成能直接学习的内容。"
    if kind == "review":
        return f"我会把生成内容和{sources}对照，先拦掉不准确、解释不清或缺少依据的材料。"
    if kind == "integration":
        return "我会把通过审核的材料按章节合并，避免资源卡片散落成一堆。"
    if kind == "schedule":
        return "我会把资源排进每天的学习步骤，让今天该学什么、练什么、复盘什么都明确。"
    if kind == "reasoning_summary":
        return detail or "模型返回了一段公开推理摘要，用来解释本次生成取舍。"
    if kind == "tool":
        return detail or "我会调用必要工具读取上下文或生成中间结果。"
    return detail or title


def _fallback_activity(*, kind: str, status: str, source_count: int | None) -> str:
    kind_labels = {
        "outline": "梳理大纲",
        "plan": "编排任务",
        "retrieval": "检索依据",
        "generation": "生成资源",
        "review": "审核资源",
        "integration": "整合资源",
        "schedule": "写入路径",
        "reasoning_summary": "记录摘要",
        "tool": "调用工具",
    }
    status_labels = {
        "pending": "等待",
        "running": "正在",
        "completed": "已完成",
        "failed": "执行失败",
        "error": "执行失败",
        "blocked": "已阻断",
        "cancelled": "已取消",
        "rework": "返工",
    }
    prefix = status_labels.get(status, status)
    label = kind_labels.get(kind, kind)
    source_text = f" · 引用 {source_count} 处" if source_count is not None else ""
    if status == "running":
        return f"{prefix}{label}{source_text}"
    return f"{prefix}{label}{source_text}"


def make_trace_payload(
    *,
    run_id: str,
    step: int | None = None,
    agent: str,
    kind: TraceKind | str,
    title: str,
    status: TraceStatus | str,
    detail: str | None = None,
    phase: str | None = None,
    input_summary: str | None = None,
    action: str | None = None,
    observation: str | None = None,
    decision_summary: str | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
    chapter_id: str | None = None,
    source_count: int | None = None,
    response_id: str | None = None,
    usage: dict[str, Any] | None = None,
    narrative: str | None = None,
    activity: str | None = None,
    span_id: str | None = None,
    span_key: str | None = None,
    parent_span_id: str | None = None,
    task_id: str | None = None,
    attempt: int = 1,
    action_type: str | None = None,
    evidence_ids: list[str] | None = None,
    error_code: str | None = None,
    retryable: bool | None = None,
    event_type: str | None = None,
    reasoning_text: str | None = None,
    reasoning_delta: str | None = None,
    reasoning_source: str | None = None,
    segment_index: int | None = None,
    visibility: str = "normal",
    tool_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build one run-scoped public event with canonical and UI-compatible fields.

    The canonical fields deliberately contain summaries, not prompts, provider
    chain-of-thought, or raw tool JSON. Callers must pass the same ``span_id``
    for a start/terminal pair. Repeated operation instances should call
    :func:`new_trace_span` so they never collapse into a same-name span.
    """

    canonical_status = _canonical_status(str(status))
    public_narrative = _compact_public_text(narrative or _fallback_narrative(
        kind=str(kind),
        title=title,
        status=canonical_status,
        detail=detail,
        source_count=source_count,
    ), title)
    public_activity = _compact_public_text(activity or _fallback_activity(
        kind=str(kind),
        status=canonical_status,
        source_count=source_count,
    ), title)
    resolved_phase = phase or _PHASE_BY_KIND.get(str(kind), "execution")
    resolved_action_type = str(action_type or kind)
    resolved_span_id = span_id or (
        trace_span_id(run_id, span_key) if span_key else new_trace_span(run_id)
    )
    if parent_span_id is None and resolved_span_id != root_span_id(run_id):
        parent_span_id = root_span_id(run_id)

    state = _run_state(run_id)
    with state.lock:
        timestamp = _now_iso()
        open_span = state.open_spans.get(resolved_span_id)
        resolved_started_at = (
            started_at
            or (open_span.started_at if open_span is not None else None)
            or timestamp
        )
        resolved_ended_at = (
            ended_at or timestamp if canonical_status in TERMINAL_STATUSES else None
        )
        sequence = state.next_sequence()
        if canonical_status in TERMINAL_STATUSES:
            state.open_spans.pop(resolved_span_id, None)
        else:
            state.open_spans[resolved_span_id] = _OpenSpan(
                span_id=resolved_span_id,
                parent_span_id=parent_span_id,
                agent_id=agent,
                task_id=task_id,
                attempt=max(1, int(attempt or 1)),
                action_type=resolved_action_type,
                kind=str(kind),
                title=title,
                phase=resolved_phase,
                started_at=resolved_started_at,
            )

    safe_input = _compact_public_text(input_summary, "") if input_summary else ""
    safe_action = _compact_public_text(
        action or public_activity,
        _ACTION_BY_KIND.get(str(kind), title),
    )
    safe_observation = _compact_public_text(observation or detail, title)
    safe_decision = _compact_public_text(decision_summary or public_narrative, title)
    safe_detail = _compact_public_text(detail, title) if detail else ""
    public_usage = _public_usage(usage)

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "event_id": f"evt_{uuid.uuid4().hex}",
        "sequence": sequence,
        "span_id": resolved_span_id,
        "parent_span_id": parent_span_id,
        "agent_id": agent,
        "task_id": task_id,
        "attempt": max(1, int(attempt or 1)),
        "event_type": event_type or _event_type(str(kind), resolved_action_type),
        "action_type": resolved_action_type,
        "input_summary": safe_input,
        "observation_summary": safe_observation,
        "decision_summary": safe_decision,
        "evidence_ids": [str(item)[:160] for item in (evidence_ids or [])[:32]],
        "started_at": resolved_started_at,
        "ended_at": resolved_ended_at,
        "usage": public_usage,
        "error_code": str(error_code)[:120] if error_code else None,
        "retryable": retryable,
        "reasoning_text": _compact_reasoning_text(reasoning_text) or None,
        "reasoning_delta": _compact_reasoning_text(reasoning_delta)[:2000] or None,
        "reasoning_source": str(reasoning_source)[:40] if reasoning_source else None,
        "segment_index": max(0, int(segment_index)) if segment_index is not None else None,
        "visibility": visibility if visibility in {"normal", "verbose", "summary"} else "normal",
        "tool_policy": _public_tool_policy(tool_policy),
        # Compatibility aliases used by the current desktop trace renderer.
        "agent": agent,
        "kind": kind,
        "title": title,
        "status": canonical_status,
        "phase": resolved_phase,
        "action": safe_action,
        "observation": safe_observation,
        "decisionSummary": safe_decision,
        "startedAt": resolved_started_at,
        "endedAt": resolved_ended_at,
        "narrative": public_narrative,
        "activity": public_activity,
    }
    payload["step"] = step if step is not None else sequence
    if input_summary:
        payload["inputSummary"] = safe_input
    if detail:
        payload["detail"] = safe_detail
    if chapter_id:
        payload["chapter_id"] = chapter_id
    if source_count is not None:
        payload["source_count"] = source_count
    if response_id:
        payload["response_id"] = response_id
    return payload


def trace_event(**kwargs: Any) -> dict[str, Any]:
    """Build a LangGraph custom stream event for the frontend trace panel."""

    return {"event": "trace", **make_trace_payload(**kwargs)}


def start_trace_run(
    run_id: str,
    *,
    agent: str = "orchestrator",
    title: str = "开始执行",
    input_summary: str | None = None,
) -> dict[str, Any]:
    """Start a clean run root; a reused run ID never inherits old events."""

    reset_trace_run(run_id)
    return trace_event(
        run_id=run_id,
        agent=agent,
        kind="plan",
        action_type="run",
        title=title,
        status="running",
        input_summary=input_summary,
        span_id=root_span_id(run_id),
        parent_span_id=None,
        decision_summary="本次运行只记录真实动作、公开摘要和可核验证据。",
    )


def finish_trace_run(
    run_id: str,
    *,
    status: Literal["completed", "failed", "blocked", "cancelled"],
    observation: str = "",
    error_code: str | None = None,
    retryable: bool | None = None,
) -> list[dict[str, Any]]:
    """Terminalize every open span, with the run root emitted last."""

    state = _run_state(run_id)
    with state.lock:
        open_spans = list(state.open_spans.values())
    root_id = root_span_id(run_id)
    open_spans.sort(key=lambda item: item.span_id == root_id)
    events: list[dict[str, Any]] = []
    for item in open_spans:
        events.append(
            trace_event(
                run_id=run_id,
                agent=item.agent_id,
                kind=item.kind,
                action_type="run" if item.span_id == root_id else item.action_type,
                title=(
                    "运行完成" if item.span_id == root_id and status == "completed"
                    else "运行终止" if item.span_id == root_id
                    else item.title
                ),
                status=status,
                phase=item.phase,
                span_id=item.span_id,
                parent_span_id=item.parent_span_id,
                task_id=item.task_id,
                attempt=item.attempt,
                started_at=item.started_at,
                observation=observation or (
                    "运行已完成" if status == "completed" else f"运行以 {status} 终止"
                ),
                error_code=error_code,
                retryable=retryable,
            )
        )
    if not any(item.span_id == root_id for item in open_spans):
        events.append(
            trace_event(
                run_id=run_id,
                agent="orchestrator",
                kind="plan",
                action_type="run",
                title="运行完成" if status == "completed" else "运行终止",
                status=status,
                span_id=root_id,
                parent_span_id=None,
                observation=observation or f"运行以 {status} 终止",
                error_code=error_code,
                retryable=retryable,
            )
        )
    reset_trace_run(run_id)
    return events


def phase_trace_event(
    *,
    run_id: str,
    phase: str,
    status: str,
    detail: str = "",
    progress: int | None = None,
) -> dict[str, Any]:
    """Create an upsertable public phase event with a stable phase ID."""

    if phase not in PHASE_KIND:
        raise ValueError(f"未知公开阶段：{phase}")
    payload = trace_event(
        run_id=run_id,
        agent="orchestrator",
        kind=PHASE_KIND[phase],
        title=PHASE_LABEL[phase],
        status=status,
        detail=detail,
        phase=phase,
        span_id=trace_span_id(run_id, f"phase:{phase}"),
        parent_span_id=root_span_id(run_id),
        action_type="phase",
    )
    payload["id"] = f"{run_id}:phase:{phase}"
    if progress is not None:
        payload["progress"] = max(0, min(100, progress))
    return payload
