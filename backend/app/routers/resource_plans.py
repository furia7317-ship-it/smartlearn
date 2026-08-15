"""Planning API for editable, owner-scoped resource generation."""

from __future__ import annotations

import asyncio
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db, settings
from app.core.agent_trace import finish_trace_run, start_trace_run
from app.core.sse import astream_via_thread, sse_format
from app.core.run_control import (
    RunCancelled,
    acknowledge_run_cancel,
    is_run_cancelled,
    run_is_registered,
    release_run,
    request_run_cancel,
)
from app.graph.planned_resource_graph import build_planned_state, planned_resource_app
from app.routers.auth import require_account_student_scope
from app.routers.custom_agents import load_custom_agent_definitions
from app.schemas.resource import ResourceRequest
from app.schemas.resource_plan import (
    PlanActionRequest,
    PlanArtifact,
    PlanExecuteRequest,
    PlanRecordResponse,
    TaskReview,
    PlanUpdateRequest,
)
from app.services.resource_plan_builder import (
    PlanBuildError,
    bind_plan_task_sources,
    build_resource_plan,
)
from app.services.resource_plan_store import (
    PlanNotFoundError,
    PlanStateError,
    PlanVersionError,
    cancel_record,
    claim_execution,
    create_record,
    get_owned_plan,
    replace_with_replan,
    require_current_version,
    to_response,
    update_artifact,
)
from app.services.resource_planning import (
    analyze_request,
    classify_complexity,
    normalize_plan_task_types,
    validate_plan,
)
from app.services.resource_quality import review_blocking_issues
from app.services.learning_baseline import require_learning_baseline
from app.services.knowledge_gate import KnowledgeGateResult, check_knowledge_gate
from app.services.media.task import ensure_video_render_tasks
from app.schemas.resource import LearningBaseline

router = APIRouter(dependencies=[Depends(require_account_student_scope)])
RESOURCE_PLAN_MAX_CONCURRENCY = min(30, max(1, settings.AGENT_MAX_CONCURRENCY))
MISSING_TASK_REVIEW_REASON = "任务未产生可审核资料"

_PUBLIC_TYPE_LABELS = {
    "explainer": "讲义",
    "mindmap": "思维导图",
    "quiz": "练习题",
    "reading": "拓展阅读",
    "code": "代码演示",
    "video": "讲解视频",
    "courseware": "课件",
    "interactive": "交互演示",
}


def _stream_text_chunks(text: str, size: int = 24) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)]


def load_plan_context(student_id: str, topic: str | None) -> tuple[dict, list[dict]]:
    """Load profile and RAG snippets behind one injectable sync seam."""

    from app.agents.profiler import get_profile
    try:
        profile = get_profile(student_id) or {}
    except Exception:
        profile = {}
    if topic is None:
        return profile, []
    from app.services.rag import retrieve
    try:
        kb_context = retrieve(topic, "", 10) or []
    except Exception:
        kb_context = []
    return profile, kb_context


def _request_text(req: ResourceRequest) -> str:
    parts = [req.topic, req.requirements, req.knowledge_points, req.assessment_context]
    return "\n".join(part.strip() for part in parts if part and part.strip())


def _is_learning_path(req: ResourceRequest, request_text: str) -> bool:
    return req.planning_mode == "learning_path" or bool(analyze_request(request_text)["multi_day_intent"])


def _require_knowledge(query: str, student_id: str) -> KnowledgeGateResult:
    result = check_knowledge_gate(query, student_id, 10)
    if result.matched:
        return result
    status_code = 503 if result.status == "kb_unavailable" else 409
    raise HTTPException(status_code=status_code, detail=result.error_payload())


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PlanNotFoundError):
        return HTTPException(status_code=404, detail="规划不存在")
    if isinstance(exc, (PlanVersionError, PlanStateError)):
        return HTTPException(status_code=409, detail=str(exc))
    raise exc


