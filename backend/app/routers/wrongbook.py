"""错题本路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import WrongQuestion

router = APIRouter()


@router.get("/{student_id}")
async def get_wrong_questions(
    student_id: str,
    topic: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """获取错题列表。"""
    stmt = select(WrongQuestion).where(WrongQuestion.student_id == student_id)
    if topic:
        stmt = stmt.where(WrongQuestion.topic == topic)
    stmt = stmt.order_by(WrongQuestion.created_at.desc())

    result = await db.execute(stmt)
    questions = result.scalars().all()

    return [
        {
            "id": q.id,
            "question_id": q.question_id,
            "exam_id": q.exam_id,
            "topic": q.topic,
            "knowledge_point": q.knowledge_point,
            "question_type": q.question_type,
            "stem": q.stem,
            "answer": q.answer,
            "student_answer": q.student_answer,
            "score": q.score,
            "feedback": q.feedback,
            "error_type": q.error_type,
            "created_at": str(q.created_at),
        }
        for q in questions
    ]
