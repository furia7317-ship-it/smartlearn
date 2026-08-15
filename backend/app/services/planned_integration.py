"""Exact integration of approved resources into plan-authored daily actions."""

from __future__ import annotations

from typing import Any

from app.core.llm import parse_json_response
from app.schemas.resource_plan import PlanArtifact
from app.services.resource_coverage import audit_plan_coverage, select_best_resources


def _allocate_minutes(total: int, weights: list[float]) -> list[int]:
    """Allocate every selected minute across visible actions, with no drift."""

    if not weights:
        return []
    if total < len(weights):
        raise ValueError("daily minutes cannot cover all scheduled actions")
    remaining = total - len(weights)
    weight_total = sum(weights)
    raw = [remaining * weight / weight_total for weight in weights]
    extras = [int(value) for value in raw]
    leftover = remaining - sum(extras)
    order = sorted(
        range(len(weights)),
        key=lambda index: raw[index] - extras[index],
        reverse=True,
    )
    for index in order[:leftover]:
        extras[index] += 1
    return [extra + 1 for extra in extras]


def _question_count(resource: dict[str, Any]) -> int:
    questions = resource.get("questions")
    return len(questions) if isinstance(questions, list) else 0


def _practice_prompts(day: Any) -> list[str]:
    points = [str(point).strip() for point in day.knowledge_points if str(point).strip()]
    anchor = points[0] if points else day.title
    second = points[1] if len(points) > 1 else anchor
    return [
        f"不看资料，用自己的话解释「{anchor}」的核心概念。",
        f"给「{second}」写一个具体例子或应用场景。",
    ]


def _normalized_generated_payload(resource: dict[str, Any]) -> dict[str, Any]:
    """Recover structured content hidden in a legacy raw JSON fallback."""

    copied = dict(resource)
    candidate = ""
    if str(copied.get("type") or "") == "explainer":
        candidate = str(copied.get("explanation") or "")
    elif str(copied.get("type") or "") == "reading":
        candidate = str(copied.get("content") or "")
    if candidate.lstrip().startswith("```"):
        try:
            recovered = parse_json_response(candidate)
        except (TypeError, ValueError):
            recovered = {}
        if isinstance(recovered, dict):
            copied.update(recovered)
    return copied


def _composite_handout(
    day: Any,
    task_resources: list[tuple[Any, dict[str, Any]]],
) -> dict[str, Any] | None:
    """Build the single daily handout from independently reviewed inputs."""

    normalized = [
        (task, _normalized_generated_payload(resource))
        for task, resource in task_resources
    ]
    base_entry = next(
        ((task, resource) for task, resource in normalized if task.type == "explainer"),
        None,
    )
    if base_entry is None:
        base_entry = next(
            (
                (task, resource)
                for task, resource in normalized
                if task.type in {"reading", "code"}
            ),
            None,
        )
    if base_entry is None:
        return None

    base_task, base = base_entry
    if base_task.type == "reading":
        base = {
            **base,
            "type": "explainer",
            "overview": str(base.get("overview") or f"{day.title}学习讲义"),
            "explanation": str(base.get("content") or ""),
        }
    elif base_task.type == "code":
        base = {
            **base,
            "type": "explainer",
            "overview": str(base.get("overview") or f"{day.title}学习讲义"),
            "explanation": str(base.get("explanation") or day.objective),
        }

    code_examples = [
        resource
        for task, resource in normalized
        if task.type == "code" and task.task_id != base_task.task_id
    ]
    readings = [
        resource
        for task, resource in normalized
        if task.type == "reading" and task.task_id != base_task.task_id
    ]
    source_values: list[Any] = []
    for _, resource in normalized:
        values = resource.get("sources") or resource.get("references") or []
        if isinstance(values, list):
            source_values.extend(values)
    return {
        **base,
        "id": str(base.get("id") or base_task.task_id),
        "task_id": base_task.task_id,
        "type": "explainer",
        "title": f"{day.day} {day.title} · 完整讲义",
        "chapter_id": day.day,
        "embedded_code_examples": code_examples,
        "embedded_readings": readings,
        "embedded_task_ids": [
            task.task_id for task, _ in normalized if task.type in {"reading", "code"}
        ],
        "sources": list(dict.fromkeys(str(value) for value in source_values if value)),
    }