async def _owned(db: AsyncSession, plan_id: str, student_id: str):
    try:
        row = await get_owned_plan(db, plan_id, student_id)
    except PlanNotFoundError as exc:
        raise _http_error(exc) from exc
    # A worker reload/crash can leave a durable row marked running although
    # the process-local run registry no longer owns it.  Recover immediately
    # to a resumable checkpoint instead of making the learner wait for a
    # timeout that can never complete.
    if row.status == "running":
        execution = dict(row.execution_state or {})
        trace_run_id = str(execution.get("trace_run_id") or "")
        if trace_run_id and not run_is_registered(trace_run_id):
            plan = PlanArtifact.model_validate(row.artifact)
            if _execution_snapshot_is_fully_ready(plan, execution):
                execution, _ = _terminalize_execution(plan, execution)
                plan.status = "completed"
                row.status = "completed"
                row.execution_state = execution
                row.last_error = ""
            else:
                plan.status = "approved"
                reviews = dict(execution.get("reviews") or {})
                for task in plan.tasks:
                    review = dict(reviews.get(task.task_id) or {})
                    task.status = "ready" if review.get("approved") else "pending"
                    task.review = TaskReview.model_validate(review) if review.get("approved") else None
                row.status = "approved"
                row.last_error = "上次执行进程已中断，成功资料已保留，正在继续失败项"
            row.artifact = plan.model_dump(mode="json")
            await db.commit()
            await db.refresh(row)
    return row


def _execution_snapshot_is_fully_ready(plan: PlanArtifact, execution: dict) -> bool:
    """Recognize a successful graph snapshot even if its iterator never closes."""
    task_ids = {task.task_id for task in plan.tasks}
    if not task_ids:
        return False
    coverage = dict(execution.get("coverage") or {})
    ready_ids = {str(item) for item in coverage.get("ready_task_ids") or []}
    reviews = dict(execution.get("reviews") or {})
    return (
        coverage.get("complete") is True
        and not coverage.get("missing_task_ids")
        and not coverage.get("failed_task_ids")
        and task_ids.issubset(ready_ids)
        and all(dict(reviews.get(task_id) or {}).get("approved") is True for task_id in task_ids)
    )


def _successful_values_chunk(chunk) -> bool:
    if not isinstance(chunk, tuple) or len(chunk) != 2 or chunk[0] != "values":
        return False
    payload = chunk[1]
    if not isinstance(payload, dict):
        return False
    plan_payload = payload.get("plan") or {}
    try:
        plan = PlanArtifact.model_validate(plan_payload)
    except Exception:
        return False
    schedule = payload.get("schedule")
    schedule_complete = (
        isinstance(schedule, list)
        and len(schedule) > 0
        and len(schedule) == len(plan.days)
    )
    # Coverage becomes complete one graph node before integration. Stopping on
    # that earlier snapshot marks the plan completed but loses the durable
    # daily schedule, so the path page cannot restore it after navigation.
    return schedule_complete and _execution_snapshot_is_fully_ready(plan, payload)


@router.post("/resource-plans", response_model=PlanRecordResponse)
async def create_plan(
    req: ResourceRequest,
    db: AsyncSession = Depends(get_db),
) -> PlanRecordResponse:
    request_text = _request_text(req)
    baseline = require_learning_baseline(req.learning_baseline) if _is_learning_path(req, request_text) else None
    gate = await asyncio.to_thread(_require_knowledge, req.topic, req.student_id)
    profile, kb_context = await asyncio.to_thread(
        load_plan_context,
        req.student_id,
        None,
    )
    kb_context = gate.context
    try:
        plan = await asyncio.to_thread(
            build_resource_plan,
            request_text=request_text,
            student_id=req.student_id,
            profile=profile,
            kb_context=kb_context,
            learner_context=baseline.model_dump(mode="json") if baseline else None,
            learning_path_preferences=(
                req.learning_path_preferences.model_dump(mode="json")
                if req.learning_path_preferences
                else None
            ),
            continuous_retry=_is_learning_path(req, request_text),
        )
    except PlanBuildError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.payload()) from exc

    plan.student_id = req.student_id
    row = await create_record(db, plan, request_text)
    return to_response(row)


@router.get("/resource-plans/{plan_id}", response_model=PlanRecordResponse)
async def get_plan(
    plan_id: str,
    student_id: str,
    db: AsyncSession = Depends(get_db),
) -> PlanRecordResponse:
    return to_response(await _owned(db, plan_id, student_id))


