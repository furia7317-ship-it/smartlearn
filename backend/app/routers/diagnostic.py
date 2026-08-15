"""摸底路由 — 学情诊断（SSE 流式）+ 写入画像 + 历史列表。"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.sse import sse_format
from app.models.learning import Assessment
from app.models.profile import Profile

router = APIRouter()


class DiagnosticRequest(BaseModel):
    student_id: str
    subject: str = Field(min_length=1, max_length=256)
    self_level: str = "基础"  # 基础 / 进阶 / 完全掌握


def _chunk(text: str, size: int = 28):
    for i in range(0, len(text), size):
        yield text[i : i + size]


async def _write_profile(db: AsyncSession, student_id: str, subject: str, self_level: str, analysis: dict) -> None:
    """把摸底结论合并进画像（knowledge_level + interests），非破坏性。"""
    profile = (await db.execute(
        select(Profile).where(Profile.student_id == student_id)
    )).scalar_one_or_none()
    if profile is None:
        profile = Profile(student_id=student_id)
        db.add(profile)

    kl = dict(profile.knowledge_level or {})
    for kp, score in (analysis.get("knowledge_seed") or {}).items():
        try:
            s = max(0.0, min(1.0, float(score)))
        except (TypeError, ValueError):
            continue
        kl[kp] = {"score": s, "level": self_level, "evidence": f"摸底·{subject}"}
    profile.knowledge_level = kl

    interests = list(profile.interests or [])
    if not any(isinstance(i, dict) and i.get("topic") == subject for i in interests):
        interests.append({"topic": subject, "level": self_level})
    profile.interests = interests


@router.post("/")
async def run_diagnostic(req: DiagnosticRequest, db: AsyncSession = Depends(get_db)):
    """摸底分析（SSE）：分析 → 流式回传 → 写画像 + 落库 → done。"""
    from app.agents.diagnostic import analyze
    from app.agents.profiler import get_profile

    async def _stream():
        yield sse_format("progress", {"agent": "profiler", "status": "started", "detail": "分析学情中…"})

        profile = await asyncio.to_thread(get_profile, req.student_id)
        analysis = await asyncio.to_thread(analyze, req.subject, req.self_level, profile)

        narrative = analysis.get("narrative", "")
        for piece in _chunk(narrative):
            yield sse_format("delta", {"text": piece})

        await _write_profile(db, req.student_id, req.subject, req.self_level, analysis)
        record = Assessment(
            id=str(uuid.uuid4()),
            student_id=req.student_id,
            subject=req.subject,
            self_level=req.self_level,
            analysis=analysis,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

        yield sse_format("done", {
            "id": record.id,
            "subject": req.subject,
            "self_level": req.self_level,
            "analysis": analysis,
            "created_at": str(record.created_at),
        })

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/{student_id}")
async def list_diagnostics(student_id: str, db: AsyncSession = Depends(get_db)):
    """摸底历史列表（供生成表单 / 目标导入）。"""
    stmt = (
        select(Assessment)
        .where(Assessment.student_id == student_id)
        .order_by(Assessment.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "subject": r.subject,
            "self_level": r.self_level,
            "analysis": r.analysis or {},
            "created_at": str(r.created_at),
        }
        for r in rows
    ]
