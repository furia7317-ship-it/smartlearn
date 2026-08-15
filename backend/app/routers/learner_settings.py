"""Learner-controlled teaching, planning, reminder and privacy settings."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import LearnerPreferenceSettings
from app.services.learner_settings import (
    DAILY_MINUTES,
    MATERIAL_TYPES,
    get_learner_settings,
    normalize_learner_settings,
)

router = APIRouter()


class LearnerSettingsWrite(BaseModel):
    teaching_mode: Literal["direct", "socratic", "practice"] = "direct"
    answer_depth: Literal["concise", "balanced", "deep"] = "balanced"
    difficulty: Literal["foundation", "balanced", "challenge"] = "balanced"
    daily_minutes: int = Field(default=40)
    material_types: list[str] = Field(default_factory=lambda: ["explainer", "quiz"], min_length=1, max_length=9)
    long_term_memory_enabled: bool = True
    reminder_enabled: bool = False
    reminder_time: str = Field(default="20:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @field_validator("daily_minutes")
    @classmethod
    def validate_daily_minutes(cls, value: int) -> int:
        if value not in DAILY_MINUTES:
            raise ValueError("每日学习时长必须是 20、40、60 或 90 分钟")
        return value

    @field_validator("material_types")
    @classmethod
    def validate_material_types(cls, value: list[str]) -> list[str]:
        selected = list(dict.fromkeys(value))
        if any(item not in MATERIAL_TYPES for item in selected):
            raise ValueError("包含不支持的资料类型")
        return selected


def settings_response(student_id: str, preferences: dict, updated_at: str | None = None) -> dict:
    return {
        "student_id": student_id,
        **normalize_learner_settings(preferences),
        "updated_at": updated_at,
    }


@router.get("/{student_id}")
async def read_learner_settings(student_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(LearnerPreferenceSettings, student_id)
    preferences = await get_learner_settings(db, student_id)
    return settings_response(student_id, preferences, str(row.updated_at) if row is not None else None)


@router.put("/{student_id}")
async def save_learner_settings(
    student_id: str,
    payload: LearnerSettingsWrite,
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(LearnerPreferenceSettings, student_id)
    preferences = normalize_learner_settings(payload.model_dump(mode="json"))
    if row is None:
        row = LearnerPreferenceSettings(student_id=student_id, preferences=preferences)
        db.add(row)
    else:
        row.preferences = preferences
    await db.commit()
    await db.refresh(row)
    return settings_response(student_id, preferences, str(row.updated_at))
