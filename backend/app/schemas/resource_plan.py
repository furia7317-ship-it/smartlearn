"""Contracts for editable, versioned resource-generation plans."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

ResourceType = Literal[
    "explainer",
    "mindmap",
    "quiz",
    "solution",
    "reading",
    "code",
    "video",
    "courseware",
    "interactive",
]
# 用户自建智能体只自定义**执行者**，不自定义资源类型：``type`` 仍然只能取上面九种，
# 只有 ``agent`` 可以是 ``custom:<id>``。审核门、整合、落库副作用和前端渲染都按
# ``type`` 分派，放开 ``type`` 会让这四处同时失配。
CUSTOM_AGENT_PREFIX = "custom:"
CUSTOM_AGENT_PATTERN = r"^custom:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
CustomAgentRef = Annotated[str, StringConstraints(pattern=CUSTOM_AGENT_PATTERN)]
MAX_PLAN_TASKS = 210
PlanStatus = Literal[
    "draft",
    "awaiting_confirmation",
    "approved",
    "running",
    "completed",
    "failed",
    "cancelled",
]


class PlanComplexity(BaseModel):
    level: Literal["simple", "complex"]
    reasons: list[str] = Field(default_factory=list)
    auto_execute: bool


class PlanConstraints(BaseModel):
    days: int = Field(ge=1, le=30)
    daily_minutes: int = Field(ge=15, le=480)
    deadline: str | None = None
    difficulty: str = "适中"
    material_types: list[ResourceType] = Field(default_factory=list)


class OutlineSection(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    goal: str = Field(min_length=4, max_length=300)
    must_cover: list[str] = Field(min_length=1, max_length=12)
    target_words: int = Field(default=300, ge=50, le=3000)


class ResourceOutline(BaseModel):
    objective: str = Field(min_length=4, max_length=500)
    sections: list[OutlineSection] = Field(min_length=1, max_length=10)


class RepairInstruction(BaseModel):
    """A field-level repair ticket for one deterministic blocking gap."""

    issue: str
    location: str
    target_field: str
    action: str
    acceptance_check: str
    required_evidence: list[str] = Field(default_factory=list)
    required_terms: list[str] = Field(default_factory=list)
    fingerprint: str = ""
    escalated: bool = False


class TaskReview(BaseModel):
    approved: bool
    score: float = Field(ge=0, le=1)
    # ``issues`` stays as the compatibility field used by persisted executions
    # and older clients.  New reviews expose severity explicitly.
    issues: list[str] = Field(default_factory=list)
    blocking_issues: list[str] = Field(default_factory=list)
    blocking_fingerprints: list[str] = Field(default_factory=list)
    repeated_fingerprints: list[str] = Field(default_factory=list)
    repair_history_fingerprints: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    fixes: list[str] = Field(default_factory=list)
    repair_instructions: list[RepairInstruction] = Field(default_factory=list)
    gate_status: Literal[
        "approved",
        "approved_after_rework_limit",
        "rejected",
        "review_unavailable",
    ] = "approved"
    evidence_ids: list[str] = Field(default_factory=list)
    claim_evidence: list[dict[str, str]] = Field(default_factory=list)
    failure_kind: str | None = None
    error_code: str | None = None
    retryable: bool = True
    terminal: bool = False
    review_attempt: int = Field(default=0, ge=0)
    retry_count: int = Field(default=0, ge=0)
    service_recoverable: bool = True
    error_fingerprint: str = ""
    consecutive_fingerprint_count: int = Field(default=0, ge=0)

    @field_validator("gate_status", mode="before")
    @classmethod
    def normalize_legacy_blocked_status(cls, value: Any) -> Any:
        """Keep interrupted executions readable after the gate enum was tightened.

        Older execution snapshots used ``blocked`` for an unavailable or
        budget-exhausted reviewer.  That is not a content verdict, so it maps to
        the fail-closed ``review_unavailable`` state instead of crashing while
        the partial result is being persisted or retried.
        """

        return "review_unavailable" if value == "blocked" else value


class PlannedResourceTask(BaseModel):
    task_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{2,63}$")
    day: str = Field(pattern=r"^D[1-9][0-9]*$")
    # 执行者可以是内置生成器，也可以是学生自建智能体；``type`` 保持 Literal 不变。
    agent: ResourceType | CustomAgentRef
    type: ResourceType
    title: str = Field(min_length=2, max_length=160)
    knowledge_points: list[str] = Field(min_length=1, max_length=12)
    difficulty: str = Field(min_length=2, max_length=32)
    audience: str = Field(min_length=2, max_length=120)
    outline: ResourceOutline
    quality_criteria: list[str] = Field(min_length=1, max_length=12)
    # Ad-hoc form generation can request an exact mix of question types.  The
    # planned runtime owns this execution field so the request does not fall
    # back to the legacy graph merely to preserve quiz counts.
    quiz_config: dict[str, int] = Field(default_factory=dict)
    source_ids: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    status: Literal["pending", "running", "generated", "review", "ready", "failed"] = (
        "pending"
    )
    review: TaskReview | None = None
    retry_count: int = Field(default=0, ge=0)


class PlannedDay(BaseModel):
    day: str = Field(pattern=r"^D[1-9][0-9]*$")
    title: str = Field(min_length=1, max_length=160)
    knowledge_points: list[str] = Field(min_length=1, max_length=16)
    objective: str = Field(min_length=4, max_length=500)
    minutes: int = Field(ge=15, le=480)
    prerequisites: list[str] = Field(default_factory=list, max_length=30)
    task_ids: list[str] = Field(default_factory=list)
    actions: list[str] = Field(min_length=1, max_length=12)


class PlanValidation(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PlanArtifact(BaseModel):
    plan_id: str
    student_id: str
    version: int = Field(ge=1)
    status: PlanStatus
    request_summary: str = Field(min_length=4, max_length=500)
    complexity: PlanComplexity
    constraints: PlanConstraints
    days: list[PlannedDay] = Field(min_length=1, max_length=30)
    tasks: list[PlannedResourceTask] = Field(min_length=1, max_length=MAX_PLAN_TASKS)
    validation: PlanValidation
    learner_context: dict[str, Any] | None = None
    learning_path_preferences: dict[str, Any] | None = None

    @model_validator(mode="after")
    def task_references_exist(self):
        task_ids = {task.task_id for task in self.tasks}
        if len(task_ids) != len(self.tasks):
            raise ValueError("task_id 必须唯一")
        referenced = {task_id for day in self.days for task_id in day.task_ids}
        if not referenced <= task_ids:
            raise ValueError("day.task_ids 包含不存在的任务")
        if any(not set(task.depends_on) <= task_ids for task in self.tasks):
            raise ValueError("depends_on 包含不存在的任务")
        return self


class PlanDraftTask(BaseModel):
    """Business fields only; execution lifecycle is server-owned."""

    key: str = Field(
        pattern=r"^[a-z0-9][a-z0-9_-]{2,63}$",
        validation_alias=AliasChoices("key", "task_id"),
    )
    day: str = Field(pattern=r"^D[1-9][0-9]*$")
    type: ResourceType
    title: str = Field(min_length=2, max_length=160)
    knowledge_points: list[str] = Field(min_length=1, max_length=12)
    difficulty: str = Field(min_length=2, max_length=32)
    audience: str = Field(min_length=2, max_length=120)
    outline: "PlanDraftOutline"
    quality_criteria: list[str] = Field(min_length=1, max_length=4)
    source_ids: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)


class PlanDraftDay(BaseModel):
    day: str = Field(pattern=r"^D[1-9][0-9]*$")
    title: str = Field(min_length=2, max_length=160)
    knowledge_points: list[str] = Field(min_length=1, max_length=16)
    objective: str = Field(min_length=4, max_length=500)
    minutes: int = Field(ge=15, le=480)
    prerequisites: list[str] = Field(default_factory=list)
    task_keys: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("task_keys", "task_ids"),
    )
    actions: list[str] = Field(min_length=1, max_length=12)


class PlanDraftSection(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    goal: str = Field(min_length=4, max_length=300)
    must_cover: list[str] = Field(min_length=1, max_length=4)
    target_words: int = Field(default=300, ge=50, le=3000)


class PlanDraftOutline(BaseModel):
    objective: str = Field(min_length=4, max_length=500)
    sections: list[PlanDraftSection] = Field(min_length=1, max_length=4)


PlanDraftTask.model_rebuild()


class PlanDraft(BaseModel):
    """The compact contract requested from a planning model.

    Persistence and lifecycle fields belong to the server, not the model.
    """

    request_summary: str = Field(min_length=4, max_length=500)
    constraints: PlanConstraints
    days: list[PlanDraftDay] = Field(min_length=1, max_length=30)
    tasks: list[PlanDraftTask] = Field(min_length=1, max_length=MAX_PLAN_TASKS)


class LongPlanTaskSkeleton(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{2,63}$")
    day: str = Field(pattern=r"^D[1-9][0-9]*$")
    type: ResourceType
    title: str = Field(min_length=2, max_length=80)
    knowledge_points: list[str] = Field(min_length=1, max_length=4)
    difficulty: str = Field(min_length=2, max_length=32)
    audience: str = Field(min_length=2, max_length=80)
    depends_on: list[str] = Field(default_factory=list, max_length=4)


class LongPlanScheduleDay(BaseModel):
    day: str = Field(pattern=r"^D[1-9][0-9]*$")
    title: str = Field(min_length=1, max_length=80)
    knowledge_points: list[str] = Field(min_length=1, max_length=6)
    objective: str = Field(min_length=4, max_length=120)
    minutes: int = Field(ge=15, le=480)
    prerequisites: list[str] = Field(default_factory=list, max_length=30)
    actions: list[str] = Field(min_length=1, max_length=4)


class LongPlanDaySkeleton(LongPlanScheduleDay):
    """Legacy day shape retained for persisted fixtures with task_keys."""

    task_keys: list[str] = Field(default_factory=list, max_length=MAX_PLAN_TASKS)


class LongPlanScheduleSkeleton(BaseModel):
    """Compact model-facing contract for long-plan daily schedules only."""

    request_summary: str = Field(min_length=4, max_length=200)
    constraints: PlanConstraints
    # The schedule-first builder is also used for short plans with many
    # requested material types.  Those plans need the same bounded, repairable
    # construction path without pretending they are fourteen-day plans.
    days: list[LongPlanScheduleDay] = Field(min_length=3, max_length=30)


class LongPlanSkeleton(LongPlanScheduleSkeleton):
    """Legacy task-bearing skeleton kept for old fixtures and persisted data."""

    days: list[LongPlanDaySkeleton] = Field(min_length=14, max_length=30)
    tasks: list[LongPlanTaskSkeleton] = Field(min_length=1, max_length=MAX_PLAN_TASKS)

    @model_validator(mode="after")
    def task_keys_match_schedule(self):
        task_keys = [task.key for task in self.tasks]
        if len(task_keys) != len(set(task_keys)):
            raise ValueError("long plan task keys must be unique")

        valid_days = {day.day for day in self.days}
        if any(task.day not in valid_days for task in self.tasks):
            raise ValueError("long plan task day must exist in the schedule")
        return self


class OutlineBatchEntry(BaseModel):
    key: str
    outline: PlanDraftOutline
    quality_criteria: list[str] = Field(min_length=1, max_length=4)


class OutlineBatch(BaseModel):
    tasks: list[OutlineBatchEntry] = Field(min_length=1, max_length=4)


class PlanExecutionState(BaseModel):
    resources: list[dict] = Field(default_factory=list)
    schedule: list[dict] = Field(default_factory=list)
    task_progress: dict[str, dict] = Field(default_factory=dict)
    coverage: dict = Field(default_factory=dict)
    integration: dict = Field(default_factory=dict)
    reviews: dict[str, dict] = Field(default_factory=dict)
    repair_task_ids: list[str] = Field(default_factory=list)
    retry_round: int = 0
    trace_run_id: str = ""


class PlanRecordResponse(BaseModel):
    plan: PlanArtifact
    execution: PlanExecutionState


class PlanUpdateRequest(BaseModel):
    student_id: str
    version: int = Field(ge=1)
    days: list[PlannedDay]
    tasks: list[PlannedResourceTask]
    constraints: PlanConstraints


class PlanActionRequest(BaseModel):
    student_id: str
    version: int = Field(ge=1)
    feedback: str = ""
    learning_baseline: dict[str, Any] | None = None


class PlanExecuteRequest(BaseModel):
    student_id: str
    version: int = Field(ge=1)
    confirm: bool = False
