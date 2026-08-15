"""Learning compiler and on-demand code visualization endpoints."""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import CodeExercise, CodeSubmission
from app.schemas.code_lab import (
    CodeEligibilityRequest,
    CodeExerciseGenerateRequest,
    CodeExerciseSubmitRequest,
    CodeExecuteRequest,
    CodeVisualizationRestoreRequest,
    CodeVisualizeRequest,
)
from app.services.code_exercises import (
    fallback_code_exercise,
    fallback_grade_feedback,
    generate_code_exercise,
    grade_code_feedback,
    public_code_exercise,
    run_hidden_tests,
    update_profile_from_code_submission,
)
from app.services.code_execution import (
    CodeValidationError,
    execute_python,
    validate_python_source,
)
from app.services.code_tutor import (
    build_visual_plan,
    diagnose_code,
    fallback_diagnosis,
    fallback_visual_plan,
)
from app.services.code_visualization_store import code_visualization_store

router = APIRouter()
AI_TIMEOUT_SECONDS = 22.0


@router.get("/exercises/latest/{student_id}")
async def latest_code_exercise(
    student_id: str,
    learning_date: str,
    db: AsyncSession = Depends(get_db),
):
    """Restore today's most recent exercise without exposing hidden tests."""

    stmt = (
        select(CodeExercise)
        .where(
            CodeExercise.student_id == student_id,
            CodeExercise.learning_date == learning_date,
        )
        .order_by(CodeExercise.created_at.desc())
        .limit(1)
    )
    exercise = (await db.execute(stmt)).scalar_one_or_none()
    if exercise is None:
        raise HTTPException(status_code=404, detail="今天还没有生成代码题")
    return public_code_exercise(exercise)


