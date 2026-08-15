"""学习目标进度计算与交卷推进。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import LearningGoal, LearningPath, MemoryCard
from app.models.profile import Profile


def _topic_matches(left: str, right: str) -> bool:
    return bool(left and right and (left in right or right in left))


def _average_mastery(knowledge_level: dict, topic: str) -> float:
    scores = [
        float(value.get("score", 0))
        for knowledge_point, value in (knowledge_level or {}).items()
        if isinstance(value, dict) and _topic_matches(str(knowledge_point), topic)
    ]
    return sum(scores) / len(scores) if scores else 0.0


async def _mature_memory_ratio(db: AsyncSession, student_id: str, topic: str) -> float:
    stmt = select(MemoryCard).where(MemoryCard.student_id == student_id)
    cards = [
        card
        for card in (await db.execute(stmt)).scalars().all()
        if _topic_matches(card.topic, topic) or _topic_matches(card.knowledge_point, topic)
    ]
    if not cards:
        return 0.0
    return sum(card.state == "review" for card in cards) / len(cards)


async def recalculate_goal(
    db: AsyncSession,
    goal: LearningGoal,
    knowledge_level: dict | None = None,
) -> dict[str, float | str]:
    """按固定路径/掌握度权重重算一个目标。"""
    if knowledge_level is None:
        profile = await db.get(Profile, goal.student_id)
        knowledge_level = profile.knowledge_level if profile else {}

    target = goal.target_mastery if goal.target_mastery > 0 else 0.8
    average_mastery = _average_mastery(knowledge_level or {}, goal.topic)
    memory_ratio = await _mature_memory_ratio(db, goal.student_id, goal.topic)
    # 掌握度项取画像平均掌握度和成熟记忆卡占比中的较高值。
    mastery_progress = min(max(average_mastery, memory_ratio) / target, 1.0)

    if goal.path_id:
        path = await db.get(LearningPath, goal.path_id)
        path_progress = float(path.progress) if path else 0.0
        progress = 0.4 * path_progress + 0.6 * mastery_progress
    else:
        progress = mastery_progress

    goal.progress = round(min(max(progress, 0.0), 1.0), 4)
    if goal.progress >= 1.0 and goal.status == "active":
        goal.status = "completed"
    return {"progress": goal.progress, "status": goal.status}


async def advance_goals(
    db: AsyncSession,
    student_id: str,
    topic: str,
    mastery: dict | None = None,
) -> list[LearningGoal]:
    """推进与本次测评主题匹配的活动目标。"""
    profile = await db.get(Profile, student_id)
    knowledge_level = dict(profile.knowledge_level or {}) if profile else {}
    knowledge_level.update(mastery or {})

    stmt = select(LearningGoal).where(
        LearningGoal.student_id == student_id,
        LearningGoal.status == "active",
    )
    goals = list((await db.execute(stmt)).scalars().all())
    updated: list[LearningGoal] = []
    for goal in goals:
        if _topic_matches(goal.topic, topic):
            await recalculate_goal(db, goal, knowledge_level=knowledge_level)
            updated.append(goal)
    return updated
