"""LangGraph pipeline that executes a validated resource plan verbatim."""

from __future__ import annotations

import copy
import importlib
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.core.agent_trace import (
    phase_trace_event,
    root_span_id,
    trace_event,
    trace_span_id,
)
from app.core.config import settings
from app.core.run_control import (
    RunCancelled,
    RunBudgetExceeded,
    cancellation_checkpoint,
    register_run,
    reserve_model_calls,
    wait_or_cancel,
)
from app.graph.state import PlannedResourceState
from app.schemas.resource_plan import CUSTOM_AGENT_PREFIX, PlanArtifact
from app.services.planned_integration import integrate_approved_plan
from app.services.resource_plan_builder import apply_learning_time_workload
from app.services.resource_coverage import audit_plan_coverage
from app.services.resource_quality import (
    extract_resource_text,
    review_blocking_issues,
    review_resource,
)
from app.services.resource_grounding import apply_grounding_gate, verify_resource_semantics
from app.services.resource_planning import normalize_plan_task_types

DEFAULT_RETRY_POLICY: dict[str, int | float] = {
    # A candidate may be regenerated once. A second quality rejection is
    # released with warnings so one imperfect artifact cannot strand a plan.
    "max_task_retries": 1,
    "max_reviewer_attempts": 2,
    "max_run_seconds": 300.0,
    # Explicit finite model-call budget.  The graph counts one attempted
    # generation/review cycle per task attempt; provider token accounting is
    # intentionally not guessed when a provider does not report it reliably.
    "max_model_calls": 48,
    "max_total_attempts": 36,
    "max_identical_failures": 3,
}

REVIEW_MAX_CONCURRENCY = min(30, max(1, settings.AGENT_MAX_CONCURRENCY))


def _review_can_retry(
    review: dict[str, Any],
    state: PlannedResourceState | None = None,
) -> bool:
    """Apply permanent-error, attempt, time, total-budget, and fingerprint bounds."""

    if review.get("approved") or review.get("terminal") is True:
        return False
    # A fresh run may retry a budget-ended task, but the current run cannot:
    # its call/time budget is already exhausted.  Keeping this terminal here
    # also prevents the graph from wasting the one content-rework pass on an
    # unchanged candidate.
    if review.get("failure_kind") == "budget":
        return False
    if review.get("retryable") is False or review.get("service_recoverable") is False:
        return False
    policy = dict(DEFAULT_RETRY_POLICY)
    if state:
        policy.update(state.get("retry_policy") or {})
        policy["max_task_retries"] = min(1, int(policy.get("max_task_retries") or 1))
        started_at = float(state.get("run_started_at") or time.time())
        if time.time() - started_at >= float(policy["max_run_seconds"]):
            return False
        total_attempts = sum(
            max(
                int(item.get("retry_count") or 0) + 1,
                int(item.get("review_attempt") or 0),
            )
            for item in (state.get("reviews") or {}).values()
        )
        attempt_budget = min(
            int(policy["max_total_attempts"]),
            int(policy.get("max_model_calls", policy["max_total_attempts"])),
        )
        if total_attempts >= attempt_budget:
            return False
    if review.get("failure_kind") == "reviewer":
        return int(review.get("review_attempt") or 0) < int(policy["max_reviewer_attempts"])
    if int(review.get("retry_count") or 0) >= int(policy["max_task_retries"]):
        return False
    fingerprint_count = int(review.get("consecutive_fingerprint_count") or 0)
    return fingerprint_count < int(policy["max_identical_failures"])


def _auto_release_after_rework_limit(
    review: dict[str, Any],
    resource: dict[str, Any] | None,
) -> dict[str, Any]:
    """Release an existing candidate after its single allowed quality rework."""
    if (
        resource is None
        or review.get("approved")
        or review.get("failure_kind") != "quality"
        or int(review.get("retry_count") or 0) < 1
    ):
        return review
    blocking = [str(item) for item in review.get("blocking_issues") or [] if str(item)]
    issues = [str(item) for item in review.get("issues") or [] if str(item)]
    warnings = list(dict.fromkeys([
        *[str(item) for item in review.get("warnings") or [] if str(item)],
        *blocking,
        *issues,
        "已完成一次自动返工；达到返工上限后携带审核告警自动放行。",
    ]))
    return {
        **review,
        "approved": True,
        "auto_released": True,
        "gate_status": "approved_after_rework_limit",
        "release_reason": "single_rework_limit_reached",
        "blocking_issues": [],
        "warnings": warnings,
        "retryable": False,
        "terminal": True,
    }


def _retry_delay_seconds(retry_count: int) -> float:
    """Bound retry pressure inside the run's finite attempt and time budget."""

    schedule = (0.0, 0.1, 0.25)
    return schedule[min(max(0, retry_count), len(schedule) - 1)]


def _wait_before_retry(retry_count: int, run_id: str = "") -> None:
    delay = _retry_delay_seconds(retry_count)
    wait_or_cancel(run_id, delay)


