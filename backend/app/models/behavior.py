"""行为埋点 + 媒体产物模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Float, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BehaviorEvent(Base):
    """行为埋点：浏览时长、练习量、资源反馈。"""

    __tablename__ = "behavior_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    # view_duration / practice_count / resource_feedback / page_visit
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    # type-specific 数据
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class MediaAsset(Base):
    """视频/PPT 媒体产物。"""

    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # video / ppt
    topic: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    # pending -> rendering -> completed -> failed
    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    # 模板名、参数、时长等
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
