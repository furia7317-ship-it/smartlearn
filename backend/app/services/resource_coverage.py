"""Coverage audit for approved PlanArtifact tasks and generated resources."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.schemas.resource_plan import PlanArtifact
from app.services.resource_quality import extract_resource_text, is_term_covered


def _reviewed_copy(
    resource: dict[str, Any],
    reviews: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    copied = dict(resource)
    task_id = str(copied.get("task_id") or "")
    review = reviews.get(task_id) or {}
    resource_retry = int(copied.get("retry_count") or 0)
    review_retry = int(review.get("retry_count") or 0)
    # A task can have several generated candidates. The task-level review
    # belongs only to the candidate with the same retry_count; applying it to
    # older candidates can accidentally publish the pre-rework version.
    review_matches_candidate = bool(review) and resource_retry == review_retry
    copied["review_approved"] = bool(
        review.get("approved", False)
        if review_matches_candidate
        else copied.get("review_approved", False)
    )
    copied["review_score"] = float(
        (
            review.get("score", 0.0)
            if review_matches_candidate
            else copied.get("review_score", 0.0)
        )
        or 0.0
    )
    copied["retry_count"] = resource_retry
    if review_matches_candidate:
        copied["review_gate_status"] = str(review.get("gate_status") or "")
        copied["review_auto_released"] = bool(review.get("auto_released"))
        copied["review_warnings"] = list(review.get("warnings") or [])
    return copied


def select_best_resources(
    plan: PlanArtifact,
    resources: list[dict[str, Any]],
    reviews: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    plan_task_ids = {task.task_id for task in plan.tasks}
    grouped: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    review_map = reviews or {}
    for index, resource in enumerate(resources):
        task_id = str(resource.get("task_id") or "")
        if task_id in plan_task_ids:
            grouped[task_id].append((index, _reviewed_copy(resource, review_map)))

    selected: dict[str, dict[str, Any]] = {}
    duplicate_resource_ids: list[str] = []
    for task in plan.tasks:
        candidates = grouped.get(task.task_id) or []
        if not candidates:
            continue
        best_index, best = max(
            candidates,
            key=lambda item: (
                bool(item[1].get("review_approved")),
                int(item[1].get("retry_count") or 0),
                float(item[1].get("review_score") or 0),
                item[0],
            ),
        )
        selected[task.task_id] = best
        duplicate_resource_ids.extend(
            str(candidate.get("id") or task.task_id)
            for index, candidate in candidates
            if index != best_index
        )
    return selected, duplicate_resource_ids


def _outline_gaps(task, resource: dict[str, Any]) -> list[str]:
    must_cover: list[str] = []
    for section in task.outline.sections:
        for term in section.must_cover:
            if term not in must_cover:
                must_cover.append(term)
    text = extract_resource_text(resource)
    return [term for term in must_cover if not is_term_covered(term, text)]


def audit_plan_coverage(
    plan: PlanArtifact,
    resources: list[dict[str, Any]],
    reviews: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    selected, duplicate_ids = select_best_resources(plan, resources, reviews)
    ready: list[str] = []
    missing: list[str] = []
    failed: list[str] = []
    outline_gaps: dict[str, list[str]] = {}

    for task in plan.tasks:
        resource = selected.get(task.task_id)
        if resource is None:
            missing.append(task.task_id)
            continue
        gaps = _outline_gaps(task, resource)
        if gaps:
            outline_gaps[task.task_id] = gaps
        released_after_rework = (
            resource.get("review_auto_released") is True
            or resource.get("review_gate_status") == "approved_after_rework_limit"
        )
        if resource.get("review_approved") is True and (
            not gaps or released_after_rework
        ):
            ready.append(task.task_id)
        else:
            failed.append(task.task_id)

    return {
        "ready_task_ids": ready,
        "missing_task_ids": missing,
        "failed_task_ids": failed,
        "duplicate_resource_ids": duplicate_ids,
        "outline_gaps": outline_gaps,
        "complete": len(ready) == len(plan.tasks),
    }
