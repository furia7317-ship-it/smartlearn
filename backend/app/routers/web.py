from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.web_summary import build_web_summary_payload
from app.services.material_approval import attach_material_approvals

router = APIRouter()


class WebSummaryRequest(BaseModel):
    student_id: str
    url: str = ""
    title: str = ""
    content: str = ""


@router.post("/summarize")
async def summarize_web(req: WebSummaryRequest):
    """内置浏览器当前网页正文 → 学习笔记 + 测验题。"""
    payload = await build_web_summary_payload(req.url, req.title, req.content)
    source_id = req.url or f"web:{req.title[:80]}"
    return attach_material_approvals(
        payload,
        student_id=req.student_id,
        evidence_context=[
            {
                "id": source_id,
                "content": (req.content or req.title)[:6000],
                "metadata": {"title": req.title, "url": req.url},
            }
        ],
    )
