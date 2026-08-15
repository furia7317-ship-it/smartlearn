"""记忆卡创建、去重与 SM-2 调度。"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import MemoryCard


def schedule(card: MemoryCard, rating: int) -> None:
    """按实施方案固定参数更新记忆卡。"""
    if rating not in {0, 1, 2, 3}:
        raise ValueError("rating 必须是 0、1、2 或 3")

    card.repetitions = card.repetitions or 0
    card.interval_days = card.interval_days or 0
    card.ease_factor = card.ease_factor or 2.5

    if rating == 0:
        card.repetitions = 0
        card.interval_days = 0
        card.ease_factor = max(1.3, card.ease_factor - 0.2)
        card.state = "lapsed"
    else:
        if card.repetitions == 0:
            card.interval_days = 1
        elif card.repetitions == 1:
            card.interval_days = 3
        else:
            card.interval_days = round(card.interval_days * card.ease_factor)

        if rating == 1:
            card.interval_days = max(1, round(card.interval_days * 0.5))
            card.ease_factor = max(1.3, card.ease_factor - 0.15)
        elif rating == 3:
            card.interval_days = round(card.interval_days * 1.3)
            card.ease_factor += 0.1

        card.repetitions += 1
        card.state = "review" if card.interval_days >= 21 else "learning"

    card.due_date = (date.today() + timedelta(days=card.interval_days)).isoformat()


async def get_or_create_card(
    db: AsyncSession,
    *,
    student_id: str,
    front: str,
    back: str,
    topic: str = "",
    knowledge_point: str = "",
    source: str = "manual",
    source_id: str = "",
) -> tuple[MemoryCard, bool]:
    """按学生和 source_id 去重创建记忆卡。"""
    if source_id:
        stmt = select(MemoryCard).where(
            MemoryCard.student_id == student_id,
            MemoryCard.source_id == source_id,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            return existing, False

    card = MemoryCard(
        id=str(uuid.uuid4()),
        student_id=student_id,
        front=front,
        back=back,
        topic=topic,
        knowledge_point=knowledge_point,
        source=source,
        source_id=source_id,
        due_date=date.today().isoformat(),
    )
    db.add(card)
    await db.flush()
    return card, True


def serialize_card(card: MemoryCard) -> dict:
    return {
        "id": card.id,
        "student_id": card.student_id,
        "front": card.front,
        "back": card.back,
        "topic": card.topic,
        "knowledge_point": card.knowledge_point,
        "source": card.source,
        "source_id": card.source_id,
        "ease_factor": card.ease_factor,
        "interval_days": card.interval_days,
        "repetitions": card.repetitions,
        "due_date": card.due_date,
        "state": card.state,
        "created_at": str(card.created_at),
    }
