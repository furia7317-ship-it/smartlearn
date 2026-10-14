from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_db
from app.models.account import UserAccount
from app.models.focus import FocusGraph, FocusJob, FocusPackage, FocusProgress
from app.routers.auth import get_current_account
from app.schemas.focus import CourseGraph, GenerateGraphRequest, PrepareRequest, StateAction, validate_graph
from app.services.focus import apply_action, ensure_catalog, owned_graph, safe_package, snapshot, uid

router = APIRouter()


def job_view(job: FocusJob) -> dict:
    return {"id": job.id, "kind": job.kind, "status": job.status, "result": job.result, "error": job.error, "title": job.input.get("title", "学习资料")}


@router.get("/courses")
async def courses(account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    await ensure_catalog(db, account.id)
    rows = (await db.scalars(select(FocusGraph).where(FocusGraph.student_id == account.id).order_by(FocusGraph.created_at))).all()
    jobs = (await db.scalars(select(FocusJob).where(FocusJob.student_id == account.id, FocusJob.kind == "graph", FocusJob.status != "ready"))).all()
    return {"courses": [{"id": r.id, "title": r.payload["title"], "version": r.version, "status": r.status, "origin": r.origin} for r in rows], "jobs": [job_view(j) for j in jobs]}


@router.post("/courses/generate")
async def create_graph(body: GenerateGraphRequest, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    target = f"course.{body.request_id}"
    job = await db.scalar(select(FocusJob).where(FocusJob.student_id == account.id, FocusJob.kind == "graph", FocusJob.target == target))
    if job:
        if job.input != body.model_dump():
            raise HTTPException(409, "此请求编号已经用于另一份课程")
        return job_view(job)
    job = FocusJob(id=uid(), student_id=account.id, kind="graph", target=target, input=body.model_dump(), result={}, status="pending")
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return await create_graph(body, account, db)
    return job_view(job)


@router.get("/courses/{graph_id}")
async def course(graph_id: str, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    return await snapshot(db, await owned_graph(db, account.id, graph_id))


@router.post("/courses/{graph_id}/publish")
async def publish(graph_id: str, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    row = await owned_graph(db, account.id, graph_id)
    validate_graph(CourseGraph.model_validate(row.payload))
    if row.status != "published":
        row.status = "published"
        db.add(FocusProgress(id=uid(), student_id=account.id, graph_id=row.id, records={}, revision=0))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            row = await owned_graph(db, account.id, graph_id)
    return await snapshot(db, row)


@router.post("/courses/{graph_id}/draft")
async def save_draft(graph_id: str, body: CourseGraph, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    row = await owned_graph(db, account.id, graph_id)
    if row.status != "draft":
        raise HTTPException(409, "已启用的课程版本不能直接改写")
    try:
        row.payload = validate_graph(body).model_dump()
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    row.version += 1
    await db.commit()
    return await snapshot(db, row)


@router.post("/courses/{graph_id}/actions")
async def act(graph_id: str, body: StateAction, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    return await apply_action(db, account.id, graph_id, body)


@router.get("/courses/{graph_id}/nodes/{node_id}/package")
async def package(graph_id: str, node_id: str, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    await owned_graph(db, account.id, graph_id)
    item = await db.scalar(select(FocusPackage).where(FocusPackage.graph_id == graph_id, FocusPackage.node_id == node_id))
    if item:
        return {"status": "ready", "package": safe_package(item)}
    job = await db.scalar(select(FocusJob).where(FocusJob.student_id == account.id, FocusJob.kind == "package", FocusJob.target == f"{graph_id}:{node_id}"))
    return {"status": job.status if job else "unprepared", "job": job_view(job) if job else None}


@router.post("/courses/{graph_id}/nodes/{node_id}/prepare")
async def prepare(graph_id: str, node_id: str, body: PrepareRequest, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    row = await owned_graph(db, account.id, graph_id)
    if row.status != "published":
        raise HTTPException(409, "请先检查并启用课程图")
    if not any(n["id"] == node_id for n in row.payload["nodes"]):
        raise HTTPException(404, "知识节点不存在")
    status = await package(graph_id, node_id, account, db)
    if status["status"] == "ready":
        return status
    job = await db.scalar(select(FocusJob).where(FocusJob.student_id == account.id, FocusJob.kind == "package", FocusJob.target == f"{graph_id}:{node_id}"))
    if not job:
        job = FocusJob(id=uid(), student_id=account.id, kind="package", target=f"{graph_id}:{node_id}", input={"graph_id": graph_id, "node_id": node_id}, status="pending", result={})
        db.add(job)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return await prepare(graph_id, node_id, body, account, db)
    return {"status": job.status, "job": job_view(job)}


@router.post("/jobs/{job_id}/retry")
async def retry(job_id: str, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    job = await db.scalar(select(FocusJob).where(FocusJob.id == job_id, FocusJob.student_id == account.id))
    if not job:
        raise HTTPException(404, "准备任务不存在")
    if job.status == "failed":
        job.status, job.error = "pending", None
        await db.commit()
    return job_view(job)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, account: UserAccount = Depends(get_current_account), db: AsyncSession = Depends(get_db)):
    job = await db.scalar(select(FocusJob).where(FocusJob.id == job_id, FocusJob.student_id == account.id))
    if not job:
        raise HTTPException(404, "准备任务不存在")
    return job_view(job)
