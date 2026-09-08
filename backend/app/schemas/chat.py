"""辅导对话 Schema。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatHistoryMessage(BaseModel):
    """A validated user/assistant message from the current chat session."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatAttachment(BaseModel):
    """A transient, bounded file context supplied with one tutor question."""

    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=180)
    kind: Literal["image", "pdf", "document", "presentation", "spreadsheet", "text"]
    media_type: str = Field(default="application/octet-stream", max_length=120)
    size: int = Field(ge=1, le=20 * 1024 * 1024)
    extracted_text: str = Field(default="", max_length=18000)
    image_data: str = Field(default="", max_length=8 * 1024 * 1024)
    recognition_status: Literal["recognized", "parsed", "fallback"] = "parsed"
    recognition_provider: str = Field(default="", max_length=80)
    recognition_notice: str = Field(default="", max_length=300)


class ChatRequest(BaseModel):
    """POST /api/chat 请求。"""
    student_id: str
    conversation_id: str = Field(default="", max_length=96)
    message: str
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=100)
    image_data: str | None = None  # base64 图片
    attachments: list[ChatAttachment] = Field(default_factory=list, max_length=5)
    teacher_persona: Literal["alligator", "raccoon"] = "raccoon"


class ChatResponse(BaseModel):
    """辅导回答。"""
    answer: str
    sources: list[dict[str, Any]] = Field(default_factory=list)


class ClarificationOption(BaseModel):
    value: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    detail: str = Field(default="", max_length=240)


class ClarificationQuestion(BaseModel):
    field: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=240)
    reason: str = Field(default="", max_length=240)
    kind: Literal["single", "multiple", "text"] = "single"
    options: list[ClarificationOption] = Field(default_factory=list, max_length=10)
    required: bool = True
    allow_custom: bool = False
    custom_placeholder: str = Field(default="", max_length=160)


class RequirementContractField(BaseModel):
    field: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=240)
    kind: Literal["single", "multiple", "text"] = "single"
    required: bool = True
    inferable: bool = True
    option_guidance: str = Field(default="", max_length=240)


class ClarificationRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    request: str = Field(min_length=2, max_length=2000)
    task_family: str = Field(default="learning_path", min_length=2, max_length=64, pattern=r"^[a-z0-9_-]+$")
    owner_agent: str = Field(default="path_planner", min_length=2, max_length=64, pattern=r"^[a-z0-9_-]+$")
    phase: Literal["initial", "confirmed"] = "initial"
    answers: dict[str, Any] = Field(default_factory=dict)


class ClarificationResponse(BaseModel):
    summary: str = Field(default="", max_length=500)
    inferred: dict[str, Any] = Field(default_factory=dict)
    questions: list[ClarificationQuestion] = Field(default_factory=list, max_length=8)
    context_sources: list[str] = Field(default_factory=list, max_length=8)
    source: Literal["model"] = "model"
    decision: Literal["execute", "ask"] = "ask"
    requirement_contract_id: str = Field(default="", max_length=64)
    requirement_contract_source: Literal["generated", "reused"] = "generated"
    requirement_contract_owner: str = Field(default="", max_length=64)
    requirement_fields: list[RequirementContractField] = Field(default_factory=list, max_length=12)
