"""画像相关 Schema。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProfileBase(BaseModel):
    """画像基础字段。"""
    knowledge_level: dict[str, Any] = Field(default_factory=dict)
    cognitive_style: dict[str, Any] = Field(default_factory=dict)
    goals: dict[str, Any] = Field(default_factory=dict)
    error_profile: dict[str, Any] = Field(default_factory=dict)
    pace: dict[str, Any] = Field(default_factory=dict)
    interests: list[dict[str, Any]] = Field(default_factory=list)


class ProfileResponse(ProfileBase):
    """GET /api/profile/{id} 响应。"""
    student_id: str
    dialogue_history: str | None = None

    class Config:
        from_attributes = True


class ProfileDialogueRequest(BaseModel):
    """POST /api/profile/dialogue 请求。"""
    student_id: str
    message: str
    dialogue: list[dict[str, str]] = Field(default_factory=list)
    current_profile: dict[str, Any] = Field(default_factory=dict)
    round: int = 0


class ProfileDialogueResponse(BaseModel):
    """POST /api/profile/dialogue 响应。"""
    question: str
    updated_profile: dict[str, Any]
    round: int
    done: bool


class ProfileIdentityWrite(BaseModel):
    """用户可编辑的个人主页身份信息。"""

    display_name: str = Field(min_length=1, max_length=40)
    motto: str = Field(default="", max_length=120)
    strengths: list[str] = Field(default_factory=list, max_length=5)


class ProfileIdentityResponse(ProfileIdentityWrite):
    """个人主页身份卡响应。"""

    student_id: str
    major: str = ""
    grade: str = ""
    updated_at: str | None = None
