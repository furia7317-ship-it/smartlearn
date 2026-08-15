"""Knowledge-aware LLM builder for editable resource plans."""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from typing import Any, Callable

from pydantic import ValidationError

from app.core.config import settings
from app.core.llm import build_llm
from app.schemas.resource_plan import (
    LongPlanScheduleSkeleton,
    LongPlanTaskSkeleton,
    OutlineBatch,
    OutlineBatchEntry,
    PlanArtifact,
    PlanDraft,
    PlannedDay,
    PlannedResourceTask,
)
from app.services.resource_planning import (
    classify_complexity,
    normalize_plan_task_types,
    validate_plan,
)
from app.services.learning_baseline import apply_length_policy

logger = logging.getLogger(__name__)


def _generator_agent(resource_type: str) -> str:
    return "quiz" if resource_type == "solution" else resource_type


def _planning_retry_delay(attempt: int) -> float:
    schedule = (0.0, 0.1, 0.25)
    return schedule[min(max(0, attempt), len(schedule) - 1)]


def _pause_continuous_retry(attempt: int, continuous_retry: bool) -> None:
    if not continuous_retry:
        return
    delay = _planning_retry_delay(attempt)
    if delay > 0:
        time.sleep(delay)


def _max_planning_attempts(continuous_retry: bool) -> int:
    """Legacy continuous mode now means one extra bounded attempt, never infinity."""

    return 3 if continuous_retry else 2

SYSTEM_PROMPT = """你是学习项目规划智能体。输出严格 JSON，不输出 Markdown。
若请求包含 learning_path_preferences，必须将其作为硬约束：目标、天数、每日分钟数和资料类型都要反映在计划中。

根据用户目标、学习画像和真实知识库片段，安排每天的知识点、学习目标和资料任务。
禁止使用“基础定位、核心框架、方法拆解、实战应用、综合检测”等泛化标题。
每份资料必须有任务专属大纲 sections、必须覆盖点 must_cover 和质量标准 quality_criteria。
quality_criteria 只使用可自动验收的维度：数量、定义/知识点覆盖、示例或类比、对比与复杂度、选型场景、代码可运行与异常边界、题目答案解析、结构层级、时长页数、来源引用；不要写“竞赛级”“高质量”等无法客观验证的措辞。
用户要求 N 道题时，题目必须放在一个测验资料的 questions 中，不要将每道题拆成独立资料；quality_criteria 必须明确写出 N 道题。
学习路径中，每个学习日都必须为用户勾选的每一种资料类型创建独立任务；不要虚构未提供的 source_id。
"""


class PlanBuildError(RuntimeError):
    """A sanitized planning failure safe to return to clients."""

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        retryable: bool = True,
        http_status: int = 422,
        actions: list[str] | None = None,
        checkpoint: dict[str, Any] | None = None,
    ):
        if message is None:
            message = code
            code = "plan_build_failed"
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.http_status = http_status
        self.actions = list(actions or [])
        self.checkpoint = checkpoint

    def payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "stage": "plan_build",
            "retryable": self.retryable,
            "message": str(self),
            "actions": self.actions,
            "checkpoint": self.checkpoint,
        }


def _provider_error(exc: Exception) -> PlanBuildError | None:
    """Map provider failures without exposing provider response bodies."""
    name = type(exc).__name__
    mapping = {
        "APIConnectionError": ("plan_provider_unavailable", True, 503, "规划服务暂时不可用，请稍后重试"),
        "APITimeoutError": ("plan_provider_unavailable", True, 503, "规划服务暂时不可用，请稍后重试"),
        "RateLimitError": ("plan_provider_rate_limited", True, 429, "规划服务繁忙，请稍后重试"),
        "AuthenticationError": ("plan_provider_auth_failed", False, 401, "规划服务认证失败"),
        "PermissionDeniedError": ("plan_provider_permission_denied", False, 403, "规划服务权限不足"),
        "NotFoundError": ("plan_provider_model_not_found", False, 404, "规划模型不可用"),
        "BadRequestError": ("plan_provider_bad_request", False, 400, "规划请求不被服务接受"),
        "LengthFinishReasonError": ("plan_output_truncated", True, 422, "规划输出过长，正在使用紧凑合同重试"),
        "ConnectError": ("plan_provider_unavailable", True, 503, "规划服务暂时不可用，请稍后重试"),
        "ReadTimeout": ("plan_provider_unavailable", True, 503, "规划服务暂时不可用，请稍后重试"),
        "ConnectTimeout": ("plan_provider_unavailable", True, 503, "规划服务暂时不可用，请稍后重试"),
    }
    matched = mapping.get(name)
    if not matched:
        return None
    code, retryable, status, message = matched
    return PlanBuildError(code, message, retryable=retryable, http_status=status)


class PlanOutputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _response_finish_reason(response: Any) -> str:
    metadata = getattr(response, "response_metadata", {}) or {}
    return str(metadata.get("finish_reason") or "")


def _parse_plan_output(text: str, finish_reason: str) -> dict[str, Any]:
    raw = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", raw, re.DOTALL)
    candidate = fenced.group(1).strip() if fenced else raw
    if finish_reason == "length" or not candidate.endswith(("}", "]")):
        raise PlanOutputError("plan_output_truncated", "模型输出不完整，需要使用紧凑合同重试")
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PlanOutputError(
            "plan_json_invalid",
            f"JSON 语法错误：第 {exc.lineno} 行第 {exc.colno} 列",
        ) from exc
    if not isinstance(parsed, dict):
        raise PlanOutputError("plan_json_invalid", "规划输出必须是 JSON 对象")
    return parsed


def _compact_legacy_draft_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept only unmistakably legacy full artifacts during migration."""
    legacy_markers = {
        "plan_id", "student_id", "status", "complexity", "validation",
    }
    if len(legacy_markers.intersection(payload)) < 3:
        return payload
    normalized = json.loads(json.dumps(payload, ensure_ascii=False))
    for task in normalized.get("tasks", []):
        if not isinstance(task, dict):
            continue
        task["quality_criteria"] = list(task.get("quality_criteria") or [])[:4]
        outline = task.get("outline")
        if isinstance(outline, dict):
            outline["sections"] = list(outline.get("sections") or [])[:4]
            for section in outline["sections"]:
                if isinstance(section, dict):
                    section["must_cover"] = list(section.get("must_cover") or [])[:4]
    return normalized


def _source_context(kb_context: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {
            "id": str(item.get("id") or f"source-{index}"),
            "content": str(item.get("content") or item.get("text") or "")[:1000],
        }
        for index, item in enumerate(kb_context[:10], 1)
    ]


def bind_plan_sources(plan: PlanArtifact, kb_context: list[dict[str, Any]]) -> PlanArtifact:
    """Replace model-suggested source ids with this request's real evidence."""
    valid_ids = [str(item.get("id")) for item in kb_context if item.get("id")]
    if not valid_ids:
        # Direct builder callers retained for legacy baseline=None tests do not
        # have a retrieval seam. HTTP routes always gate before invoking us.
        return plan
    allowed = set(valid_ids)
    for task in plan.tasks:
        selected = [source_id for source_id in task.source_ids if source_id in allowed]
        task.source_ids = list(dict.fromkeys(selected or valid_ids[:3]))
    return PlanArtifact.model_validate(plan.model_dump(mode="json"))


