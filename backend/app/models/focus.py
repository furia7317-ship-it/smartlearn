"""Immutable graph versions, personal execution, packages and durable jobs."""
from datetime import datetime, timezone
from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


def now():
    return datetime.now(timezone.utc)


class FocusGraph(Base):
    __tablename__ = "focus_graphs"
    __table_args__ = (UniqueConstraint("student_id", "course_id", "version"),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(100), index=True)
    course_id: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    origin: Mapped[str] = mapped_column(String(30), default="agent")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FocusProgress(Base):
    __tablename__ = "focus_progress"
    __table_args__ = (UniqueConstraint("student_id", "graph_id"),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(100), index=True)
    graph_id: Mapped[str] = mapped_column(String(100), index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    active_node_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    daily_minutes: Mapped[int] = mapped_column(Integer, default=60)
    records: Mapped[dict] = mapped_column(JSON, default=dict)


class FocusPackage(Base):
    __tablename__ = "focus_packages"
    __table_args__ = (UniqueConstraint("graph_id", "node_id", "version"),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(100), index=True)
    graph_id: Mapped[str] = mapped_column(String(100), index=True)
    node_id: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    content: Mapped[dict] = mapped_column(JSON, default=dict)


class FocusOperation(Base):
    __tablename__ = "focus_operations"
    __table_args__ = (UniqueConstraint("student_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(100), index=True)
    request_id: Mapped[str] = mapped_column(String(100))
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FocusJob(Base):
    __tablename__ = "focus_jobs"
    __table_args__ = (UniqueConstraint("student_id", "kind", "target"),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(100), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    target: Mapped[str] = mapped_column(String(220))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