@router.patch("/resource-plans/{plan_id}", response_model=PlanRecordResponse)
async def update_plan(
    plan_id: str,
    req: PlanUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> PlanRecordResponse:
    row = await _owned(db, plan_id, req.student_id)
    try:
        require_current_version(row, req.version)
        plan = PlanArtifact.model_validate(row.artifact)
        plan.days = req.days
        plan.tasks = req.tasks
        plan.constraints = req.constraints
        plan = normalize_plan_task_types(plan)
        plan.complexity = classify_complexity(row.request_text, plan)
        plan.validation = validate_plan(plan)
        if not plan.validation.valid:
            raise HTTPException(
                status_code=422,
                detail=plan.validation.model_dump(mode="json"),
            )
        row = await update_artifact(db, row, plan, req.version)
    except (PlanVersionError, PlanStateError) as exc:
        raise _http_error(exc) from exc
    return to_response(row)


@router.post("/resource-plans/{plan_id}/replan", response_model=PlanRecordResponse)
async def replan(
    plan_id: str,
    req: PlanActionRequest,
    db: AsyncSession = Depends(get_db),
) -> PlanRecordResponse:
    row = await _owned(db, plan_id, req.student_id)
    try:
        require_current_version(row, req.version)
        request_text = row.request_text
        if req.feedback.strip():
            request_text = f"{request_text}\n用户重规划意见：{req.feedback.strip()}"
        existing = PlanArtifact.model_validate(row.artifact).learner_context
        existing_plan = PlanArtifact.model_validate(row.artifact)
        baseline = LearningBaseline.model_validate(req.learning_baseline or existing) if (req.learning_baseline or existing) else None
        if bool(analyze_request(request_text)["multi_day_intent"]):
            baseline = require_learning_baseline(baseline)
        gate = await asyncio.to_thread(_require_knowledge, request_text.splitlines()[0], row.student_id)
        profile, _ = await asyncio.to_thread(
            load_plan_context,
            row.student_id,
            None,
        )
        kb_context = gate.context
        plan = await asyncio.to_thread(
            build_resource_plan,
            request_text=request_text,
            student_id=row.student_id,
            profile=profile,
            kb_context=kb_context,
            learner_context=baseline.model_dump(mode="json") if baseline else None,
            learning_path_preferences=existing_plan.learning_path_preferences,
            plan_id=row.id,
        )
        row = await replace_with_replan(db, row, plan, req.version)
    except PlanBuildError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.payload()) from exc
    except (PlanVersionError, PlanStateError) as exc:
        raise _http_error(exc) from exc
    return to_response(row)


@router.post("/resource-plans/{plan_id}/cancel", response_model=PlanRecordResponse)
async def cancel_plan(
    plan_id: str,
    req: PlanActionRequest,
    db: AsyncSession = Depends(get_db),
) -> PlanRecordResponse:
    row = await _owned(db, plan_id, req.student_id)
    trace_run_id = str((row.execution_state or {}).get("trace_run_id") or "")
    try:
        row = await cancel_record(db, row, req.version)
    except (PlanVersionError, PlanStateError) as exc:
        raise _http_error(exc) from exc
    request_run_cancel(trace_run_id)
    return to_response(row)


