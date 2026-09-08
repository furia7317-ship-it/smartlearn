"""测评路由 — 出卷 + 交卷。"""

from __future__ import annotations

import asyncio
import copy
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.sse import astream_via_thread, sse_format
from app.graph.exam_graph import exam_app
from app.graph.grade_graph import grade_app
from app.models.learning import Assessment, ExamPaper, WrongQuestion
from app.schemas.exam import ExamRequest, SubmitRequest
from app.services.goals import advance_goals
from app.services.memory import get_or_create_card
from app.services.scoring import should_enter_wrongbook

router = APIRouter()


class ExamFromBankRequest(BaseModel):
    student_id: str
    question_ids: list[str] = Field(min_length=1)
    title: str | None = None
    category: str = "未分类"


def _diagnostic_level(overall: float) -> str:
    if overall >= 85:
        return "完全掌握"
    if overall >= 60:
        return "进阶"
    return "基础"


def _diagnostic_analysis(final_state: dict) -> dict:
    """把客观试卷评分转换成现有学情记录合约。"""
    overall = float(final_state.get("overall") or 0.0)
    mastery = final_state.get("mastery") or {}
    report = final_state.get("assessment") or {}

    knowledge_seed: dict[str, float] = {}
    for knowledge_point, value in mastery.items():
        score = value.get("score") if isinstance(value, dict) else value
        try:
            normalized = float(score)
        except (TypeError, ValueError):
            continue
        if normalized > 1:
            normalized /= 100
        knowledge_seed[str(knowledge_point)] = max(0.0, min(1.0, normalized))

    suggestions = [
        str(item).strip()
        for item in [*(report.get("suggestions") or []), *(report.get("next_steps") or [])]
        if str(item).strip()
    ]
    summary = str(report.get("summary") or f"本次客观摸底得分 {round(overall)} 分").strip()
    encouragement = str(report.get("encouragement") or "").strip()
    narrative = f"{summary}\n\n{encouragement}".strip()
    return {
        "summary": summary,
        "narrative": narrative,
        "strengths": [str(item) for item in report.get("strengths") or []],
        "gaps": [str(item) for item in report.get("weaknesses") or []],
        "recommended_focus": list(dict.fromkeys(suggestions)),
        "knowledge_seed": knowledge_seed,
        "suggested_modules": ["explainer", "quiz"] if overall < 60 else ["quiz", "reading"],
        "overall_score": overall,
        "source_exam_id": final_state.get("exam_id", ""),
    }


async def _persist_diagnostic_assessment(
    db: AsyncSession,
    paper: ExamPaper,
    student_id: str,
    final_state: dict,
) -> None:
    if paper.category != "学情摸底":
        return
    assessment_id = f"diagnostic-{paper.id}"
    existing = await db.scalar(select(Assessment.id).where(Assessment.id == assessment_id))
    if existing is not None:
        return
    db.add(Assessment(
        id=assessment_id,
        student_id=student_id,
        subject=paper.topic,
        self_level=_diagnostic_level(float(final_state.get("overall") or 0.0)),
        analysis=_diagnostic_analysis({**final_state, "exam_id": paper.exam_id}),
    ))


async def finalize_exam_submission(
    db: AsyncSession,
    paper: ExamPaper,
    student_id: str,
    answers: dict[str, str],
    final_state: dict,
) -> None:
    """按固定顺序持久化评分、错题、记忆卡和目标推进。"""
    paper.answers = answers
    paper.results = final_state.get("results", [])
    paper.overall_score = final_state.get("overall", 0)
    paper.mastery = final_state.get("mastery", {})
    paper.status = "graded"

    q_by_id = {q.get("id"): q for q in (paper.questions or [])}
    for result in final_state.get("results", []):
        if not should_enter_wrongbook(result.get("score", 0), result.get("max_score", 0)):
            continue
        question_id = result.get("question_id", "")
        question = q_by_id.get(question_id, {})
        existing_wrong = await db.scalar(
            select(WrongQuestion.id).where(
                WrongQuestion.student_id == student_id,
                WrongQuestion.exam_id == paper.exam_id,
                WrongQuestion.question_id == question_id,
            )
        )
        if existing_wrong is None:
            db.add(WrongQuestion(
                student_id=student_id,
                question_id=question_id,
                exam_id=paper.exam_id,
                topic=paper.topic,
                knowledge_point=result.get("knowledge_point", ""),
                question_type=result.get("type", ""),
                stem=question.get("stem", ""),
                answer=str(result.get("answer", "")),
                student_answer=str(result.get("student_answer", "")),
                score=float(result.get("score", 0)),
                feedback=result.get("feedback", ""),
                error_type=result.get("error_type", "unknown"),
            ))
        await get_or_create_card(
            db,
            student_id=student_id,
            front=question.get("stem", ""),
            back=f"{result.get('answer', '')}\n\n{result.get('feedback', '')}".strip(),
            topic=paper.topic,
            knowledge_point=result.get("knowledge_point", ""),
            source="wrongbook",
            source_id=result.get("question_id", ""),
        )

    await advance_goals(db, student_id, paper.topic, paper.mastery or {})
    await _persist_diagnostic_assessment(db, paper, student_id, final_state)
    await db.commit()


