"""资源生成相关 Schema。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class QuizConfig(BaseModel):
    """题目生成配置：各题型数量。负数被拒（ge=0），上限防滥用（le=50）。"""
    choice: int = Field(default=0, ge=0, le=50)  # 选择题
    judge: int = Field(default=0, ge=0, le=50)   # 判断题
    short: int = Field(default=0, ge=0, le=50)   # 简答题


class LearningBaseline(BaseModel):
    source: Literal["diagnostic", "self_report", "existing_profile", "explicit_default"]
    level: Literal["novice", "basic", "intermediate", "advanced", "custom"]
    confidence: float = Field(ge=0, le=1)
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    mastery: dict[str, Any] = Field(default_factory=dict)
    custom_description: str = ""
    explicit_default_confirmed: bool = False


class LearningPathPreferences(BaseModel):
    """Explicit learner choices that deterministically constrain a path plan."""

    goal: Literal["starter", "exam", "project", "gap"]
    days: Literal[3, 7, 14, 30]
    daily_minutes: Literal[20, 40, 60, 90]
    material_types: list[
        Literal[
            "explainer",
            "quiz",
            "solution",
            "reading",
            "code",
            "video",
            "mindmap",
            "courseware",
            "interactive",
        ]
    ] = Field(min_length=1, max_length=9)


class ResourceRequest(BaseModel):
    """POST /api/agents/resource 请求。"""
    topic: str
    student_id: str
    requirements: str = ""
    # 表单生成（/api/materials/generate）专用，默认空时保持原分诊行为：
    material_types: list[str] = Field(default_factory=list)  # 用户勾选的资料类型 → 强制生成
    knowledge_points: str = ""  # 用户填写的知识点，并入 requirements 注入各生成器
    assessment_context: str = ""  # 导入的摸底分析，注入各生成器作为学情上下文
    quiz_config: QuizConfig | None = None  # 题型数量；勾选练习题时由前端表单传入
    planning_mode: Literal["resource", "learning_path"] = "resource"
    learning_baseline: LearningBaseline | None = None
    learning_path_preferences: LearningPathPreferences | None = None
    # Clients reuse this key when retrying the same generation request. A new
    # user action must create a new key so intentional duplicate topics remain
    # possible.
    idempotency_key: str = Field(
        default="",
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]*$",
    )


class ResourceItem(BaseModel):
    """单个生成资源。"""
    id: str
    type: str  # explainer / mindmap / quiz / solution / reading / code / video / courseware / interactive
    title: str
    content: Any
    reviewed: bool = False
    # Approval is an explicit server-side gate.  Missing review metadata must
    # never make a candidate publishable by default.
    review_approved: bool = False
    sources: list[dict[str, Any]] = Field(default_factory=list)


class ResourceResponse(BaseModel):
    """资源生成响应（SSE done 事件中的汇总）。"""
    topic: str
    reason: str
    resources: list[dict[str, Any]]
