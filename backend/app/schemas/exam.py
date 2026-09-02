"""测评相关 Schema。"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints


ScopePoint = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=160),
]
QuestionId = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64),
]
AnswerText = Annotated[str, StringConstraints(max_length=20_000)]


class ExamRequest(BaseModel):
    """POST /api/assess/exam 请求。"""
    topic: str
    student_id: str
    scope_points: list[str] = Field(default_factory=list)
    paper_type: str = "mixed"  # unit_test / mixed / adaptive
    category: str = "未分类"


class CourseExamContext(BaseModel):
    """One currently visible course selected for a combined assessment."""

    course_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=256)
    progress: float = Field(default=0, ge=0, le=100)
    scope_points: list[ScopePoint] = Field(default_factory=list, max_length=80)
    current_stage: str = Field(default="", max_length=256)


class CourseExamRequest(BaseModel):
    """POST /api/assess/course-exam request.

    ``topic``, ``category`` and paper tags are intentionally server-derived so
    the stored paper always reflects the selected course snapshot.
    """

    student_id: str = Field(min_length=1, max_length=64)
    courses: list[CourseExamContext] = Field(min_length=1, max_length=8)
    paper_type: Literal["adaptive"] = "adaptive"


class QuestionSchema(BaseModel):
    """单道题目。"""
    id: str
    type: str  # mcq / blank / short / code
    stem: str
    options: list[str] | None = None
    answer: str = ""
    score: int = 10
    knowledge_point: str = ""
    difficulty: str = "medium"
    explanation: str = ""


class ExamResponse(BaseModel):
    """出卷响应。"""
    exam_id: str
    paper_id: str
    topic: str
    questions: list[QuestionSchema]
    paper_type: str


class SubmitRequest(BaseModel):
    """POST /api/assess/{exam_id}/submit 请求。"""
    student_id: str
    answers: dict[QuestionId, AnswerText] = Field(default_factory=dict, max_length=200)
    # {question_id: answer_text}


class GradedResult(BaseModel):
    """单题评分结果。"""
    question_id: str
    type: str
    score: float
    max_score: float
    correct: bool
    student_answer: str
    answer: str
    knowledge_point: str
    feedback: str
    error_type: str = "unknown"


class MasteryItem(BaseModel):
    """分项掌握度。"""
    score: float
    level: str
    question_count: int


class SubmitResponse(BaseModel):
    """交卷评分响应。"""
    exam_id: str
    overall: float
    mastery: dict[str, MasteryItem]
    results: list[GradedResult]
    assessment: dict[str, Any]
