"""Account-scoped access to the Learning Data Steward and client training archive."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.core.config import async_session
from app.routers.auth import get_current_account
from app.models.learning_data import LearningDataState, LearnerTrainingArchive, LearnerTrainingRun
from app.services.learning_data import process_student, serialize_state

router = APIRouter()


@router.get("")
async def get_learning_data(account=Depends(get_current_account)):
    async with async_session() as db:
        state = await db.get(LearningDataState, account.id)
        if state and state.revision:
            return serialize_state(state)
    return await process_student(account.id)


@router.post("/refresh")
async def refresh_learning_data(account=Depends(get_current_account)):
    return await process_student(account.id, force=True)


class TrainingArchiveWrite(BaseModel):
    student_id: str
    state: dict = Field(default_factory=dict)


def merge_training_archive(previous, incoming):
    """Per-task last edit wins; immutable run IDs are deduplicated across tabs."""
    from app.agents.learning_data import utc
    merged = dict(previous or {})
    for key, value in incoming.items():
        if not isinstance(key, str) or len(key) > 160 or key in {"__proto__", "constructor", "prototype"} or not isinstance(value, dict):
            raise HTTPException(422, "实训存档格式无效")
        if not isinstance(value.get("code"), str) or len(value["code"]) > 10000 or not utc(value.get("updatedAt")) or not utc(value.get("startedAt")):
            raise HTTPException(422, "实训草稿无效")
        runs = value.get("runs", [])
        if not isinstance(runs, list) or len(runs) > 20:
            raise HTTPException(422, "实训记录过多")
        for run in runs:
            if not isinstance(run, dict) or not isinstance(run.get("id"), str) or len(run["id"]) > 160 or run.get("taskId") != key or run.get("kind") not in {"run", "check"} or not utc(run.get("createdAt")):
                raise HTTPException(422, "实训运行记录无效")
            if not isinstance(run.get("code"), str) or len(run["code"]) > 10000:
                raise HTTPException(422, "实训代码过长")
        old = merged.get(key) or {}
        latest = value if not old or utc(value["updatedAt"]) >= utc(old["updatedAt"]) else old
        all_runs = {run["id"]: run for run in [*runs, *old.get("runs", [])]}
        merged[key] = {**latest, "runs": sorted(all_runs.values(), key=lambda run: utc(run["createdAt"]), reverse=True)[:20]}
    if len(json.dumps(merged, ensure_ascii=False)) > 2_000_000:
        raise HTTPException(413, "实训存档超过容量上限")
    return merged


@router.get("/training-archive")
async def get_training_archive(account=Depends(get_current_account)):
    async with async_session() as db:
        archive = await db.get(LearnerTrainingArchive, account.id)
        return {"state": archive.state if archive else {}}


@router.put("/training-archive")
async def save_training_archive(payload: TrainingArchiveWrite, account=Depends(get_current_account)):
    from sqlalchemy import text
    if payload.student_id != account.id:
        raise HTTPException(403, "只能保存当前账户的实训记录")
    if len(json.dumps(payload.state, ensure_ascii=False)) > 2_000_000:
        raise HTTPException(413, "实训存档超过容量上限")
    async with async_session() as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        archive = await db.get(LearnerTrainingArchive, account.id)
        if not archive:
            archive = LearnerTrainingArchive(student_id=account.id, state={}); db.add(archive)
        archive.state = merge_training_archive(archive.state, payload.state)
        from app.agents.learning_data import utc
        for task_id, progress in payload.state.items():
            for run in progress.get("runs", []):
                if not await db.get(LearnerTrainingRun, (account.id, run["id"])):
                    db.add(LearnerTrainingRun(student_id=account.id, run_id=run["id"], task_id=task_id,
                        payload=run, created_at=utc(run["createdAt"]).replace(tzinfo=None)))
                    await db.flush()
        await db.commit()
        return {"saved": True}
