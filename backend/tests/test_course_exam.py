from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
async def db_session():
    from app.models import learning, profile  # noqa: F401
    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _response_text(response) -> str:
    return "".join([
        chunk.decode() if isinstance(chunk, bytes) else chunk
        async for chunk in response.body_iterator
    ])


@pytest.mark.asyncio
async def test_course_exam_gates_each_course_merges_context_and_hides_answers(
    db_session,
    monkeypatch,
):
    from app.routers import assess
    from app.schemas.exam import CourseExamContext, CourseExamRequest
    from app.services.knowledge_gate import KnowledgeGateResult

    gate_queries: list[str] = []

    def fake_gate(query: str, student_id: str, n_results: int):
        gate_queries.append(query)
        course = "数据结构" if "数据结构" in query else "操作系统"
        return KnowledgeGateResult(
            status="matched",
            query=query,
            context=[
                {"id": "shared", "title": "公共基础", "content": "共同依据"},
                {"id": f"{course}-source", "title": "课程讲义", "content": f"{course}专属依据"},
            ],
            best_score=0.9,
            retrieval_mode="test",
        )

    monkeypatch.setattr("app.services.knowledge_gate.check_knowledge_gate", fake_gate)
    monkeypatch.setattr(
        "app.agents.profiler.get_profile",
        lambda _student_id: {"knowledge_level": {"队列": {"score": 0.4}}},
    )

    captured: dict = {}
    questions = [{
        "id": "q1",
        "type": "mcq",
        "stem": "队列遵循什么原则？",
        "options": ["A. FIFO", "B. LIFO"],
        "answer": "A",
        "explanation": "先进先出",
        "score": 10,
        "knowledge_point": "队列",
    }]

    async def fake_stream(_graph, state, _modes):
        captured["state"] = state
        yield "custom", {"event": "exam", "questions": questions}
        yield "values", {
            **state,
            "questions": questions,
            "exam_id": "course-exam-1",
            "paper_id": "course-paper-1",
        }

    monkeypatch.setattr(assess, "astream_via_thread", fake_stream)
    response = await assess.create_course_exam(
        CourseExamRequest(
            student_id="course-student",
            courses=[
                CourseExamContext(
                    course_id="course-ds",
                    title="数据结构",
                    progress=45,
                    scope_points=["队列", "树"],
                    current_stage="线性结构",
                ),
                CourseExamContext(
                    course_id="course-os",
                    title="操作系统",
                    progress=20,
                    scope_points=["进程调度"],
                    current_stage="进程管理",
                ),
            ],
        ),
        db_session,
    )
    body = await _response_text(response)

    assert len(gate_queries) == 2
    assert any("数据结构" in query for query in gate_queries)
    assert any("操作系统" in query for query in gate_queries)
    assert len(captured["state"]["kb_context"]) == 3
    assert {item["course_title"] for item in captured["state"]["kb_context"]} == {
        "数据结构",
        "操作系统",
    }
    assert "数据结构：队列" in captured["state"]["scope_points"]
    assert "操作系统：进程调度" in captured["state"]["scope_points"]

    exam_event = next(
        line.removeprefix("data: ")
        for line in body.splitlines()
        if line.startswith("data: ") and '"event": "exam"' in line
    )
    public_payload = json.loads(exam_event)
    assert "answer" not in public_payload["questions"][0]
    assert "explanation" not in public_payload["questions"][0]

    from app.models.learning import ExamPaper

    paper = await db_session.get(ExamPaper, "course-paper-1")
    assert paper is not None
    assert paper.category == "课程测评"
    assert paper.tags == ["数据结构", "操作系统"]
    assert paper.topic == "数据结构 / 操作系统"
    assert paper.questions[0]["answer"] == "A"
    assert paper.questions[0]["explanation"] == "先进先出"

    from app.routers.papers import get_paper_detail, redo_paper

    detail = await get_paper_detail("course-paper-1", "course-student", db_session)
    assert "answer" not in detail["questions"][0]
    assert "explanation" not in detail["questions"][0]
    with pytest.raises(HTTPException) as owner_error:
        await get_paper_detail("course-paper-1", "another-student", db_session)
    assert owner_error.value.status_code == 404
    redone = await redo_paper("course-paper-1", "course-student", db_session)
    assert "answer" not in redone["questions"][0]
    assert "explanation" not in redone["questions"][0]


