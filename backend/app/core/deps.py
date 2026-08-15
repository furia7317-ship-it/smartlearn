"""FastAPI 通用依赖注入。"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.llm import build_llm

# 数据库会话依赖
DBSession = Annotated[AsyncSession, Depends(get_db)]


def get_llm(temperature: float = 0.7, provider: str | None = None):
    """FastAPI 依赖工厂：获取 LLM 实例。"""
    return build_llm(temperature=temperature, provider=provider)
