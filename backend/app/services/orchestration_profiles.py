"""One policy registry; effort never changes the requested deliverables."""
from app.schemas.orchestration import CollaborationOptions

PROFILE_VERSION = "2026-09-06.1"
PROFILES = {
    "fast": {"repair_rounds": 1, "review_attempts": 2, "sources_per_task": 3, "cross_review": False, "independent_review": False},
    "standard": {"repair_rounds": 1, "review_attempts": 2, "sources_per_task": 5, "cross_review": False, "independent_review": False},
    "deep": {"repair_rounds": 2, "review_attempts": 2, "sources_per_task": 8, "cross_review": True, "independent_review": False},
    "rigorous": {"repair_rounds": 2, "review_attempts": 3, "sources_per_task": 10, "cross_review": True, "independent_review": True},
}
LABELS = {"fast": "快速", "standard": "标准", "deep": "深度", "rigorous": "严谨"}
STRATEGIES = {"direct": "直接处理", "single": "单任务流水线", "parallel": "并行流水线", "dependency": "依赖编排", "batched": "分批编排"}


def resolve_policy(options=None, tasks=None):
    options = CollaborationOptions.model_validate(options or {})
    tasks = tasks or []
    count = len(tasks)
    dependencies = any(t.get("depends_on") for t in tasks)
    days = len({t.get("day") for t in tasks})
    effort = options.effort
    reason = "按你的选择执行"
    if effort == "auto":
        effort = "deep" if dependencies or count > 8 else "standard" if count > 1 else "fast"
        order = list(PROFILES)
        effort = order[min(order.index(effort), order.index(options.auto_max_effort))]
        reason = f"根据 {count} 个任务及依赖关系选择，未超过自动模式上限"
    strategy = "direct" if count == 0 else "single" if count == 1 else "dependency" if dependencies else "parallel"
    if count > 8 or (options.preference == "staged" and days > 1):
        strategy = "batched"
    profile = PROFILES[effort]
    generation_slots, review_slots = 4, 2
    attempts = profile["repair_rounds"] + 1
    # Exact task-based envelope includes service retries and independent checks.
    calls = max(12, count * attempts * (1 + profile["review_attempts"] + int(profile["independent_review"])) + days * 2 + 8)
    return {
        **profile, "requested_effort": options.effort, "effective_effort": effort,
        "strategy": strategy, "profile_version": PROFILE_VERSION, "reason": reason,
        "summary": f"{LABELS[effort]}协作 · {STRATEGIES[strategy]} · {reason}",
        "generation_concurrency": generation_slots, "review_concurrency": review_slots,
        "batch_size": 8, "sources": options.sources.model_dump(),
        "retry_policy": {"max_task_retries": profile["repair_rounds"], "max_reviewer_attempts": profile["review_attempts"],
                         "max_model_calls": calls, "max_total_attempts": calls,
                         "max_run_seconds": max(300., min(3600., count * 60. * attempts))},
    }