@pytest.mark.asyncio
async def test_course_exam_reports_the_specific_course_that_failed_knowledge_gate(
    db_session,
    monkeypatch,
):
    from app.routers import assess
    from app.schemas.exam import CourseExamContext, CourseExamRequest
    from app.services.knowledge_gate import KnowledgeGateResult

    def fake_gate(query: str, _student_id: str, _n_results: int):
        if "操作系统" in query:
            return KnowledgeGateResult("kb_miss", query, [], 0.0, "test")
        return KnowledgeGateResult(
            "matched",
            query,
            [{"id": "ds", "title": "数据结构", "content": "队列"}],
            0.9,
            "test",
        )

    monkeypatch.setattr("app.services.knowledge_gate.check_knowledge_gate", fake_gate)
    with pytest.raises(HTTPException) as error:
        await assess.create_course_exam(
            CourseExamRequest(
                student_id="course-student",
                courses=[
                    CourseExamContext(course_id="ds", title="数据结构"),
                    CourseExamContext(course_id="os", title="操作系统"),
                ],
            ),
            db_session,
        )

    assert error.value.status_code == 409
    assert error.value.detail["course_id"] == "os"
    assert error.value.detail["course_title"] == "操作系统"


def test_course_exam_and_submission_payloads_are_bounded():
    from app.schemas.exam import CourseExamContext, SubmitRequest

    with pytest.raises(ValidationError):
        CourseExamContext(
            course_id="course",
            title="数据结构",
            scope_points=["知" * 161],
        )
    with pytest.raises(ValidationError):
        SubmitRequest(
            student_id="student",
            answers={"q1": "答" * 20_001},
        )
    with pytest.raises(ValidationError):
        SubmitRequest(
            student_id="student",
            answers={f"q{index}": "A" for index in range(201)},
        )


@pytest.mark.asyncio
async def test_invalid_generated_course_exam_emits_error_without_persisting(
    db_session,
    monkeypatch,
):
    from app.routers import assess
    from app.schemas.exam import CourseExamContext, CourseExamRequest
    from app.services.knowledge_gate import KnowledgeGateResult

    monkeypatch.setattr(
        "app.services.knowledge_gate.check_knowledge_gate",
        lambda query, _student_id, _n_results: KnowledgeGateResult(
            "matched",
            query,
            [{"id": "kb", "title": "课程讲义", "content": "课程依据"}],
            0.9,
            "test",
        ),
    )
    monkeypatch.setattr(
        "app.agents.profiler.get_profile",
        lambda _student_id: {"knowledge_level": {}},
    )
    invalid_questions = [{
        "id": "duplicate",
        "type": "mcq",
        "stem": "没有答案的题目",
        "score": 0,
    }, {
        "id": "duplicate",
        "type": "essay",
        "stem": "重复 ID 且题型无效",
        "answer": "参考答案",
        "score": 10,
    }]

    async def fake_stream(_graph, state, _modes):
        yield "custom", {"event": "exam", "questions": invalid_questions}
        yield "values", {
            **state,
            "questions": invalid_questions,
            "exam_id": "invalid-exam",
            "paper_id": "invalid-paper",
        }

    monkeypatch.setattr(assess, "astream_via_thread", fake_stream)
    response = await assess.create_course_exam(
        CourseExamRequest(
            student_id="course-student",
            courses=[CourseExamContext(course_id="course", title="数据结构")],
        ),
        db_session,
    )
    body = await _response_text(response)

    assert "event: error" in body
    assert "invalid_exam_questions" in body
    assert "ID 重复" in body
    assert "event: done" not in body
    from app.models.learning import ExamPaper

    assert await db_session.get(ExamPaper, "invalid-paper") is None


