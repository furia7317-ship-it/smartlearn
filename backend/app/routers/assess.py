"""测评路由 — 出卷 + 交卷。"""

from __future__ import annotations

import asyncio
import copy
import math
import uuid
from datetime import datetime, timezone

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
from app.models.profile import Profile
from app.schemas.exam import CourseExamRequest, ExamRequest, SubmitRequest
from app.services.agent_memory import upsert_semantic_fact
from app.services.goals import advance_goals
from app.services.memory import get_or_create_card
from app.services.scoring import calculate_mastery, calculate_overall, should_enter_wrongbook

router = APIRouter()


class ExamFromBankRequest(BaseModel):
    student_id: str
    question_ids: list[str] = Field(min_length=1)
    title: str | None = None
    category: str = "未分类"


def _unique_texts(values) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def _course_gate_query(course) -> str:
    parts = [course.title, course.current_stage, *course.scope_points[:12]]
    return " ".join(_unique_texts(parts))[:800]


def _merge_course_contexts(courses, contexts_by_course: list[list[dict]]) -> list[dict]:
    """Round-robin and deduplicate evidence so every course keeps coverage."""

    annotated: list[list[dict]] = []
    for course, contexts in zip(courses, contexts_by_course, strict=True):
        course_contexts: list[dict] = []
        for raw in contexts:
            if not isinstance(raw, dict):
                continue
            item = dict(raw)
            source_title = str(item.get("title") or "课程资料").strip()
            item["title"] = f"{course.title} · {source_title}"
            item["course_id"] = course.course_id
            item["course_title"] = course.title
            course_contexts.append(item)
        annotated.append(course_contexts)

    merged: list[dict] = []
    seen: set[str] = set()
    max_length = max((len(items) for items in annotated), default=0)
    for index in range(max_length):
        for items in annotated:
            if index >= len(items):
                continue
            item = items[index]
            source_id = str(item.get("id") or item.get("source_id") or item.get("url") or "").strip()
            fingerprint = source_id or "|".join([
                str(item.get("title") or ""),
                str(item.get("content") or "")[:500],
            ])
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            merged.append(item)
    return merged


def _public_exam_chunk(chunk: dict) -> dict:
    """Remove answer material from the pre-submission SSE payload."""

    if chunk.get("event") != "exam" or not isinstance(chunk.get("questions"), list):
        return chunk
    public_questions = []
    for raw in chunk["questions"]:
        if not isinstance(raw, dict):
            continue
        public_questions.append({
            key: value
            for key, value in raw.items()
            if key not in {"answer", "explanation"}
        })
    return {**chunk, "questions": public_questions}


def _validate_generated_questions(raw_questions) -> tuple[list[dict], list[str]]:
    """Validate the minimum authoritative paper contract before persistence."""

    if not isinstance(raw_questions, list) or not raw_questions:
        return [], ["AI 未生成有效题目"]

    allowed_types = {"mcq", "blank", "short", "code"}
    questions: list[dict] = []
    seen_ids: set[str] = set()
    errors: list[str] = []
    for index, raw in enumerate(raw_questions, 1):
        if not isinstance(raw, dict):
            errors.append(f"第 {index} 题不是对象")
            continue
        question = dict(raw)
        question_id = str(question.get("id") or "").strip()
        if not question_id:
            errors.append(f"第 {index} 题缺少 ID")
        elif question_id in seen_ids:
            errors.append(f"第 {index} 题 ID 重复")
        else:
            seen_ids.add(question_id)
            question["id"] = question_id
        if question.get("type") not in allowed_types:
            errors.append(f"第 {index} 题题型无效")
        if not str(question.get("stem") or "").strip():
            errors.append(f"第 {index} 题缺少题干")
        if not str(question.get("answer") or "").strip():
            errors.append(f"第 {index} 题缺少答案")
        score = question.get("score")
        if isinstance(score, bool):
            errors.append(f"第 {index} 题分值无效")
        else:
            try:
                score_value = float(score)
                if not math.isfinite(score_value) or score_value <= 0:
                    errors.append(f"第 {index} 题分值必须大于 0")
            except (TypeError, ValueError):
                errors.append(f"第 {index} 题分值无效")
        questions.append(question)
    return questions, errors[:12]