_TASK_DOMAIN_HINTS = (
    ("排序", "排序算法"),
    ("查找", "查找算法"),
    ("贪心", "贪心算法"),
    ("动态规划", "动态规划"),
    ("二叉树", "树与二叉树"),
    ("哈夫曼", "树与二叉树"),
    ("前序遍历", "树与二叉树"),
    ("中序遍历", "树与二叉树"),
    ("后序遍历", "树与二叉树"),
    ("层序遍历", "树与二叉树"),
    ("哈希表", "查找算法"),
    ("哈希函数", "查找算法"),
    ("冲突处理", "查找算法"),
    ("开放定址", "查找算法"),
    ("链地址", "查找算法"),
    ("最短路径", "图"),
    ("最小生成树", "图"),
    ("Dijkstra", "图"),
    ("Prim", "图"),
    ("Kruskal", "图"),
    ("栈", "栈和队列"),
    ("队列", "栈和队列"),
    ("线性表", "线性表"),
    ("链表", "线性表"),
    ("顺序表", "线性表"),
    ("回溯", "回溯与分支限界"),
    ("分支限界", "回溯与分支限界"),
)


def _task_knowledge_query(task: PlannedResourceTask) -> str:
    """Build a focused retrieval query from one material's acceptance contract."""

    # Objectives and acceptance bullets contain generic phrases such as
    # "time complexity" and "Python implementation".  Feeding all of them to
    # the lexical fallback made those common phrases outrank the actual topic.
    # Titles, knowledge points, and section headings carry the useful domain
    # signal; canonical document-title hints make variants such as
    # "quick sort" -> "sorting algorithms" deterministic.
    parts = [task.title, *task.knowledge_points]
    for section in task.outline.sections:
        parts.append(section.title)
    joined = "\n".join(parts)
    # The task title and knowledge points are authoritative.  Long-plan
    # templates can carry a stale must-cover bullet from a neighboring day;
    # using that bullet to select chapters caused a hash-table task to inherit
    # graph evidence.  Fall back to outline terms only when the primary fields
    # contain no recognizable domain marker.
    primary_hints = [hint for marker, hint in _TASK_DOMAIN_HINTS if marker in joined]
    if primary_hints:
        parts.extend(primary_hints)
    else:
        outline_text = "\n".join(
            point
            for section in task.outline.sections
            for point in section.must_cover
        )
        parts.extend(hint for marker, hint in _TASK_DOMAIN_HINTS if marker in outline_text)
    return "\n".join(
        dict.fromkeys(part.strip() for part in parts if isinstance(part, str) and part.strip())
    )[:1200]


def bind_plan_task_sources(
    plan: PlanArtifact,
    fallback_context: list[dict[str, Any]],
    *,
    student_id: str,
    retriever: Any | None = None,
    sources_per_task: int = 5,
) -> tuple[PlanArtifact, list[dict[str, Any]]]:
    """Retrieve and bind evidence independently for every planned material.

    A broad learning-path query (for example, ``数据结构``) is sufficient for
    the initial knowledge gate, but it is not a safe evidence scope for a task
    about Huffman trees, sorting, or dynamic programming.  The previous
    implementation assigned the same first three broad snippets to every task,
    which made valid task output fail semantic review and made retries repeat
    the same mistake.  This execution-time pass keeps the gate as a fallback
    while giving each generator and reviewer a focused, identical source set.
    """

    if retriever is None:
        from app.services.rag import retrieve_for_gate

        retriever = retrieve_for_gate

    fallback = [item for item in fallback_context if isinstance(item, dict) and item.get("id")]
    combined: dict[str, dict[str, Any]] = {}
    source_limit = max(1, min(int(sources_per_task), 10))

    for task in plan.tasks:
        try:
            query = _task_knowledge_query(task)
            canonical_hints = list(
                dict.fromkeys(
                    line for line in query.splitlines() if line in {hint for _, hint in _TASK_DOMAIN_HINTS}
                )
            )
            if len(canonical_hints) > 1:
                buckets = [
                    list(retriever(hint, student_id, 2) or [])
                    for hint in canonical_hints
                ]
                retrieved = []
                # Interleave domains so a comprehensive review task cannot
                # consume all five slots with chunks from only the first book.
                for offset in range(2):
                    for bucket in buckets:
                        if offset < len(bucket):
                            retrieved.append(bucket[offset])
                if len(retrieved) < source_limit:
                    retrieved.extend(retriever(query, student_id, source_limit) or [])
            else:
                # Query the canonical chapter directly.  Sending the whole
                # title ("思维导图", "最小生成树") to the lexical fallback
                # accidentally matched the one-character chapter names 图/树
                # and reintroduced unrelated evidence.
                focused_query = canonical_hints[0] if canonical_hints else query
                retrieved = retriever(focused_query, student_id, source_limit) or []
        except Exception:  # the already-passed broad gate remains the safe fallback
            retrieved = []
        lexical_scores = [
            float(item.get("fallback_score") or 0)
            for item in retrieved
            if isinstance(item, dict) and item.get("retrieval_source") in {"markdown", "hybrid"}
        ]
        if lexical_scores and max(lexical_scores) >= 100:
            # An exact local chapter-title match is authoritative.  Do not pad
            # its scope with low-score vector/lexical neighbors merely to fill
            # five slots; those unrelated snippets confused both generation
            # and semantic review in the live 14-day path.
            retrieved = [
                item
                for item in retrieved
                if isinstance(item, dict)
                and item.get("retrieval_source") in {"markdown", "hybrid"}
                and float(item.get("fallback_score") or 0) >= 100
            ]
        scoped_by_id: dict[str, dict[str, Any]] = {}
        for item in retrieved:
            if not isinstance(item, dict) or not item.get("id") or not item.get("content"):
                continue
            scoped_by_id.setdefault(str(item["id"]), item)
            if len(scoped_by_id) >= source_limit:
                break
        scoped = list(scoped_by_id.values())
        if not scoped:
            scoped = fallback[:source_limit]
        task.source_ids = list(
            dict.fromkeys(str(item["id"]) for item in scoped if item.get("id"))
        )
        for item in scoped:
            normalized = dict(item)
            metadata = normalized.get("metadata")
            if not normalized.get("title") and isinstance(metadata, dict):
                normalized["title"] = str(metadata.get("title") or "")
            combined[str(normalized["id"])] = normalized

    if not combined:
        for item in fallback:
            combined[str(item["id"])] = dict(item)
    rebound = PlanArtifact.model_validate(plan.model_dump(mode="json"))
    return rebound, list(combined.values())