def _execution_snapshot(state: dict) -> dict:
    candidate_resources = list(state.get("resources") or [])
    reviews = dict(state.get("reviews") or {})
    approved_candidates: dict[str, dict] = {}
    for resource in candidate_resources:
        task_id = str(resource.get("task_id") or "")
        review = dict(reviews.get(task_id) or {})
        if not task_id or not review.get("approved"):
            continue
        if int(resource.get("retry_count") or 0) != int(review.get("retry_count") or 0):
            continue
        approved_candidates[task_id] = resource
    # The durable execution snapshot is the publication boundary: rejected
    # candidates remain in transient graph state and audit events, never in the
    # resource payload consumed by the resource center.
    resources = list(approved_candidates.values())
    task_progress = {}
    for resource in resources:
        task_id = str(resource.get("task_id") or "")
        if not task_id:
            continue
        review = reviews.get(task_id)
        resource_retry = int(resource.get("retry_count") or 0)
        review_retry = int((review or {}).get("retry_count") or 0)
        if review and review.get("approved"):
            status = "ready"
        elif review and review.get("terminal") is True:
            status = "failed"
        elif review and resource_retry <= review_retry:
            # The review failed but is still eligible for the graph's bounded
            # repair loop.  Persist it as in-flight so refreshes do not turn a
            # rework into a premature terminal failure in the UI.
            status = "rework"
        else:
            status = "generated"
        task_progress[task_id] = {"status": status, "review": review}
    for task_id, review in reviews.items():
        if task_id in task_progress:
            continue
        task_progress[task_id] = {
            "status": "failed" if review.get("terminal") is True else "rework",
            "review": review,
        }
    return {
        "resources": resources,
        "schedule": list(state.get("schedule") or []),
        "task_progress": task_progress,
        "coverage": dict(state.get("coverage") or {}),
        "integration": dict(state.get("integration") or {}),
        "reviews": reviews,
        "repair_task_ids": list(state.get("repair_task_ids") or []),
        "retry_round": int(state.get("retry_round") or 0),
        "trace_run_id": str(state.get("trace_run_id") or ""),
    }


def _terminalize_execution(
    plan: PlanArtifact,
    execution: dict,
) -> tuple[dict, list[str]]:
    resources = list(execution.get("resources") or [])
    generated_ids = {
        str(resource.get("task_id"))
        for resource in resources
        if resource.get("task_id")
    }
    reviews = dict(execution.get("reviews") or {})
    existing_progress = dict(execution.get("task_progress") or {})
    task_progress: dict[str, dict] = {}
    failure_reasons: list[str] = []

    for task in plan.tasks:
        has_resource = task.task_id in generated_ids
        review = dict(reviews.get(task.task_id) or {})
        approved = has_resource and bool(review.get("approved"))
        issues = [str(issue) for issue in review.get("issues") or []]
        blocking_issues = review_blocking_issues(review)
        blocking_fingerprints = [str(item) for item in review.get("blocking_fingerprints") or []]
        repeated_fingerprints = [str(item) for item in review.get("repeated_fingerprints") or []]
        repair_history_fingerprints = [
            str(item) for item in review.get("repair_history_fingerprints") or []
        ]
        repair_instructions = list(review.get("repair_instructions") or [])
        warnings = [str(warning) for warning in review.get("warnings") or []]
        fixes = [str(fix) for fix in review.get("fixes") or []]
        if not approved and not issues:
            issues = [
                MISSING_TASK_REVIEW_REASON
                if not has_resource or not review
                else "任务未通过质量审核"
            ]
            blocking_issues = list(issues)
        if not approved and not fixes:
            fixes = ["请重试该资料"]
        retry_count = int(review.get("retry_count") or 0)
        if not approved:
            retry_count = max(1, retry_count)
        gate_status = str(
            review.get("gate_status")
            or ("approved" if approved else "rejected")
        )
        if gate_status == "blocked":
            gate_status = "review_unavailable"
        normalized_review = {
            "approved": approved,
            "score": float(review.get("score") or 0.0) if has_resource else 0.0,
            "issues": issues,
            "blocking_issues": blocking_issues,
            "blocking_fingerprints": blocking_fingerprints,
            "repeated_fingerprints": repeated_fingerprints,
            "repair_history_fingerprints": repair_history_fingerprints,
            "warnings": warnings,
            "fixes": fixes,
            "repair_instructions": repair_instructions,
            "retry_count": retry_count,
            "gate_status": gate_status,
            "evidence_ids": list(review.get("evidence_ids") or []),
            "claim_evidence": list(review.get("claim_evidence") or []),
            "failure_kind": review.get("failure_kind"),
            "error_code": review.get("error_code"),
            "retryable": bool(review.get("retryable", False if not approved else True)),
            "terminal": bool(review.get("terminal", not approved)),
            "review_attempt": int(review.get("review_attempt") or 0),
            "service_recoverable": bool(review.get("service_recoverable", True)),
            "error_fingerprint": str(review.get("error_fingerprint") or ""),
            "consecutive_fingerprint_count": int(
                review.get("consecutive_fingerprint_count") or 0
            ),
        }
        reviews[task.task_id] = normalized_review
        task.review = TaskReview.model_validate(normalized_review)
        task.retry_count = retry_count
        task.status = "ready" if approved else "failed"
        task_progress[task.task_id] = {
            **dict(existing_progress.get(task.task_id) or {}),
            "status": task.status,
            "review": normalized_review,
        }
        if not approved:
            details = [*blocking_issues, *warnings] or issues
            failure_reasons.append("；".join(dict.fromkeys(details)))

    execution = {
        **execution,
        "resources": [
            resource
            for resource in resources
            if reviews.get(str(resource.get("task_id") or ""), {}).get("approved")
        ],
        "reviews": reviews,
        "task_progress": task_progress,
    }
    return execution, failure_reasons


