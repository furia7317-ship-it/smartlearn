from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.base import Base
from app.routers.learner_settings import (
    LearnerSettingsWrite,
    read_learner_settings,
    save_learner_settings,
)
from app.services.learner_settings import normalize_learner_settings, teaching_preference_prompt


@pytest.fixture
async def settings_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_learner_settings_round_trip_in_sqlite(settings_db):
    initial = await read_learner_settings("settings-student", settings_db)
    assert initial["daily_minutes"] == 40
    assert initial["long_term_memory_enabled"] is True

    saved = await save_learner_settings(
        "settings-student",
        LearnerSettingsWrite(
            teaching_mode="socratic",
            answer_depth="deep",
            difficulty="challenge",
            daily_minutes=60,
            material_types=["video", "quiz", "solution"],
            long_term_memory_enabled=False,
            reminder_enabled=True,
            reminder_time="19:30",
        ),
        settings_db,
    )
    restored = await read_learner_settings("settings-student", settings_db)

    assert saved["teaching_mode"] == "socratic"
    assert restored["daily_minutes"] == 60
    assert restored["material_types"] == ["video", "quiz", "solution"]
    assert restored["long_term_memory_enabled"] is False
    assert restored["reminder_time"] == "19:30"


def test_settings_normalization_and_prompt_are_bounded_to_supported_values():
    normalized = normalize_learner_settings({
        "teaching_mode": "unknown",
        "daily_minutes": 999,
        "material_types": ["video", "video", "shell"],
        "reminder_time": "99:99",
    })

    assert normalized["teaching_mode"] == "direct"
    assert normalized["daily_minutes"] == 40
    assert normalized["material_types"] == ["video"]
    assert normalized["reminder_time"] == "20:00"
    prompt = teaching_preference_prompt(normalized)
    assert "学生主动设置的教学偏好" in prompt
    assert "讲解视频" in prompt
    assert "当前消息中的明确要求优先级更高" in prompt