_CHINESE_DIGITS = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def _parse_small_count(value: str) -> int | None:
    if value.isdigit():
        count = int(value)
    elif value == "十":
        count = 10
    elif "十" in value:
        left, right = value.split("十", 1)
        tens = _CHINESE_DIGITS.get(left, 1) if left else 1
        ones = _CHINESE_DIGITS.get(right, 0) if right else 0
        count = tens * 10 + ones
    else:
        count = _CHINESE_DIGITS.get(value, 0)
    return count if 1 <= count <= 30 else None


def _requested_question_count(request_text: str) -> int | None:
    raw_counts = re.findall(
        r"([一二两三四五六七八九十\d]+)\s*道(?:[^，。；,;\n]{0,6})?题",
        request_text,
    )
    counts = {_parse_small_count(value) for value in raw_counts}
    counts.discard(None)
    return next(iter(counts)) if len(counts) == 1 else None


def _dedupe(values: list[str], *, limit: int) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))[:limit]


def _normalize_explicit_quiz_count(
    plan: PlanArtifact,
    request_text: str,
) -> PlanArtifact:
    requested = _requested_question_count(request_text)
    quiz_tasks = [task for task in plan.tasks if task.type == "quiz"]
    if requested is None or not quiz_tasks:
        return plan

    if len(quiz_tasks) > 1 and len({task.day for task in quiz_tasks}) == 1:
        primary, *extras = quiz_tasks
        removed_ids = {task.task_id for task in extras}
        primary.title = re.sub(
            r"(练习题)[一二两三四五六七八九十]+(?:[:：].*)?$",
            r"\1",
            primary.title,
        )
        primary.knowledge_points = _dedupe(
            [point for task in quiz_tasks for point in task.knowledge_points],
            limit=12,
        )
        primary.source_ids = _dedupe(
            [source_id for task in quiz_tasks for source_id in task.source_ids],
            limit=30,
        )
        primary.outline.sections = [
            section for task in quiz_tasks for section in task.outline.sections
        ][:10]
        plan.tasks = [task for task in plan.tasks if task.task_id not in removed_ids]
        for day in plan.days:
            normalized_ids = [
                primary.task_id if task_id in removed_ids else task_id
                for task_id in day.task_ids
            ]
            day.task_ids = _dedupe(normalized_ids, limit=12)
        for task in plan.tasks:
            normalized_dependencies = [
                primary.task_id if task_id in removed_ids else task_id
                for task_id in task.depends_on
            ]
            task.depends_on = _dedupe(normalized_dependencies, limit=12)
        quiz_tasks = [primary]

    if len(quiz_tasks) == 1:
        allocated = [requested]
    elif requested >= len(quiz_tasks):
        base, remainder = divmod(requested, len(quiz_tasks))
        allocated = [base + (1 if index < remainder else 0) for index in range(len(quiz_tasks))]
    else:
        return plan

    count_pattern = re.compile(
        r"[一二两三四五六七八九十\d]+\s*道(?:[^，。；,;\n]{0,6})?题"
    )
    for task, count in zip(quiz_tasks, allocated, strict=True):
        criteria = [
            criterion
            for criterion in task.quality_criteria
            if not count_pattern.search(criterion)
        ]
        task.quality_criteria = [f"必须生成 {count} 道题", *criteria][:12]

    return PlanArtifact.model_validate(plan.model_dump(mode="json"))


