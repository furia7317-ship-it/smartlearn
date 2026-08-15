"""Deterministic policy and validation for editable resource plans."""

from __future__ import annotations

import re

from app.schemas.resource_plan import (
    CUSTOM_AGENT_PREFIX,
    PlanArtifact,
    PlanComplexity,
    PlanValidation,
    PlannedResourceTask,
)

GENERIC_TITLE_PARTS = {"基础定位", "核心框架", "方法拆解", "实战应用", "综合检测"}
DIRECT_MARKERS = ("直接生成", "不用确认", "马上生成")
PLAN_FIRST_MARKERS = ("先给我规划", "先看规划", "确认后生成")
MULTI_DAY_MARKERS = ("学习路径", "学习计划", "每天", "天计划", "周计划")
QUIZ_STRONG_MARKERS = ("测验", "选择题", "填空题", "答案解析")
QUIZ_COUNT_PATTERN = re.compile(
    r"(?:共|合计|总计)?\s*(?:\d+|[一二两三四五六七八九十]+)\s*道(?:[^，。；,;\n]{0,6})?题"
)


def _task_quiz_evidence(task: PlannedResourceTask) -> str:
    outline = task.outline
    values = [task.title, outline.objective, *task.quality_criteria]
    for section in outline.sections:
        values.extend([section.title, section.goal, *section.must_cover])
    return "\n".join(str(value) for value in values if value)


def normalize_task_type(task: PlannedResourceTask) -> bool:
    """Correct unambiguous quiz tasks before any validation or dispatch.

    This intentionally relies on strong assessment signals only, so an ordinary
    reading task that merely extends a topic keeps its planned type.
    """

    if str(task.agent or "").startswith(CUSTOM_AGENT_PREFIX):
        # 用户自建智能体只自定义执行者：输出类型是学生显式挑的，不能被
        # solution→quiz 的改写静默夺走。豁免必须写在这里，因为 build_planned_state、
        # validate_plan 等多处都会重复调用本函数。
        return False

    if task.type == "solution":
        changed = task.agent != "quiz"
        task.agent = "quiz"
        return changed

    evidence = _task_quiz_evidence(task)
    if not (
        any(marker in evidence for marker in QUIZ_STRONG_MARKERS)
        or QUIZ_COUNT_PATTERN.search(evidence)
    ):
        return False
    changed = task.type != "quiz" or task.agent != "quiz"
    task.type = "quiz"
    task.agent = "quiz"
    return changed


def normalize_plan_task_types(plan: PlanArtifact) -> PlanArtifact:
    """Apply task-type policy at every shared plan boundary."""

    for task in plan.tasks:
        normalize_task_type(task)
    return plan


def analyze_request(text: str) -> dict[str, object]:
    """Extract only routing preferences that must remain deterministic."""

    return {
        "force_direct": any(marker in text for marker in DIRECT_MARKERS),
        "force_confirm": any(marker in text for marker in PLAN_FIRST_MARKERS),
        "multi_day_intent": any(marker in text for marker in MULTI_DAY_MARKERS),
    }


def classify_complexity(text: str, plan: PlanArtifact | dict) -> PlanComplexity:
    artifact = plan if isinstance(plan, PlanArtifact) else PlanArtifact.model_validate(plan)
    flags = analyze_request(text)
    reasons: list[str] = []
    if flags["multi_day_intent"] or artifact.constraints.days > 1:
        reasons.append("multi_day")
    if len(artifact.days) > 1:
        reasons.append("multiple_chapters")
    if len(artifact.tasks) > 3:
        reasons.append("many_resources")

    complex_plan = bool(reasons)
    auto_execute = not complex_plan
    if flags["force_direct"]:
        auto_execute = True
    if flags["force_confirm"]:
        auto_execute = False
        complex_plan = True
        reasons.append("user_requested_confirmation")

    return PlanComplexity(
        level="complex" if complex_plan else "simple",
        reasons=list(dict.fromkeys(reasons)),
        auto_execute=auto_execute,
    )


def validate_plan(plan: PlanArtifact) -> PlanValidation:
    normalize_plan_task_types(plan)
    errors: list[str] = []
    warnings: list[str] = []
    task_by_id = {task.task_id: task for task in plan.tasks}
    day_ids = {day.day for day in plan.days}
    day_index = {day.day: index for index, day in enumerate(plan.days)}
    mounts: dict[str, list[str]] = {task_id: [] for task_id in task_by_id}

    for day in plan.days:
        if any(part in day.title for part in GENERIC_TITLE_PARTS):
            errors.append(f"{day.day} 标题过于泛化：{day.title}")
        if day.minutes > plan.constraints.daily_minutes + 15:
            errors.append(f"{day.day} 时长超过每日约束")
        elif day.minutes >= plan.constraints.daily_minutes * 0.9:
            warnings.append(f"{day.day} 时长接近每日上限")
        if not day.task_ids:
            warnings.append(f"{day.day} 没有资料任务")
        for task_id in day.task_ids:
            if task_id in mounts:
                mounts[task_id].append(day.day)

    signatures: set[tuple[str, tuple[str, ...]]] = set()
    titles: set[str] = set()
    for task in plan.tasks:
        signature = (task.type, tuple(sorted(task.knowledge_points)))
        if signature in signatures or task.title in titles:
            errors.append(f"资料任务重复：{task.title}")
        signatures.add(signature)
        titles.add(task.title)
        if not task.outline.sections or not task.quality_criteria:
            errors.append(f"资料缺少大纲或验收标准：{task.title}")
        if task.day not in day_ids:
            errors.append(f"资料绑定到不存在的学习日：{task.task_id}")
        if task.task_id in task.depends_on:
            errors.append(f"资料不能依赖自身：{task.task_id}")
        mounted_days = mounts.get(task.task_id) or []
        if not mounted_days:
            errors.append(f"资料任务未挂载到任何学习日：{task.task_id}")
        elif mounted_days != [task.day]:
            errors.append(
                f"资料任务挂载学习日与 task.day 不一致：{task.task_id}（{','.join(mounted_days)} / {task.day}）"
            )
        for dependency_id in task.depends_on:
            dependency = task_by_id.get(dependency_id)
            if dependency and day_index.get(dependency.day, 0) > day_index.get(task.day, 0):
                errors.append(f"依赖任务晚于当前任务：{task.task_id} -> {dependency_id}")

    for day in plan.days:
        missing = [task_id for task_id in day.task_ids if task_id not in task_by_id]
        if missing:
            errors.append(f"{day.day} 引用了不存在的任务：{'、'.join(missing)}")

    remaining = {task_id: len(task.depends_on) for task_id, task in task_by_id.items()}
    ready = [task_id for task_id, count in remaining.items() if count == 0]
    visited = 0
    while ready:
        completed = ready.pop()
        visited += 1
        for task_id, task in task_by_id.items():
            if completed not in task.depends_on:
                continue
            remaining[task_id] -= 1
            if remaining[task_id] == 0:
                ready.append(task_id)
    if visited != len(task_by_id):
        errors.append("资料任务存在依赖环")

    return PlanValidation(valid=not errors, errors=errors, warnings=warnings)