def _compose_last_error(
    failure_reasons: list[str],
    *global_messages: str,
) -> str:
    parts: list[str] = []
    for item in [*failure_reasons, *global_messages]:
        text = str(item).strip()
        if text and text not in parts:
            parts.append(text)
    return "；".join(parts)[:1000]


def _prepare_failed_retry(plan: PlanArtifact, execution: dict) -> tuple[PlanArtifact, dict]:
    reviews = dict(execution.get("reviews") or {})
    approved_ids = {
        task_id for task_id, review in reviews.items() if review.get("approved")
    }
    resources = [
        resource
        for resource in execution.get("resources") or []
        if str(resource.get("task_id") or "") in approved_ids
    ]
    for task in plan.tasks:
        if task.task_id in approved_ids:
            task.status = "ready"
            continue
        task.status = "pending"
        task.review = None
        task.retry_count = 0
    fresh_execution = {
        key: value
        for key, value in execution.items()
        if key not in {"trace_run_id", "run_started_at", "retry_policy"}
    }
    return plan, {
        **fresh_execution,
        "resources": resources,
        "reviews": {
            task_id: review for task_id, review in reviews.items() if task_id in approved_ids
        },
        "task_progress": {
            task_id: progress
            for task_id, progress in (execution.get("task_progress") or {}).items()
            if task_id in approved_ids
        },
        "schedule": [],
        "coverage": {},
        "integration": {},
        "repair_task_ids": [],
        "retry_round": 0,
    }