def _validate_grading_results(
    questions,
    raw_results,
    answers: dict[str, str],
) -> tuple[list[dict], list[str]]:
    """Validate and normalize grader output against the persisted paper."""

    if not isinstance(questions, list) or not questions:
        return [], ["试卷不包含可评分题目"]
    if not isinstance(raw_results, list) or not raw_results:
        return [], ["阅卷结果为空"]

    questions_by_id: dict[str, dict] = {}
    errors: list[str] = []
    for index, raw_question in enumerate(questions, 1):
        if not isinstance(raw_question, dict):
            errors.append(f"第 {index} 道题结构无效")
            continue
        question_id = str(raw_question.get("id") or "").strip()
        if not question_id:
            errors.append(f"第 {index} 道题缺少 ID")
            continue
        if question_id in questions_by_id:
            errors.append(f"题目 ID 重复：{question_id}")
            continue
        try:
            maximum = float(raw_question.get("score", 0))
        except (TypeError, ValueError):
            maximum = 0.0
        if not math.isfinite(maximum) or maximum <= 0:
            errors.append(f"题目 {question_id} 的分值无效")
            continue
        questions_by_id[question_id] = raw_question

    normalized: list[dict] = []
    seen_result_ids: set[str] = set()
    for index, raw_result in enumerate(raw_results, 1):
        if not isinstance(raw_result, dict):
            errors.append(f"第 {index} 条阅卷结果结构无效")
            continue
        question_id = str(raw_result.get("question_id") or "").strip()
        question = questions_by_id.get(question_id)
        if question is None:
            errors.append(f"阅卷结果包含未知题目：{question_id or '空 ID'}")
            continue
        if question_id in seen_result_ids:
            errors.append(f"阅卷结果重复：{question_id}")
            continue
        seen_result_ids.add(question_id)

        try:
            awarded = float(raw_result.get("score"))
            reported_maximum = float(raw_result.get("max_score"))
            expected_maximum = float(question.get("score"))
        except (TypeError, ValueError):
            errors.append(f"题目 {question_id} 的阅卷分值无效")
            continue
        if (
            not math.isfinite(awarded)
            or not math.isfinite(reported_maximum)
            or not math.isfinite(expected_maximum)
            or not math.isclose(reported_maximum, expected_maximum)
            or awarded < 0
            or awarded > expected_maximum
        ):
            errors.append(f"题目 {question_id} 的阅卷分值越界或与试卷不一致")
            continue

        normalized.append({
            **raw_result,
            "question_id": question_id,
            "type": question.get("type", ""),
            "score": awarded,
            "max_score": expected_maximum,
            "correct": awarded >= expected_maximum * 0.6,
            "student_answer": str(answers.get(question_id, "")),
            "answer": str(question.get("answer", "")),
            "knowledge_point": str(question.get("knowledge_point", "")),
            "feedback": str(raw_result.get("feedback") or ""),
            "error_type": str(raw_result.get("error_type") or "unknown"),
        })

    missing_ids = set(questions_by_id) - seen_result_ids
    if missing_ids:
        errors.append("阅卷结果缺少题目：" + "、".join(sorted(missing_ids)))
    return normalized, errors[:12]


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


async def _update_profile_from_exam(
    db: AsyncSession,
    paper: ExamPaper,
    student_id: str,
) -> bool:
    """Merge score evidence into the six-dimension profile without committing."""

    mastery = paper.mastery or {}
    results = paper.results or []
    if not mastery and not results:
        return False

    profile = await db.get(Profile, student_id)
    if profile is None:
        profile = Profile(student_id=student_id)
        db.add(profile)

    updated_at = datetime.now(timezone.utc).isoformat()
    knowledge_level = dict(profile.knowledge_level or {})
    for knowledge_point, raw in mastery.items():
        info = raw if isinstance(raw, dict) else {"score": raw}
        knowledge_level[str(knowledge_point)] = {
            "score": info.get("score", 0),
            "level": info.get("level", ""),
            "evidence": f"考试测评·{paper.exam_id}",
            "last_updated": updated_at,
        }
    profile.knowledge_level = knowledge_level

    error_profile = dict(profile.error_profile or {})
    for result in results:
        if result.get("correct"):
            continue
        error_type = str(result.get("error_type") or "unknown")
        current = dict(error_profile.get(error_type) or {"count": 0})
        current["count"] = int(current.get("count") or 0) + 1
        current["last_exam_id"] = paper.exam_id
        current["last_knowledge_point"] = str(result.get("knowledge_point") or "")
        error_profile[error_type] = current
    profile.error_profile = error_profile
    return True


