"""试卷库管理、分类与重做。"""

from __future__ import annotations

import copy
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import ExamPaper

router = APIRouter()


class PaperUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    category: str | None = Field(default=None, min_length=1, max_length=64)
    tags: list[str] | None = None
    starred: bool | None = None
    archived: bool | None = None


class CategoryRename(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str = Field(min_length=1, max_length=64)


def paper_summary(paper: ExamPaper) -> dict:
    return {
        "id": paper.id,
        "exam_id": paper.exam_id,
        "title": paper.title,
        "topic": paper.topic,
        "category": paper.category,
        "tags": paper.tags or [],
        "starred": paper.starred,
        "status": paper.status,
        "overall_score": paper.overall_score,
        "question_count": len(paper.questions or []),
        "created_at": str(paper.created_at),
    }


def _paper_questions_for_student(paper: ExamPaper) -> list[dict]:
    questions = [dict(question) for question in (paper.questions or []) if isinstance(question, dict)]
    if paper.category != "课程测评" or paper.status == "graded":
        return questions
    return [
        {
            key: value
            for key, value in question.items()
            if key not in {"answer", "explanation"}
        }
        for question in questions
    ]


@router.get("/{student_id}")
async def list_papers(
    student_id: str,
    category: str | None = None,
    tag: str | None = None,
    status: str | None = None,
    keyword: str | None = None,
    starred: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    """获取试卷摘要，禁止返回题目、答案和评分大字段。"""
    stmt = select(ExamPaper).where(ExamPaper.student_id == student_id)
    if category:
        stmt = stmt.where(ExamPaper.category == category)
    if keyword:
        pattern = f"%{keyword}%"
        stmt = stmt.where(ExamPaper.title.ilike(pattern) | ExamPaper.topic.ilike(pattern))
    if starred is not None:
        stmt = stmt.where(ExamPaper.starred == starred)
    if status == "archived":
        stmt = stmt.where(ExamPaper.archived.is_(True))
    else:
        stmt = stmt.where(ExamPaper.archived.is_(False))
        if status:
            stmt = stmt.where(ExamPaper.status == status)
    stmt = stmt.order_by(ExamPaper.created_at.desc())

    papers = list((await db.execute(stmt)).scalars().all())
    if tag:
        papers = [paper for paper in papers if tag in (paper.tags or [])]
    return [paper_summary(paper) for paper in papers]


@router.get("/detail/{paper_id}")
async def get_paper_detail(
    paper_id: str,
    student_id: str = Query(min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    paper = await db.get(ExamPaper, paper_id)
    if paper is None:
        paper = (await db.execute(
            select(ExamPaper).where(
                ExamPaper.exam_id == paper_id,
                ExamPaper.student_id == student_id,
            )
        )).scalar_one_or_none()
    if paper is None or paper.student_id != student_id:
        raise HTTPException(status_code=404, detail="试卷不存在")
    return {
        **paper_summary(paper),
        "paper_type": paper.paper_type,
        "questions": _paper_questions_for_student(paper),
        "answers": paper.answers or {},
        "results": paper.results or [],
        "mastery": paper.mastery or {},
    }


@router.patch("/{paper_id}")
async def update_paper(
    paper_id: str,
    req: PaperUpdate,
    db: AsyncSession = Depends(get_db),
):
    paper = await db.get(ExamPaper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="试卷不存在")
    for key, value in req.model_dump(exclude_none=True).items():
        setattr(paper, key, value)
    await db.commit()
    await db.refresh(paper)
    return paper_summary(paper)


@router.delete("/{paper_id}")
async def delete_paper(paper_id: str, db: AsyncSession = Depends(get_db)):
    paper = await db.get(ExamPaper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="试卷不存在")
    await db.delete(paper)
    await db.commit()
    return {"ok": True}


@router.get("/{student_id}/categories")
async def get_categories(student_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(ExamPaper).where(
        ExamPaper.student_id == student_id,
        ExamPaper.archived.is_(False),
    )
    papers = (await db.execute(stmt)).scalars().all()
    category_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    for paper in papers:
        category_counts[paper.category] = category_counts.get(paper.category, 0) + 1
        for tag in paper.tags or []:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return {
        "categories": [{"name": name, "count": count} for name, count in sorted(category_counts.items())],
        "tags": [{"name": name, "count": count} for name, count in sorted(tag_counts.items())],
    }


@router.post("/{student_id}/categories/rename")
async def rename_category(
    student_id: str,
    req: CategoryRename,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ExamPaper).where(
        ExamPaper.student_id == student_id,
        ExamPaper.category == req.from_,
    )
    papers = list((await db.execute(stmt)).scalars().all())
    for paper in papers:
        paper.category = req.to
    await db.commit()
    return {"updated": len(papers)}


@router.post("/{paper_id}/redo")
async def redo_paper(
    paper_id: str,
    student_id: str = Query(min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(ExamPaper, paper_id)
    if source is None or source.student_id != student_id:
        raise HTTPException(status_code=404, detail="试卷不存在")

    paper = ExamPaper(
        id=str(uuid.uuid4()),
        exam_id=str(uuid.uuid4()),
        student_id=source.student_id,
        topic=source.topic,
        title=f"{source.title} · 重做",
        category=source.category,
        tags=list(dict.fromkeys([*(source.tags or []), "重做"])),
        starred=False,
        archived=False,
        paper_type=source.paper_type,
        questions=copy.deepcopy(source.questions or []),
        status="created",
    )
    db.add(paper)
    await db.commit()
    return {"exam_id": paper.exam_id, "questions": _paper_questions_for_student(paper)}
