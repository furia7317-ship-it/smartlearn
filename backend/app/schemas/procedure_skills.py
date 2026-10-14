"""Bounded, non-executable teaching procedures and management API contracts."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.resource_plan import ResourceType


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


ShortText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=160)]
ProcedureText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=500)]
StudentId = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=64)]


class SkillDefinition(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=400)
    resource_types: list[ResourceType] = Field(min_length=1, max_length=9)
    triggers: list[ShortText] = Field(min_length=1, max_length=8)
    steps: list[ProcedureText] = Field(min_length=1, max_length=12)
    checks: list[ProcedureText] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def bounded_plain_text(self) -> SkillDefinition:
        values = [self.name, self.description, *self.triggers, *self.steps, *self.checks]
        if sum(map(len, values)) > 7000:
            raise ValueError("教学方法文字总长不能超过 7000 字")
        if any(any(ord(char) < 32 and char not in "\n\t" for char in value) for value in values):
            raise ValueError("教学方法不能包含控制字符")
        self.resource_types = list(dict.fromkeys(self.resource_types))
        return self


class SkillProposal(StrictModel):
    student_id: StudentId
    definition: SkillDefinition
    skill_id: str | None = Field(default=None, min_length=1, max_length=64)
    source_run_id: str = Field(default="", max_length=64)


class SkillVersionAction(StrictModel):
    student_id: StudentId
    version_id: str = Field(min_length=1, max_length=64)


class SkillDisableAction(StrictModel):
    student_id: StudentId
    disabled: bool


class SkillUsageSummary(StrictModel):
    total: int = 0
    approved: int = 0
    failed: int = 0


class SkillVersionView(StrictModel):
    id: str
    skill_id: str
    version: int
    definition: SkillDefinition
    content_hash: str
    status: Literal["candidate", "passed", "rejected"]
    validation: dict[str, Any]
    source_run_id: str
    created_at: str


class SkillEventView(StrictModel):
    id: str
    event_type: str
    actor_id: str
    version_id: str | None
    details: dict[str, Any]
    created_at: str


class SkillSummary(StrictModel):
    id: str
    name: str
    description: str
    owner_id: str
    read_only: bool
    disabled: bool
    active_version_id: str | None
    active_version: int | None
    latest_version_id: str
    latest_version: int
    latest_version_status: Literal["candidate", "passed", "rejected"]
    status: Literal["candidate", "passed", "rejected", "active", "disabled"]
    resource_types: list[ResourceType]
    created_at: str
    updated_at: str
    usage_summary: SkillUsageSummary


class SkillDetail(SkillSummary):
    proposed_version_id: str | None = None
    versions: list[SkillVersionView]
    events: list[SkillEventView]