@router.post("/exam")
async def create_exam(req: ExamRequest, db: AsyncSession = Depends(get_db)):
    """出卷（SSE 流式）。"""
    from app.agents.profiler import get_profile
    from app.services.knowledge_gate import check_knowledge_gate

    gate = await asyncio.to_thread(check_knowledge_gate, req.topic, req.student_id, 5)
    if not gate.matched:
        raise HTTPException(
            status_code=503 if gate.status == "kb_unavailable" else 409,
            detail=gate.error_payload(),
        )

    profile = await asyncio.to_thread(get_profile, req.student_id)
    weak_points = [
        kp for kp, v in (profile.get("knowledge_level") or {}).items()
        if isinstance(v, dict) and v.get("score", 1) < 0.6
    ]

    kb_context = gate.context

    state = {
        "topic": req.topic,
        "student_id": req.student_id,
        "scope_points": req.scope_points,
        "weak_points": weak_points,
        "kb_context": kb_context,
        "composition": {},
        "paper_type": req.paper_type,
        "questions": [],
        "exam_id": "",
        "paper_id": "",
    }

    async def _stream_and_persist():
        final_state: dict = {}
        async for mode, chunk in astream_via_thread(exam_app, state, ["custom", "values"]):
            if mode == "custom" and isinstance(chunk, dict):
                yield sse_format(chunk.get("event", "message"), chunk)
            elif mode == "values":
                final_state = chunk

        questions = final_state.get("questions", [])
        exam_id = final_state.get("exam_id") or str(uuid.uuid4())
        paper_id = final_state.get("paper_id") or str(uuid.uuid4())

        paper = ExamPaper(
            id=paper_id,
            exam_id=exam_id,
            student_id=req.student_id,
            topic=req.topic,
            title=f"{req.topic} · {datetime.now().strftime('%m-%d')}",
            category=req.category,
            paper_type=req.paper_type,
            questions=questions,
            status="created",
        )
        db.add(paper)
        await db.commit()

        yield sse_format("done", {"exam_id": exam_id, "paper_id": paper_id, "question_count": len(questions)})

    return StreamingResponse(
        _stream_and_persist(),
        media_type="text/event-stream",
    )


@router.post("/exam-from-bank")
async def create_exam_from_bank(
    req: ExamFromBankRequest,
    db: AsyncSession = Depends(get_db),
):
    """从既有试卷抽取题目组卷，不调用 LLM。"""
    stmt = select(ExamPaper).where(ExamPaper.student_id == req.student_id)
    papers = (await db.execute(stmt)).scalars().all()
    question_map: dict[str, dict] = {}
    topics: list[str] = []
    for paper in papers:
        if paper.topic not in topics:
            topics.append(paper.topic)
        for question in paper.questions or []:
            question_id = question.get("id")
            if question_id and question_id not in question_map:
                question_map[question_id] = question

    selected: list[dict] = []
    seen: set[str] = set()
    for question_id in req.question_ids:
        if question_id in seen:
            continue
        question = question_map.get(question_id)
        if question is not None:
            selected.append(copy.deepcopy(question))
            seen.add(question_id)
    if not selected:
        raise HTTPException(status_code=404, detail="未找到可组卷题目")

    paper = ExamPaper(
        id=str(uuid.uuid4()),
        exam_id=str(uuid.uuid4()),
        student_id=req.student_id,
        topic=" / ".join(topics) or "题库组卷",
        title=req.title or f"题库组卷 · {datetime.now().strftime('%m-%d')}",
        category=req.category,
        tags=["强化"],
        paper_type="bank",
        questions=selected,
        status="created",
    )
    db.add(paper)
    await db.commit()
    return {"exam_id": paper.exam_id, "questions": paper.questions}


@router.post("/{exam_id}/submit")
async def submit_exam(exam_id: str, req: SubmitRequest, db: AsyncSession = Depends(get_db)):
    """交卷评分（SSE 流式）。"""
    stmt = select(ExamPaper).where(
        ExamPaper.exam_id == exam_id,
        ExamPaper.student_id == req.student_id,
    )
    result = await db.execute(stmt)
    paper = result.scalar_one_or_none()

    if paper is None:
        raise HTTPException(status_code=404, detail="试卷不存在")

    if paper.status == "graded":
        async def _stream_existing_grade():
            yield sse_format("graded", {
                "event": "graded",
                "results": {
                    "overall": float(paper.overall_score or 0.0),
                    "mastery": paper.mastery or {},
                    "results": paper.results or [],
                },
            })
            yield sse_format("done", {
                "overall": float(paper.overall_score or 0.0),
                "status": "graded",
            })

        return StreamingResponse(
            _stream_existing_grade(),
            media_type="text/event-stream",
        )

    state = {
        "exam_id": exam_id,
        "student_id": req.student_id,
        "answers": req.answers,
        "questions": paper.questions,
        "results": [],
        "overall": 0.0,
        "mastery": {},
        "assessment": {},
    }

    async def _stream_and_update():
        final_state: dict = {}
        async for mode, chunk in astream_via_thread(grade_app, state, ["custom", "values"]):
            if mode == "custom" and isinstance(chunk, dict):
                yield sse_format(chunk.get("event", "message"), chunk)
            elif mode == "values":
                final_state = chunk

        await finalize_exam_submission(db, paper, req.student_id, req.answers, final_state)
        yield sse_format("done", {"overall": paper.overall_score, "status": "graded"})

    return StreamingResponse(
        _stream_and_update(),
        media_type="text/event-stream",
    )