def apply_learning_time_workload(
    plan: PlanArtifact,
    *,
    preserve_explicit_quiz_count: bool,
) -> PlanArtifact:
    """Turn the learner's daily time choice into enforceable material volume.

    A day-level ``minutes`` value is only cosmetic unless the generated
    material and integrated actions consume that capacity.  Quiz tasks are the
    clearest failure mode: without an explicit config the quiz agent always
    generated five questions, whether the learner selected 20 or 90 minutes.
    This policy assigns a mixed, reviewable question set from the time budget;
    an explicit question count in the user's request still wins.
    """

    day_by_id = {day.day: day for day in plan.days}
    count_pattern = re.compile(
        r"[一二两三四五六七八九十\d]+\s*道(?:[^，。；,;\n]{0,6})?题"
    )
    for task in plan.tasks:
        if task.type != "quiz":
            continue
        if preserve_explicit_quiz_count and any(
            count_pattern.search(criterion) for criterion in task.quality_criteria
        ):
            continue

        day = day_by_id.get(task.day)
        if day is None:
            continue
        tasks_on_day = max(1, len(day.task_ids))
        # Roughly 55% of a study day is active material work.  At about 2.5
        # minutes per mixed question, 40/60/90-minute choices yield 9/13/20
        # questions for a single quiz day instead of the old fixed five.
        quiz_minutes = max(10, round(day.minutes * 0.55 / tasks_on_day))
        question_count = max(5, min(30, round(quiz_minutes / 2.5)))
        short = max(1, question_count // 6)
        judge = max(1, question_count // 4)
        choice = question_count - short - judge
        task.quiz_config = {"choice": choice, "judge": judge, "short": short}
        task.quality_criteria = [
            f"必须生成 {question_count} 道题并附逐题解析",
            *[
                criterion
                for criterion in task.quality_criteria
                if not count_pattern.search(criterion)
            ],
        ][:12]

    return PlanArtifact.model_validate(plan.model_dump(mode="json"))


def apply_learning_path_preferences(
    plan: PlanArtifact,
    preferences: dict[str, Any] | None,
) -> PlanArtifact:
    """Apply explicit learner choices after the model response.

    The model receives these choices as a hard prompt too, but day count,
    daily minutes, and task types are normalized here so an otherwise valid
    model response cannot silently ignore the confirmation dialog.
    """

    if not preferences:
        return plan

    requested_days = int(preferences["days"])
    daily_minutes = int(preferences["daily_minutes"])
    material_types = list(preferences["material_types"])
    if not material_types:
        material_types = ["explainer"]

    original_days = list(plan.days)
    if len(plan.days) > requested_days:
        plan.days = plan.days[:requested_days]
    elif len(plan.days) < requested_days and original_days:
        template_day = original_days[-1]
        for number in range(len(plan.days) + 1, requested_days + 1):
            day = template_day.model_copy(deep=True)
            day.day = f"D{number}"
            day.title = f"第 {number} 天：{template_day.title}"
            day.knowledge_points = [
                f"第 {number} 天 {point}" for point in template_day.knowledge_points[:4]
            ] or [f"第 {number} 天学习重点"]
            day.objective = f"在第 {number} 天完成所选全部资料并形成可验证学习产出"
            day.actions = ["完成讲义区学习", "完成配套练习", "进入复盘工作台"]
            day.task_ids = []
            plan.days.append(day)

    type_labels = {
        "explainer": "讲义",
        "mindmap": "思维导图",
        "quiz": "练习题",
        "solution": "题目解析",
        "reading": "扩展阅读",
        "code": "代码示例",
        "video": "讲解视频",
        "courseware": "课件",
        "interactive": "交互演示",
    }
    quality = {
        "explainer": ["覆盖当天全部知识点", "至少包含 1 个例子和 1 个反例"],
        "mindmap": ["层级不少于 3 层", "覆盖当天全部知识点及关系"],
        "quiz": ["题目覆盖当天全部知识点", "每题提供唯一答案和错误项解析"],
        "solution": ["题目覆盖当天全部知识点", "每题同时展示答案、步骤和完整解析"],
        "reading": ["包含课本外延伸知识", "列出可核验来源和讨论问题"],
        "code": ["代码可运行", "包含注释、测试用例和异常边界"],
        "video": ["包含完整章节内容和旁白文本", "总时长与当天知识量匹配"],
        "courseware": ["课件结构完整", "每页有明确标题和学习目标"],
        "interactive": ["演示结构完整且说明核心概念", "标注可交互操作与观察重点"],
    }
    templates_by_type = {task.type: task for task in plan.tasks}
    fallback_template = plan.tasks[0]
    expanded_tasks: list[PlannedResourceTask] = []
    for index, day in enumerate(plan.days, 1):
        day.day = f"D{index}"
        day.minutes = daily_minutes
        day.task_ids = []
        points = day.knowledge_points[:4] or [day.title]
        for material_type in material_types:
            template = templates_by_type.get(material_type, fallback_template)
            task_id = f"{material_type}-{day.day.lower()}"
            label = type_labels[material_type]
            task = PlannedResourceTask(
                task_id=task_id,
                day=day.day,
                agent=_generator_agent(material_type),
                type=material_type,
                title=f"{day.day} {day.title} · {label}"[:160],
                knowledge_points=points,
                difficulty=template.difficulty,
                audience=template.audience,
                outline={
                    "objective": f"用{label}帮助学习者达成：{day.objective}",
                    "sections": [
                        {
                            "title": f"{day.title}{label}",
                            "goal": f"围绕当天目标完成{label}学习产出",
                            "must_cover": points,
                            "target_words": 600 if material_type in {"explainer", "reading"} else 300,
                        }
                    ],
                },
                quality_criteria=quality[material_type],
                quiz_config=template.quiz_config if material_type in {"quiz", "solution"} else {},
                source_ids=list(template.source_ids),
                depends_on=[],
            )
            expanded_tasks.append(task)
            day.task_ids.append(task_id)
    plan.tasks = expanded_tasks

    plan.constraints.days = requested_days
    plan.constraints.daily_minutes = daily_minutes
    plan.constraints.material_types = material_types
    return PlanArtifact.model_validate(plan.model_dump(mode="json"))


def _invoke_compact_json(model: Any, payload: dict[str, Any]) -> dict[str, Any]:
    response = model.invoke(
        [
            {"role": "system", "content": "Return only compact JSON. Do not include explanations."},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False, default=str)},
        ]
    )
    return _parse_plan_output(str(response.content), _response_finish_reason(response))


def _normalize_long_dependencies(item: Any, task_by_key: dict[str, Any]) -> list[str]:
    """Keep only earlier, unique task dependencies from the final skeleton."""

    current_day = int(item.day[1:])
    dependencies: list[str] = []
    for dependency in item.depends_on:
        dependency_task = task_by_key.get(dependency)
        if (
            dependency == item.key
            or dependency_task is None
            or dependency in dependencies
            or int(dependency_task.day[1:]) > current_day
        ):
            continue
        dependencies.append(dependency)
    return dependencies


def _derive_long_plan_tasks(
    schedule: LongPlanScheduleSkeleton,
    preferences: dict[str, Any],
    learner_context: dict[str, Any] | None,
) -> list[LongPlanTaskSkeleton]:
    """Create every selected resource type for every scheduled learning day."""

    material_types = list(preferences.get("material_types") or schedule.constraints.material_types)
    if not material_types:
        material_types = ["explainer"]

    type_labels = {
        "explainer": "讲义",
        "mindmap": "思维导图",
        "quiz": "测验",
        "solution": "题目解析",
        "reading": "阅读材料",
        "code": "代码示例",
        "video": "视频学习",
        "courseware": "课件",
        "interactive": "交互演示",
    }
    context = learner_context or {}
    difficulty = str(context.get("level") or schedule.constraints.difficulty or "适中")
    audience = str(context.get("summary") or "学习者")
    if len(difficulty) < 2:
        difficulty = "适中"
    if len(audience) < 2:
        audience = "学习者"

    tasks: list[LongPlanTaskSkeleton] = []
    for day in schedule.days:
        for task_type in material_types:
            key = f"{task_type}-{day.day.lower()}"
            tasks.append(
                LongPlanTaskSkeleton(
                    key=key,
                    day=day.day,
                    type=task_type,
                    title=f"{day.day} {day.title} · {type_labels[task_type]}"[:80],
                    knowledge_points=day.knowledge_points[:4],
                    difficulty=difficulty,
                    audience=audience,
                    depends_on=[],
                )
            )
    return tasks


