"""One production adapter for ad-hoc planned resource generation.

The editable learning-path API already executes ``planned_resource_app``.  The
form, chat tool, and compatibility resource endpoint use this adapter so every
production entry follows the same plan -> generate -> review -> bounded repair
-> approved-only persistence -> public trace lifecycle.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from app.core.agent_trace import (
    finish_trace_run,
    root_span_id,
    start_trace_run,
    trace_event,
    trace_span_id,
)
from app.core.config import settings
from app.core.run_control import (
    RunBudgetExceeded,
    RunCancelled,
    acknowledge_run_cancel,
    cancellation_checkpoint,
    register_run,
    release_run,
    reserve_model_calls,
    request_run_cancel,
)
from app.core.sse import astream_via_thread
from app.core.llm import parse_json_response
from app.graph.planned_resource_graph import planned_resource_app
from app.schemas.resource import ResourceRequest
from app.schemas.resource_plan import (
    OutlineSection,
    PlanArtifact,
    PlanComplexity,
    PlanConstraints,
    PlanValidation,
    PlannedDay,
    PlannedResourceTask,
    ResourceOutline,
)
from app.services.knowledge_gate import check_knowledge_gate
from app.services.media.task import ensure_video_render_tasks
from app.services.resource_plan_builder import PlanBuildError, build_resource_plan
from app.services.resource_planning import normalize_plan_task_types, validate_plan

RESOURCE_TYPES: tuple[str, ...] = (
    "explainer",
    "mindmap",
    "quiz",
    "solution",
    "reading",
    "code",
    "video",
    "courseware",
    "interactive",
)

PIPELINE_RETRY_POLICY: dict[str, int | float] = {
    # One initial candidate plus one targeted regeneration. If the regenerated
    # candidate still misses a quality gate, the graph publishes it with
    # explicit warnings instead of starting another repair cycle.
    "max_task_retries": 1,
    "max_reviewer_attempts": 2,
    "max_run_seconds": 300.0,
    "max_total_attempts": 36,
    "max_model_calls": 36,
    "max_identical_failures": 3,
}

PersistApproved = Callable[[list[dict[str, Any]]], Awaitable[int]]


def public_resource_stream_text(resource: dict[str, Any]) -> str:
    """Render approved output as readable prose, never as a JSON transport dump."""

    normalized = dict(resource)
    raw_content = normalized.get("content")
    if isinstance(raw_content, str) and raw_content.strip().startswith(("{", "```")):
        try:
            recovered = parse_json_response(raw_content)
        except (TypeError, ValueError):
            recovered = None
        if isinstance(recovered, dict):
            normalized.update(recovered)

    resource_type = str(normalized.get("type") or "resource")
    title = str(normalized.get("title") or _TYPE_LABELS.get(resource_type, "学习资料"))
    parts = [f"### {title}\n"]

    if resource_type in {"reading", "code"}:
        parts.append("内容已审核通过，并将插入当天讲义的对应知识点位置。")
    elif resource_type in {"quiz", "solution"}:
        questions = normalized.get("questions")
        count = len(questions) if isinstance(questions, list) else 0
        parts.append(
            f"已生成 {count or '完整'} 道题目并附逐题答案解析。"
            if resource_type == "solution"
            else f"已生成 {count or '完整'} 道练习题，提交后系统会按真实答题结果判定完成。"
        )
    elif resource_type == "video":
        parts.append("视频脚本已审核通过，MP4 正在后台自动渲染。")
    else:
        visible: list[str] = []
        for field in ("overview", "summary", "description", "explanation", "content"):
            value = normalized.get(field)
            if not isinstance(value, str):
                continue
            value = value.strip()
            if not value or value.startswith(("{", "```json")) or value in visible:
                continue
            visible.append(value)
        body = "\n\n".join(visible).strip()
        if body:
            # Keep the chat readable for large multi-day plans; the complete
            # approved object follows in the structured content event/viewer.
            parts.append(body[:900] + ("\n\n完整内容已生成，可在资料中继续阅读。" if len(body) > 900 else ""))
        else:
            parts.append("资料已通过审核，可以打开查看完整内容。")
    return "\n".join(parts).rstrip() + "\n"


def _approved_output_chunks(resource: dict[str, Any], size: int = 180) -> list[str]:
    text = public_resource_stream_text(resource)
    return [text[index : index + size] for index in range(0, len(text), size)]


class _PipelineTerminal(RuntimeError):
    """Internal control flow for an already-emitted blocked terminal."""

_TYPE_LABELS = {
    "explainer": "概念讲解",
    "mindmap": "思维导图",
    "quiz": "练习题",
    "solution": "题目解析",
    "reading": "拓展阅读",
    "code": "代码案例",
    "video": "讲解短片",
    "courseware": "课件",
    "interactive": "交互演示",
}

_TYPE_CRITERIA = {
    "explainer": ["正文至少 300 字", "包含定义、示例和常见误区"],
    "mindmap": ["至少 3 个一级分支且包含二级节点", "节点标签不得重复"],
    "quiz": ["每道题必须包含题干、答案和解析", "选择题必须包含至少 2 个选项"],
    "solution": ["每道题必须同时包含题干、答案和完整解析", "选择题必须包含至少 2 个选项"],
    "reading": ["正文至少 500 字", "包含来源引用和读后问题"],
    "code": ["Python 代码必须可运行", "包含复杂度说明和异常边界"],
    "video": ["包含至少 2 个连续章节内容", "总时长必须在 150 到 300 秒之间"],
    "courseware": ["至少 8 页有效幻灯片", "每页必须包含标题和内容"],
    "interactive": ["必须说明演示展示的核心概念与操作方式", "结构清晰且在无网络沙箱中可运行"],
}


def _request_text(req: ResourceRequest, forced_types: list[str]) -> str:
    parts = [req.topic, req.requirements, req.knowledge_points, req.assessment_context]
    if forced_types:
        parts.append("必须且仅生成这些资料类型：" + "、".join(forced_types))
    return "\n".join(part.strip() for part in parts if part and part.strip())


def _topic(req: ResourceRequest) -> str:
    return (req.topic or req.knowledge_points or "学习资料").strip()[:160]


def _forced_types(req: ResourceRequest) -> list[str]:
    return list(
        dict.fromkeys(
            item for item in req.material_types if item in RESOURCE_TYPES
        )
    )


def _fallback_task(
    *,
    resource_type: str,
    index: int,
    req: ResourceRequest,
    source_ids: list[str],
) -> PlannedResourceTask:
    topic = _topic(req)
    label = _TYPE_LABELS[resource_type]
    requirements = (req.requirements or req.assessment_context or "").strip()
    objective = f"围绕{topic}生成一份可直接学习、可审核的{label}。"
    if requirements:
        objective += f"同时满足：{requirements[:240]}"
    must_cover = list(
        dict.fromkeys(
            item.strip()
            for item in re.split(r"[,，、;；\n]+", req.knowledge_points or topic)
            if item.strip()
        )
    )[:4] or [topic]
    criteria = list(_TYPE_CRITERIA[resource_type])
    quiz_config: dict[str, int] = {}
    if resource_type in {"quiz", "solution"} and req.quiz_config is not None:
        quiz_config = req.quiz_config.model_dump(mode="json")
        total = sum(int(value) for value in quiz_config.values())
        if total > 0:
            criteria.insert(0, f"必须生成 {total} 道题")
    return PlannedResourceTask(
        task_id=f"material-{index + 1}-{resource_type}",
        day="D1",
        agent="quiz" if resource_type == "solution" else resource_type,
        type=resource_type,
        title=f"{topic} · {label}",
        knowledge_points=must_cover,
        difficulty="适中",
        audience="当前学习者",
        outline=ResourceOutline(
            objective=objective,
            sections=[
                OutlineSection(
                    title="核心内容",
                    goal=f"准确讲清{topic}的核心概念与学习目标",
                    must_cover=must_cover,
                    target_words=500 if resource_type == "reading" else 300,
                ),
                OutlineSection(
                    title="应用与检查",
                    goal="提供可执行示例、练习或自检步骤",
                    must_cover=must_cover,
                    target_words=300,
                ),
            ],
        ),
        quality_criteria=criteria,
        quiz_config=quiz_config,
        source_ids=source_ids,
        depends_on=[],
    )


def build_explicit_request_plan(
    req: ResourceRequest,
    kb_context: list[dict[str, Any]],
) -> PlanArtifact:
    """Compile an explicit type selection into a validated server-owned plan.

    A form selection is already a complete scheduling decision. Sending it to a
    model first made valid one-resource requests depend on an unrelated draft
    shape and occasionally fail before the deterministic projection ran. This
    compiler performs the real constraint work without claiming an LLM call;
    generation and semantic review remain model-backed and fail closed.
    """

    forced = _forced_types(req)
    if not forced:
        raise ValueError("explicit plan requires at least one resource type")
    source_ids = [str(item.get("id") or "") for item in kb_context if item.get("id")]
    tasks = [
        _fallback_task(
            resource_type=resource_type,
            index=index,
            req=req,
            source_ids=source_ids,
        )
        for index, resource_type in enumerate(forced)
    ]
    minutes = min(120, max(15, 20 * len(tasks)))
    topic = _topic(req)
    plan = PlanArtifact(
        plan_id=f"plan-{uuid.uuid4().hex[:16]}",
        student_id=req.student_id,
        version=1,
        status="approved",
        request_summary=f"生成并审核{topic}的指定学习资料"[:500],
        complexity=PlanComplexity(
            level="simple",
            reasons=["用户已显式选择资料类型"],
            auto_execute=True,
        ),
        constraints=PlanConstraints(
            days=1,
            daily_minutes=minutes,
            difficulty="适中",
            material_types=forced,
        ),
        days=[
            PlannedDay(
                day="D1",
                title=f"{topic}资料生成",
                knowledge_points=list(
                    dict.fromkeys(point for task in tasks for point in task.knowledge_points)
                )[:16],
                objective=f"生成并审核{topic}的指定学习资料",
                minutes=minutes,
                prerequisites=[],
                task_ids=[task.task_id for task in tasks],
                actions=["生成候选资料", "执行质量审核", "保存审核通过版本"],
            )
        ],
        tasks=tasks,
        validation=PlanValidation(valid=True),
    )
    plan.validation = validate_plan(plan)
    if not plan.validation.valid:
        raise PlanBuildError(
            "plan_policy_invalid",
            "显式资源规划未通过执行前校验",
            retryable=False,
        )
    return plan


def project_plan_to_request(
    plan: PlanArtifact,
    req: ResourceRequest,
    kb_context: list[dict[str, Any]],
) -> PlanArtifact:
    """Make explicit form selections deterministic without bypassing planning."""

    plan = normalize_plan_task_types(plan.model_copy(deep=True))
    forced = _forced_types(req)
    source_ids = [str(item.get("id") or "") for item in kb_context if item.get("id")]
    if forced:
        first_by_type: dict[str, PlannedResourceTask] = {}
        for task in plan.tasks:
            first_by_type.setdefault(task.type, task)
        projected: list[PlannedResourceTask] = []
        for index, resource_type in enumerate(forced):
            original = first_by_type.get(resource_type)
            if original is None:
                task = _fallback_task(
                    resource_type=resource_type,
                    index=index,
                    req=req,
                    source_ids=source_ids,
                )
            else:
                task = original.model_copy(deep=True)
                task.task_id = f"material-{index + 1}-{resource_type}"
                task.day = "D1"
                task.depends_on = []
                task.source_ids = source_ids
                task.agent = "quiz" if resource_type == "solution" else resource_type
                if resource_type in {"quiz", "solution"} and req.quiz_config is not None:
                    task.quiz_config = req.quiz_config.model_dump(mode="json")
                    total = sum(task.quiz_config.values())
                    if total > 0 and not any(
                        str(total) in criterion and "题" in criterion
                        for criterion in task.quality_criteria
                    ):
                        task.quality_criteria = [
                            f"必须生成 {total} 道题",
                            *task.quality_criteria,
                        ][:12]
            projected.append(task)
        plan.tasks = projected
        plan.days = [
            PlannedDay(
                day="D1",
                title=f"{_topic(req)}资料生成",
                knowledge_points=list(
                    dict.fromkeys(
                        point for task in projected for point in task.knowledge_points
                    )
                )[:16],
                objective=f"生成并审核{_topic(req)}的指定学习资料",
                minutes=min(120, max(15, 20 * len(projected))),
                prerequisites=[],
                task_ids=[task.task_id for task in projected],
                actions=["生成候选资料", "执行质量审核", "保存审核通过版本"],
            )
        ]
        plan.constraints.days = 1
        plan.constraints.daily_minutes = plan.days[0].minutes
        plan.constraints.material_types = forced
    for task in plan.tasks:
        if not task.source_ids:
            task.source_ids = source_ids
    plan.status = "approved"
    plan.complexity.level = "simple" if len(plan.days) == 1 else plan.complexity.level
    plan.complexity.auto_execute = True
    plan.validation = validate_plan(plan)
    if not plan.validation.valid:
        raise PlanBuildError(
            "plan_policy_invalid",
            "资源规划未通过执行前校验",
            retryable=True,
        )
    return plan


def approved_resources(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Return only the latest candidate matching an explicit approved review."""

    reviews = dict(state.get("reviews") or {})
    latest: dict[str, dict[str, Any]] = {}
    for resource in state.get("resources") or []:
        if not isinstance(resource, dict):
            continue
        task_id = str(resource.get("task_id") or "")
        if task_id:
            latest[task_id] = resource
    approved: list[dict[str, Any]] = []
    for task_id, resource in latest.items():
        review = dict(reviews.get(task_id) or {})
        if review.get("approved") is not True:
            continue
        if int(review.get("retry_count") or 0) != int(resource.get("retry_count") or 0):
            continue
        approved.append(
            {
                **resource,
                "reviewed": True,
                "review_approved": True,
                "review": review,
            }
        )
    return approved


