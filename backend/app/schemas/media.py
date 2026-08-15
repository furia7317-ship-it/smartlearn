"""媒体相关 Schema。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class VideoRequest(BaseModel):
    """POST /api/media/video 请求。"""
    topic: str
    student_id: str
    script: dict[str, Any] | None = None  # 如果不提供则自动生成


class VideoTaskResponse(BaseModel):
    """POST /api/media/video 响应。"""
    task_id: str
    status: str = "pending"


class VideoProgressResponse(BaseModel):
    """GET /api/media/video/{task_id} 响应。"""
    id: str
    status: str
    progress: float
    file_path: str | None = None
    error: str | None = None


class PptRequest(BaseModel):
    """POST /api/media/ppt 请求。"""
    topic: str
    student_id: str
    slides: list[dict[str, Any]] | None = None
    template: str | None = None  # 视觉模板键（academic/tech/warm/chalk）；缺省自动/默认


class PptResponse(BaseModel):
    """POST /api/media/ppt 响应。"""
    task_id: str
    status: str = "pending"
