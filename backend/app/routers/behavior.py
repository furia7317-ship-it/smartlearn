"""行为埋点路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.routers.auth import require_account_student_scope
from app.schemas.behavior import BehaviorEventRequest
from app.services.behavior import record_event

router = APIRouter(dependencies=[Depends(require_account_student_scope)])


@router.post("")
async def create_behavior_event(
    req: BehaviorEventRequest,
    db: AsyncSession = Depends(get_db),
):
    """记录行为埋点事件。"""
    event = await record_event(db, req.student_id, req.type, req.payload)
    return {
        "id": event.id,
        "student_id": event.student_id,
        "type": event.type,
        "created_at": str(event.created_at),
    }
