"""生成资料库 — 表单生成（强制类型）、持久化、列表/详情/删除。

题目类材料保存时自动在 exam_papers 建一份试卷（与试题库打通）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.sse import sse_format
from app.models.learning import ExamPaper, GeneratedMaterial
from app.routers.auth import require_account_student_scope
from app.schemas.resource import ResourceRequest

router = APIRouter(dependencies=[Depends(require_account_student_scope)])


class MaterialSave(BaseModel):
    """POST /api/materials —— 保存单条已生成材料（studio 路径客户端持久化）。"""

    student_id: str
    type: str
    title: str = ""
    subtitle: str = ""
    meta: list[str] = Field(default_factory=list)
    sources: int = 0
    knowledge_points: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    source: str = "studio"
    approval_token: str = ""


class ReflectionSave(BaseModel):
    """User-authored learning evidence with an optional AI supplement."""

    student_id: str
    task_key: str = Field(min_length=1, max_length=120)
    day: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=2, max_length=160)
    knowledge_points: str = Field(default="", max_length=1000)
    user_content: str = Field(min_length=6, max_length=12000)
    ai_supplement: str = Field(default="", max_length=12000)
    context_summary: str = Field(default="", max_length=12000)


class NoteSave(BaseModel):
    """A note written by the learner against a selected source passage."""

    student_id: str = Field(min_length=1, max_length=64)
    resource_id: str = Field(min_length=1, max_length=120)
    resource_title: str = Field(min_length=1, max_length=256)
    title: str = Field(min_length=1, max_length=160)
    selected_text: str = Field(min_length=1, max_length=12000)
    note_content: str = Field(min_length=2, max_length=24000)
    knowledge_points: str = Field(default="", max_length=1000)


class MaterialMediaLink(BaseModel):
    """Associate one server-owned video task with an approved video material."""

    student_id: str = Field(min_length=1, max_length=64)
    task_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    resource_task_id: str = Field(default="", max_length=120)


def _derive_card(data: dict[str, Any]) -> tuple[str, list[str], int]:
    """从生成器产出推导卡片摘要（subtitle / meta / sources），与前端 metaFromData 对齐。"""
    subtitle = (
        data.get("overview")
        or data.get("summary")
        or data.get("description")
        or ""
    )
    meta: list[str] = []

    def _n(key: str) -> int:
        v = data.get(key)
        return len(v) if isinstance(v, list) else 0

    if _n("questions"):
        meta.append(f"{_n('questions')} 题")
    if _n("key_points"):
        meta.append(f"{_n('key_points')} 个要点")
    if _n("scenes"):
        meta.append(f"{_n('scenes')} 个章节内容")
    if _n("articles"):
        meta.append(f"{_n('articles')} 篇")
    if _n("nodes"):
        meta.append(f"{_n('nodes')} 节点")
    if _n("slides"):
        meta.append(f"{_n('slides')} 页")
    if isinstance(data.get("language"), str):
        meta.append(data["language"])

    sources = len(data["sources"]) if isinstance(data.get("sources"), list) else 0
    return str(subtitle), meta[:3], sources


def _save_material(
    db: AsyncSession,
    *,
    student_id: str,
    type: str,
    title: str,
    knowledge_points: str,
    data: dict[str, Any],
    source: str,
    subtitle: str | None = None,
    meta: list[str] | None = None,
    sources: int | None = None,
    material_id: str | None = None,
    exam_id: str | None = None,
    paper_id: str | None = None,
) -> GeneratedMaterial:
    """构造并 add 一条材料；quiz 类同步建试卷。调用方负责 commit。"""
    if subtitle is None or meta is None or sources is None:
        d_sub, d_meta, d_src = _derive_card(data)
        subtitle = subtitle if subtitle is not None else d_sub
        meta = meta if meta is not None else d_meta
        sources = sources if sources is not None else d_src

    resolved_exam_id: str | None = None
    questions = data.get("questions")
    if type == "quiz" and isinstance(questions, list) and questions:
        for q in questions:
            if isinstance(q, dict):
                q.setdefault("id", str(uuid.uuid4())[:8])
        resolved_exam_id = exam_id or str(uuid.uuid4())
        db.add(ExamPaper(
            id=paper_id or str(uuid.uuid4()),
            exam_id=resolved_exam_id,
            student_id=student_id,
            topic=knowledge_points or title or "AI 生成",
            title=title or "AI 生成练习卷",
            category="AI 生成",
            tags=["生成"],
            paper_type="generated",
            questions=questions,
            status="created",
        ))

    material = GeneratedMaterial(
        id=material_id or str(uuid.uuid4()),
        student_id=student_id,
        type=type,
        title=title,
        subtitle=subtitle,
        meta=meta,
        sources=sources,
        knowledge_points=knowledge_points,
        data=data,
        source=source,
        exam_id=resolved_exam_id,
    )
    db.add(material)
    return material


async def _save_material_once(
    db: AsyncSession,
    *,
    publication_key: str,
    student_id: str,
    type: str,
    title: str,
    knowledge_points: str,
    data: dict[str, Any],
    source: str,
) -> tuple[GeneratedMaterial, bool]:
    """Publish one approved resource at most once for a retry-stable key."""

    identity = f"smartlearn:{student_id}:{publication_key}"
    material_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{identity}:material"))
    existing = await db.get(GeneratedMaterial, material_id)
    if existing is not None:
        return existing, False

    try:
        async with db.begin_nested():
            material = _save_material(
                db,
                student_id=student_id,
                type=type,
                title=title,
                knowledge_points=knowledge_points,
                data=data,
                source=source,
                material_id=material_id,
                exam_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{identity}:exam")),
                paper_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{identity}:paper")),
            )
            await db.flush()
    except IntegrityError:
        # A concurrent retry may have won the unique primary-key race.
        existing = await db.get(GeneratedMaterial, material_id)
        if existing is None:
            raise
        return existing, False
    return material, True


def material_summary(m: GeneratedMaterial) -> dict[str, Any]:
    """列表摘要，不返回 data 大字段。"""
    external_video = None
    if isinstance(m.data, dict):
        raw_video = m.data.get("video")
        if isinstance(raw_video, dict):
            url = str(raw_video.get("url") or "").strip()
            bvid = str(raw_video.get("bvid") or "").strip()
            if url or bvid:
                external_video = {
                    "bvid": bvid,
                    "title": str(raw_video.get("title") or m.title).strip(),
                    "url": url,
                    "embed_url": str(raw_video.get("embed_url") or "").strip(),
                    "author": str(raw_video.get("author") or "").strip(),
                    "duration": str(raw_video.get("duration") or "").strip(),
                    "summary": str(raw_video.get("summary") or "").strip(),
                }
    return {
        "id": m.id,
        "type": m.type,
        "title": m.title,
        "subtitle": m.subtitle,
        "meta": m.meta or [],
        "sources": m.sources,
        "knowledge_points": m.knowledge_points,
        "source": m.source,
        # Resource Center needs only this safe public summary to expose the
        # original learning-video link.  Full generated material data remains
        # behind the authenticated detail endpoint.
        "external_video": external_video,
        "exam_id": m.exam_id,
        "review_approved": _material_is_approved(m),
        "created_at": str(m.created_at),
    }


def _material_is_approved(material: GeneratedMaterial) -> bool:
    data = material.data
    return isinstance(data, dict) and data.get("review_approved") is True


@router.post("/save")
async def save_material(req: MaterialSave, db: AsyncSession = Depends(get_db)):
    """Persist only a payload carrying a matching server-issued approval."""

    from app.services.material_approval import verify_material_approval

    approved, reason = verify_material_approval(
        req.approval_token,
        req.student_id,
        req.model_dump(exclude={"approval_token"}, mode="json"),
    )
    if not approved:
        raise HTTPException(
            status_code=403,
            detail={
                "code": reason,
                "message": "资料没有有效的服务端审核凭证，未保存。",
                "recovery": "请重新执行网页总结或视频分析，审核通过后再保存。",
                "retryable": reason in {"approval_token_expired"},
            },
        )
    approved_data = {
        **req.data,
        "reviewed": True,
        "review_approved": True,
    }
    material = _save_material(
        db,
        student_id=req.student_id,
        type=req.type,
        title=req.title,
        knowledge_points=req.knowledge_points,
        data=approved_data,
        source=req.source,
        subtitle=req.subtitle or None,
        meta=req.meta or None,
        sources=req.sources or None,
    )
    await db.commit()
    await db.refresh(material)
    return material_summary(material)


@router.post("/reflections")
async def save_reflection(req: ReflectionSave, db: AsyncSession = Depends(get_db)):
    """Persist a learner's own reflection without pretending it was AI-reviewed.

    The server owns this endpoint and marks the record publishable because the
    primary evidence is authored and explicitly submitted by the learner.  Any
    AI text remains a separately labelled supplement in the stored payload.
    """

    user_content = req.user_content.strip()
    ai_supplement = req.ai_supplement.strip()
    data = {
        "kind": "reflection",
        "day": req.day,
        "task_key": req.task_key,
        "user_content": user_content,
        "ai_supplement": ai_supplement,
        "context_summary": req.context_summary.strip(),
        "content": "\n\n".join(
            part
            for part in (
                f"## 我的复盘\n\n{user_content}",
                f"## AI 补充\n\n{ai_supplement}" if ai_supplement else "",
            )
            if part
        ),
        "authored_by_user": True,
        "reviewed": True,
        "review_approved": True,
    }
    material = _save_material(
        db,
        student_id=req.student_id,
        type="reading",
        title=req.title,
        knowledge_points=req.knowledge_points,
        data=data,
        source="reflection",
        subtitle=f"{req.day} 学习复盘 · 用户原文与 AI 补充已分开保存",
        meta=[req.day, "学习复盘", "画像证据"],
        sources=0,
    )
    await db.commit()
    await db.refresh(material)
    return {**material_summary(material), "data": data}


@router.post("/notes")
async def save_note(req: NoteSave, db: AsyncSession = Depends(get_db)):
    """Save a learner-authored note and its immutable source passage."""

    selected_text = req.selected_text.strip()
    note_content = req.note_content.strip()
    data = {
        "kind": "note",
        "resource_id": req.resource_id,
        "resource_title": req.resource_title.strip(),
        "selected_text": selected_text,
        "note_content": note_content,
        "content": (
            f"## 来源摘录\n\n> {selected_text}\n\n"
            f"## 我的笔记\n\n{note_content}"
        ),
        "authored_by_user": True,
        "reviewed": True,
        "review_approved": True,
    }
    material = _save_material(
        db,
        student_id=req.student_id,
        type="reading",
        title=req.title.strip(),
        knowledge_points=req.knowledge_points.strip(),
        data=data,
        source="note",
        subtitle=f"摘自《{req.resource_title.strip()}》的段落笔记",
        meta=["笔记", "段落摘录", "用户原创"],
        sources=1,
    )
    await db.commit()
    await db.refresh(material)
    return {**material_summary(material), "data": data}


@router.post("/generate")
async def generate_materials(req: ResourceRequest, db: AsyncSession = Depends(get_db)):
    """Run the canonical planned pipeline and persist final approved versions."""

    from app.services.agent_run_store import persist_stream_event
    from app.services.planned_resource_pipeline import stream_planned_resource_pipeline

    run_id = f"resource_{uuid.uuid4().hex[:12]}"
    publication_key = req.idempotency_key or run_id

    async def _stream_and_persist():
        async def persist(resources: list[dict[str, Any]]) -> int:
            saved = 0
            for index, resource in enumerate(resources):
                if resource.get("review_approved") is not True:
                    continue
                await _save_material_once(
                    db,
                    publication_key=f"{publication_key}:{index}",
                    student_id=req.student_id,
                    type=str(resource.get("type") or "explainer"),
                    title=str(resource.get("title") or ""),
                    knowledge_points=req.knowledge_points or req.topic,
                    data=resource,
                    source="form",
                )
                saved += 1
            await db.commit()
            return saved

        async for event, payload in stream_planned_resource_pipeline(
            req,
            persist=persist,
            source="form",
            run_id=run_id,
        ):
            await persist_stream_event(event, payload, owner_id=req.student_id)
            yield sse_format(event, payload)

    return StreamingResponse(_stream_and_persist(), media_type="text/event-stream")


@router.delete("/{student_id}")
async def clear_materials(student_id: str, db: AsyncSession = Depends(get_db)):
    """Clear all generated materials for one student and their generated quiz papers."""
    stmt = select(GeneratedMaterial).where(GeneratedMaterial.student_id == student_id)
    materials = (await db.execute(stmt)).scalars().all()
    exam_ids = [m.exam_id for m in materials if m.exam_id]

    papers: list[ExamPaper] = []
    if exam_ids:
        paper_stmt = select(ExamPaper).where(
            ExamPaper.student_id == student_id,
            ExamPaper.exam_id.in_(exam_ids),
        )
        papers = (await db.execute(paper_stmt)).scalars().all()

    for paper in papers:
        await db.delete(paper)
    for material in materials:
        await db.delete(material)

    await db.commit()
    return {"ok": True, "deleted": len(materials), "papers_deleted": len(papers)}


@router.get("/{student_id}")
async def list_materials(
    student_id: str,
    type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """资料列表（摘要）。"""
    stmt = select(GeneratedMaterial).where(GeneratedMaterial.student_id == student_id)
    if type:
        stmt = stmt.where(GeneratedMaterial.type == type)
    stmt = stmt.order_by(GeneratedMaterial.created_at.desc())
    materials = (await db.execute(stmt)).scalars().all()
    return [material_summary(m) for m in materials if _material_is_approved(m)]


@router.get("/detail/{material_id}")
async def get_material(
    material_id: str,
    student_id: str,
    db: AsyncSession = Depends(get_db),
):
    """资料详情（含 data 完整载荷）。"""
    stmt = select(GeneratedMaterial).where(
        GeneratedMaterial.id == material_id,
        GeneratedMaterial.student_id == student_id,
    )
    material = (await db.execute(stmt)).scalar_one_or_none()
    if material is None or not _material_is_approved(material):
        raise HTTPException(status_code=404, detail="资料不存在")
    return {**material_summary(material), "data": material.data or {}}


@router.patch("/detail/{material_id}/media")
async def link_material_media(
    material_id: str,
    req: MaterialMediaLink,
    db: AsyncSession = Depends(get_db),
):
    """Persist the durable video-task link without reopening material approval."""

    from app.services.media.task import media_task_manager

    stmt = select(GeneratedMaterial).where(
        GeneratedMaterial.id == material_id,
        GeneratedMaterial.student_id == req.student_id,
    )
    material = (await db.execute(stmt)).scalar_one_or_none()
    if material is None and req.resource_task_id:
        fallback_stmt = select(GeneratedMaterial).where(
            GeneratedMaterial.student_id == req.student_id,
            GeneratedMaterial.type == "video",
        )
        candidates = (await db.execute(fallback_stmt)).scalars().all()
        material = next(
            (
                candidate
                for candidate in candidates
                if isinstance(candidate.data, dict)
                and str(candidate.data.get("task_id") or "") == req.resource_task_id
            ),
            None,
        )
    if (
        material is None
        or material.type != "video"
        or not _material_is_approved(material)
    ):
        raise HTTPException(status_code=404, detail="视频资料不存在")

    progress = media_task_manager.get_progress(req.task_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="视频任务不存在")
    owner = str(progress.get("student_id") or "")
    if owner and owner != req.student_id:
        raise HTTPException(status_code=403, detail="不能关联其他用户的视频任务")
    if str(progress.get("kind") or "video") != "video":
        raise HTTPException(status_code=400, detail="任务不是视频任务")

    status = str(progress.get("status") or "pending")
    workflow_version = str(progress.get("workflow_version") or "")
    data = dict(material.data or {})
    data.update({
        "media_task_id": req.task_id,
        "media_status": status,
        "media_workflow_version": workflow_version,
        "media_updated_at": datetime.now(timezone.utc).isoformat(),
    })
    if status == "completed":
        data["media_file_url"] = f"/api/media/video/{req.task_id}/file"
    else:
        data.pop("media_file_url", None)
    material.data = data
    await db.commit()
    await db.refresh(material)
    return {
        "material_id": material.id,
        "media_task_id": req.task_id,
        "media_status": status,
        "media_workflow_version": workflow_version,
        "media_file_url": data.get("media_file_url"),
    }


@router.delete("/detail/{material_id}")
async def delete_material(
    material_id: str,
    student_id: str,
    db: AsyncSession = Depends(get_db),
):
    """删除资料（不级联删除其衍生试卷）。"""
    stmt = select(GeneratedMaterial).where(
        GeneratedMaterial.id == material_id,
        GeneratedMaterial.student_id == student_id,
    )
    material = (await db.execute(stmt)).scalar_one_or_none()
    if material is None:
        raise HTTPException(status_code=404, detail="资料不存在")
    await db.delete(material)
    await db.commit()
    return {"ok": True}
