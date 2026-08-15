"""行为埋点 Schema。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class BehaviorEventRequest(BaseModel):
    """POST /api/behavior 请求。"""
    student_id: str
    type: str  # view_duration / practice_count / resource_feedback / page_visit
    payload: dict[str, Any] = Field(default_factory=dict)


class DashboardResponse(BaseModel):
    """GET /api/dashboard/{id} 响应。"""
    type_counts: dict[str, int]
    daily_activity: list[dict[str, Any]]
    usage_history: list[dict[str, Any]] = Field(default_factory=list)
    resource_feedback: dict[str, Any]
    period_days: int
