"""学习目标路由。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import LearningGoal
from app.models.profile import Profile
from app.services.goals import recalculate_goal

router = APIRouter()


class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    description: str = ""
    start_date: str | None = None
    target_date: str | None = None
    topic: str = Field(min_length=1, max_length=256)
    target_mastery: float = Field(default=0.8, gt=0, le=1)
    generate_path: bool = False
    source: str = "manual"
    horizon: Literal["long", "mid", "short"] = "short"


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    status: str | None = None
    target_date: str | None = None
    target_mastery: float | None = Field(default=None, gt=0, le=1)
    horizon: Literal["long", "mid", "short"] | None = None


def _goal_horizon(goal: LearningGoal) -> str:
    suffix = str(goal.source or "").rsplit(":", 1)[-1]
    return suffix if suffix in {"long", "mid", "short"} else "short"


def serialize_goal(goal: LearningGoal) -> dict:
    return {
        "id": goal.id,
        "title": goal.title,
        "description": goal.description,
        "start_date": goal.start_date,
        "target_date": goal.target_date,
        "topic": goal.topic,
        "path_id": goal.path_id,
        "target_mastery": goal.target_mastery,
        "source": str(goal.source or "manual").split(":", 1)[0],
        "status": goal.status,
        "progress": goal.progress,
        "horizon": _goal_horizon(goal),
    }


async def _sync_goal_memory(db: AsyncSession, student_id: str) -> None:
    """Keep explicit goals in the learner profile's durable memory."""

    result = await db.execute(
        select(LearningGoal).where(
            LearningGoal.student_id == student_id,
            LearningGoal.status != "abandoned",
        )
    )
    goals = list(result.scalars().all())
    grouped = {"long": [], "mid": [], "short": []}
    for goal in goals:
        grouped[_goal_horizon(goal)].append(
            {
                "id": goal.id,
                "title": goal.title,
                "description": goal.description,
                "topic": goal.topic,
                "target_date": goal.target_date,
                "status": goal.status,
                "progress": goal.progress,
            }
        )

    profile = await db.get(Profile, student_id)
    if profile is None:
        profile = Profile(student_id=student_id)
        db.add(profile)
    memory = dict(profile.goals or {})
    memory["learning_targets"] = grouped
    memory["updated_at"] = datetime.now(timezone.utc).isoformat()
    profile.goals = memory


@router.get("/{student_id}")
async def get_goals(student_id: str, db: AsyncSession = Depends(get_db)):
    """获取学生目标列表。"""
    stmt = select(LearningGoal).where(LearningGoal.student_id == student_id)
    goals = (await db.execute(stmt)).scalars().all()
    return [serialize_goal(goal) for goal in goals]


@router.post("/{student_id}")
async def create_goal(
    student_id: str,
    req: GoalCreate,
    db: AsyncSession = Depends(get_db),
):
    """创建学习目标，可选同步生成学习路径。"""
    path_id: str | None = None
    if req.generate_path:
        from app.routers.path import create_path

        path = await create_path({"student_id": student_id, "topic": req.topic}, db)
        path_id = path["id"]

    goal = LearningGoal(
        student_id=student_id,
        title=req.title,
        description=req.description,
        start_date=req.start_date,
        target_date=req.target_date,
        topic=req.topic,
        path_id=path_id,
        target_mastery=req.target_mastery,
        source=f"{req.source.split(':', 1)[0]}:{req.horizon}",
    )
    db.add(goal)
    await db.flush()
    await _sync_goal_memory(db, student_id)
    await db.commit()
    await db.refresh(goal)
    return serialize_goal(goal)


@router.patch("/{goal_id}")
async def update_goal(
    goal_id: int,
    req: GoalUpdate,
    db: AsyncSession = Depends(get_db),
):
    """编辑目标的可变字段。"""
    goal = await db.get(LearningGoal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="目标不存在")

    payload = req.model_dump(exclude_none=True)
    horizon = payload.pop("horizon", None)
    for key, value in payload.items():
        setattr(goal, key, value)
    if horizon:
        goal.source = f"{str(goal.source or 'manual').split(':', 1)[0]}:{horizon}"
    await db.flush()
    await _sync_goal_memory(db, goal.student_id)
    await db.commit()
    await db.refresh(goal)
    return serialize_goal(goal)


@router.delete("/{goal_id}")
async def delete_goal(goal_id: int, db: AsyncSession = Depends(get_db)):
    """删除学习目标。"""
    goal = await db.get(LearningGoal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="目标不存在")
    student_id = goal.student_id
    await db.delete(goal)
    await db.flush()
    await _sync_goal_memory(db, student_id)
    await db.commit()
    return {"ok": True}


@router.post("/{goal_id}/recalc")
async def recalc_goal(goal_id: int, db: AsyncSession = Depends(get_db)):
    """按当前路径和画像掌握度重算目标。"""
    goal = await db.get(LearningGoal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="目标不存在")
    result = await recalculate_goal(db, goal)
    await db.commit()
    return result