async def _persist_course_mastery_facts(
    db: AsyncSession,
    paper: ExamPaper,
    student_id: str,
) -> int:
    """Write stable, versioned mastery facts for course assessments only."""

    if paper.category != "课程测评":
        return 0

    updated = 0
    for knowledge_point, raw in (paper.mastery or {}).items():
        if not str(knowledge_point).strip():
            continue
        info = raw if isinstance(raw, dict) else {"score": raw}
        try:
            score = float(info.get("score") or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        if score > 1:
            score /= 100
        score = max(0.0, min(1.0, score))
        try:
            question_count = max(0, int(info.get("question_count") or 0))
        except (TypeError, ValueError):
            question_count = 0
        await upsert_semantic_fact(
            db,
            student_id=student_id,
            category="knowledge_mastery",
            key=str(knowledge_point),
            value={
                "knowledge_point": str(knowledge_point),
                "score": score,
                "level": str(info.get("level") or ""),
                "question_count": question_count,
                "exam_id": paper.exam_id,
                "courses": list(paper.tags or []),
            },
            confidence=min(0.95, 0.6 + question_count * 0.08),
            evidence=f"课程测评「{paper.title or paper.topic}」掌握度 {score:.0%}",
            source="course_assessment",
        )
        updated += 1
    return updated


async def finalize_exam_submission(
    db: AsyncSession,
    paper: ExamPaper,
    student_id: str,
    answers: dict[str, str],
    final_state: dict,
) -> dict[str, int | bool]:
    """按固定顺序持久化评分、错题、记忆卡和目标推进。"""
    already_graded = paper.status == "graded"
    paper.answers = answers
    paper.results = final_state.get("results", [])
    paper.overall_score = final_state.get("overall", 0)
    paper.mastery = final_state.get("mastery", {})
    paper.status = "graded"

    memory_cards_created = 0
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
        _, was_created = await get_or_create_card(
            db,
            student_id=student_id,
            front=question.get("stem", ""),
            back=f"{result.get('answer', '')}\n\n{result.get('feedback', '')}".strip(),
            topic=paper.topic,
            knowledge_point=result.get("knowledge_point", ""),
            source="wrongbook",
            source_id=result.get("question_id", ""),
        )
        memory_cards_created += int(was_created)

    await advance_goals(db, student_id, paper.topic, paper.mastery or {})
    await _persist_diagnostic_assessment(db, paper, student_id, final_state)
    profile_updated = False
    if not already_graded:
        profile_updated = await _update_profile_from_exam(db, paper, student_id)
    semantic_facts_updated = await _persist_course_mastery_facts(db, paper, student_id)
    await db.commit()
    return {
        "memory_cards_created": memory_cards_created,
        "semantic_facts_updated": semantic_facts_updated,
        "profile_updated": profile_updated,
    }


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


@router.post("/course-exam")
async def create_course_exam(
    req: CourseExamRequest,
    db: AsyncSession = Depends(get_db),
):
    """按当前课程逐门检索依据，并生成一张跨课程自适应测评卷。"""

    from app.agents.profiler import get_profile
    from app.services.knowledge_gate import check_knowledge_gate

    courses = list({course.course_id: course for course in req.courses}.values())
    gates = await asyncio.gather(*(
        asyncio.to_thread(
            check_knowledge_gate,
            _course_gate_query(course),
            req.student_id,
            5,
        )
        for course in courses
    ))
    for course, gate in zip(courses, gates, strict=True):
        if gate.matched:
            continue
        raise HTTPException(
            status_code=503 if gate.status == "kb_unavailable" else 409,
            detail={
                **gate.error_payload(),
                "course_id": course.course_id,
                "course_title": course.title,
            },
        )

    kb_context = _merge_course_contexts(
        courses,
        [list(gate.context or []) for gate in gates],
    )
    profile = await asyncio.to_thread(get_profile, req.student_id)
    weak_points = [
        kp for kp, value in (profile.get("knowledge_level") or {}).items()
        if isinstance(value, dict) and value.get("score", 1) < 0.6
    ]

    course_names = _unique_texts(course.title for course in courses)
    paper_topic = " / ".join(course_names)[:256]
    course_snapshots = []
    scope_points: list[str] = []
    for course in courses:
        stage = course.current_stage.strip()
        course_snapshots.append(
            f"{course.title}（进度 {round(course.progress)}%"
            + (f"，当前阶段：{stage}" if stage else "")
            + "）"
        )
        raw_points = _unique_texts([stage, *course.scope_points]) or [course.title]
        scope_points.extend(f"{course.title}：{point}" for point in raw_points)

    state = {
        "topic": "课程综合测评：" + "；".join(course_snapshots),
        "student_id": req.student_id,
        "scope_points": _unique_texts(scope_points),
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
                public_chunk = _public_exam_chunk(chunk)
                yield sse_format(public_chunk.get("event", "message"), public_chunk)
            elif mode == "values":
                final_state = chunk

        questions, validation_errors = _validate_generated_questions(
            final_state.get("questions", [])
        )
        if validation_errors:
            yield sse_format("error", {
                "code": "invalid_exam_questions",
                "message": "AI 生成的试卷未通过完整性校验，请重新组卷",
                "errors": validation_errors,
            })
            return
        exam_id = final_state.get("exam_id") or str(uuid.uuid4())
        paper_id = final_state.get("paper_id") or str(uuid.uuid4())
        title = (
            f"{course_names[0]}课程测评"
            if len(course_names) == 1
            else "跨课程综合测评"
        )
        paper = ExamPaper(
            id=paper_id,
            exam_id=exam_id,
            student_id=req.student_id,
            topic=paper_topic,
            title=f"{title} · {datetime.now().strftime('%m-%d')}",
            category="课程测评",
            tags=course_names,
            paper_type=req.paper_type,
            questions=questions,
            status="created",
        )
        db.add(paper)
        await db.commit()

        yield sse_format("done", {
            "exam_id": exam_id,
            "paper_id": paper_id,
            "question_count": len(questions),
            "course_ids": [course.course_id for course in courses],
            "courses": course_names,
        })

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
                "memory_cards_created": 0,
                "semantic_facts_updated": 0,
                "profile_updated": False,
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
        try:
            async for mode, chunk in astream_via_thread(grade_app, state, ["custom", "values"]):
                if mode == "custom" and isinstance(chunk, dict):
                    yield sse_format(chunk.get("event", "message"), chunk)
                elif mode == "values":
                    final_state = chunk
        except Exception:
            await db.rollback()
            yield sse_format("error", {
                "code": "grading_failed",
                "message": "AI 阅卷暂时失败，答卷尚未写入记忆与画像，请稍后重试",
                "retryable": True,
            })
            return

        normalized_results, validation_errors = _validate_grading_results(
            paper.questions,
            final_state.get("results") if final_state else None,
            req.answers,
        )
        if validation_errors:
            await db.rollback()
            yield sse_format("error", {
                "code": "grading_incomplete",
                "message": "阅卷结果不完整，答卷尚未写入记忆与画像，请重新提交",
                "retryable": True,
            })
            return

        validated_state = {
            **final_state,
            "results": normalized_results,
            "overall": calculate_overall(normalized_results),
            "mastery": calculate_mastery(normalized_results, paper.questions),
        }
        try:
            feedback = await finalize_exam_submission(
                db,
                paper,
                req.student_id,
                req.answers,
                validated_state,
            )
        except Exception:
            await db.rollback()
            yield sse_format("error", {
                "code": "feedback_persist_failed",
                "message": "评分已完成，但结果暂未归档，记忆与画像没有更新，请重新提交",
                "retryable": True,
            })
            return
        yield sse_format("done", {
            "overall": paper.overall_score,
            "status": "graded",
            **feedback,
        })

    return StreamingResponse(
        _stream_and_update(),
        media_type="text/event-stream",
    )
