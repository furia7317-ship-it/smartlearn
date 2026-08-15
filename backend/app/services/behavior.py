"""行为埋点聚合服务。"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.behavior import BehaviorEvent


def _non_negative_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


async def record_event(
    db: AsyncSession,
    student_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> BehaviorEvent:
    """记录行为事件。"""
    event = BehaviorEvent(
        student_id=student_id,
        type=event_type,
        payload=payload,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def get_dashboard_data(
    db: AsyncSession,
    student_id: str,
    days: int = 30,
) -> dict[str, Any]:
    """获取仪表盘数据。"""
    since = datetime.utcnow() - timedelta(days=days)

    # 浏览时长统计
    stmt = (
        select(
            BehaviorEvent.type,
            func.count(BehaviorEvent.id).label("count"),
        )
        .where(BehaviorEvent.student_id == student_id)
        .where(BehaviorEvent.created_at >= since)
        .group_by(BehaviorEvent.type)
    )
    result = await db.execute(stmt)
    type_counts = {row.type: row.count for row in result.all()}

    # 每日活跃度
    stmt = (
        select(
            func.date(BehaviorEvent.created_at).label("date"),
            func.count(BehaviorEvent.id).label("count"),
        )
        .where(BehaviorEvent.student_id == student_id)
        .where(BehaviorEvent.created_at >= since)
        .group_by(func.date(BehaviorEvent.created_at))
        .order_by(func.date(BehaviorEvent.created_at))
    )
    result = await db.execute(stmt)
    daily_activity = [{"date": str(row.date), "count": row.count} for row in result.all()]

    # 资源反馈统计
    stmt = (
        select(BehaviorEvent.payload)
        .where(BehaviorEvent.student_id == student_id)
        .where(BehaviorEvent.type == "resource_feedback")
        .where(BehaviorEvent.created_at >= since)
    )
    result = await db.execute(stmt)
    feedbacks = [row.payload for row in result.all()]

    useful_count = sum(1 for f in feedbacks if f.get("useful", False))
    total_feedback = len(feedbacks)

    # Durable per-day usage is returned alongside aggregates so a newly signed
    # in device can render the same learning evidence as the SQLite account.
    # Local browser telemetry is still merged by the client for live sessions.
    stmt = (
        select(BehaviorEvent)
        .where(BehaviorEvent.student_id == student_id)
        .where(BehaviorEvent.created_at >= since)
        .order_by(BehaviorEvent.created_at)
    )
    events = (await db.scalars(stmt)).all()
    usage_by_date: dict[str, dict[str, Any]] = {}
    for event in events:
        day = event.created_at.date().isoformat()
        usage = usage_by_date.setdefault(
            day,
            {
                "date": day,
                "route": "/desktop",
                "minutes": 0,
                "questions": 0,
                "correct": 0,
                "feedback_count": 0,
            },
        )
        payload = event.payload if isinstance(event.payload, dict) else {}
        if event.type == "page_visit" and isinstance(payload.get("route"), str):
            usage["route"] = payload["route"][:160]
        elif event.type == "view_duration":
            usage["minutes"] += _non_negative_int(payload.get("minutes"))
        elif event.type == "practice_count":
            questions = _non_negative_int(payload.get("questions"))
            correct = min(questions, _non_negative_int(payload.get("correct")))
            usage["questions"] += questions
            usage["correct"] += correct
        elif event.type == "resource_feedback":
            usage["feedback_count"] += 1

    return {
        "type_counts": type_counts,
        "daily_activity": daily_activity,
        "usage_history": list(usage_by_date.values()),
        "resource_feedback": {
            "total": total_feedback,
            "useful": useful_count,
            "useful_rate": useful_count / total_feedback if total_feedback > 0 else 0,
        },
        "period_days": days,
    }
