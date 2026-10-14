"""Personal teaching-method management; builtin procedures stay read-only."""

from fastapi import APIRouter, Depends, Query

from app.core.deps import DBSession
from app.routers.auth import require_account_student_scope
from app.schemas.procedure_skills import (
    SkillDetail,
    SkillDisableAction,
    SkillProposal,
    SkillSummary,
    SkillVersionAction,
)
from app.services import procedure_skills as store

router = APIRouter(dependencies=[Depends(require_account_student_scope)])


@router.get("", response_model=list[SkillSummary])
async def list_procedure_skills(
    db: DBSession,
    student_id: str = Query(min_length=1, max_length=64),
    query: str = Query(default="", max_length=200),
    resource_type: str = Query(default="", max_length=24),
):
    return await store.list_skills(db, student_id, query, resource_type)


@router.get("/{skill_id}", response_model=SkillDetail)
async def get_procedure_skill(
    skill_id: str, db: DBSession, student_id: str = Query(min_length=1, max_length=64),
):
    return await store.get_skill(db, student_id, skill_id)


@router.post("", response_model=SkillDetail)
async def propose_procedure_skill(req: SkillProposal, db: DBSession):
    return await store.propose_skill(db, req.student_id, req.definition, req.source_run_id, req.skill_id)


@router.post("/{skill_id}/evaluate", response_model=SkillDetail)
async def evaluate_procedure_skill(skill_id: str, req: SkillVersionAction, db: DBSession):
    from app.services.skill_evaluation import evaluate_skill_version

    await store.owned_skill(db, req.student_id, skill_id, writable=True)
    result = await evaluate_skill_version(db, req.student_id, skill_id, req.version_id)
    await db.commit()
    return result


@router.post("/{skill_id}/activate", response_model=SkillDetail)
async def activate_procedure_skill(skill_id: str, req: SkillVersionAction, db: DBSession):
    return await store.activate_version(db, req.student_id, skill_id, req.version_id)


@router.post("/{skill_id}/disable", response_model=SkillDetail)
async def disable_procedure_skill(skill_id: str, req: SkillDisableAction, db: DBSession):
    return await store.set_disabled(db, req.student_id, skill_id, req.disabled)