def _normalize_candidate_for_review(
    resource: dict[str, Any],
    task: dict[str, Any],
    _repair_instructions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply deterministic, auditable last-mile repairs before re-review.

    The generator remains responsible for the learning content.  This helper
    only fixes representation defects the generator cannot reliably see:
    duplicate mind-map labels. It must not invent prose, claims, or required
    terms merely to satisfy the reviewer.
    """

    normalized = copy.deepcopy(resource)
    if str(task.get("type") or normalized.get("type") or "") == "mindmap":
        seen: dict[str, int] = {}

        def visit(items: Any, parent_label: str = "") -> None:
            if not isinstance(items, list):
                return
            for item in items:
                if not isinstance(item, dict):
                    continue
                original = str(item.get("label") or "").strip()
                if original:
                    count = seen.get(original, 0) + 1
                    seen[original] = count
                    if count > 1:
                        qualifier = parent_label or str(count)
                        candidate = f"{original}·{qualifier}"
                        suffix = count
                        while candidate in seen:
                            suffix += 1
                            candidate = f"{original}·{suffix}"
                        item["label"] = candidate
                        seen[candidate] = 1
                visit(item.get("children"), str(item.get("label") or original))

        visit(normalized.get("nodes"))

    # Semantic corrections belong to the generating agent's bounded rework
    # pass. Returning here prevents this normalizer from fabricating prose or
    # narration solely to make a keyword-based review pass.
    return normalized


def _model_call_checkpoint(state: PlannedResourceState) -> None:
    """Stop before creating a provider call when cancellation/time/cost wins."""

    run_id = str(state.get("trace_run_id") or "")
    cancellation_checkpoint(run_id)
    policy = {**DEFAULT_RETRY_POLICY, **dict(state.get("retry_policy") or {})}
    started_at = float(state.get("run_started_at") or time.time())
    if time.time() - started_at >= float(policy["max_run_seconds"]):
        raise RunBudgetExceeded(
            f"run {run_id} wall-clock budget exhausted before model call",
            error_code="run_time_budget_exhausted",
        )
    reserve_model_calls(run_id)


def _budget_error_code(exc: RunBudgetExceeded) -> str:
    code = str(getattr(exc, "error_code", "") or "")
    if code and code != "run_budget_exhausted":
        return code
    return (
        "run_time_budget_exhausted"
        if "wall-clock" in str(exc).lower()
        else "model_call_budget_exhausted"
    )


def _budget_issue(
    exc: RunBudgetExceeded,
    state: PlannedResourceState,
    *,
    action: str,
) -> str:
    if _budget_error_code(exc) == "run_time_budget_exhausted":
        policy = {**DEFAULT_RETRY_POLICY, **dict(state.get("retry_policy") or {})}
        seconds = int(float(policy.get("max_run_seconds") or 0))
        return (
            f"本次运行已达到 {seconds} 秒时限，未启动后续{action}模型调用；"
            "候选资料未发布"
        )
    return (
        f"本次运行允许的模型调用次数已用尽，未启动后续{action}调用；"
        "候选资料未发布"
    )


def _generation_error_is_retryable(exc: Exception) -> bool:
    """Do not burn retries on errors that require operator intervention."""

    explicit_retryable = getattr(exc, "retryable", None)
    if isinstance(explicit_retryable, bool):
        return explicit_retryable
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int):
        if status_code in {400, 401, 403, 404, 405, 409, 410, 422}:
            return False
        if status_code in {408, 425, 429} or status_code >= 500:
            return True
    message = str(exc).lower()
    permanent_markers = (
        "invalid api key",
        "incorrect api key",
        "unauthorized",
        "authentication",
        "forbidden",
        "permission denied",
        "insufficient_quota",
        "quota exceeded",
        "quota exhausted",
        "billing",
        "payment required",
        "model not found",
        "model_not_found",
        "invalid model",
        "unsupported model",
        "does not exist",
        "http 401",
        "http 403",
        "unknown resource agent",
        "未知资源智能体",
    )
    return not any(marker in message for marker in permanent_markers)


def _generation_failure_instruction(message: str) -> dict[str, Any]:
    return {
        "issue": message,
        "location": "资料生成调用 / 模型输出",
        "target_field": "entire_resource",
        "action": (
            "主 Agent 已确认上一轮没有产出可审核的完整资料。请针对上述失败原因重新生成，"
            "不要复用空响应、截断响应或无法解析的输出，并严格按原大纲返回完整资源对象。"
        ),
        "acceptance_check": "返回非空、可解析且字段完整的资源对象，随后通过原质量审核。",
        "required_evidence": ["完整资源对象", "原大纲各章节的实际内容"],
        "required_terms": [],
        "fingerprint": f"generation:{message[:160]}",
        "escalated": False,
    }


def get_agent(
    name: str,
    definitions: dict[str, Any] | None = None,
) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """Resolve a built-in generator, or a preloaded user-defined agent.

    The graph runs in worker threads and must never open a database session, so
    ``custom:<id>`` executors are resolved from definitions that the pipeline
    entry point preloaded into ``state["custom_agents"]``.  A missing definition
    is the same *permanent* error class as an unknown built-in agent: the
    message carries the marker ``_generation_error_is_retryable`` matches, so
    the task fails fast instead of burning the run budget on retries.
    """

    if name.startswith(CUSTOM_AGENT_PREFIX):
        available = definitions if isinstance(definitions, dict) else {}
        definition = available.get(name) or available.get(name[len(CUSTOM_AGENT_PREFIX):])
        if not isinstance(definition, dict) or not definition:
            raise ValueError(f"未知资料智能体：{name}（unknown resource agent）")
        from app.agents.custom import build_custom_agent

        return build_custom_agent(definition)
    if name not in {
        "explainer",
        "mindmap",
        "quiz",
        "solution",
        "reading",
        "code",
        "video",
        "courseware",
        "interactive",
    }:
        raise ValueError(f"未知资料智能体：{name}（unknown resource agent）")
    module = importlib.import_module(f"app.agents.{name}")
    return module.generate


def _emit(payload: dict[str, Any]) -> None:
    try:
        get_stream_writer()(payload)
    except RuntimeError:
        pass


def _generation_span_id(run_id: str, task_id: str, retry_count: int) -> str:
    return trace_span_id(run_id, f"task:{task_id}:generation:{retry_count}")


def _emit_orchestrator_reasoning(
    state: PlannedResourceState,
    *,
    key: str,
    text: str,
    phase: str,
) -> None:
    """Emit one public main-agent summary for a logical tool batch.

    Worker agents keep their operation/review trace cards, but their own
    reasoning is never promoted into the conversation.  Stable span IDs let
    the client collapse a repeated graph routing snapshot instead of replaying
    the same summary.
    """

    run_id = str(state.get("trace_run_id") or "plan-reasoning")
    _emit(
        trace_event(
            run_id=run_id,
            agent="orchestrator",
            kind="reasoning_summary",
            event_type="reasoning",
            title="主 Agent 推理摘要",
            status="completed",
            phase=phase,
            detail=text,
            observation=text,
            decision_summary=text,
            narrative=text,
            reasoning_text=text,
            reasoning_source="runtime",
            span_id=trace_span_id(run_id, f"orchestrator-reasoning:{key}"),
            parent_span_id=root_span_id(run_id),
            action_type="reasoning",
            visibility="summary",
        )
    )


def _tool_batch_signature(tasks: list[dict[str, Any]]) -> str:
    return "|".join(
        sorted(
            f"{task.get('task_id')}:{int(task.get('retry_count') or 0)}"
            for task in tasks
        )
    )


def _emit_tool_batch_before(
    state: PlannedResourceState,
    tasks: list[dict[str, Any]],
    *,
    purpose: str,
) -> None:
    if not tasks:
        return
    count = len(tasks)
    _emit_orchestrator_reasoning(
        state,
        key=f"before:{purpose}:{_tool_batch_signature(tasks)}",
        phase="generation",
        text=(
            f"我将把当前 {count} 个资料任务作为一批调给生成与审核工具，"
            "并行执行以缩短等待时间；拿到这一批结果后再统一判断，"
            "不会逐条展示子智能体的推理摘要。"
        ),
    )


def _emit_tool_batch_result(state: PlannedResourceState) -> None:
    reviews = {
        str(task_id): dict(review or {})
        for task_id, review in (state.get("reviews") or {}).items()
        if isinstance(review, dict)
    }
    if not reviews:
        return
    approved = sum(bool(review.get("approved")) for review in reviews.values())
    budget_failed = sum(
        review.get("failure_kind") == "budget" and not review.get("approved")
        for review in reviews.values()
    )
    rework = sum(_review_can_retry(review, state) for review in reviews.values())
    terminal_failed = len(reviews) - approved - rework
    snapshot = "|".join(
        sorted(
            f"{task_id}:{int(review.get('retry_count') or 0)}:"
            f"{int(bool(review.get('approved')))}:{review.get('error_code') or ''}:"
            f"{int(bool(review.get('terminal')))}"
            for task_id, review in reviews.items()
        )
    )
    if budget_failed:
        next_step = (
            "运行预算已阻止后续审核；我会保留已通过资料并明确报告未发布项。"
        )
    elif rework:
        next_step = f"其中 {rework} 份需要修正，我只对这些任务安排一次定向返工。"
    elif terminal_failed:
        next_step = "未通过项不会发布，我会整理已通过内容并给出明确失败原因。"
    else:
        next_step = "全部结果可进入统一整理和发布阶段。"
    _emit_orchestrator_reasoning(
        state,
        key=f"after:{snapshot}",
        phase="review",
        text=(
            f"这一批工具结果已返回：当前共审核 {len(reviews)} 份，"
            f"{approved} 份通过、{rework} 份待返工、{terminal_failed} 份终止。"
            f"{next_step}"
        ),
    )


def _review_span_id(
    run_id: str,
    task_id: str,
    retry_count: int,
    review_attempt: int,
) -> str:
    return trace_span_id(
        run_id,
        f"task:{task_id}:review:{retry_count}:{review_attempt}",
    )


def _planned_quiz_config(task: dict[str, Any]) -> dict[str, int]:
    if task.get("type") not in {"quiz", "solution"} and task.get("agent") != "quiz":
        return {}

    explicit = task.get("quiz_config")
    if isinstance(explicit, dict):
        normalized = {
            key: max(0, min(30, int(explicit.get(key) or 0)))
            for key in ("choice", "judge", "short")
        }
        if sum(normalized.values()) > 0:
            return normalized

    outline = task.get("outline") or {}
    searchable = [
        str(task.get("title") or ""),
        str(outline.get("objective") or ""),
        *(str(item) for item in task.get("quality_criteria") or []),
    ]
    for section in outline.get("sections") or []:
        if isinstance(section, dict):
            searchable.extend(
                [str(section.get("title") or ""), str(section.get("goal") or "")]
            )

    match = re.search(
        r"(\d+)\s*道(?:[^，。；,;\n]{0,6})?题",
        "；".join(searchable),
    )
    if match is None:
        return {}
    count = max(1, min(30, int(match.group(1))))
    return {"choice": count, "judge": 0, "short": 0}


def build_planned_state(
    plan: PlanArtifact,
    execution_state: dict[str, Any] | None,
) -> PlannedResourceState:
    plan = normalize_plan_task_types(plan)
    if plan.learning_path_preferences:
        plan = apply_learning_time_workload(
            plan,
            preserve_explicit_quiz_count=False,
        )
        # Long plans produced before the parallel planner used one synthetic
        # predecessor per task.  The exact full-chain shape is safe to migrate:
        # calendar prerequisites remain intact while independent artifacts can
        # finally generate concurrently on retry.
        if len(plan.tasks) >= 3 and all(
            task.depends_on == ([] if index == 0 else [plan.tasks[index - 1].task_id])
            for index, task in enumerate(plan.tasks)
        ):
            for task in plan.tasks:
                task.depends_on = []
    execution = execution_state or {}
    trace_run_id = str(execution.get("trace_run_id") or f"plan_{uuid.uuid4().hex[:12]}")
    retry_policy = {
        **DEFAULT_RETRY_POLICY,
        **dict(execution.get("retry_policy") or {}),
    }
    retry_policy["max_task_retries"] = min(
        1,
        int(retry_policy.get("max_task_retries") or 1),
    )
    register_run(
        trace_run_id,
        parent_run_id=str(execution.get("parent_run_id") or "") or None,
        model_call_limit=int(retry_policy["max_model_calls"]),
        owner_id=plan.student_id,
    )
    return {
        "plan": plan.model_dump(mode="json"),
        "student_id": plan.student_id,
        "profile": dict(execution.get("profile") or {}),
        "kb_context": list(execution.get("kb_context") or []),
        "plan_task": {},
        "resources": list(execution.get("resources") or []),
        "reviews": dict(execution.get("reviews") or {}),
        "repair_task_ids": list(execution.get("repair_task_ids") or []),
        "retry_round": int(execution.get("retry_round") or 0),
        "coverage": dict(execution.get("coverage") or {}),
        "integration": dict(execution.get("integration") or {}),
        "schedule": list(execution.get("schedule") or []),
        "trace_run_id": trace_run_id,
        "run_started_at": float(execution.get("run_started_at") or time.time()),
        "retry_policy": retry_policy,
        # 图跑在工作线程里，不能查库：``custom:<id>`` 的定义由管线入口预加载进来。
        "custom_agents": dict(execution.get("custom_agents") or {}),
        "knowledge_gate_enforced": bool(execution.get("knowledge_gate_enforced", False)),
    }


def _terminal_task_ids(state: PlannedResourceState) -> set[str]:
    return {
        str(task_id)
        for task_id, review in (state.get("reviews") or {}).items()
        if review.get("approved") or not _review_can_retry(review, state)
    }


def _revision_note(review: dict[str, Any]) -> str:
    instructions = review.get("repair_instructions") or []
    structured_actions = [
        str(item.get("action") or "").strip()
        for item in instructions
        if isinstance(item, dict) and str(item.get("action") or "").strip()
    ]
    if structured_actions:
        return "；".join(structured_actions)
    fixes = [str(item) for item in review.get("fixes") or [] if str(item)]
    if fixes:
        return "；".join(fixes)
    return "；".join(
        f"请在对应字段或正文中显式补写：{issue}"
        for issue in review_blocking_issues(review)
    )


def _latest_resource_for_task(state: PlannedResourceState, task_id: str) -> dict[str, Any] | None:
    latest: dict[str, Any] | None = None
    for resource in state.get("resources") or []:
        if str(resource.get("task_id") or "") == task_id:
            latest = resource
    return latest


def _bounded_repair_context(resource: dict[str, Any] | None) -> dict[str, Any]:
    if not resource:
        return {}
    structure = {
        key: len(resource.get(key) or [])
        for key in ("questions", "nodes", "slides", "scenes", "narration")
        if isinstance(resource.get(key), list)
    }
    previous_resource: dict[str, Any] = {
        "title": str(resource.get("title") or resource.get("task_id") or "上一版资料"),
        "type": str(resource.get("type") or ""),
        "content_excerpt": extract_resource_text(resource)[:3600],
        "structure": structure,
    }
    questions = resource.get("questions")
    if isinstance(questions, list):
        previous_resource["questions"] = [
            {
                key: value[:1200] if isinstance(value, str) else value
                for key, value in question.items()
                if key in {"id", "type", "stem", "options", "answer", "explanation"}
            }
            for question in questions[:30]
            if isinstance(question, dict)
        ]
    return {"previous_resource": previous_resource}


def _upgrade_repeated_instructions(
    instructions: list[dict[str, Any]],
    repeated_fingerprints: set[str],
) -> list[dict[str, Any]]:
    upgraded: list[dict[str, Any]] = []
    for item in instructions:
        if not isinstance(item, dict):
            continue
        updated = dict(item)
        if str(updated.get("fingerprint") or "") in repeated_fingerprints:
            updated["escalated"] = True
            updated["action"] = (
                f"{str(updated.get('action') or '').strip()} "
                "这是重复缺口；生成前自检 required_terms 与 required_evidence，"
                "逐项确认已显式写入目标字段。"
            ).strip()
            updated["acceptance_check"] = (
                f"{str(updated.get('acceptance_check') or '').strip()} "
                "重复返工验收：逐项自检后再提交。"
            ).strip()
        upgraded.append(updated)
    return upgraded


def _rework_detail(instructions: list[dict[str, Any]]) -> str:
    locations = [
        f"{item.get('location', '资料正文')} / {item.get('target_field', 'content')}"
        for item in instructions
        if isinstance(item, dict)
    ]
    focus = "、".join(dict.fromkeys(locations[:3])) or "指定字段"
    return f"正在优化 {focus}，共 {len(instructions)} 项阻断缺口"


def _retry_task_for_review(
    state: PlannedResourceState,
    task: dict[str, Any],
    review: dict[str, Any],
) -> dict[str, Any]:
    task_id = str(task.get("task_id") or "")
    instructions = list(review.get("repair_instructions") or [])
    return {
        **task,
        "status": "failed",
        "retry_count": int(review.get("retry_count") or 0) + 1,
        "_revise_note": _revision_note(review),
        "_repair_instructions": instructions,
        "_repair_context": {
            **_bounded_repair_context(_latest_resource_for_task(state, task_id)),
            "failure_reason": "；".join(review_blocking_issues(review)),
        },
    }


def _emit_rework_started(state: PlannedResourceState, retry_task: dict[str, Any]) -> None:
    instructions = list(retry_task.get("_repair_instructions") or [])
    detail = _rework_detail(instructions)
    task_id = str(retry_task.get("task_id") or "")
    retry_count = int(retry_task.get("retry_count") or 0)
    run_id = str(state.get("trace_run_id") or "plan_repair")
    previous_review = dict((state.get("reviews") or {}).get(task_id) or {})
    parent_review_span = _review_span_id(
        run_id,
        task_id,
        int(previous_review.get("retry_count") or max(0, retry_count - 1)),
        int(previous_review.get("review_attempt") or 1),
    )
    delegation_span = trace_span_id(run_id, f"task:{task_id}:delegation:{retry_count}")
    retry_task["_parent_span_id"] = delegation_span
    observation = "；".join(
        str(item.get("issue") or "")
        for item in instructions
        if isinstance(item, dict) and item.get("issue")
    ) or "上一轮结果未达到验收标准"
    actions = "；".join(
        str(item.get("action") or "")
        for item in instructions
        if isinstance(item, dict) and item.get("action")
    ) or "按原大纲重新生成并修复审核指出的问题"
    acceptance = "；".join(
        str(item.get("acceptance_check") or "")
        for item in instructions
        if isinstance(item, dict) and item.get("acceptance_check")
    ) or "重新生成后通过质量审核"
    _emit(
        phase_trace_event(
            run_id=run_id,
            phase="generation",
            status="running",
            detail=detail,
        )
    )
    _emit(
        {
            **trace_event(
                run_id=run_id,
                agent="supervisor",
                kind="review",
                title=f"主 Agent 向 {retry_task.get('agent', 'generator')} 下发返工要求",
                status="completed",
                phase="review",
                action=actions,
                observation=observation,
                decision_summary=f"只重试任务 {task_id}；验收条件：{acceptance}",
                chapter_id=str(retry_task.get("day") or ""),
                detail=detail,
                span_id=delegation_span,
                parent_span_id=parent_review_span,
                task_id=task_id,
                attempt=retry_count + 1,
                action_type="delegation",
            ),
            "id": f"{state.get('trace_run_id')}:feedback:{task_id}",
            "from_agent": "supervisor",
            "to_agent": str(retry_task.get("agent") or ""),
            "task_id": task_id,
            "attempt": retry_count,
            "improvement_actions": [
                str(item.get("action") or "")
                for item in instructions
                if isinstance(item, dict) and item.get("action")
            ],
            "acceptance_check": acceptance,
        }
    )
    _emit(
        {
            "event": "task_progress",
            "task_id": task_id,
            "agent": retry_task.get("agent", ""),
            "status": "rework",
            "detail": detail,
            "blocking_count": len(instructions),
            "retry_count": retry_count,
        }
    )


def dispatch_tasks(state: PlannedResourceState):
    """Dispatch exactly one action for each task's latest candidate version.

    A resource and its review are paired by ``retry_count``.  This is
    important because generator nodes merge concurrently: a stale failed
    review must never schedule an additional copy after a newer candidate is
    already waiting for review.
    """

    cancellation_checkpoint(str(state.get("trace_run_id") or ""))
    generated_retries: dict[str, int] = {}
    for resource in state.get("resources", []) or []:
        task_id = str(resource.get("task_id") or "")
        if task_id:
            generated_retries[task_id] = int(resource.get("retry_count") or 0)
    terminal = _terminal_task_ids(state)
    tasks = list((state.get("plan") or {}).get("tasks") or [])
    reviews = state.get("reviews") or {}
    _emit_tool_batch_result(state)

    # Review every *new* candidate before scheduling any repair.  In
    # particular, this prevents a failed review from racing the successful
    # generator result that superseded it in the same LangGraph merge.
    review_pending = [
        task_id
        for task_id, retry_count in generated_retries.items()
        if task_id not in terminal
        and (
            task_id not in reviews
            or retry_count > int(reviews[task_id].get("retry_count") or 0)
        )
    ]
    if review_pending:
        pending_tasks = [
            task for task in tasks if str(task.get("task_id") or "") in review_pending
        ]
        _emit_tool_batch_before(state, pending_tasks, purpose="review")
        return "review_tasks"

    # Inline task pipelines already own a review for their newest candidate.
    # Schedule the single targeted quality rework here instead of waiting for
    # a separate batch-review node. Reviewer infrastructure failures still go
    # back to review_tasks because regenerating unchanged content would waste
    # a model call.
    quality_retries: list[Send] = []
    reviewer_retry_pending = False
    for task in tasks:
        task_id = str(task.get("task_id") or "")
        review = dict(reviews.get(task_id) or {})
        if (
            task_id not in generated_retries
            or not review
            or int(review.get("retry_count") or 0) != generated_retries[task_id]
            or not _review_can_retry(review, state)
        ):
            continue
        if review.get("failure_kind") == "reviewer":
            reviewer_retry_pending = True
            continue
        retry_task = _retry_task_for_review(state, task, review)
        _emit_rework_started(state, retry_task)
        quality_retries.append(
            Send("generate_task", {**state, "plan_task": retry_task})
        )
    if quality_retries:
        _emit_tool_batch_before(
            state,
            [dict(send.arg.get("plan_task") or {}) for send in quality_retries],
            purpose="quality-rework",
        )
        return quality_retries
    if reviewer_retry_pending:
        return "review_tasks"

    # Provider failures have no resource to review.  Re-dispatch only after
    # confirming there is no newer generated candidate for the same task.
    failed_generation_retries: list[Send] = []
    for task in tasks:
        task_id = str(task.get("task_id") or "")
        review = reviews.get(task_id)
        if (
            not review
            or task_id in generated_retries
            or task_id in terminal
            or not set(task.get("depends_on") or []).issubset(terminal)
        ):
            continue
        retry_task = _retry_task_for_review(state, task, review)
        _emit_rework_started(state, retry_task)
        failed_generation_retries.append(
            Send("generate_task", {**state, "plan_task": retry_task})
        )
    if failed_generation_retries:
        _emit_tool_batch_before(
            state,
            [dict(send.arg.get("plan_task") or {}) for send in failed_generation_retries],
            purpose="generation-retry",
        )
        return failed_generation_retries

    pending = [
        task
        for task in tasks
        if task.get("status") in {"pending", "failed", "running", "generated", "review"}
        and task.get("task_id") not in generated_retries
        and task.get("task_id") not in terminal
        and task.get("task_id") not in reviews
    ]
    ready = [
        task
        for task in pending
        if set(task.get("depends_on") or []).issubset(terminal)
    ]
    if ready:
        _emit_tool_batch_before(state, ready, purpose="generation")
        return [Send("generate_task", {**state, "plan_task": task}) for task in ready]
    # No runnable task remains.  Missing/cyclic tasks are terminalized by the
    # persistence boundary instead of spinning indefinitely in this node.
    return "coverage"


def run_planned_task(state: PlannedResourceState) -> dict[str, Any]:
    task = state["plan_task"]
    task_id = str(task["task_id"])
    retry_count = int(task.get("retry_count") or 0)
    generation_span = _generation_span_id(state["trace_run_id"], task_id, retry_count)
    generation_parent = str(task.get("_parent_span_id") or root_span_id(state["trace_run_id"]))
    repair_instructions = list(task.get("_repair_instructions") or [])
    repair_context = dict(task.get("_repair_context") or {})
    is_rework = bool(repair_instructions)
    cancellation_checkpoint(state["trace_run_id"])
    if is_rework:
        _wait_before_retry(int(task.get("retry_count") or 0), state["trace_run_id"])
        cancellation_checkpoint(state["trace_run_id"])
    progress_detail = (
        _rework_detail(repair_instructions)
        if is_rework
        else f"正在按已确认大纲生成《{task['title']}》"
    )
    _emit(
        phase_trace_event(
            run_id=state["trace_run_id"],
            phase="generation",
            status="running",
            detail="正在并行生成已确认规划中的资料",
        )
    )
    _emit(
        {
            **trace_event(
                run_id=state["trace_run_id"],
                agent=str(task["agent"]),
                kind="generation",
                title=f"生成《{task['title']}》",
                status="running",
                phase="generation",
                input_summary=str(task.get("outline", {}).get("objective") or task["title"]),
                action="按已确认大纲生成一份可审核资料",
                observation="生成任务已由 Supervisor 派发",
                decision_summary="本次只处理当前任务和当前候选版本。",
                span_id=generation_span,
                parent_span_id=generation_parent,
                task_id=task_id,
                attempt=retry_count + 1,
                action_type="agent_call",
                evidence_ids=[str(item) for item in task.get("source_ids") or []],
            ),
        }
    )
    _emit(
        {
            "event": "task_progress",
            "task_id": task_id,
            "agent": task["agent"],
            "status": "rework" if is_rework else "running",
            "detail": progress_detail,
        }
    )

    source_ids = {str(source_id) for source_id in task.get("source_ids") or []}
    scoped_kb = [
        item
        for item in state.get("kb_context", [])
        if str(item.get("id")) in source_ids
    ]
    if not scoped_kb and state.get("kb_context"):
        scoped_kb = list(state["kb_context"])[:3]
        _emit({"event": "task_progress", "task_id": task_id, "agent": task["agent"], "status": "blocked", "detail": "任务来源已失效，已重新绑定本轮知识库来源"})
    if not scoped_kb and state.get("knowledge_gate_enforced"):
        issue = "知识库门禁阻断：任务没有可用来源"
        _emit(
            trace_event(
                run_id=state["trace_run_id"],
                agent=str(task["agent"]),
                kind="generation",
                title=f"生成《{task['title']}》",
                status="blocked",
                phase="generation",
                observation=issue,
                decision_summary="缺少可靠证据时不启动新的模型调用。",
                span_id=generation_span,
                parent_span_id=generation_parent,
                task_id=task_id,
                attempt=retry_count + 1,
                action_type="agent_call",
                error_code="knowledge_gate_blocked",
                retryable=False,
            )
        )
        return {
            "reviews": {
                task_id: {
                    "approved": False, "score": 0.0, "issues": [issue],
                    "blocking_issues": [issue], "warnings": [], "fixes": [],
                    "retry_count": int(task.get("retry_count") or 0),
                    "failure_kind": "knowledge_gate", "retryable": False, "terminal": True,
                }
            }
        }
    latest_resources: dict[str, dict[str, Any]] = {}
    for resource in state.get("resources") or []:
        dependency_id = str(resource.get("task_id") or "")
        if dependency_id:
            latest_resources[dependency_id] = resource
    reviews = dict(state.get("reviews") or {})
    dependency_outputs = []
    for dependency_id in task.get("depends_on") or []:
        resource = latest_resources.get(str(dependency_id))
        if resource is None or not reviews.get(str(dependency_id), {}).get("approved"):
            continue
        dependency_outputs.append(
            {
                "task_id": str(dependency_id),
                "title": str(resource.get("title") or dependency_id),
                "type": str(resource.get("type") or ""),
                "summary": extract_resource_text(resource)[:1200],
            }
        )
    agent_state = {
        "topic": task["title"],
        "student_id": state["student_id"],
        "requirements": task["outline"]["objective"],
        "profile": state.get("profile", {}),
        "kb_context": scoped_kb,
        "resource_outline": task["outline"],
        "quality_criteria": task["quality_criteria"],
        "chapter": {"id": task["day"], "title": task["title"]},
        "plan_task": task,
        "dependency_outputs": dependency_outputs,
        "quiz_config": _planned_quiz_config(task),
        "revise_note": str(task.get("_revise_note") or ""),
        "repair_instructions": repair_instructions,
        "repair_context": repair_context,
    }
    try:
        cancellation_checkpoint(state["trace_run_id"])
        agent_name = str(task["agent"])
        agent = (
            get_agent(agent_name, state.get("custom_agents") or {})
            if agent_name.startswith(CUSTOM_AGENT_PREFIX)
            else get_agent(agent_name)
        )
        # This is the last checkpoint before a generator starts a new LLM call.
        _model_call_checkpoint(state)
        generated = agent(agent_state)
        cancellation_checkpoint(state["trace_run_id"])
        if not isinstance(generated, dict):
            raise TypeError(f"{task['agent']} did not return a resource object")
    except RunCancelled:
        raise
    except Exception as exc:
        service_recoverable = _generation_error_is_retryable(exc)
        budget_exhausted = isinstance(exc, RunBudgetExceeded)
        message = (
            _budget_issue(exc, state, action="生成")
            if budget_exhausted
            else f"{task['agent']} 生成失败：{str(exc)[:200]}"
        )
        repair_instruction = _generation_failure_instruction(message)
        previous_review = dict((state.get("reviews") or {}).get(task_id) or {})
        fingerprint = str(repair_instruction["fingerprint"])
        previous_fingerprint = str(previous_review.get("error_fingerprint") or "")
        fingerprint_count = (
            int(previous_review.get("consecutive_fingerprint_count") or 0) + 1
            if previous_fingerprint == fingerprint
            else 1
        )
        if retry_count > 0:
            repair_instruction["escalated"] = True
        review = {
            "approved": False,
            "score": 0.0,
            "issues": [message],
            "blocking_issues": [message],
            "warnings": [],
            "fixes": [str(repair_instruction["action"])],
            "repair_instructions": [repair_instruction],
            "retry_count": retry_count,
            "failure_kind": "budget" if budget_exhausted else "generation",
            # Budget termination is not retried inside the exhausted run, but
            # a user may start a fresh run with a reset budget.
            "retryable": True if budget_exhausted else service_recoverable,
            "service_recoverable": True if budget_exhausted else service_recoverable,
            "error_code": (
                _budget_error_code(exc)
                if budget_exhausted
                else "generation_unavailable"
                if service_recoverable
                else "generation_permanent_error"
            ),
            "error_fingerprint": fingerprint,
            "consecutive_fingerprint_count": fingerprint_count,
        }
        review["terminal"] = not _review_can_retry(review, state)
        _emit(
            trace_event(
                run_id=state["trace_run_id"],
                agent=str(task["agent"]),
                kind="generation",
                title=f"生成《{task['title']}》",
                status="failed",
                phase="generation",
                observation="资料生成调用失败，错误详情已转换为公开摘要",
                decision_summary=(
                    "终止当前任务重试" if review["terminal"] else "按有界策略安排当前任务重试"
                ),
                span_id=generation_span,
                parent_span_id=generation_parent,
                task_id=task_id,
                attempt=retry_count + 1,
                action_type="agent_call",
                error_code=str(review["error_code"]),
                retryable=bool(review["retryable"] and not review["terminal"]),
            )
        )
        detail = (
            f"{message}；主 Agent 已将原因发回生成 Agent，准备第 {retry_count + 1} 次重试"
            if not review["terminal"]
            else f"{message}；已触发永久错误、尝试次数或错误指纹熔断"
        )
        _emit(
            {
                "event": "task_progress",
                "task_id": task_id,
                "agent": task["agent"],
                "status": "failed" if review["terminal"] else "rework",
                "detail": detail,
                "retry_count": retry_count,
            }
        )
        _emit({"event": "task_review", "task_id": task_id, **review})
        update: dict[str, Any] = {"reviews": {task_id: review}}
        if task.get("_coverage_repair"):
            update["repair_task_ids"] = [task_id]
        return update
    result = _normalize_candidate_for_review(
        dict(generated),
        task,
        repair_instructions,
    )
    result.update(
        {
            "id": task_id,
            "task_id": task_id,
            "type": task["type"],
            "title": str(result.get("title") or task["title"]),
            "chapter_id": task["day"],
            "plan_outline": task["outline"],
            "quality_criteria": task["quality_criteria"],
            "retry_count": int(task.get("retry_count") or 0),
        }
    )
    _emit(
        trace_event(
            run_id=state["trace_run_id"],
            agent=str(task["agent"]),
            kind="generation",
            title=f"生成《{task['title']}》",
            status="completed",
            phase="generation",
            observation="候选资料已生成，等待分层审核",
            decision_summary="候选资料尚未发布，只有审核通过后才可持久化。",
            span_id=generation_span,
            parent_span_id=generation_parent,
            task_id=task_id,
            attempt=retry_count + 1,
            action_type="agent_call",
            evidence_ids=[str(item) for item in task.get("source_ids") or []],
        )
    )
    _emit(
        {
            "event": "content",
            "task_id": task_id,
            "agent": task["agent"],
            "type": task["type"],
            "data": result,
        }
    )
    _emit(
        {
            "event": "task_progress",
            "task_id": task_id,
            "agent": task["agent"],
            "status": "generated",
            "detail": "内容已生成，等待质量审核",
        }
    )
    update: dict[str, Any] = {"resources": [result]}
    if task.get("_coverage_repair"):
        update["repair_task_ids"] = [task_id]
    return update


def review_tasks(
    state: PlannedResourceState,
    *,
    announce_batch: bool = True,
) -> dict[str, Any]:
    cancellation_checkpoint(state["trace_run_id"])
    if announce_batch:
        _emit(
            phase_trace_event(
                run_id=state["trace_run_id"],
                phase="generation",
                status="completed",
                detail="规划内资料已完成首轮生成",
                progress=100,
            )
        )
        _emit(
            phase_trace_event(
                run_id=state["trace_run_id"],
                phase="review",
                status="running",
                detail="正在按资料类型和大纲覆盖度审核",
            )
        )
    tasks = {
        str(task.get("task_id")): task
        for task in (state.get("plan") or {}).get("tasks") or []
    }
    latest: dict[str, dict[str, Any]] = {}
    for resource in state.get("resources") or []:
        task_id = str(resource.get("task_id") or "")
        if task_id:
            latest[task_id] = resource

    reviews = dict(state.get("reviews") or {})
    prepared_reviews: dict[str, dict[str, Any]] = {}
    semantic_futures: dict[str, Any] = {}
    review_candidates: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    for task_id, resource in latest.items():
        task = tasks.get(task_id)
        if task is None:
            continue
        retry_count = int(resource.get("retry_count") or 0)
        previous_review = dict(reviews.get(task_id) or {})
        if (
            previous_review.get("approved")
            and int(previous_review.get("retry_count") or 0) == retry_count
        ):
            continue
        if previous_review.get("failure_kind") == "reviewer":
            _wait_before_retry(
                int(previous_review.get("review_attempt") or 0) + 1,
                state["trace_run_id"],
            )
            cancellation_checkpoint(state["trace_run_id"])
        review_candidates.append((task_id, resource, task))

    # Semantic review is the slow part of the gate.  Running independent
    # candidates concurrently keeps a 12-resource learning path from spending
    # the whole wall-clock budget in a serial reviewer loop.  Model-call budget
    # reservations remain atomic and happen before each worker is submitted.
    if review_candidates:
        with ThreadPoolExecutor(
            max_workers=min(REVIEW_MAX_CONCURRENCY, len(review_candidates)),
            thread_name_prefix="resource-review",
        ) as executor:
            for index, (task_id, resource, task) in enumerate(review_candidates, 1):
                _emit(
                    {
                        "event": "task_progress",
                        "task_id": task_id,
                        "agent": "reviewer",
                        "status": "reviewing",
                        "detail": f"正在并行审核（{index}/{len(review_candidates)}）",
                    }
                )
                try:
                    cancellation_checkpoint(state["trace_run_id"])
                    base_review = review_resource(resource, task)
                    source_ids = {str(item) for item in task.get("source_ids") or []}
                    scoped_kb = [
                        item
                        for item in state.get("kb_context") or []
                        if not source_ids or str(item.get("id") or "") in source_ids
                    ]
                    _model_call_checkpoint(state)
                except RunCancelled:
                    raise
                except Exception as exc:
                    prepared_reviews[task_id] = {"error": exc}
                    continue
                prepared_reviews[task_id] = {
                    "review": base_review,
                    "scoped_kb": scoped_kb,
                }
                semantic_futures[task_id] = executor.submit(
                    verify_resource_semantics,
                    resource,
                    task,
                    scoped_kb,
                )

            for task_id, future in semantic_futures.items():
                try:
                    prepared_reviews[task_id]["semantic"] = future.result()
                except Exception as exc:
                    prepared_reviews[task_id]["error"] = exc

    for task_id, resource in latest.items():
        task = tasks.get(task_id)
        if task is None:
            continue
        retry_count = int(resource.get("retry_count") or 0)
        previous_review = dict(reviews.get(task_id) or {})
        if (
            previous_review.get("approved")
            and int(previous_review.get("retry_count") or 0) == retry_count
        ):
            continue
        current_review_attempt = (
            int(previous_review.get("review_attempt") or 0) + 1
            if previous_review.get("failure_kind") == "reviewer"
            else 1
        )
        review_span = _review_span_id(
            state["trace_run_id"], task_id, retry_count, current_review_attempt
        )
        generation_span = _generation_span_id(
            state["trace_run_id"], task_id, retry_count
        )
        _emit(
            trace_event(
                run_id=state["trace_run_id"],
                agent="reviewer",
                kind="review",
                title=f"审核《{task.get('title') or task_id}》",
                status="running",
                phase="review",
                action="执行结构、证据、语义事实和可执行性门禁",
                observation="候选资料已进入审核，尚未发布",
                decision_summary="只有所有阻断门禁通过的版本才可持久化。",
                span_id=review_span,
                parent_span_id=generation_span,
                task_id=task_id,
                attempt=current_review_attempt,
                action_type="review_gate",
            )
        )
        try:
            cancellation_checkpoint(state["trace_run_id"])
            prepared = prepared_reviews.get(task_id) or {}
            if prepared.get("error") is not None:
                raise prepared["error"]
            review = prepared["review"]
            scoped_kb = prepared["scoped_kb"]
            semantic = prepared["semantic"]
            # Every generated candidate must pass the production semantic-fact
            # reviewer.  Provider/parsing failures raise ReviewUnavailable and
            # are mapped below to the independent review_unavailable state;
            # deterministic structure/lexical checks can never approve alone.
            review = apply_grounding_gate(
                review,
                resource,
                task,
                scoped_kb,
                semantic_verifier=lambda *_args, verdict=semantic: verdict,
            )
            review_payload = {
                **review.model_dump(mode="json"),
                "retry_count": retry_count,
                "failure_kind": "quality",
                "retryable": True,
                "review_attempt": current_review_attempt,
            }
        except RunCancelled:
            raise
        except RunBudgetExceeded as exc:
            message = _budget_issue(exc, state, action="审核")
            review_payload = {
                "approved": False,
                "score": 0.0,
                "issues": [message],
                "blocking_issues": [message],
                "warnings": [],
                "fixes": [],
                "repair_instructions": [],
                "retry_count": retry_count,
                "failure_kind": "budget",
                "gate_status": "review_unavailable",
                "error_code": _budget_error_code(exc),
                "retryable": True,
                "service_recoverable": True,
                "review_attempt": current_review_attempt,
            }
        except Exception as exc:
            service_recoverable = _generation_error_is_retryable(exc)
            message = f"审核基础设施不可用：{type(exc).__name__}"
            review_payload = {
                "approved": False,
                "score": 0.0,
                "issues": [message],
                "blocking_issues": [message],
                "warnings": [],
                "fixes": [],
                "repair_instructions": [],
                "retry_count": retry_count,
                "failure_kind": "reviewer",
                "gate_status": "review_unavailable",
                "error_code": "review_unavailable",
                "retryable": service_recoverable,
                "service_recoverable": service_recoverable,
                "review_attempt": current_review_attempt,
            }
        current_fingerprints = [
            str(item)
            for item in review_payload.get("blocking_fingerprints") or []
            if str(item)
        ]
        repair_history = [
            str(item)
            for item in (
                previous_review.get("repair_history_fingerprints")
                or previous_review.get("blocking_fingerprints")
                or []
            )
            if str(item)
        ]
        repeated = [fingerprint for fingerprint in current_fingerprints if fingerprint in repair_history]
        if repeated:
            review_payload["repair_instructions"] = _upgrade_repeated_instructions(
                list(review_payload.get("repair_instructions") or []),
                set(repeated),
            )
        review_payload["repeated_fingerprints"] = repeated
        review_payload["repair_history_fingerprints"] = list(
            dict.fromkeys([*repair_history, *current_fingerprints])
        )[:24]
        review_payload = _auto_release_after_rework_limit(review_payload, resource)
        review_payload["terminal"] = not _review_can_retry(review_payload, state)
        failure_kind = str(review_payload.get("failure_kind") or "")
        reviewer_unavailable = failure_kind in {"reviewer", "budget"}
        budget_ended = failure_kind == "budget"
        _emit(
            trace_event(
                run_id=state["trace_run_id"],
                agent="reviewer",
                kind="review",
                title=f"审核《{task.get('title') or task_id}》",
                status="failed" if reviewer_unavailable else "completed",
                phase="review",
                observation=(
                    str((review_payload.get("issues") or [""])[0])
                    if budget_ended
                    else "审核基础设施不可用，未放行候选资料"
                    if failure_kind == "reviewer"
                    else "候选资料已完成返工并获准发布"
                    if review_payload.get("auto_released")
                    else "全部门禁通过，资料获准发布"
                    if review_payload.get("approved")
                    else "资料未通过门禁，已形成可执行返工要求"
                ),
                decision_summary=(
                    "停止本轮后续调用，保留已通过资料并报告预算终止原因"
                    if budget_ended
                    else "停止审核重试并报告基础设施故障"
                    if failure_kind == "reviewer" and review_payload["terminal"]
                    else "在有界预算内重试审核"
                    if reviewer_unavailable
                    else "批准返工后的候选资料"
                    if review_payload.get("auto_released")
                    else "批准候选资料"
                    if review_payload.get("approved")
                    else "驳回候选并仅重做失败任务"
                ),
                span_id=review_span,
                parent_span_id=generation_span,
                task_id=task_id,
                attempt=current_review_attempt,
                action_type="review_gate",
                evidence_ids=[str(item) for item in review_payload.get("evidence_ids") or []],
                error_code=review_payload.get("error_code"),
                retryable=bool(review_payload.get("retryable") and not review_payload["terminal"]),
            )
        )
        reviews[task_id] = review_payload
        _emit(
            {
                "event": "task_review",
                "task_id": task_id,
                **review_payload,
            }
        )
    if announce_batch:
        budget_ended = any(
            item.get("failure_kind") == "budget" for item in reviews.values()
        )
        reviewer_unavailable = any(
            item.get("failure_kind") == "reviewer" for item in reviews.values()
        )
        _emit(
            phase_trace_event(
                run_id=state["trace_run_id"],
                phase="review",
                status=(
                    "failed"
                    if any(
                        item.get("gate_status") == "review_unavailable"
                        for item in reviews.values()
                    )
                    else "completed"
                ),
                detail=(
                    "本次运行预算已结束，未完成审核的候选资料不会发布"
                    if budget_ended
                    else "审核基础设施不可用，未放行任何未完成审核的资料"
                    if reviewer_unavailable
                    else "本轮质量审核完成"
                ),
                progress=100,
            )
        )
    return {"reviews": reviews}


def generate_and_review_task(state: PlannedResourceState) -> dict[str, Any]:
    """Run one task as a pipeline so review overlaps other task generations.

    LangGraph otherwise places a superstep barrier between the parallel
    generation fan-out and the batch reviewer.  Keeping generation and review
    in the same branch changes the critical path from
    ``max(generation) + max(review)`` to ``max(generation + review)`` without
    increasing either model-call count or the one-rework budget.
    """

    generated = run_planned_task(state)
    resources = list(generated.get("resources") or [])
    if not resources:
        return generated

    resource = resources[-1]
    task_id = str(resource.get("task_id") or "")
    review_state = {
        **state,
        **generated,
        "resources": [resource],
        "reviews": {
            **dict(state.get("reviews") or {}),
            **dict(generated.get("reviews") or {}),
        },
    }
    reviewed = review_tasks(review_state, announce_batch=False)
    latest_review = dict((reviewed.get("reviews") or {}).get(task_id) or {})
    return {
        **generated,
        "reviews": {task_id: latest_review} if task_id and latest_review else {},
    }


def route_after_quality_review(state: PlannedResourceState):
    tasks = {
        str(task.get("task_id")): task
        for task in (state.get("plan") or {}).get("tasks") or []
    }
    sends: list[Send] = []
    reviewer_retry_pending = False
    for task_id, review in (state.get("reviews") or {}).items():
        if not _review_can_retry(review, state):
            continue
        if review.get("failure_kind") == "reviewer":
            reviewer_retry_pending = True
            continue
        task = tasks.get(task_id)
        if task is None:
            continue
        retry_task = _retry_task_for_review(state, task, review)
        _emit_rework_started(state, retry_task)
        sends.append(Send("generate_task", {**state, "plan_task": retry_task}))
    if sends:
        return sends
    if reviewer_retry_pending:
        return "review_tasks"

    terminal = _terminal_task_ids(state)
    if any(task_id not in terminal for task_id in tasks):
        return "dispatch_tasks"
    return "coverage"


def coverage_node(state: PlannedResourceState) -> dict[str, Any]:
    run_id = str(state.get("trace_run_id") or "plan-coverage")
    cancellation_checkpoint(run_id)
    reviews = dict(state.get("reviews") or {})
    budget_ended = any(
        item.get("failure_kind") == "budget" for item in reviews.values()
    )
    reviewer_unavailable = any(
        item.get("failure_kind") == "reviewer" for item in reviews.values()
    )
    _emit(
        phase_trace_event(
            run_id=run_id,
            phase="generation",
            status="completed",
            detail="规划内资料生成与单项返工已结束",
            progress=100,
        )
    )
    _emit(
        phase_trace_event(
            run_id=run_id,
            phase="review",
            status="failed" if budget_ended or reviewer_unavailable else "completed",
            detail=(
                "本次运行预算已结束，未完成审核的候选资料不会发布"
                if budget_ended
                else "审核基础设施不可用，未放行未完成审核的资料"
                if reviewer_unavailable
                else "逐项质量审核完成，准备整理已放行资料"
            ),
            progress=100,
        )
    )
    plan = PlanArtifact.model_validate(state["plan"])
    coverage = audit_plan_coverage(
        plan,
        list(state.get("resources") or []),
        reviews,
    )
    _emit({"event": "coverage", **coverage})
    return {"coverage": coverage}


def route_after_coverage(state: PlannedResourceState):
    repaired = set(state.get("repair_task_ids") or [])
    missing = [
        task_id
        for task_id in (state.get("coverage") or {}).get("missing_task_ids") or []
        if task_id not in repaired
    ]
    if not missing:
        return "integrate"
    tasks = {
        str(task.get("task_id")): task
        for task in (state.get("plan") or {}).get("tasks") or []
    }
    sends: list[Send] = []
    for task_id in missing:
        task = tasks.get(task_id)
        if task is None:
            continue
        if any(
            not (state.get("reviews") or {}).get(str(dependency_id), {}).get("approved")
            for dependency_id in task.get("depends_on") or []
        ):
            continue
        previous_review = (state.get("reviews") or {}).get(task_id) or {}
        # Coverage repair is for a missing deliverable, not an escape hatch
        # around the review retry budget for an already-reviewed resource.
        # A generation/review failure already owns its retry policy.  Coverage
        # must not revive a terminal authentication, quota, model, or exhausted
        # task merely because it has no deliverable to count yet.
        if previous_review:
            continue
        previous_retries = int(previous_review.get("retry_count") or 0)
        repair_task = {
            **task,
            "status": "failed",
            "retry_count": previous_retries + 1,
            "_coverage_repair": True,
            "_revise_note": "覆盖审计发现该规划任务没有可交付资料，请严格按原大纲重新生成。",
        }
        sends.append(Send("generate_task", {**state, "plan_task": repair_task}))
    return sends or "integrate"


def integration_node(state: PlannedResourceState) -> dict[str, Any]:
    cancellation_checkpoint(state["trace_run_id"])
    approved_count = sum(
        bool(review.get("approved"))
        for review in (state.get("reviews") or {}).values()
    )
    _emit_orchestrator_reasoning(
        state,
        key=f"before:integration:{approved_count}",
        phase="integration",
        text=(
            f"生成与审核工具已经返回，我现在调用整理能力统一处理 {approved_count} 份"
            "已通过资料；未通过或未完成审核的候选不会进入发布结果。"
        ),
    )
    _emit(
        phase_trace_event(
            run_id=state["trace_run_id"],
            phase="integration",
            status="running",
            detail="正在去重并绑定每天的资料和学习动作",
        )
    )
    plan = PlanArtifact.model_validate(state["plan"])
    integration = integrate_approved_plan(
        plan,
        list(state.get("resources") or []),
        dict(state.get("reviews") or {}),
    )
    # ``resources`` uses an append reducer because parallel generation nodes
    # contribute independently.  Appending the composite handout here would
    # therefore create a second resource with the same task_id.  Replace the
    # final approved instance in place so downstream snapshots keep one item
    # per planned task while the lecture gains its embedded reading/code.
    for composite in integration.get("composite_resources") or []:
        task_id = str(composite.get("task_id") or "")
        if not task_id:
            continue
        for resource in reversed(state.get("resources") or []):
            if str(resource.get("task_id") or "") == task_id:
                resource.clear()
                resource.update(composite)
                break
    _emit(
        {
            "event": "schedule",
            "schedule": integration["schedule"],
            "coverage": integration["coverage"],
        }
    )
    _emit(
        phase_trace_event(
            run_id=state["trace_run_id"],
            phase="integration",
            status="completed",
            detail="资料、术语和每日学习步骤已统一整合",
            progress=100,
        )
    )
    schedule_count = len(integration.get("schedule") or [])
    _emit_orchestrator_reasoning(
        state,
        key=f"after:integration:{approved_count}:{schedule_count}",
        phase="integration",
        text=(
            f"整理工具已返回：{approved_count} 份已通过资料已绑定到 "
            f"{schedule_count} 个学习步骤。接下来只发布这些已放行内容，并明确报告失败项。"
        ),
    )
    return {
        "coverage": integration["coverage"],
        "integration": integration,
        "schedule": integration["schedule"],
        "resources": [],
    }


def finalize_generation(state: PlannedResourceState) -> dict[str, Any]:
    cancellation_checkpoint(state["trace_run_id"])
    task_total = len((state.get("plan") or {}).get("tasks") or [])
    generated_total = len(
        {
            str(resource.get("task_id"))
            for resource in state.get("resources") or []
            if resource.get("task_id")
        }
    )
    ready_total = sum(
        1 for review in (state.get("reviews") or {}).values() if review.get("approved")
    )
    failed_total = task_total - ready_total
    failed_reviews = [
        dict(review or {})
        for review in (state.get("reviews") or {}).values()
        if not review.get("approved")
    ]
    budget_review = next(
        (
            review
            for review in failed_reviews
            if review.get("failure_kind") == "budget"
        ),
        None,
    )
    reviewer_failed = any(
        review.get("failure_kind") == "reviewer" for review in failed_reviews
    )
    failure_detail = (
        str((budget_review.get("issues") or [""])[0])
        if budget_review
        else "审核服务暂时不可用，候选资料未发布"
        if reviewer_failed
        else "资料在一次定向返工后仍未通过质量门禁"
    )
    _emit(
        phase_trace_event(
            run_id=state["trace_run_id"],
            phase="delivery",
            status="running",
            detail="正在交付可直接打开的学习路径",
        )
    )
    delivery_completed = failed_total == 0
    _emit(
        phase_trace_event(
            run_id=state["trace_run_id"],
            phase="delivery",
            status="completed" if delivery_completed else "failed",
            detail=(
                "学习资料与每日路径已交付"
                if delivery_completed
                else f"仍有 {failed_total} 份资料未完成：{failure_detail}"
            ),
            progress=100,
        )
    )
    _emit_orchestrator_reasoning(
        state,
        key=f"after:delivery:{ready_total}:{failed_total}:"
        f"{(budget_review or {}).get('error_code') or ''}",
        phase="delivery",
        text=(
            f"交付门禁已返回：{ready_total}/{task_total} 份资料可以发布。"
            + (
                "全部资料已通过，生成流程可以完成。"
                if delivery_completed
                else f"另外 {failed_total} 份未发布，原因是{failure_detail}；主对话会明确显示本次未完成。"
            )
        ),
    )
    _emit(
        {
            "event": "done",
            "task_total": task_total,
            "generated_total": generated_total,
            "ready_total": ready_total,
            "failed_total": failed_total,
            "completed": delivery_completed,
            "error_code": (
                None
                if delivery_completed
                else (budget_review or {}).get("error_code")
                or "resource_review_failed"
            ),
            "failure_detail": "" if delivery_completed else failure_detail,
        }
    )
    return {}


def build_graph():
    graph = StateGraph(PlannedResourceState)
    graph.add_node("dispatch_tasks", lambda state: {})
    graph.add_node("generate_task", generate_and_review_task)
    graph.add_node("review_tasks", review_tasks)
    graph.add_node("coverage", coverage_node)
    graph.add_node("integrate", integration_node)
    graph.add_node("finalize", finalize_generation)
    graph.add_edge(START, "dispatch_tasks")
    graph.add_conditional_edges(
        "dispatch_tasks",
        dispatch_tasks,
        ["generate_task", "review_tasks", "coverage"],
    )
    graph.add_edge("generate_task", "dispatch_tasks")
    graph.add_conditional_edges(
        "review_tasks",
        route_after_quality_review,
        ["generate_task", "review_tasks", "dispatch_tasks", "coverage"],
    )
    graph.add_conditional_edges(
        "coverage",
        route_after_coverage,
        ["generate_task", "integrate"],
    )
    graph.add_edge("integrate", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


planned_resource_app = build_graph()
