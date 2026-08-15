"""Durable public agent-run history.

Only the sanitized trace payload is stored here. Provider-private reasoning,
raw prompts, raw tool envelopes, and encrypted reasoning state never belong in
these tables.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AgentRun(Base):
    """One user-visible agent execution."""

    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(96), default="", index=True)
    parent_run_id: Mapped[str] = mapped_column(String(96), default="", index=True)
    schema_version: Mapped[str] = mapped_column(String(24), default="2.0")
    status: Mapped[str] = mapped_column(String(24), default="running", index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    input_summary: Mapped[str] = mapped_column(Text, default="")
    last_sequence: Mapped[int] = mapped_column(Integer, default=0)
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
        onupdate=func.now(),
    )


class AgentRunEvent(Base):
    """Append-only public event belonging to one run."""

    __tablename__ = "agent_run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_agent_run_event_sequence"),
    )

    event_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"),
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer)
    span_id: Mapped[str] = mapped_column(String(128), index=True)
    event_type: Mapped[str] = mapped_column(String(40), default="operation", index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
