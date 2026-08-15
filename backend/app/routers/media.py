"""媒体路由 — 视频/PPT 生成与下载。"""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.sse import sse_format
from app.schemas.media import (
    PptRequest,
    PptResponse,
    VideoRequest,
    VideoTaskResponse,
)
from app.services.media.task import media_task_manager
from app.services.iflytek.tts import is_configured as tts_is_configured, synthesize

router = APIRouter()


def _script_from_slides(topic: str, slides: list[dict[str, Any]]) -> dict[str, Any]:
    """Wrap a frontend slide list into the renderer's courseware script shape."""
    return {
        "title": topic,
        "slides": slides,
        "total_slides": len(slides),
    }


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    voice: str = "xiaoyan"


@router.post("/tts")
async def create_tts(req: TtsRequest):
    """合成并缓存短文本语音。"""
    if not tts_is_configured():
        raise HTTPException(status_code=503, detail="TTS 密钥尚未配置")
    tts_id = hashlib.md5(req.text.encode("utf-8")).hexdigest()
    output_path = Path(settings.MEDIA_OUTPUT_DIR) / "tts" / f"{tts_id}.mp3"
    if not output_path.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            await synthesize(req.text, output_path, voice=req.voice)
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"tts_id": tts_id}


@router.get("/tts/{tts_id}/file")
async def download_tts(tts_id: str):
    """返回已缓存的 MP3。"""
    if re.fullmatch(r"[0-9a-f]{32}", tts_id) is None:
        raise HTTPException(status_code=404, detail="语音不存在")
    output_path = Path(settings.MEDIA_OUTPUT_DIR) / "tts" / f"{tts_id}.mp3"
    if not output_path.is_file():
        raise HTTPException(status_code=404, detail="语音不存在")
    return FileResponse(output_path, media_type="audio/mpeg", filename=f"{tts_id}.mp3")


async def _task_progress_stream(task_id: str):
    """通用任务进度 SSE 流。"""
    while True:
        p = media_task_manager.get_progress(task_id)
        if p is None:
            missing = {
                "id": task_id,
                "status": "failed",
                "progress": 0.0,
                "error": "媒体任务状态已丢失",
                "render_stage": "failed",
            }
            yield sse_format("progress", missing)
            yield sse_format("done", missing)
            break

        yield sse_format("progress", p)

        if p["status"] in ("completed", "failed"):
            yield sse_format("done", p)
            break

        await asyncio.sleep(1)


@router.post("/video", response_model=VideoTaskResponse)
async def create_video(req: VideoRequest):
    """创建视频渲染任务。"""
    script = req.script
    if not script:
        from app.agents.video import generate

        state = {
            "topic": req.topic,
            "student_id": req.student_id,
            "kb_context": [],
        }
        script = generate(state)

    task_id = media_task_manager.create_task(
        student_id=req.student_id,
        kind="video",
        topic=req.topic,
        script=script,
    )
    return VideoTaskResponse(task_id=task_id)


@router.get("/video/{task_id}")
async def get_video_progress(task_id: str):
    """获取视频渲染进度（SSE）。"""
    progress = media_task_manager.get_progress(task_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    return StreamingResponse(_task_progress_stream(task_id), media_type="text/event-stream")


@router.get("/video/{task_id}/snapshot")
async def get_video_progress_snapshot(task_id: str):
    """Return progress without silently restarting CPU-intensive rendering."""

    progress = media_task_manager.peek_progress(task_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        **progress,
        "active": media_task_manager.is_active(task_id),
        "resumable": progress.get("status") not in {"completed", "failed"},
    }


@router.post("/video/{task_id}/resume")
async def resume_video(task_id: str):
    """Resume an interrupted video only after the learner confirms it."""

    progress = media_task_manager.resume_video(task_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        **progress,
        "active": media_task_manager.is_active(task_id),
    }


@router.get("/video/{task_id}/file")
async def download_video(task_id: str):
    """下载视频文件。"""
    progress = media_task_manager.get_progress(task_id)
    if progress is None or progress["status"] != "completed":
        raise HTTPException(status_code=404, detail="视频未就绪")

    file_path = progress.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="文件路径不存在")

    output = Path(file_path)
    if not output.is_file() or output.suffix.lower() != ".mp4":
        raise HTTPException(status_code=404, detail="视频文件不存在")

    return FileResponse(output, media_type="video/mp4", filename=f"{task_id}.mp4")


