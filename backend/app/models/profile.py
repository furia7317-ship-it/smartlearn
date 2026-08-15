"""学生六维画像模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Profile(Base):
    """学生画像 — 六维：知识水平、认知风格、目标、易错点、节奏、兴趣。"""

    __tablename__ = "profiles"

    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)

    # 六维数据，每维内部含 evidence 字段（来自哪轮对话/哪次测评）
    knowledge_level: Mapped[dict] = mapped_column(JSON, default=dict)
    # {topic: {score: float, last_updated: str, evidence: str}}
    cognitive_style: Mapped[dict] = mapped_column(JSON, default=dict)
    # {visual: float, verbal: float, practical: float, evidence: str}
    goals: Mapped[dict] = mapped_column(JSON, default=dict)
    # {target: str, deadline: str, milestones: [...]}
    error_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    # {error_type x knowledge_point: {count, examples}}
    pace: Mapped[dict] = mapped_column(JSON, default=dict)
    # {preferred_duration_min: int, frequency: str, question_count: int}
    interests: Mapped[list] = mapped_column(JSON, default=list)
    # [{topic: str, level: str}]

    # 对话建档原始记录
    dialogue_history: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
