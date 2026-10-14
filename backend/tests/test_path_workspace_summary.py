from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
async def db_session():
    from app.models.base import Base
    from app.models import learning, profile  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_path_workspace_summary_is_scoped_and_counts_real_records(db_session):
    from app.models.learning import Assessment, ExamPaper, LearningGoal, MemoryCard, WrongQuestion
    from app.routers.path import get_path_workspace_summary

    db_session.add_all([
        LearningGoal(student_id="student-a", title="掌握树", topic="树", status="active"),
        LearningGoal(student_id="student-a", title="掌握图", topic="图", status="completed"),
        LearningGoal(student_id="student-b", title="其他", topic="其他", status="active"),
        Assessment(id="assessment-a", student_id="student-a", subject="数据结构", self_level="基础", analysis={}),
        ExamPaper(
            id="paper-open", exam_id="exam-open", student_id="student-a", topic="树",
            title="树练习", paper_type="mixed", questions=[], status="created", archived=False,
        ),
        ExamPaper(
            id="paper-graded", exam_id="exam-graded", student_id="student-a", topic="图",
            title="图练习", paper_type="mixed", questions=[], status="graded", archived=False,
        ),
        WrongQuestion(
            student_id="student-a", question_id="wrong-a", exam_id="exam-graded",
            topic="图", knowledge_point="BFS", question_type="short", stem="BFS?",
            answer="队列", student_answer="栈", score=0,
        ),
        MemoryCard(
            id="due-a", student_id="student-a", front="BFS", back="队列",
            due_date=date.today().isoformat(),
        ),
        MemoryCard(
            id="future-a", student_id="student-a", front="DFS", back="栈",
            due_date=(date.today() + timedelta(days=2)).isoformat(),
        ),
    ])
    await db_session.commit()

    result = await get_path_workspace_summary("student-a", db_session)

    assert result == {
        "student_id": "student-a",
        "active_goals": 1,
        "completed_goals": 1,
        "assessments": 1,
        "available_exams": 1,
        "graded_exams": 1,
        "wrong_questions": 1,
        "due_reviews": 1,
    }
