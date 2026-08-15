"""LangGraph 各图的 State 定义（TypedDict + reducers）。"""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


def merge_dict_updates(
    current: dict[str, dict[str, Any]],
    update: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    return {**(current or {}), **(update or {})}


class ResourceState(TypedDict):
    """资源生成图状态。"""

    topic: str
    student_id: str
    requirements: str
    profile: dict[str, Any]
    kb_context: list[dict[str, Any]]
    selected: list[str]
    forced_modules: list[str]   # 非空时跳过分诊，直接按用户勾选生成
    assessment_context: str     # 导入的摸底分析，经 prompt_extras 注入各生成器
    quiz_config: dict[str, int] # 题型数量配置 {choice, judge, short}，供 quiz 生成器按量出题
    resources: Annotated[list[dict[str, Any]], operator.add]
    reason: str
    revise: dict[str, str]      # rid → 修订意见（reviewer 驳回时写入）
    retry_round: int            # 0=初轮，1=重做轮
    outline: dict[str, Any]
    integrated: dict[str, Any]
    schedule: list[dict[str, Any]]
    chapter: dict[str, Any]
    clarification_required: bool
    trace_run_id: str
    agent_response_ids: dict[str, str]


class PlannedResourceState(TypedDict):
    """Execution state for an already validated PlanArtifact."""

    plan: dict[str, Any]
    student_id: str
    profile: dict[str, Any]
    kb_context: list[dict[str, Any]]
    plan_task: dict[str, Any]
    resources: Annotated[list[dict[str, Any]], operator.add]
    reviews: Annotated[dict[str, dict[str, Any]], merge_dict_updates]
    repair_task_ids: Annotated[list[str], operator.add]
    retry_round: int
    coverage: dict[str, Any]
    integration: dict[str, Any]
    schedule: list[dict[str, Any]]
    trace_run_id: str
    run_started_at: float
    retry_policy: dict[str, int | float]
    knowledge_gate_enforced: bool
    # ``custom:<id>`` → 用户自建智能体定义；图内不查库，由管线入口预加载。
    custom_agents: dict[str, dict[str, Any]]


class ExamState(TypedDict):
    """出卷图状态。"""

    topic: str
    student_id: str
    scope_points: list[str]
    weak_points: list[str]
    kb_context: list[dict[str, Any]]
    composition: dict[str, Any]
    paper_type: str
    questions: list[dict[str, Any]]
    exam_id: str
    paper_id: str


class GradeState(TypedDict):
    """评分+分析图状态。"""

    exam_id: str
    student_id: str
    answers: dict[str, str]
    questions: list[dict[str, Any]]
    results: Annotated[list[dict[str, Any]], operator.add]
    overall: float
    mastery: dict[str, Any]
    assessment: dict[str, Any]


class TutorState(TypedDict):
    """辅导图状态。"""

    student_id: str
    question: str
    history: list[dict[str, str]]
    image_data: str | None
    kb_context: list[dict[str, Any]]
    profile: dict[str, Any]
    answer: str
    sources: list[dict[str, Any]]


class ProfileState(TypedDict):
    """对话建档图状态。"""

    student_id: str
    dialogue: list[dict[str, str]]
    current_profile: dict[str, Any]
    updated_profile: dict[str, Any]
    round: int
    max_rounds: int
    done: bool