@router.get("/ppt/templates")
async def list_ppt_templates_endpoint(
    style: str | None = None, page: int = 1, size: int = 24
):
    """PPT 模板列表。配了讯飞智文就返回它的成品模板（带缩略图，供图片模板墙）；
    否则回落到内置主题。"""
    from app.services.iflytek import zhiwen

    if zhiwen.is_configured():
        try:
            data = await asyncio.to_thread(
                zhiwen.list_templates, page=page, size=size, style=style
            )
            return {"provider": "zhiwen", **data}
        except Exception:
            pass  # 智文异常 → 回落内置
    from app.services.media.ppt import list_ppt_templates

    return {"provider": "builtin", "templates": list_ppt_templates()}


class AipptRequest(BaseModel):
    """POST /api/media/ppt/aippt —— 讯飞智文真·PPT 生成。"""

    query: str = Field(min_length=1, max_length=8000)  # 生成要求（主题/大纲文本）
    template_id: str = ""
    author: str = "学枢"


@router.post("/ppt/aippt")
async def create_aippt(req: AipptRequest):
    """用讯飞智文按模板生成成品 PPT，返回 sid（再轮询 progress 取 pptUrl）。"""
    from app.services.iflytek import zhiwen

    if not zhiwen.is_configured():
        raise HTTPException(status_code=400, detail="讯飞智文未配置（backend/.env 的 IFLYTEK_APPID/API_SECRET）")
    try:
        res = await asyncio.to_thread(
            zhiwen.create, req.query, req.template_id, author=req.author
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)[:200]) from exc
    if not res.get("sid"):
        raise HTTPException(status_code=502, detail="智文未返回 sid")
    return res


@router.get("/ppt/aippt/{sid}")
async def aippt_progress(sid: str):
    """查询智文生成进度，done 时带 ppt_url（成品 .pptx）。"""
    from app.services.iflytek import zhiwen

    try:
        p = await asyncio.to_thread(zhiwen.progress, sid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)[:200]) from exc
    raw = p.get("status")
    norm = "completed" if raw == "done" else "failed" if raw == "build_failed" else "rendering"
    total, done = p.get("total") or 0, p.get("done") or 0
    return {
        "sid": sid,
        "status": norm,
        "raw_status": raw,
        "progress": round(done / total, 3) if total else (1.0 if norm == "completed" else 0.0),
        "ppt_url": p.get("ppt_url"),
    }


@router.post("/ppt", response_model=PptResponse)
async def create_ppt(req: PptRequest):
    """创建 PPT。"""
    if req.slides:
        script = _script_from_slides(req.topic, req.slides)
    else:
        from app.agents.courseware import generate

        state = {
            "topic": req.topic,
            "student_id": req.student_id,
            "kb_context": [],
        }
        script = generate(state)

    # 显式指定的模板覆盖大纲里生成器选的
    if req.template:
        script["template"] = req.template

    task_id = media_task_manager.create_task(
        student_id=req.student_id,
        kind="ppt",
        topic=req.topic,
        script=script,
    )
    return PptResponse(task_id=task_id)


@router.get("/ppt/{task_id}")
async def get_ppt_progress(task_id: str):
    """获取 PPT 渲染进度（SSE）。"""
    progress = media_task_manager.get_progress(task_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    return StreamingResponse(_task_progress_stream(task_id), media_type="text/event-stream")


@router.get("/ppt/{task_id}/file")
async def download_ppt(task_id: str):
    """下载 PPT 文件。"""
    progress = media_task_manager.get_progress(task_id)
    if progress is None or progress["status"] != "completed":
        raise HTTPException(status_code=404, detail="PPT 未就绪")

    file_path = progress.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="文件路径不存在")

    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{task_id}.pptx",
    )


class OcrRequest(BaseModel):
    image_data: str


@router.post("/ocr")
async def ocr_endpoint(req: OcrRequest):
    """OCR 文字识别。"""
    from app.services.iflytek.ocr import ocr_image_async

    text = await ocr_image_async(req.image_data)
    return {"text": text}