def _deterministic_outline(item: LongPlanTaskSkeleton) -> dict[str, Any]:
    """Build a typed outline without one extra model call per duplicated day/type."""

    labels = {
        "explainer": "讲义",
        "mindmap": "思维导图",
        "quiz": "练习题",
        "solution": "题目解析",
        "reading": "扩展阅读",
        "code": "代码示例",
        "video": "讲解视频",
        "courseware": "课件",
        "interactive": "交互演示",
    }
    quality = {
        "explainer": ["覆盖全部知识点", "包含例子和反例"],
        "mindmap": ["不少于 3 层", "标明知识关系"],
        "quiz": ["覆盖全部知识点", "逐题提供答案解析"],
        "solution": ["覆盖全部知识点", "题目、答案和逐题解析必须成组呈现"],
        "reading": ["包含课本外延伸知识", "列出可核验来源"],
        "code": ["代码可运行", "包含测试和异常边界"],
        "video": ["包含章节内容与旁白", "时长与知识量匹配"],
        "courseware": ["页面结构完整", "每页目标明确"],
        "interactive": ["演示结构完整", "交互操作说明清晰"],
    }
    label = labels[item.type]
    return {
        "outline": {
            "objective": f"通过{label}掌握：{'、'.join(item.knowledge_points)}",
            "sections": [
                {
                    "title": item.title,
                    "goal": f"形成可验证的{label}学习产出",
                    "must_cover": item.knowledge_points,
                    "target_words": 600 if item.type in {"explainer", "reading"} else 300,
                }
            ],
        },
        "quality_criteria": quality[item.type],
    }


def _assemble_long_plan(
    schedule: LongPlanScheduleSkeleton,
    task_skeletons: list[LongPlanTaskSkeleton],
    outlines: dict[str, Any],
    *,
    plan_id: str,
    student_id: str,
    learner_context: dict[str, Any] | None,
    preferences: dict[str, Any],
    kb_context: list[dict[str, Any]],
    request_text: str,
) -> PlanArtifact:
    task_by_key = {item.key: item for item in task_skeletons}
    task_ids_by_day = {day.day: [] for day in schedule.days}
    tasks = []
    for item in task_skeletons:
        outline = outlines.get(item.key)
        if outline is None:
            raise PlanBuildError("plan_schema_invalid", "资料大纲缺失")
        task_ids_by_day[item.day].append(item.key)
        tasks.append(
            PlannedResourceTask(
                task_id=item.key, day=item.day, agent=_generator_agent(item.type), type=item.type,
                title=item.title, knowledge_points=item.knowledge_points,
                difficulty=item.difficulty, audience=item.audience,
                outline=outline["outline"], quality_criteria=outline["quality_criteria"],
                depends_on=_normalize_long_dependencies(item, task_by_key),
            )
        )
    plan = PlanArtifact(
        plan_id=plan_id, student_id=student_id, version=1, status="draft",
        request_summary=schedule.request_summary,
        complexity={"level": "complex", "reasons": [], "auto_execute": False},
        constraints=schedule.constraints,
        days=[
            PlannedDay(day=day.day, title=day.title, knowledge_points=day.knowledge_points,
                       objective=day.objective, minutes=day.minutes,
                       prerequisites=day.prerequisites, actions=day.actions,
                       task_ids=task_ids_by_day[day.day])
            for day in schedule.days
        ],
        tasks=tasks, validation={"valid": True, "errors": [], "warnings": []},
        learner_context=learner_context, learning_path_preferences=preferences,
    )
    plan = normalize_plan_task_types(plan)
    plan = bind_plan_sources(plan, kb_context)
    plan = apply_learning_path_preferences(plan, preferences)
    plan = _normalize_explicit_quiz_count(plan, request_text)
    plan = apply_learning_time_workload(
        plan,
        preserve_explicit_quiz_count=_requested_question_count(request_text) is not None,
    )
    plan = apply_length_policy(plan, learner_context)
    plan.complexity = classify_complexity(request_text, plan)
    plan.status = "approved" if plan.complexity.auto_execute else "awaiting_confirmation"
    plan.validation = validate_plan(plan)
    if not plan.validation.valid:
        raise PlanBuildError("plan_policy_invalid", "长学习路径规则校验未通过")
    return plan


OUTLINE_BATCH_SIZE = 4
OUTLINE_BATCH_CALL_LIMIT = 2
OUTLINE_SINGLE_CALL_LIMIT = 1
OUTLINE_TOTAL_CALL_LIMIT = 24


def _outline_validation_errors(raw: Any, expected_keys: set[str]) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    """Validate outline entries independently so one bad item cannot erase good work."""

    accepted: dict[str, dict[str, Any]] = {}
    issues: dict[str, list[str]] = {key: [] for key in expected_keys}
    if not isinstance(raw, dict) or not isinstance(raw.get("tasks"), list):
        for key in expected_keys:
            issues[key].append("missing_tasks_array")
        return accepted, issues

    seen: set[str] = set()
    entries = raw.get("tasks") or []
    for index, candidate in enumerate(entries):
        if not isinstance(candidate, dict):
            fallback = sorted(expected_keys)[index] if index < len(expected_keys) else None
            if fallback:
                issues[fallback].append("entry_not_object")
            continue
        key = str(candidate.get("key") or "")
        if key not in expected_keys:
            continue
        if key in seen:
            accepted.pop(key, None)
            issues[key].append("duplicate_key")
            continue
        seen.add(key)
        try:
            entry = OutlineBatchEntry.model_validate(candidate)
        except ValidationError as exc:
            issues[key].extend(
                f"{'.'.join(str(part) for part in error.get('loc', ())) or 'entry'}:{error.get('type', 'invalid')}"
                for error in exc.errors()[:8]
            )
            continue
        accepted[key] = {
            "outline": entry.outline.model_dump(mode="json"),
            "quality_criteria": list(entry.quality_criteria),
        }

    for key in expected_keys:
        if key not in accepted and not issues[key]:
            issues[key].append("missing_key")
    return accepted, issues


def _checkpoint_copy(checkpoint: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(checkpoint, ensure_ascii=False, default=str))