def _trace_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key != "event"}


async def stream_planned_resource_pipeline(
    req: ResourceRequest,
    *,
    persist: PersistApproved | None,
    source: str,
    parent_run_id: str | None = None,
    run_id: str | None = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Execute the canonical planned graph and expose compatibility events."""

    resolved_run_id = run_id or f"resource_{uuid.uuid4().hex[:12]}"
    topic = _topic(req)
    final_state: dict[str, Any] = {}
    terminal_status = "failed"
    terminal_error = "resource_runtime_interrupted"
    terminal_retryable = True
    terminal_observation = "资源运行中断，未保存未审核候选资料"
    disconnected = False
    run_started_at = time.time()
    register_run(
        resolved_run_id,
        parent_run_id=parent_run_id,
        model_call_limit=int(PIPELINE_RETRY_POLICY["max_model_calls"]),
        owner_id=req.student_id,
    )

    def before_planner_model_call() -> None:
        cancellation_checkpoint(resolved_run_id)
        if time.time() - run_started_at >= float(
            PIPELINE_RETRY_POLICY["max_run_seconds"]
        ):
            raise RunBudgetExceeded(
                f"run {resolved_run_id} wall-clock budget exhausted before planning call",
                error_code="run_time_budget_exhausted",
            )
        reserve_model_calls(resolved_run_id)
    planning_span = trace_span_id(resolved_run_id, "adapter:planning")
    start = start_trace_run(
        resolved_run_id,
        agent="supervisor",
        title="开始资源生成",
        input_summary=topic,
    )
    yield "trace", _trace_payload(start)
    yield "progress", {
        "agent": "supervisor",
        "status": "started",
        "detail": "正在检索依据并制定资源计划",
    }
    forced = _forced_types(req)
    planning_action_type = "constraint_compiler" if forced else "planner_call"
    yield "trace", _trace_payload(
        trace_event(
            run_id=resolved_run_id,
            agent="supervisor",
            kind="plan",
            phase="planning",
            title="制定资源计划",
            status="running",
            action=(
                "把用户显式选择编译为可审核、可执行的资源任务"
                if forced
                else "结合请求、学习画像和知识库生成可执行任务"
            ),
            observation="规划尚未批准执行",
            decision_summary=(
                "显式资料类型是硬约束，不增加隐藏任务。"
                if forced
                else "规划结果必须通过结构与依赖校验。"
            ),
            span_id=planning_span,
            parent_span_id=root_span_id(resolved_run_id),
            action_type=planning_action_type,
        )
    )

    try:
        gate = await asyncio.to_thread(
            check_knowledge_gate,
            topic,
            req.student_id,
            10,
        )
        if not gate.matched:
            blocked = gate.error_payload()
            terminal_status = "blocked"
            terminal_error = str(blocked.get("code") or "knowledge_gate_blocked")
            terminal_retryable = bool(blocked.get("retryable", False))
            terminal_observation = str(blocked.get("message") or "知识库没有可靠依据")
            yield "blocked", blocked
            raise _PipelineTerminal

        try:
            from app.agents.profiler import get_profile

            profile = await asyncio.to_thread(get_profile, req.student_id) or {}
        except Exception:
            profile = {}

        request_text = _request_text(req, forced)
        cancellation_checkpoint(resolved_run_id)
        if forced:
            plan = build_explicit_request_plan(req, gate.context)
        else:
            plan = await asyncio.to_thread(
                build_resource_plan,
                request_text=request_text,
                student_id=req.student_id,
                profile=profile,
                kb_context=gate.context,
                continuous_retry=False,
                before_model_call=before_planner_model_call,
            )
            plan.student_id = req.student_id
            plan = project_plan_to_request(plan, req, gate.context)
        cancellation_checkpoint(resolved_run_id)
        modules = [task.type for task in plan.tasks]
        yield "trace", _trace_payload(
            trace_event(
                run_id=resolved_run_id,
                agent="supervisor",
                kind="plan",
                phase="planning",
                title="制定资源计划",
                status="completed",
                action="锁定任务、资料类型和审核标准",
                observation=f"已形成 {len(plan.tasks)} 个可执行任务",
                decision_summary="计划已通过结构与依赖校验，进入统一生成管线。",
                span_id=planning_span,
                parent_span_id=root_span_id(resolved_run_id),
                action_type=planning_action_type,
            )
        )
        yield "plan", {
            "run_id": resolved_run_id,
            "plan_id": plan.plan_id,
            "topic": topic,
            "modules": modules,
            "tasks": [
                {
                    "task_id": task.task_id,
                    "type": task.type,
                    "title": task.title,
                }
                for task in plan.tasks
            ],
        }

        from app.graph.planned_resource_graph import build_planned_state

        state = build_planned_state(
            plan,
            {
                "trace_run_id": resolved_run_id,
                "parent_run_id": parent_run_id or "",
                "run_started_at": run_started_at,
                "retry_policy": PIPELINE_RETRY_POLICY,
            },
        )
        state["profile"] = profile
        state["kb_context"] = gate.context
        state["knowledge_gate_enforced"] = True

        async for chunk in astream_via_thread(
            planned_resource_app,
            state,
            ["custom", "values"],
            config={
                "max_concurrency": min(30, max(1, settings.AGENT_MAX_CONCURRENCY)),
                "recursion_limit": 256,
            },
        ):
            mode, payload = (
                chunk
                if isinstance(chunk, tuple) and len(chunk) == 2
                else ("custom", chunk)
            )
            if mode == "values" and isinstance(payload, dict):
                final_state = payload
                continue
            if mode != "custom" or not isinstance(payload, dict):
                continue
            event = str(payload.get("event") or "message")
            # Candidate content is audit evidence, not a published resource.
            # It is emitted only after the matching final review is approved.
            if event in {"content", "done"}:
                continue
            yield event, payload
            if event == "task_progress":
                status = str(payload.get("status") or "")
                if status in {"running", "rework", "generated"}:
                    yield "progress", {
                        "agent": str(payload.get("agent") or "supervisor"),
                        "status": "started" if status != "generated" else "completed",
                        "detail": str(payload.get("detail") or ""),
                        "retry": status == "rework",
                        "task_id": payload.get("task_id"),
                    }
            elif event == "task_review":
                yield "progress", {
                    "agent": "reviewer",
                    "status": "completed" if payload.get("approved") else "rework",
                    "detail": (
                        "审核通过"
                        if payload.get("approved")
                        else "审核驳回，按结构化修复意见返工"
                    ),
                    "task_id": payload.get("task_id"),
                }

        approved = approved_resources(final_state)
        approved = ensure_video_render_tasks(approved, student_id=req.student_id)
        for resource in approved:
            resource_type = str(resource.get("type") or "resource")
            task_id = resource.get("task_id")
            yield "content_start", {
                "task_id": task_id,
                "type": resource_type,
                "review_approved": True,
            }
            for delta in _approved_output_chunks(resource):
                yield "content_delta", {
                    "task_id": task_id,
                    "type": resource_type,
                    "delta": delta,
                    "review_approved": True,
                }
                await asyncio.sleep(0)
            yield "content", {
                "task_id": task_id,
                "agent": resource_type,
                "type": resource_type,
                "data": resource,
                "review_approved": True,
            }

        saved = 0
        if persist is not None and approved:
            cancellation_checkpoint(resolved_run_id)
            persistence_span = trace_span_id(resolved_run_id, "adapter:persistence")
            yield "trace", _trace_payload(
                trace_event(
                    run_id=resolved_run_id,
                    agent="publisher",
                    kind="integration",
                    phase="persistence",
                    title="保存审核通过资料",
                    status="running",
                    action="只保存与最终批准审核版本匹配的资料",
                    observation=f"等待保存 {len(approved)} 份批准资料",
                    decision_summary="被驳回、审核不可用或版本不匹配的候选不会进入资源中心。",
                    span_id=persistence_span,
                    parent_span_id=root_span_id(resolved_run_id),
                    action_type="persistence_gate",
                )
            )
            saved = await persist(approved)
            cancellation_checkpoint(resolved_run_id)
            yield "trace", _trace_payload(
                trace_event(
                    run_id=resolved_run_id,
                    agent="publisher",
                    kind="integration",
                    phase="persistence",
                    title="保存审核通过资料",
                    status="completed",
                    action="提交批准资料",
                    observation=f"已保存 {saved} 份批准资料",
                    decision_summary="持久化门禁已完成。",
                    span_id=persistence_span,
                    parent_span_id=root_span_id(resolved_run_id),
                    action_type="persistence_gate",
                )
            )
        yield "saved", {"count": saved, "source": source}

        task_total = len(plan.tasks)
        terminal_status = "completed" if task_total > 0 and len(approved) == task_total else "failed"
        terminal_error = "" if terminal_status == "completed" else "resource_review_failed"
        terminal_retryable = terminal_status != "completed"
        terminal_observation = (
            f"{len(approved)} 份资料已通过审核并完成持久化"
            if terminal_status == "completed"
            else f"{task_total - len(approved)} 份资料在受限返工后仍未通过审核"
        )
    except _PipelineTerminal:
        pass
    except PlanBuildError as exc:
        terminal_error = exc.code
        terminal_retryable = exc.retryable
        terminal_observation = str(exc)
        yield "error", exc.payload()
    except RunBudgetExceeded as exc:
        terminal_status = "blocked"
        terminal_error = str(
            getattr(exc, "error_code", "") or "run_budget_exhausted"
        )
        terminal_retryable = True
        terminal_observation = str(exc)
        yield "error", {
            "code": terminal_error,
            "message": (
                "本次资源运行达到时限，未审核候选资料未保存"
                if terminal_error == "run_time_budget_exhausted"
                else "本次资源运行的模型调用次数已达上限，未审核候选资料未保存"
            ),
            "retryable": True,
        }
    except RunCancelled:
        terminal_status = "cancelled"
        terminal_error = "cancelled_by_user"
        terminal_retryable = False
        terminal_observation = "运行已取消，未启动后续模型调用或持久化"
    except asyncio.CancelledError:
        terminal_status = "cancelled"
        terminal_error = "client_disconnected"
        terminal_retryable = True
        terminal_observation = "连接中断，已请求停止后续模型调用"
        disconnected = True
    except GeneratorExit:
        request_run_cancel(resolved_run_id)
        finish_trace_run(
            resolved_run_id,
            status="cancelled",
            observation="连接已关闭，已请求停止后续模型调用",
            error_code="client_disconnected",
            retryable=True,
        )
        release_run(resolved_run_id)
        raise
    except Exception as exc:  # noqa: BLE001
        terminal_observation = f"资源运行中断：{type(exc).__name__}"
        yield "error", {
            "code": terminal_error,
            "message": "资源生成暂时中断，未审核候选资料未保存",
            "retryable": True,
        }
    finally:
        if disconnected:
            finish_trace_run(
                resolved_run_id,
                status="cancelled",
                observation=terminal_observation,
                error_code=terminal_error,
                retryable=terminal_retryable,
            )
            release_run(resolved_run_id)

    if disconnected:
        raise asyncio.CancelledError

    for event in finish_trace_run(
        resolved_run_id,
        status=terminal_status,  # type: ignore[arg-type]
        observation=terminal_observation,
        error_code=terminal_error or None,
        retryable=terminal_retryable,
    ):
        yield "trace", _trace_payload(event)
    if terminal_status == "cancelled":
        acknowledge_run_cancel(resolved_run_id)
    release_run(resolved_run_id)

    yield "done", {
        "run_id": resolved_run_id,
        "status": terminal_status,
        "completed": terminal_status == "completed",
        "error_code": terminal_error or None,
        "retryable": terminal_retryable,
    }
