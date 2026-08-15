from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.bilibili import (
    BilibiliVideoResult,
    build_video_learning_payload,
    search_bilibili_videos_async,
)
from app.services.material_approval import attach_material_approvals

router = APIRouter()


class VideoAnalyzeRequest(BaseModel):
    student_id: str
    video: BilibiliVideoResult
    watched_seconds: int = Field(default=0, ge=0)
    note: str = ""


@router.get("/bilibili/search")
async def search_bilibili(query: str, count: int = 8):
    q = (query or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="query 不能为空")
    try:
        results = await search_bilibili_videos_async(q, max(1, min(count, 12)))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"B站资源搜索失败: {exc}") from exc
    return {"query": q, "results": [item.model_dump() for item in results]}


@router.post("/bilibili/analyze")
async def analyze_bilibili(req: VideoAnalyzeRequest):
    payload = await build_video_learning_payload(
        req.video,
        watched_seconds=req.watched_seconds,
        note=req.note,
    )
    return attach_material_approvals(
        payload,
        student_id=req.student_id,
        evidence_context=[
            {
                "id": req.video.url or req.video.bvid,
                "content": "\n".join(
                    part
                    for part in (req.video.title, req.video.summary, req.note)
                    if part
                )[:3000],
                "metadata": {
                    "title": req.video.title,
                    "url": req.video.url,
                    "bvid": req.video.bvid,
                },
            }
        ],
    )
