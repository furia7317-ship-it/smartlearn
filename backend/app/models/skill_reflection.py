"""Durable, bounded background work for personal procedural memories."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SkillReflectionJob(Base):
    __tablename__ = "skill_reflection_jobs"
    __table_args__ = (
        UniqueConstraint("student_id", "run_id", name="uq_skill_reflection_student_run"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    run_id: Mapped[str] = mapped_column(String(96), index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    # Contains bounded, redacted review evidence, never conversations or prompts.
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[str] = mapped_column(String(64), default="")
    locked_until: Mapped[datetime | None] = mapped_column(nullable=True)
    next_attempt_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC).replace(tzinfo=None), index=True,
    )
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    last_error_code: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
