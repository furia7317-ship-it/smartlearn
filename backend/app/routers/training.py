"""Path-grounded training reuses the code lab generator, persistence and executor."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import CodeExercise, CodeSubmission
from app.services.training_presets import PRESETS
from app.routers.auth import get_current_account
from app.routers.code_lab import submit_code_exercise
from app.schemas.code_lab import CodeExerciseSubmitRequest
from app.services.code_exercises import generate_code_exercise, public_code_exercise

router = APIRouter()
logger = logging.getLogger(__name__)


class TrainingSource(BaseModel):
    path_signature: str = Field(min_length=1, max_length=80)
    node_index: int = Field(ge=0, le=10000)
    node_title: str = Field(min_length=1, max_length=240)
    node_day: str = Field(default="", max_length=80)
    course: str = Field(default="当前学习路径", max_length=240)


class TrainingGenerateRequest(BaseModel):
    learning_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    learning_context: str = Field(min_length=10, max_length=6000)
    exercise_kind: Literal["implementation", "completion", "debugging"]
    source: TrainingSource


class TrainingCheckRequest(BaseModel):
    code: str = Field(min_length=1, max_length=10000)


@router.get("")
async def list_training_tasks(account=Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(CodeExercise).where(
        CodeExercise.student_id == account.id,
        CodeExercise.training_metadata["source"].as_string() == "learning_path",
    ).order_by(CodeExercise.created_at.desc(), CodeExercise.id.desc()))).all()
    return [public_code_exercise(row) for row in rows]


@router.post("")
async def generate_training_task(req: TrainingGenerateRequest, account=Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    try:
        generated = await asyncio.wait_for(asyncio.to_thread(
            generate_code_exercise, req.source.node_title, req.learning_context,
            exercise_kind=req.exercise_kind, strict=True,
        ), timeout=100)
        if generated.get("used_fallback"):
            raise ValueError("未能生成符合路径要求的题目")
    except ValueError as exc:
        logger.warning("Training validation failed (%s): %s", req.exercise_kind, exc)
        raise HTTPException(422, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Path training generation failed: %s", type(exc).__name__)
        raise HTTPException(503, detail="实训生成暂未成功，请稍后重试或检查模型配置。没有保存替代题目。") from exc
    exercise = CodeExercise(
        id=f"code-exercise-{uuid.uuid4().hex}", student_id=account.id,
        learning_date=req.learning_date, context_title=req.source.node_title,
        learning_context=req.learning_context,
        **{key: generated[key] for key in ("title", "prompt", "difficulty", "knowledge_points", "constraints", "starter_code", "function_name")},
        examples=[{"input": case["args"], "output": case["expected"]} for case in generated["tests"][:2]],
        hidden_tests=generated["tests"], ai_status="completed",
        training_metadata={"source": "learning_path", "exercise_kind": req.exercise_kind, **req.source.model_dump()},
    )
    db.add(exercise)
    await db.commit()
    await db.refresh(exercise)
    return public_code_exercise(exercise)


@router.post("/{task_id}/check")
async def check_training_task(task_id: str, req: TrainingCheckRequest, account=Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    if task_id in PRESETS:
        preset = PRESETS[task_id]
        exercise = (await db.scalars(select(CodeExercise).where(
            CodeExercise.student_id == account.id,
            CodeExercise.training_metadata["preset_id"].as_string() == task_id,
        ).order_by(CodeExercise.created_at))).first()
        if exercise is None:
            exercise = CodeExercise(id=f"code-exercise-{uuid.uuid4().hex}", student_id=account.id,
                learning_date=datetime.now(timezone.utc).date().isoformat(), context_title=preset["title"],
                title=preset["title"], prompt=preset["title"], starter_code="", function_name=preset["function"],
                knowledge_points=preset["points"],
                hidden_tests=[{"args": args, "expected": expected, "label": f"案例 {i + 1}"} for i, (args, expected) in enumerate(preset["cases"])],
                training_metadata={"source": "preset", "preset_id": task_id, "course": preset["course"]})
            db.add(exercise)
            await db.flush()
        task_id = exercise.id
    exercise = await db.get(CodeExercise, task_id)
    if exercise is None or exercise.student_id != account.id or (exercise.training_metadata or {}).get("source") not in {"learning_path", "preset"}:
        raise HTTPException(404, detail="实训任务不存在")
    return await submit_code_exercise(task_id, CodeExerciseSubmitRequest(
        student_id=account.id, code=req.code, include_ai_review=False,
    ), db)


@router.get("/evidence")
async def training_evidence(account=Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CodeSubmission, CodeExercise).join(CodeExercise, CodeExercise.id == CodeSubmission.exercise_id).where(
        CodeSubmission.student_id == account.id, CodeExercise.student_id == account.id,
        CodeSubmission.total_tests > 0,
        CodeExercise.training_metadata["source"].as_string().in_(["learning_path", "preset"]),
    ).order_by(CodeSubmission.created_at, CodeSubmission.id))).all()
    return [{"id": submission.id, "taskId": (exercise.training_metadata or {}).get("preset_id") or exercise.id,
        "title": exercise.title, "course": (exercise.training_metadata or {}).get("course") or exercise.context_title,
        "knowledgePoints": exercise.knowledge_points or [], "score": submission.score,
        "passedTests": submission.passed_tests, "totalTests": submission.total_tests,
        "createdAt": submission.created_at.replace(tzinfo=timezone.utc).isoformat(),
        "stage": (exercise.training_metadata or {}).get("node_title") or "",
    } for submission, exercise in rows]