@router.post("/exercises")
async def create_code_exercise(
    req: CodeExerciseGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate and persist one exercise grounded in today's learning context."""

    try:
        generated = await asyncio.wait_for(
            asyncio.to_thread(
                generate_code_exercise,
                req.context_title,
                req.learning_context,
            ),
            timeout=AI_TIMEOUT_SECONDS,
        )
        ai_status = "fallback" if generated.get("used_fallback") else "completed"
    except Exception:  # noqa: BLE001 - keep a usable exercise when the model is unavailable
        generated = fallback_code_exercise(req.context_title, req.learning_context)
        ai_status = "unavailable"
    examples = [
        {"input": item.get("args", []), "output": item.get("expected")}
        for item in generated["tests"][:2]
    ]
    exercise = CodeExercise(
        id=f"code-exercise-{uuid.uuid4().hex}",
        student_id=req.student_id,
        learning_date=req.learning_date,
        context_title=req.context_title,
        learning_context=req.learning_context,
        title=generated["title"],
        prompt=generated["prompt"],
        difficulty=generated["difficulty"],
        knowledge_points=generated["knowledge_points"],
        constraints=generated["constraints"],
        starter_code=generated["starter_code"],
        function_name=generated["function_name"],
        examples=examples,
        hidden_tests=generated["tests"],
        ai_status=ai_status,
    )
    db.add(exercise)
    await db.commit()
    await db.refresh(exercise)
    return public_code_exercise(exercise)


@router.post("/exercises/{exercise_id}/submit")
async def submit_code_exercise(
    exercise_id: str,
    req: CodeExerciseSubmitRequest,
    db: AsyncSession = Depends(get_db),
):
    """Run hidden tests, calculate the immutable score, then ask AI to explain it."""

    exercise = await db.get(CodeExercise, exercise_id)
    if exercise is None or exercise.student_id != req.student_id:
        raise HTTPException(status_code=404, detail="代码题不存在")
    tests = list(exercise.hidden_tests or [])
    execution, case_results = await asyncio.to_thread(
        run_hidden_tests,
        req.code,
        function_name=exercise.function_name,
        tests=tests,
    )
    passed_tests = sum(bool(item.get("passed")) for item in case_results)
    total_tests = len(tests)
    score = round(100 * passed_tests / total_tests) if total_tests else 0
    passed = bool(total_tests) and passed_tests == total_tests
    visible_stdout = str(execution.get("stdout") or "").rstrip()
    test_summary = f"返回值测试：{passed_tests}/{total_tests} 通过，本次得分 {score} 分。"
    execution["stdout"] = (
        f"{visible_stdout}\n\n--- 自动测试 ---\n{test_summary}\n"
        if visible_stdout
        else f"程序未产生 print 输出（函数题按返回值判分）。\n{test_summary}\n"
    )
    exercise_payload = {
        "title": exercise.title,
        "prompt": exercise.prompt,
        "tests": tests,
    }
    failed_cases = [
        {"label": tests[index].get("label") if index < len(tests) else f"测试 {index + 1}"}
        for index, item in enumerate(case_results)
        if not bool(item.get("passed"))
    ]
    try:
        feedback = await asyncio.wait_for(
            asyncio.to_thread(
                grade_code_feedback,
                req.code,
                exercise=exercise_payload,
                execution=execution,
                case_results=case_results,
                score=score,
            ),
            timeout=AI_TIMEOUT_SECONDS,
        )
        ai_status = "completed"
    except Exception:  # noqa: BLE001 - deterministic score remains authoritative
        feedback = fallback_grade_feedback(
            score=score,
            passed_tests=passed_tests,
            total_tests=total_tests,
            execution=execution,
            failed_cases=failed_cases,
        )
        ai_status = "unavailable"
    submission = CodeSubmission(
        id=f"code-submission-{uuid.uuid4().hex}",
        exercise_id=exercise.id,
        student_id=req.student_id,
        code=req.code,
        score=score,
        passed=passed,
        passed_tests=passed_tests,
        total_tests=total_tests,
        feedback=feedback,
        execution=execution,
    )
    db.add(submission)
    await update_profile_from_code_submission(
        db,
        exercise=exercise,
        submission=submission,
    )
    await db.commit()
    return {
        "submission_id": submission.id,
        "exercise_id": exercise.id,
        "score": score,
        "passed": passed,
        "passed_tests": passed_tests,
        "total_tests": total_tests,
        "execution": execution,
        "ai_status": ai_status,
        "diagnosis": feedback,
    }


@router.post("/eligibility")
async def code_visualization_eligibility(req: CodeEligibilityRequest):
    """Validate a code example without running it or invoking the LLM."""

    try:
        await asyncio.to_thread(validate_python_source, req.code)
    except CodeValidationError as exc:
        return {
            "eligible": False,
            "reason": str(exc),
            "line": exc.line,
        }
    return {"eligible": True, "reason": "", "line": None}


@router.post("/execute")
async def execute_code(req: CodeExecuteRequest):
    """Run Python in the bounded worker and optionally request an AI review."""

    execution = await asyncio.to_thread(execute_python, req.code)
    response = {"execution": execution, "ai_status": "not_requested", "diagnosis": None}
    if not req.include_ai_review:
        return response
    try:
        response["diagnosis"] = await asyncio.wait_for(
            asyncio.to_thread(
                diagnose_code,
                req.code,
                execution,
                context=req.context,
            ),
            timeout=AI_TIMEOUT_SECONDS,
        )
        response["ai_status"] = "completed"
    except Exception:  # noqa: BLE001 - execution remains useful if the provider is unavailable
        response["diagnosis"] = fallback_diagnosis(execution)
        response["ai_status"] = "unavailable"
    return response


@router.post("/visualizations/restore")
async def restore_code_visualization(req: CodeVisualizationRestoreRequest):
    """Restore a generated demonstration when its source code still matches."""

    result = await asyncio.to_thread(
        code_visualization_store.load,
        student_id=req.student_id,
        resource_id=req.resource_id,
        code=req.code,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="没有可恢复的代码演示")
    return result


@router.post("/visualize")
async def visualize_code(req: CodeVisualizeRequest):
    """Run once, then let the LLM select explanations for prebuilt components."""

    execution = await asyncio.to_thread(execute_python, req.code)
    try:
        plan = await asyncio.wait_for(
            asyncio.to_thread(
                build_visual_plan,
                req.code,
                execution,
                title=req.title,
                context=req.context,
            ),
            timeout=AI_TIMEOUT_SECONDS,
        )
        ai_status = "completed"
    except Exception:  # noqa: BLE001 - never discard a truthful execution trace
        plan = fallback_visual_plan(execution)
        ai_status = "unavailable"
    response = {"execution": execution, "ai_status": ai_status, "plan": plan}
    persisted = False
    if execution.get("error") is None and execution.get("trace"):
        try:
            persisted = await asyncio.to_thread(
                code_visualization_store.save,
                student_id=req.student_id,
                resource_id=req.resource_id,
                code=req.code,
                result=response,
            )
        except OSError:
            persisted = False
    response["persisted"] = persisted
    return response