def _build_long_resource_plan(
    *, model: Any, request_text: str, student_id: str, profile: dict[str, Any],
    kb_context: list[dict[str, Any]], learner_context: dict[str, Any] | None,
    preferences: dict[str, Any], plan_id: str, continuous_retry: bool = False,
    before_model_call: Callable[[], None] | None = None,
    on_checkpoint: Callable[[dict[str, Any]], None] | None = None,
) -> PlanArtifact:
    """Build a long plan with item-level outline repair and durable checkpoints."""

    total_calls = 0
    checkpoint: dict[str, Any] = {
        "version": 1,
        "phase": "long_plan_skeleton",
        "schedule": None,
        "outlines": {},
        "completed_keys": [],
        "pending_keys": [],
        "model_calls": 0,
    }

    def publish() -> None:
        checkpoint["model_calls"] = total_calls
        checkpoint["completed_keys"] = sorted(checkpoint["outlines"])
        if on_checkpoint is not None:
            on_checkpoint(_checkpoint_copy(checkpoint))

    def call_model(payload: dict[str, Any]) -> dict[str, Any]:
        nonlocal total_calls
        if total_calls >= OUTLINE_TOTAL_CALL_LIMIT:
            raise PlanBuildError(
                "plan_model_call_budget_exhausted",
                "资料大纲修复已达到模型调用上限",
                retryable=False,
                actions=["adjust_request", "cancel"],
                checkpoint=_checkpoint_copy(checkpoint),
            )
        if before_model_call is not None:
            before_model_call()
        total_calls += 1
        return _invoke_compact_json(model, payload)

    skeleton_payload = {
        "phase": "long_plan_skeleton",
        "request": request_text,
        "profile": profile,
        "learner_context": learner_context or {},
        "preferences": preferences,
        "sources": _source_context(kb_context),
        "schema": LongPlanScheduleSkeleton.model_json_schema(),
    }
    schedule: LongPlanScheduleSkeleton | None = None
    last_error: PlanBuildError | None = None
    attempt = 0
    max_attempts = _max_planning_attempts(continuous_retry)
    while attempt < max_attempts:
        try:
            schedule = LongPlanScheduleSkeleton.model_validate(call_model(skeleton_payload))
            checkpoint["phase"] = "outline_batch"
            checkpoint["schedule"] = schedule.model_dump(mode="json")
            publish()
            break
        except PlanBuildError:
            raise
        except PlanOutputError as exc:
            last_error = PlanBuildError(exc.code, "长学习路径骨架输出不完整")
            skeleton_payload["repair"] = {"code": exc.code, "instruction": "Return the compact skeleton only."}
        except ValidationError as exc:
            last_error = PlanBuildError("plan_schema_invalid", "长学习路径骨架结构无效")
            skeleton_payload["repair"] = {"code": "plan_schema_invalid", "errors": exc.errors()[:8]}
        except Exception as exc:  # noqa: BLE001
            provider = _provider_error(exc)
            if provider is None:
                raise PlanBuildError("plan_internal_error", "长学习路径规划失败", retryable=False, checkpoint=_checkpoint_copy(checkpoint)) from exc
            last_error = provider
            if not provider.retryable:
                provider.checkpoint = _checkpoint_copy(checkpoint)
                raise provider from exc
        attempt += 1
        _pause_continuous_retry(attempt, continuous_retry)
    if schedule is None:
        error = last_error or PlanBuildError("plan_build_failed", "长学习路径骨架生成失败")
        error.checkpoint = _checkpoint_copy(checkpoint)
        raise error

    task_skeletons = _derive_long_plan_tasks(schedule, preferences, learner_context)
    task_by_key = {task.key: task for task in task_skeletons}
    keys = list(task_by_key)
    checkpoint["pending_keys"] = list(keys)
    publish()
    outlined: dict[str, Any] = {}

    # Beyond twelve tasks the daily schedule is already the model's semantic
    # plan.  Expanding every selected type deterministically avoids dozens of
    # redundant outline calls and keeps 30-day plans inside a bounded runtime.
    if len(keys) > 12:
        outlined = {key: _deterministic_outline(task_by_key[key]) for key in keys}
        checkpoint["outlines"] = outlined
        checkpoint["pending_keys"] = []
        checkpoint["phase"] = "assembled"
        publish()
        return _assemble_long_plan(
            schedule, task_skeletons, outlined, plan_id=plan_id, student_id=student_id,
            learner_context=learner_context, preferences=preferences,
            kb_context=kb_context, request_text=request_text,
        )

    def accept(entries: dict[str, dict[str, Any]]) -> None:
        outlined.update(entries)
        checkpoint["outlines"] = outlined
        checkpoint["pending_keys"] = [key for key in keys if key not in outlined]
        publish()

    def fail_task(key: str, issues: list[str]) -> None:
        raise PlanBuildError(
            "plan_schema_invalid",
            f"资料大纲任务 {key} 仍未通过结构校验",
            retryable=True,
            actions=["retry_failed_items", "adjust_request", "open_kb", "cancel"],
            checkpoint=_checkpoint_copy({**checkpoint, "pending_keys": [item for item in keys if item not in outlined], "failed_task": key, "issues": issues}),
        )

    for batch_index in range(0, len(keys), OUTLINE_BATCH_SIZE):
        batch_keys = keys[batch_index : batch_index + OUTLINE_BATCH_SIZE]
        pending = list(batch_keys)
        issues: dict[str, list[str]] = {key: [] for key in pending}
        payload: dict[str, Any] = {
            "phase": "outline_batch",
            "tasks": [task_by_key[key].model_dump() for key in pending],
            "sources": _source_context(kb_context)[:4],
            "schema": OutlineBatch.model_json_schema(),
        }
        for batch_attempt in range(OUTLINE_BATCH_CALL_LIMIT):
            if not pending:
                break
            try:
                raw = call_model(payload)
                accepted, parsed_issues = _outline_validation_errors(raw, set(pending))
                accept(accepted)
                pending = [key for key in pending if key not in accepted]
                for key, values in parsed_issues.items():
                    if key in pending:
                        issues[key] = list(dict.fromkeys([*issues.get(key, []), *values]))
            except PlanOutputError as exc:
                for key in pending:
                    issues[key].append(exc.code)
            except PlanBuildError:
                raise
            except Exception as exc:  # noqa: BLE001
                provider = _provider_error(exc)
                if provider is None:
                    raise PlanBuildError("plan_internal_error", "资料大纲批次失败", retryable=False, checkpoint=_checkpoint_copy(checkpoint)) from exc
                if not provider.retryable:
                    provider.checkpoint = _checkpoint_copy(checkpoint)
                    provider.actions = ["adjust_request", "cancel"]
                    raise provider from exc
                for key in pending:
                    issues[key].append(provider.code)
            if pending and batch_attempt + 1 < OUTLINE_BATCH_CALL_LIMIT:
                payload = {
                    "phase": "outline_batch_repair",
                    "tasks": [task_by_key[key].model_dump() for key in pending],
                    "repair": {
                        "only_task_keys": pending,
                        "issues": {key: issues.get(key) or ["invalid_entry"] for key in pending},
                        "instruction": "只修复列出的任务；不得重新生成已通过的任务。",
                    },
                    "sources": _source_context(kb_context)[:4],
                    "schema": OutlineBatch.model_json_schema(),
                }
                _pause_continuous_retry(batch_attempt + 1, continuous_retry)

        for key in pending:
            single_payload = {
                "phase": "outline_single_repair",
                "task": task_by_key[key].model_dump(),
                "repair": {
                    "only_task_key": key,
                    "issues": issues.get(key) or ["batch_repair_failed"],
                    "instruction": "只返回这个任务的一个严格 OutlineBatchEntry，不得返回其它 key。",
                },
                "schema": OutlineBatchEntry.model_json_schema(),
                "sources": _source_context(kb_context)[:4],
            }
            try:
                raw = call_model(single_payload)
                candidate = raw.get("task") if isinstance(raw, dict) and "task" in raw else raw
                accepted, single_issues = _outline_validation_errors({"tasks": [candidate]}, {key})
                if key not in accepted:
                    fail_task(key, single_issues.get(key) or issues.get(key) or ["single_repair_invalid"])
                accept(accepted)
            except PlanBuildError:
                raise
            except PlanOutputError as exc:
                fail_task(key, [exc.code])
            except Exception as exc:  # noqa: BLE001
                provider = _provider_error(exc)
                if provider is not None and not provider.retryable:
                    provider.checkpoint = _checkpoint_copy(checkpoint)
                    provider.actions = ["adjust_request", "cancel"]
                    raise provider from exc
                if provider is not None:
                    fail_task(key, [provider.code])
                raise PlanBuildError("plan_internal_error", "单任务大纲修复失败", retryable=False, checkpoint=_checkpoint_copy(checkpoint)) from exc

    try:
        return _assemble_long_plan(
            schedule, task_skeletons, outlined, plan_id=plan_id, student_id=student_id,
            learner_context=learner_context, preferences=preferences,
            kb_context=kb_context, request_text=request_text,
        )
    except PlanBuildError as exc:
        exc.checkpoint = _checkpoint_copy(checkpoint)
        raise
    except (ValidationError, ValueError) as exc:
        raise PlanBuildError(
            "plan_schema_invalid", "长学习路径结构无效", retryable=True,
            checkpoint=_checkpoint_copy(checkpoint),
        ) from exc


