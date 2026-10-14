"""Versioned procedural memory, activation pointers, and separate audit records."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, Integer, String, UniqueConstraint, event, func, inspect
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ProcedureSkill(Base):
    __tablename__ = "procedure_skills"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(80))
    active_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    version_counter: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class ProcedureSkillVersion(Base):
    __tablename__ = "procedure_skill_versions"
    __table_args__ = (
        UniqueConstraint("skill_id", "version", name="uq_procedure_skill_version"),
        UniqueConstraint("skill_id", "content_hash", name="uq_procedure_skill_content"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    skill_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="candidate")
    validation: Mapped[dict] = mapped_column(JSON, default=dict)
    source_run_id: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProcedureSkillEvent(Base):
    __tablename__ = "procedure_skill_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    skill_id: Mapped[str] = mapped_column(String(64), index=True)
    actor_id: Mapped[str] = mapped_column(String(64))
    event_type: Mapped[str] = mapped_column(String(32))
    version_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProcedureSkillUsage(Base):
    __tablename__ = "procedure_skill_usages"
    __table_args__ = (
        UniqueConstraint("student_id", "run_id", "task_id", "version_id", name="uq_procedure_skill_usage"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[str] = mapped_column(String(64), default="")
    skill_id: Mapped[str] = mapped_column(String(64), index=True)
    version_id: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


@event.listens_for(ProcedureSkillVersion, "before_update")
def prevent_version_rewrite(_mapper, _connection, target: ProcedureSkillVersion) -> None:
    """Evaluation may change; a reviewed definition always keeps its original identity."""
    state = inspect(target)
    immutable = ("id", "skill_id", "version", "definition", "content_hash", "source_run_id", "created_at")
    if any(state.attrs[name].history.has_changes() for name in immutable):
        raise ValueError("教学方法版本不可改写，请创建新版本")