async def _rollback_safely(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception:
        pass


async def _persist_failed_execution(
    db: AsyncSession,
    row_model,
    row_id: str,
    execution_snapshot: dict,
    global_message: str,
) -> None:
    await _rollback_safely(db)
    try:
        recovered = await db.get(row_model, row_id)
        if recovered is None:
            return
        plan = PlanArtifact.model_validate(recovered.artifact)
        execution, failure_reasons = _terminalize_execution(
            plan,
            {
                **dict(recovered.execution_state or {}),
                **dict(execution_snapshot or {}),
            },
        )
        plan.status = "failed"
        recovered.status = "failed"
        recovered.artifact = plan.model_dump(mode="json")
        recovered.execution_state = execution
        recovered.last_error = _compose_last_error(failure_reasons, global_message)
        await db.commit()
    except Exception:
        await _rollback_safely(db)


async def _persist_resumable_execution(
    db: AsyncSession,
    row_model,
    row_id: str,
    execution_snapshot: dict,
    message: str,
) -> None:
    """Keep checkpoints runnable when transport or orchestration is interrupted."""

    await _rollback_safely(db)
    try:
        recovered = await db.get(row_model, row_id)
        if recovered is None:
            return
        await db.refresh(recovered)
        if recovered.status == "cancelled":
            return
        plan = PlanArtifact.model_validate(recovered.artifact)
        plan.status = "approved"
        for task in plan.tasks:
            review = dict((execution_snapshot.get("reviews") or {}).get(task.task_id) or {})
            task.status = "ready" if review.get("approved") else "pending"
            task.review = TaskReview.model_validate(review) if review.get("approved") else None
            task.retry_count = int(review.get("retry_count") or 0)
        recovered.status = "approved"
        recovered.artifact = plan.model_dump(mode="json")
        recovered.execution_state = {
            **dict(recovered.execution_state or {}),
            **dict(execution_snapshot or {}),
        }
        retry_reasons: list[str] = []
        for review in (execution_snapshot.get("reviews") or {}).values():
            review_reasons = review_blocking_issues(dict(review or {}))
            retry_reasons.extend(
                review_reasons
                or [str(item) for item in (review or {}).get("issues") or []]
            )
        recovered.last_error = _compose_last_error(retry_reasons, message)
        await db.commit()
    except Exception:
        await _rollback_safely(db)


async def _raise_if_plan_was_cancelled(
    db: AsyncSession,
    row,
    trace_run_id: str,
) -> None:
    """Stop terminal persistence when the durable plan or run was cancelled.

    The graph runs in a worker thread while the cancel endpoint uses another
    request/session in production.  A cancellation can therefore land after
    the graph's last checkpoint but before this coroutine writes ``completed``
    or ``failed``.  Refreshing the durable status closes that race and keeps
    ``cancelled`` authoritative.
    """

    if is_run_cancelled(trace_run_id):
        raise RunCancelled(f"run {trace_run_id} was cancelled")
    await db.refresh(row, attribute_names=["status", "artifact", "version"])
    if row.status == "cancelled":
        request_run_cancel(trace_run_id)
        raise RunCancelled(f"plan {row.id} was cancelled")


async def _commit_terminal_execution(
    db: AsyncSession,
    row,
    *,
    trace_run_id: str,
    status: str,
    artifact: dict,
    execution_state: dict,
    last_error: str,
) -> None:
    """Atomically terminalize only a record that is still running.

    The status predicate is the final guard against a cancel request racing the
    last graph event. A winning cancellation is surfaced as ``RunCancelled``
    so the SSE contract remains cancelled instead of emitting a false failure.
    """

    await _raise_if_plan_was_cancelled(db, row, trace_run_id)
    row_model = type(row)
    result = await db.execute(
        update(row_model)
        .where(
            row_model.id == row.id,
            row_model.student_id == row.student_id,
            row_model.version == row.version,
            row_model.status == "running",
        )
        .values(
            status=status,
            artifact=artifact,
            execution_state=execution_state,
            last_error=last_error,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await db.rollback()
        current = await db.get(row_model, row.id, populate_existing=True)
        if current is not None and current.status == "cancelled":
            request_run_cancel(trace_run_id)
            raise RunCancelled(f"plan {row.id} was cancelled")
        raise RuntimeError("resource plan left running state before terminal persistence")
    await db.commit()
    await db.refresh(row)


async def stream_and_persist_planned_execution(graph, state, row, db: AsyncSession):
    from app.services.agent_run_store import persist_stream_event

    row_id = str(row.id)
    owner_id = str(row.student_id)
    row_model = type(row)
    latest_execution = dict(row.execution_state or {})
    pending_done: dict | None = None
    try:
        start_event = start_trace_run(
            state["trace_run_id"],
            agent="supervisor",
            title="开始执行资料规划",
            input_summary=str((state.get("plan") or {}).get("request_summary") or "")[:240],
        )
        start_event.pop("event", None)
        await persist_stream_event("trace", start_event, owner_id=owner_id)
        yield sse_format("trace", start_event)
        profile, _ = await asyncio.to_thread(
            load_plan_context,
            owner_id,
            None,
        )
        state["profile"] = profile
        async for chunk in astream_via_thread(
            graph,
            state,
            ["custom", "values"],
            config={
                "max_concurrency": RESOURCE_PLAN_MAX_CONCURRENCY,
                "recursion_limit": 256,
            },
            stop_when=_successful_values_chunk,
            stop_grace_seconds=1.0,
        ):
            mode, payload = chunk if isinstance(chunk, tuple) and len(chunk) == 2 else ("custom", chunk)
            if mode == "values" and isinstance(payload, dict):
                latest_execution = _execution_snapshot(payload)
                row.execution_state = latest_execution
                await db.commit()
                continue
            if mode == "custom" and isinstance(payload, dict):
                event = str(payload.get("event") or "message")
                if event == "done":
                    pending_done = payload
                    continue
                if event == "content":
                    # Candidates are private audit input until their matching
                    # review approves them. The final persisted snapshot is the
                    # source of truth for the resource centre; chat receives a
                    # single delivery summary instead of every resource body.
                    continue
                await persist_stream_event(event, payload, owner_id=owner_id)
                yield sse_format(event, payload)

        plan = PlanArtifact.model_validate(row.artifact)
        latest_execution["resources"] = ensure_video_render_tasks(
            list(latest_execution.get("resources") or []),
            student_id=owner_id,
        )
        execution, failure_reasons = _terminalize_execution(
            plan,
            latest_execution,
        )
        latest_execution = execution
        plan.status = (
            "completed"
            if plan.tasks and all(task.status == "ready" for task in plan.tasks)
            else "failed"
        )
        last_error = _compose_last_error(failure_reasons)
        await _commit_terminal_execution(
            db,
            row,
            trace_run_id=state["trace_run_id"],
            status=plan.status,
            artifact=plan.model_dump(mode="json"),
            execution_state=execution,
            last_error=last_error,
        )
        final_status = "completed" if plan.status == "completed" else "failed"
        for event in finish_trace_run(
            state["trace_run_id"],
            status=final_status,
            observation=(
                "资料规划执行完成"
                if final_status == "completed"
                else row.last_error or "部分资料未通过审核"
            ),
            error_code=None if final_status == "completed" else "resource_review_failed",
            retryable=final_status != "completed",
        ):
            event.pop("event", None)
            await persist_stream_event("trace", event, owner_id=owner_id)
            yield sse_format("trace", event)
        if final_status == "completed":
            result_text = (
                f"学习路径已生成完成：{len(plan.days)} 天、{len(plan.tasks)} 份资料全部通过审核，"
                "已更新到学习路径和资源中心。"
            )
            yield sse_format("result_start", {"plan_id": row_id})
            for delta in _stream_text_chunks(result_text):
                yield sse_format(
                    "result_delta",
                    {"plan_id": row_id, "delta": delta},
                )
                await asyncio.sleep(0.015)
            yield sse_format(
                "result",
                {"plan_id": row_id, "text": result_text},
            )
        yield sse_format(
            "done",
            {
                **(pending_done or {}),
                "run_id": state["trace_run_id"],
                "status": final_status,
                "completed": final_status == "completed",
                "error_code": None if final_status == "completed" else "resource_review_failed",
                "retryable": final_status != "completed",
            },
        )
    except asyncio.CancelledError:
        request_run_cancel(str(state.get("trace_run_id") or ""))
        for event in finish_trace_run(
            state["trace_run_id"],
            status="cancelled",
            observation="SSE 连接中断，已停止后续模型调用",
            error_code="client_disconnected",
            retryable=True,
        ):
            event.pop("event", None)
            await persist_stream_event("trace", event, owner_id=owner_id)
        await _persist_resumable_execution(
            db,
            row_model,
            row_id,
            latest_execution,
            "SSE 连接中断，已保留成功部分并等待自动续跑",
        )
        raise
    except RunCancelled:
        await _rollback_safely(db)
        for event in finish_trace_run(
            state["trace_run_id"],
            status="cancelled",
            observation="用户已取消资料执行，后续模型调用已停止",
            error_code="cancelled_by_user",
            retryable=False,
        ):
            event.pop("event", None)
            await persist_stream_event("trace", event, owner_id=owner_id)
            yield sse_format("trace", event)
        yield sse_format(
            "done",
            {
                "run_id": state["trace_run_id"],
                "status": "cancelled",
                "completed": False,
                "error_code": "cancelled_by_user",
                "retryable": False,
            },
        )
        acknowledge_run_cancel(state["trace_run_id"])
    except Exception as exc:
        await _persist_resumable_execution(
            db,
            row_model,
            row_id,
            latest_execution,
            str(exc),
        )
        yield sse_format(
            "error",
            {
                "message": f"执行暂时中断，成功部分已保留并等待续跑：{str(exc)[:200]}",
                "retrying": True,
            },
        )
        for event in finish_trace_run(
            state["trace_run_id"],
            status="failed",
            observation="资料执行中断，成功部分已保留",
            error_code="resource_runtime_interrupted",
            retryable=True,
        ):
            event.pop("event", None)
            await persist_stream_event("trace", event, owner_id=owner_id)
            yield sse_format("trace", event)
        yield sse_format(
            "done",
            {
                "run_id": state["trace_run_id"],
                "status": "failed",
                "completed": False,
                "error_code": "resource_runtime_interrupted",
                "retryable": True,
            },
        )
    finally:
        release_run(str(state.get("trace_run_id") or ""))


@router.post("/resource-plans/{plan_id}/execute")
async def execute_plan(
    plan_id: str,
    req: PlanExecuteRequest,
    db: AsyncSession = Depends(get_db),
):
    row = await _owned(db, plan_id, req.student_id)
    try:
        require_current_version(row, req.version)
    except PlanVersionError as exc:
        raise _http_error(exc) from exc

    plan = normalize_plan_task_types(PlanArtifact.model_validate(row.artifact))
    plan.validation = validate_plan(plan)
    if not plan.validation.valid:
        raise HTTPException(status_code=409, detail="规划尚未通过验证")
    gate = await asyncio.to_thread(
        _require_knowledge, row.request_text.splitlines()[0], row.student_id
    )
    plan, task_kb_context = await asyncio.to_thread(
        bind_plan_task_sources,
        plan,
        gate.context,
        student_id=row.student_id,
    )
    original_status = row.status
    if original_status == "running":
        raise HTTPException(status_code=409, detail="规划正在执行，请刷新查看进度")
    if original_status == "awaiting_confirmation":
        if not req.confirm:
            raise HTTPException(status_code=409, detail="复杂规划需要用户明确确认后执行")
        plan.status = "approved"
    elif original_status not in {"approved", "failed"}:
        raise HTTPException(status_code=409, detail="当前状态不可执行")

    execution_state = dict(row.execution_state or {})
    has_failed_checkpoint = any(
        not bool(review.get("approved"))
        for review in (execution_state.get("reviews") or {}).values()
        if isinstance(review, dict)
    )
    if original_status == "failed" or has_failed_checkpoint:
        plan, execution_state = _prepare_failed_retry(plan, execution_state)
    execution_state["trace_run_id"] = f"plan_{uuid.uuid4().hex[:12]}"
    execution_state["run_started_at"] = time.time()
    task_count = max(1, len(plan.tasks))
    execution_state["retry_policy"] = {
        # One initial generation + one semantic review, followed by at most
        # one targeted regeneration + re-review.  Reserve the exact worst-case
        # envelope so a valid final review is not rejected by an undersized
        # three-calls-per-task budget.
        "max_model_calls": max(48, task_count * 4 + 1),
        "max_total_attempts": max(36, task_count * 3),
        # Generation and semantic review are parallel, but a single bounded
        # rework can still require a second provider round.  Six ordinary
        # tasks routinely need more than the old 180-second floor on remote
        # models, which incorrectly terminalized healthy reviews as budget
        # failures.
        "max_run_seconds": max(300.0, min(1800.0, float(task_count * 45))),
    }
    try:
        row = await claim_execution(
            db,
            row,
            plan,
            req.version,
            allowed_statuses={original_status},
            execution_state=execution_state,
        )
    except (PlanVersionError, PlanStateError) as exc:
        raise _http_error(exc) from exc
    plan = PlanArtifact.model_validate(row.artifact)
    # 图跑在工作线程里，不能开会话：``custom:<id>`` 的定义在这里一次性预加载，
    # 只随内存 state 传入，不写回持久化的 execution_state。
    custom_agents = await load_custom_agent_definitions(
        db,
        row.student_id,
        [task.agent for task in plan.tasks],
    )
    state = build_planned_state(plan, row.execution_state)
    state["kb_context"] = task_kb_context
    state["custom_agents"] = custom_agents
    state["knowledge_gate_enforced"] = True
    return StreamingResponse(
        stream_and_persist_planned_execution(planned_resource_app, state, row, db),
        media_type="text/event-stream",
    )
