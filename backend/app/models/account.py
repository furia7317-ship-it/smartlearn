"""用户账户与登录会话模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserAccount(Base):
    """可登录账户；账户 ID 同时作为全站 student_id。"""

    __tablename__ = "user_accounts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    login: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    grade: Mapped[str] = mapped_column(String(32), default="")
    major: Mapped[str] = mapped_column(String(128), default="")
    preferences: Mapped[list] = mapped_column(JSON, default=list)
    long_term_goal: Mapped[str] = mapped_column(Text, default="")
    mid_term_goal: Mapped[str] = mapped_column(Text, default="")
    short_term_goal: Mapped[str] = mapped_column(Text, default="")
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class UserSession(Base):
    """服务端保存令牌摘要，原始令牌只存在 HttpOnly Cookie 中。"""

    __tablename__ = "user_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