def integrate_approved_plan(
    plan: PlanArtifact,
    resources: list[dict[str, Any]],
    reviews: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    selected, duplicate_resource_ids = select_best_resources(plan, resources, reviews)
    coverage = audit_plan_coverage(plan, resources, reviews)
    ready_ids = set(coverage["ready_task_ids"])
    task_by_id = {task.task_id: task for task in plan.tasks}
    quiz_deliverables = [
        (task, selected[task.task_id])
        for task in plan.tasks
        if task.type == "quiz"
        and task.task_id in ready_ids
        and task.task_id in selected
        and _question_count(selected[task.task_id]) > 0
    ]
    schedule: list[dict[str, Any]] = []
    composite_resources: list[dict[str, Any]] = []

    for day_index, day in enumerate(plan.days):
        task_ids = [task_id for task_id in day.task_ids if task_id in task_by_id]
        approved_day_resources = [
            (task_by_id[task_id], selected[task_id])
            for task_id in task_ids
            if task_id in ready_ids and task_id in selected
        ]
        handout = _composite_handout(day, approved_day_resources)
        if handout is not None:
            composite_resources.append(handout)
        study_task_ids = [
            task_id
            for task_id in task_ids
            if task_by_id[task_id].type not in {"quiz", "reading", "code"}
        ]
        quiz_task_ids = [task_id for task_id in task_ids if task_by_id[task_id].type == "quiz"]
        minute_allocations = _allocate_minutes(day.minutes, [0.55, 0.25, 0.20])
        steps: list[dict[str, Any]] = []

        study_resources: list[dict[str, str]] = []
        if handout is not None:
            study_resources.append(
                {
                    "id": str(handout.get("id") or handout.get("task_id")),
                    "type": "explainer",
                    "title": str(handout.get("title") or f"{day.title}完整讲义"),
                }
            )
        for task_id in study_task_ids:
            task = task_by_id[task_id]
            if task.type == "explainer" and handout is not None:
                continue
            resource = selected.get(task_id) if task_id in ready_ids else None
            if resource is not None:
                study_resources.append(
                    {
                        "id": str(resource.get("id") or task_id),
                        "type": str(resource.get("type") or task.type),
                        "title": str(resource.get("title") or task.title),
                    }
                )
        steps.append(
            {
                "id": f"{day.day.lower()}-study",
                "type": "study",
                "title": f"学习：{day.title}讲义",
                "detail": "；".join(
                    task_by_id[task_id].outline.objective for task_id in study_task_ids
                ) or day.objective,
                "minutes": minute_allocations[0],
                "resource_types": list(
                    dict.fromkeys(
                        (["explainer"] if handout is not None else [])
                        + [
                            task_by_id[task_id].type
                            for task_id in study_task_ids
                            if handout is None or task_by_id[task_id].type != "explainer"
                        ]
                    )
                ),
                "resources": study_resources,
                "status": (
                    "ready"
                    if all(
                        task_id in ready_ids
                        for task_id in task_ids
                        if task_by_id[task_id].type != "quiz"
                    )
                    else "failed"
                ),
                "prompts": [] if study_task_ids else _practice_prompts(day),
                "completion_kind": "resource_read" if study_task_ids else "written_response",
            }
        )

        same_day_quizzes = [
            (task_by_id[task_id], selected[task_id])
            for task_id in quiz_task_ids
            if task_id in ready_ids and task_id in selected and _question_count(selected[task_id]) > 0
        ]
        quiz_task, quiz_resource = (
            same_day_quizzes[0]
            if same_day_quizzes
            else quiz_deliverables[day_index % len(quiz_deliverables)]
            if quiz_deliverables
            else (None, None)
        )
        if quiz_task is not None and quiz_resource is not None:
            quiz_title = str(quiz_resource.get("title") or quiz_task.title)
            count = _question_count(quiz_resource)
            practice_resources = [{
                "id": str(quiz_resource.get("id") or quiz_task.task_id),
                "type": "quiz",
                "title": quiz_title,
            }]
            practice_detail = (
                f"完成《{quiz_title}》中的 {count} 道题；提交答案后系统自动记录真实完成情况。"
            )
            practice_prompts: list[str] = []
            practice_types = ["quiz"]
            completion_kind = "quiz_submission"
        else:
            practice_resources = []
            practice_detail = "回答下面的主动回忆题；提交学习产出后系统自动记录完成情况。"
            practice_prompts = _practice_prompts(day)
            practice_types = []
            completion_kind = "written_response"
        steps.append(
            {
                "id": f"{day.day.lower()}-practice",
                "type": "practice",
                "title": "练习：主动回忆与应用",
                "detail": practice_detail,
                "minutes": minute_allocations[1],
                "resource_types": practice_types,
                "resources": practice_resources,
                "prompts": practice_prompts,
                "status": "ready",
                "completion_kind": completion_kind,
            }
        )
        steps.append(
            {
                "id": f"{day.day.lower()}-review",
                "type": "review",
                "title": "复盘：整理错因与明日问题",
                "detail": "；".join(day.actions),
                "minutes": minute_allocations[2],
                "resource_types": [],
                "resources": [],
                "prompts": [
                    "今天最容易出错的地方是什么？写出原因和正确判断。",
                    "给明天的自己留下一个必须解决的问题。",
                ],
                "status": "ready",
                "completion_kind": "written_response",
            }
        )
        schedule.append(
            {
                "day": day.day,
                "title": day.title,
                "objective": day.objective,
                "knowledge_points": list(day.knowledge_points),
                "minutes": day.minutes,
                "actions": list(day.actions),
                "steps": steps,
            }
        )

    ready_resources = [selected[task.task_id] for task in plan.tasks if task.task_id in ready_ids]
    duplicate_task_ids = sorted(
        {
            str(resource.get("task_id"))
            for resource in resources
            if str(resource.get("id") or "") in set(duplicate_resource_ids)
        }
    )
    terminology = sorted(
        {point for day in plan.days for point in day.knowledge_points},
        key=str.casefold,
    )
    return {
        "title": plan.request_summary,
        "terminology": terminology,
        "duplicate_task_ids": duplicate_task_ids,
        "coverage": coverage,
        "resources": ready_resources,
        "composite_resources": composite_resources,
        "schedule": schedule,
    }
