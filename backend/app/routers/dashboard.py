"""仪表盘路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.routers.auth import require_account_student_scope
from app.schemas.behavior import DashboardResponse
from app.services.behavior import get_dashboard_data

router = APIRouter(dependencies=[Depends(require_account_student_scope)])


@router.get("/{student_id}", response_model=DashboardResponse)
async def get_dashboard(
    student_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """获取学生仪表盘数据。"""
    data = await get_dashboard_data(db, student_id, days)
    return DashboardResponse(**data)