def _build_long_resource_plan_legacy(
    *, model: Any, request_text: str, student_id: str, profile: dict[str, Any],
    kb_context: list[dict[str, Any]], learner_context: dict[str, Any] | None,
    preferences: dict[str, Any], plan_id: str, continuous_retry: bool = False,
    before_model_call: Callable[[], None] | None = None,
) -> PlanArtifact:
    skeleton_payload = {
        "phase": "long_plan_skeleton", "request": request_text,
        "profile": profile, "learner_context": learner_context or {},
        "preferences": preferences, "sources": _source_context(kb_context),
        "schema": LongPlanScheduleSkeleton.model_json_schema(),
    }
    schedule: LongPlanScheduleSkeleton | None = None
    last_error: PlanBuildError | None = None
    attempt = 0
    max_attempts = _max_planning_attempts(continuous_retry)
    while attempt < max_attempts:
        try:
            if before_model_call is not None:
                before_model_call()
            schedule = LongPlanScheduleSkeleton.model_validate(
                _invoke_compact_json(model, skeleton_payload)
            )
            break
        except PlanOutputError as exc:
            last_error = PlanBuildError(exc.code, "长学习路径骨架输出不完整")
            skeleton_payload["repair"] = {"code": exc.code, "instruction": "Return the compact skeleton only."}
        except ValidationError as exc:
            last_error = PlanBuildError("plan_schema_invalid", "长学习路径骨架结构无效")
            skeleton_payload["repair"] = {"code": "plan_schema_invalid", "errors": exc.errors()[:8]}
        except Exception as exc:  # noqa: BLE001
            provider = _provider_error(exc)
            if provider is None:
                raise PlanBuildError("plan_internal_error", "长学习路径规划失败", retryable=False) from exc
            last_error = provider
            if not provider.retryable:
                break
        attempt += 1
        _pause_continuous_retry(attempt, continuous_retry)
    if schedule is None:
        raise last_error or PlanBuildError("plan_build_failed", "长学习路径骨架生成失败")

    outlined: dict[str, Any] = {}
    task_skeletons = _derive_long_plan_tasks(schedule, preferences, learner_context)
    task_by_key = {task.key: task for task in task_skeletons}
    keys = list(task_by_key)
    if len(keys) > 12:
        outlined = {key: _deterministic_outline(task_by_key[key]) for key in keys}
        return _assemble_long_plan(
            schedule, task_skeletons, outlined, plan_id=plan_id, student_id=student_id,
            learner_context=learner_context, preferences=preferences,
            kb_context=kb_context, request_text=request_text,
        )
    for batch_index in range(0, len(keys), 4):
        batch_keys = keys[batch_index : batch_index + 4]
        batch_payload = {
            "phase": "outline_batch", "tasks": [task_by_key[key].model_dump() for key in batch_keys],
            "sources": _source_context(kb_context)[:4],
            "schema": OutlineBatch.model_json_schema(),
        }
        batch: OutlineBatch | None = None
        attempt = 0
        max_attempts = _max_planning_attempts(continuous_retry)
        while attempt < max_attempts:
            try:
                if before_model_call is not None:
                    before_model_call()
                batch = OutlineBatch.model_validate(_invoke_compact_json(model, batch_payload))
                returned = {entry.key: entry for entry in batch.tasks}
                if set(returned) != set(batch_keys):
                    raise PlanOutputError("plan_schema_invalid", "资料大纲批次缺少或重复任务")
                for key, entry in returned.items():
                    outlined[key] = {
                        "outline": entry.outline.model_dump(mode="json"),
                        "quality_criteria": entry.quality_criteria,
                    }
                break
            except (PlanOutputError, ValidationError) as exc:
                batch_payload["repair"] = {"code": getattr(exc, "code", "plan_schema_invalid"), "detail": str(exc)[:240]}
                if attempt == max_attempts - 1:
                    raise PlanBuildError("plan_schema_invalid", "资料大纲批次结构无效") from exc
            except Exception as exc:  # noqa: BLE001
                provider = _provider_error(exc)
                if provider is None or not provider.retryable or attempt == max_attempts - 1:
                    raise provider or PlanBuildError("plan_internal_error", "资料大纲批次失败", retryable=False) from exc
            attempt += 1
            _pause_continuous_retry(attempt, continuous_retry)
        if batch is None:
            raise PlanBuildError("plan_schema_invalid", "资料大纲批次缺失")
    try:
        return _assemble_long_plan(
            schedule, task_skeletons, outlined, plan_id=plan_id, student_id=student_id,
            learner_context=learner_context, preferences=preferences,
            kb_context=kb_context, request_text=request_text,
        )
    except PlanBuildError:
        raise
    except (ValidationError, ValueError) as exc:
        raise PlanBuildError(
            "plan_schema_invalid", "长学习路径结构无效", retryable=True
        ) from exc


