"""Public contracts for evidence-grounded document visual novels."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class GalgameSourceRef(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=240)
    excerpt: str = Field(min_length=1, max_length=900)
    locator: str = Field(default="", max_length=120)


class GalgameChoice(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    next_scene_id: str = Field(min_length=1, max_length=80)
    feedback: str = Field(default="", max_length=260)
    correct: bool | None = None


class GalgameScene(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    speaker: str = Field(min_length=1, max_length=80)
    expression: Literal["neutral", "smile", "thinking", "encourage"] = "neutral"
    text: str = Field(min_length=1, max_length=900)
    blackboard_title: str = Field(default="本幕要点", max_length=120)
    blackboard_points: list[str] = Field(default_factory=list, max_length=6)
    source_ids: list[str] = Field(default_factory=list, max_length=6)
    choices: list[GalgameChoice] = Field(default_factory=list, max_length=4)
    duration_seconds: float = Field(default=12, ge=3, le=60)


class GalgameProject(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=240)
    source_title: str = Field(min_length=1, max_length=240)
    source_kind: str = Field(default="document", max_length=40)
    resource_id: str = Field(default="", max_length=200)
    companion_name: str = Field(default="知夏", max_length=80)
    language: str = Field(default="zh-CN", max_length=20)
    learning_objectives: list[str] = Field(default_factory=list, max_length=8)
    key_takeaways: list[str] = Field(default_factory=list, max_length=10)
    sources: list[GalgameSourceRef] = Field(default_factory=list, max_length=24)
    scenes: list[GalgameScene] = Field(min_length=3, max_length=12)
    video_script: dict[str, Any] = Field(default_factory=dict)
    generation_provider: str = Field(default="configured-llm", max_length=80)
    created_at: str


class GalgameGenerateRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=160)
    source_title: str = Field(min_length=1, max_length=240)
    source_text: str = Field(min_length=20, max_length=18_000)
    source_kind: str = Field(default="document", max_length=40)
    resource_id: str = Field(default="", max_length=200)
    resource_type: str = Field(default="reading", max_length=40)
    companion_name: str = Field(default="知夏", min_length=1, max_length=80)
    language: str = Field(default="zh-CN", max_length=20)
    reading_pace: Literal["slow", "normal", "fast"] = "normal"

