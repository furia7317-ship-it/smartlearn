"""Versioned public Agent Run protocol."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AgentRunStatus = Literal[
    "pending",
    "running",
    "completed",
    "failed",
    "blocked",
    "cancelled",
]
AgentEventStatus = Literal[
    "pending",
    "running",
    "rework",
    "completed",
    "failed",
    "blocked",
    "cancelled",
]
AgentEventType = Literal[
    "operation",
    "reasoning",
    "tool",
    "delegate",
    "verification",
    "result",
]
ReasoningSource = Literal[
    "provider_summary",
    "provider_reasoning",
    "model_narration",
    "runtime",
]
EventVisibility = Literal["normal", "verbose", "summary"]


class AgentTraceEvent(BaseModel):
    """Sanitized event shared by persistence, SSE, replay, and the frontend."""

    model_config = ConfigDict(extra="allow")

    schema_version: str = "2.0"
    run_id: str = Field(min_length=1, max_length=96)
    event_id: str = Field(min_length=1, max_length=96)
    sequence: int = Field(ge=0)
    span_id: str = Field(min_length=1, max_length=128)
    parent_span_id: str | None = Field(default=None, max_length=128)
    agent_id: str = Field(default="runtime", max_length=96)
    task_id: str | None = Field(default=None, max_length=160)
    attempt: int = Field(default=1, ge=1)
    event_type: AgentEventType = "operation"
    action_type: str = Field(default="action", max_length=80)
    status: AgentEventStatus = "running"
    title: str = Field(default="", max_length=256)
    phase: str | None = Field(default=None, max_length=80)
    input_summary: str | None = Field(default=None, max_length=500)
    observation_summary: str | None = Field(default=None, max_length=500)
    decision_summary: str | None = Field(default=None, max_length=500)
    evidence_ids: list[str] = Field(default_factory=list, max_length=50)
    started_at: str | None = None
    ended_at: str | None = None
    usage: dict[str, Any] | None = None
    error_code: str | None = Field(default=None, max_length=120)
    retryable: bool | None = None
    reasoning_text: str | None = Field(default=None, max_length=12000)
    reasoning_delta: str | None = Field(default=None, max_length=2000)
    reasoning_source: ReasoningSource | None = None
    segment_index: int | None = Field(default=None, ge=0)
    visibility: EventVisibility = "normal"
    tool_policy: dict[str, Any] | None = None


class AgentRunSummary(BaseModel):
    run_id: str
    owner_id: str
    conversation_id: str = ""
    parent_run_id: str = ""
    schema_version: str
    status: AgentRunStatus
    title: str = ""
    input_summary: str = ""
    last_sequence: int
    event_count: int
    started_at: datetime
    ended_at: datetime | None = None


class AgentRunEventsResponse(BaseModel):
    run: AgentRunSummary
    events: list[dict[str, Any]]
    last_sequence: int