def build_resource_plan(
    *,
    request_text: str,
    student_id: str,
    profile: dict[str, Any],
    kb_context: list[dict[str, Any]],
    learner_context: dict[str, Any] | None = None,
    learning_path_preferences: dict[str, Any] | None = None,
    llm=None,
    plan_id: str | None = None,
    continuous_retry: bool = False,
    before_model_call: Callable[[], None] | None = None,
    on_checkpoint: Callable[[dict[str, Any]], None] | None = None,
) -> PlanArtifact:
    """Build and validate a specific plan; never substitute a generic template."""

    model = llm or build_llm(
        temperature=0.2,
        streaming=False,
        response_format={"type": "json_object"},
        max_tokens=settings.PLAN_MAX_OUTPUT_TOKENS,
    )
    resolved_plan_id = plan_id or f"plan-{uuid.uuid4().hex[:16]}"
    requested_material_types = list((learning_path_preferences or {}).get("material_types") or [])
    if learning_path_preferences and (
        int(learning_path_preferences.get("days", 0)) >= 14
        or len(requested_material_types) >= 4
    ):
        return _build_long_resource_plan(
            model=model, request_text=request_text, student_id=student_id,
            profile=profile, kb_context=kb_context,
            learner_context=learner_context,
            preferences=learning_path_preferences,
            plan_id=resolved_plan_id,
            continuous_retry=continuous_retry,
            before_model_call=before_model_call,
            on_checkpoint=on_checkpoint,
        )
    context = {
        "request": request_text,
        "student_id": student_id,
        "profile": profile,
        "learner_context": learner_context or {},
        "learning_path_preferences": learning_path_preferences or {},
        "sources": _source_context(kb_context),
        "draft_schema": PlanDraft.model_json_schema(),
        "output_limits": {
            "max_tasks": 12,
            "max_sections_per_task": 4,
            "max_must_cover_per_section": 4,
            "max_quality_criteria": 4,
        },
    }
    feedback: dict[str, Any] = {}
    last_error: PlanBuildError | None = None

    attempt = 0
    max_attempts = _max_planning_attempts(continuous_retry)
    while attempt < max_attempts:
        try:
            if before_model_call is not None:
                before_model_call()
            response = model.invoke(
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {**context, "repair_feedback": feedback},
                            ensure_ascii=False,
                            default=str,
                        ),
                    },
                ]
            )
            raw_content = str(response.content)
            payload = _parse_plan_output(raw_content, _response_finish_reason(response))
            draft = PlanDraft.model_validate(_compact_legacy_draft_payload(payload))
            plan = PlanArtifact(
                plan_id=resolved_plan_id,
                student_id=student_id,
                version=1,
                status="draft",
                request_summary=draft.request_summary,
                complexity={"level": "complex", "reasons": [], "auto_execute": False},
                constraints=draft.constraints,
                days=[
                    PlannedDay(
                        day=day.day,
                        title=day.title,
                        knowledge_points=day.knowledge_points,
                        objective=day.objective,
                        minutes=day.minutes,
                        prerequisites=day.prerequisites,
                        task_ids=day.task_keys,
                        actions=day.actions,
                    )
                    for day in draft.days
                ],
                tasks=[
                    PlannedResourceTask(
                        task_id=task.key,
                        day=task.day,
                        agent=_generator_agent(task.type),
                        type=task.type,
                        title=task.title,
                        knowledge_points=task.knowledge_points,
                        difficulty=task.difficulty,
                        audience=task.audience,
                        outline=task.outline.model_dump(mode="json"),
                        quality_criteria=task.quality_criteria,
                        source_ids=task.source_ids,
                        depends_on=task.depends_on,
                    )
                    for task in draft.tasks
                ],
                validation={"valid": True, "errors": [], "warnings": []},
                learner_context=learner_context,
                learning_path_preferences=learning_path_preferences,
            )
            plan = normalize_plan_task_types(plan)
            plan = bind_plan_sources(plan, kb_context)
            plan = apply_learning_path_preferences(plan, learning_path_preferences)
            plan = _normalize_explicit_quiz_count(plan, request_text)
            plan = apply_learning_time_workload(
                plan,
                preserve_explicit_quiz_count=_requested_question_count(request_text) is not None,
            )
            plan = apply_length_policy(plan, learner_context)
            plan.complexity = classify_complexity(request_text, plan)
            plan.status = (
                "approved" if plan.complexity.auto_execute else "awaiting_confirmation"
            )
            plan.validation = validate_plan(plan)
            if plan.validation.valid:
                return plan
            last_error = PlanBuildError("plan_policy_invalid", "规划验证失败：规则校验未通过")
            feedback = "；".join(plan.validation.errors)
        except PlanOutputError as exc:
            logger.warning(
                "plan output rejected code=%s attempt=%s chars=%s detail=%s",
                exc.code,
                attempt + 1,
                len(raw_content) if "raw_content" in locals() else 0,
                str(exc),
            )
            feedback = {
                "kind": exc.code,
                "instruction": (
                    "Use a compact daily skeleton and at most 12 material outlines."
                    if exc.code == "plan_output_truncated"
                    else "Repair JSON syntax and return only one JSON object."
                ),
                "detail": str(exc),
            }
            last_error = PlanBuildError(exc.code, "规划输出格式异常，请重试生成")
        except ValidationError as exc:
            field_errors = exc.errors()
            feedback = {
                "kind": "plan_schema_invalid",
                "errors": field_errors[:8] if isinstance(field_errors, list) else [str(exc)[:240]],
                "instruction": "Only repair the listed fields and keep the output compact.",
            }
            last_error = PlanBuildError("plan_schema_invalid", "规划结构校验未通过")
        except (ConnectionError, TimeoutError, OSError) as exc:
            logger.warning("plan provider unavailable attempt=%s type=%s", attempt + 1, type(exc).__name__)
            feedback = {"kind": "plan_provider_unavailable", "instruction": "Retry the compact JSON plan."}
            last_error = PlanBuildError("plan_provider_unavailable", "规划服务暂时不可用，请稍后重试", http_status=503)
        except Exception as exc:  # noqa: BLE001
            provider_error = _provider_error(exc)
            if provider_error:
                last_error = provider_error
                feedback = {"kind": provider_error.code, "instruction": "Retry only when retryable."}
                if not provider_error.retryable:
                    break
                attempt += 1
                _pause_continuous_retry(attempt, continuous_retry)
                continue
            logger.exception("unexpected plan builder failure attempt=%s", attempt + 1)
            feedback = {"kind": "plan_internal_error", "instruction": "Stop and report a safe failure."}
            last_error = PlanBuildError("plan_internal_error", "规划内部处理失败，请稍后重试", retryable=False)
            break
        attempt += 1
        _pause_continuous_retry(attempt, continuous_retry)

    raise last_error or PlanBuildError("plan_policy_invalid", "规划验证失败，请稍后重试")
