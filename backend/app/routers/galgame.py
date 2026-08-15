"""Document-to-visual-novel endpoints for the desktop resource theater."""

from __future__ import annotations

import asyncio
import hashlib

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.routers.auth import require_account_student_scope
from app.schemas.galgame import GalgameGenerateRequest, GalgameProject
from app.services.galgame import generate_galgame_project


router = APIRouter(dependencies=[Depends(require_account_student_scope)])


@router.post("/attachments")
async def upload_galgame_attachment(file: UploadFile = File(...)):
    from app.services.chat_attachments import AttachmentExtractionError, extract_tutor_attachment

    data = await file.read()
    try:
        payload = await extract_tutor_attachment(
            file.filename or "未命名文件",
            file.content_type or "application/octet-stream",
            data,
        )
    except AttachmentExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload["id"] = f"theater_attachment_{hashlib.sha256(data).hexdigest()[:16]}"
    payload["image_data"] = ""
    return payload


@router.post("/generate", response_model=GalgameProject)
async def generate_galgame(req: GalgameGenerateRequest) -> GalgameProject:
    # LLM SDKs expose a synchronous invoke method here.  Keep that network wait
    # off FastAPI's event loop so health checks, other chats, and media progress
    # remain responsive while a document is being adapted.
    return await asyncio.to_thread(generate_galgame_project, req)
