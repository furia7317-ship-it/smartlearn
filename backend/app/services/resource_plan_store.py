"""Persistence helpers for owner-scoped, versioned resource plans."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import ResourceGenerationPlan
from app.schemas.resource_plan import (
    PlanArtifact,
    PlanExecutionState,
    PlanRecordResponse,
)


class PlanNotFoundError(LookupError):
    pass


class PlanVersionError(RuntimeError):
    pass


class PlanStateError(RuntimeError):
    pass


async def get_owned_plan(
    db: AsyncSession,
    plan_id: str,
    student_id: str,
) -> ResourceGenerationPlan:
    row = await db.scalar(
        select(ResourceGenerationPlan).where(
            ResourceGenerationPlan.id == plan_id,
            ResourceGenerationPlan.student_id == student_id,
        )
    )
    if row is None:
        raise PlanNotFoundError(plan_id)
    return row


def require_current_version(row: ResourceGenerationPlan, expected_version: int) -> None:
    if row.version != expected_version:
        raise PlanVersionError(f"当前版本为 {row.version}")


async def create_record(
    db: AsyncSession,
    plan: PlanArtifact,
    request_text: str,
) -> ResourceGenerationPlan:
    row = ResourceGenerationPlan(
        id=plan.plan_id,
        student_id=plan.student_id,
        version=plan.version,
        status=plan.status,
        request_text=request_text,
        artifact=plan.model_dump(mode="json"),
        validation=plan.validation.model_dump(mode="json"),
        execution_state=PlanExecutionState().model_dump(mode="json"),
    )
    db.add(row)
    await db.commit()
    return row


async def _raise_cas_failure(
    db: AsyncSession,
    plan_id: str,
    student_id: str,
    expected_version: int,
) -> None:
    await db.rollback()
    current = await get_owned_plan(db, plan_id, student_id)
    if current.version != expected_version:
        raise PlanVersionError(f"当前版本为 {current.version}")
    raise PlanStateError(f"当前状态 {current.status} 不允许该操作")


async def _commit_cas(
    db: AsyncSession,
    row: ResourceGenerationPlan,
    *,
    expected_version: int,
    allowed_statuses: set[str],
    values: dict,
) -> ResourceGenerationPlan:
    plan_id = row.id
    student_id = row.student_id
    result = await db.execute(
        update(ResourceGenerationPlan)
        .where(
            ResourceGenerationPlan.id == row.id,
            ResourceGenerationPlan.student_id == row.student_id,
            ResourceGenerationPlan.version == expected_version,
            ResourceGenerationPlan.status.in_(allowed_statuses),
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await _raise_cas_failure(db, plan_id, student_id, expected_version)
    await db.commit()
    await db.refresh(row)
    return row


async def claim_execution(
    db: AsyncSession,
    row: ResourceGenerationPlan,
    plan: PlanArtifact,
    expected_version: int,
    *,
    allowed_statuses: set[str],
    execution_state: dict,
) -> ResourceGenerationPlan:
    plan.status = "running"
    return await _commit_cas(
        db,
        row,
        expected_version=expected_version,
        allowed_statuses=allowed_statuses,
        values={
            "status": "running",
            "artifact": plan.model_dump(mode="json"),
            "execution_state": execution_state,
            "last_error": "",
        },
    )


async def update_artifact(
    db: AsyncSession,
    row: ResourceGenerationPlan,
    plan: PlanArtifact,
    expected_version: int,
) -> ResourceGenerationPlan:
    if not plan.validation.valid:
        raise PlanStateError("规划验证未通过")

    plan.version = expected_version + 1
    plan.status = "awaiting_confirmation"
    return await _commit_cas(
        db,
        row,
        expected_version=expected_version,
        allowed_statuses={"draft", "awaiting_confirmation", "approved", "failed"},
        values={
            "version": plan.version,
            "status": plan.status,
            "artifact": plan.model_dump(mode="json"),
            "validation": plan.validation.model_dump(mode="json"),
        },
    )


async def replace_with_replan(
    db: AsyncSession,
    row: ResourceGenerationPlan,
    plan: PlanArtifact,
    expected_version: int,
) -> ResourceGenerationPlan:
    if not plan.validation.valid:
        raise PlanStateError("规划验证未通过")

    plan.plan_id = row.id
    plan.student_id = row.student_id
    plan.version = expected_version + 1
    return await _commit_cas(
        db,
        row,
        expected_version=expected_version,
        allowed_statuses={"draft", "awaiting_confirmation", "approved", "failed"},
        values={
            "version": plan.version,
            "status": plan.status,
            "artifact": plan.model_dump(mode="json"),
            "validation": plan.validation.model_dump(mode="json"),
            "execution_state": PlanExecutionState().model_dump(mode="json"),
            "last_error": "",
        },
    )


async def cancel_record(
    db: AsyncSession,
    row: ResourceGenerationPlan,
    expected_version: int,
) -> ResourceGenerationPlan:
    plan = PlanArtifact.model_validate(row.artifact)
    plan.version = expected_version + 1
    plan.status = "cancelled"
    return await _commit_cas(
        db,
        row,
        expected_version=expected_version,
        allowed_statuses={"draft", "awaiting_confirmation", "approved", "running", "failed"},
        values={
            "version": plan.version,
            "status": plan.status,
            "artifact": plan.model_dump(mode="json"),
        },
    )


def to_response(row: ResourceGenerationPlan) -> PlanRecordResponse:
    return PlanRecordResponse(
        plan=PlanArtifact.model_validate(row.artifact),
        execution=PlanExecutionState.model_validate(row.execution_state or {}),
    )