@pytest.mark.asyncio
async def test_course_submission_writes_one_memory_card_and_versioned_mastery_fact(
    db_session,
):
    from app.models.learning import ExamPaper, MemoryCard, SemanticMemoryFact
    from app.models.profile import Profile
    from app.routers.assess import finalize_exam_submission

    paper = ExamPaper(
        id="feedback-paper",
        exam_id="feedback-exam",
        student_id="feedback-student",
        topic="数据结构",
        title="数据结构课程测评",
        category="课程测评",
        tags=["数据结构"],
        paper_type="adaptive",
        questions=[{
            "id": "feedback-q1",
            "type": "short",
            "stem": "解释队列",
            "answer": "先进先出",
            "score": 10,
            "knowledge_point": "队列",
        }],
        status="created",
    )
    db_session.add(paper)
    await db_session.commit()
    final_state = {
        "results": [{
            "question_id": "feedback-q1",
            "type": "short",
            "score": 0,
            "max_score": 10,
            "correct": False,
            "student_answer": "后进先出",
            "answer": "先进先出",
            "knowledge_point": "队列",
            "feedback": "复习 FIFO",
            "error_type": "conceptual",
        }],
        "overall": 0,
        "mastery": {"队列": {"score": 0, "level": "不及格", "question_count": 1}},
    }

    first = await finalize_exam_submission(
        db_session,
        paper,
        "feedback-student",
        {"feedback-q1": "后进先出"},
        final_state,
    )
    second = await finalize_exam_submission(
        db_session,
        paper,
        "feedback-student",
        {"feedback-q1": "后进先出"},
        final_state,
    )

    cards = list((await db_session.scalars(select(MemoryCard))).all())
    facts = list((await db_session.scalars(select(SemanticMemoryFact))).all())
    profile = await db_session.get(Profile, "feedback-student")
    assert first == {
        "memory_cards_created": 1,
        "semantic_facts_updated": 1,
        "profile_updated": True,
    }
    assert second["memory_cards_created"] == 0
    assert second["profile_updated"] is False
    assert len(cards) == 1
    assert len(facts) == 1
    assert facts[0].category == "knowledge_mastery"
    assert facts[0].key == "队列"
    assert facts[0].value == {
        "knowledge_point": "队列",
        "score": 0.0,
        "level": "不及格",
        "question_count": 1,
        "exam_id": "feedback-exam",
        "courses": ["数据结构"],
    }
    assert facts[0].source == "course_assessment"
    assert profile is not None
    assert profile.knowledge_level["队列"]["score"] == 0
    assert profile.knowledge_level["队列"]["evidence"] == "考试测评·feedback-exam"
    assert profile.error_profile["conceptual"]["count"] == 1


def test_grading_results_must_match_each_persisted_question_once():
    from app.routers.assess import _validate_grading_results

    questions = [
        {"id": "q1", "type": "mcq", "score": 10, "answer": "A"},
        {"id": "q2", "type": "short", "score": 20, "answer": "参考答案"},
    ]
    results = [
        {"question_id": "q1", "score": 10, "max_score": 10},
        {"question_id": "q1", "score": 10, "max_score": 10},
        {"question_id": "q2", "score": 21, "max_score": 20},
    ]

    normalized, errors = _validate_grading_results(
        questions,
        results,
        {"q1": "A", "q2": "学生答案"},
    )

    assert len(normalized) == 1
    assert any("重复" in error for error in errors)
    assert any("越界" in error for error in errors)


@pytest.mark.asyncio
async def test_grading_failure_emits_error_without_memory_or_profile_side_effects(
    db_session,
    monkeypatch,
):
    from app.models.learning import ExamPaper, MemoryCard, SemanticMemoryFact, WrongQuestion
    from app.models.profile import Profile
    from app.routers import assess
    from app.schemas.exam import SubmitRequest

    paper = ExamPaper(
        id="failed-grade-paper",
        exam_id="failed-grade-exam",
        student_id="failed-grade-student",
        topic="数据结构",
        title="评分失败保护",
        category="课程测评",
        tags=["数据结构"],
        paper_type="adaptive",
        questions=[{
            "id": "failed-q1",
            "type": "short",
            "stem": "解释队列",
            "answer": "先进先出",
            "score": 10,
            "knowledge_point": "队列",
        }],
        status="created",
    )
    db_session.add(paper)
    await db_session.commit()

    async def broken_grade_stream(_graph, _state, _modes):
        yield "custom", {"event": "stage", "stage": "grading"}
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(assess, "astream_via_thread", broken_grade_stream)
    response = await assess.submit_exam(
        "failed-grade-exam",
        SubmitRequest(
            student_id="failed-grade-student",
            answers={"failed-q1": "后进先出"},
        ),
        db_session,
    )
    body = await _response_text(response)

    await db_session.refresh(paper)
    assert "event: error" in body
    assert "grading_failed" in body
    assert "event: done" not in body
    assert paper.status == "created"
    assert paper.answers is None
    assert list((await db_session.scalars(select(WrongQuestion))).all()) == []
    assert list((await db_session.scalars(select(MemoryCard))).all()) == []
    assert list((await db_session.scalars(select(SemanticMemoryFact))).all()) == []
    assert list((await db_session.scalars(select(Profile))).all()) == []
