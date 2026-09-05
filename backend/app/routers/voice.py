"""Realtime voice conversation transport for the AI teacher."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.iflytek import iat
from app.services.iflytek import tts as iflytek_tts
from app.services.media import mimo_asr, mimo_tts, minimax_tts
from app.services.voice_action import plan_voice_action


router = APIRouter()


class VoiceTtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class VoiceResourceCandidate(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    type: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=240)
    status: str = Field(default="ready", max_length=20)


class VoiceActionRequest(BaseModel):
    utterance: str = Field(min_length=1, max_length=500)
    resources: list[VoiceResourceCandidate] = Field(default_factory=list, max_length=100)


def preferred_tts_provider() -> str | None:
    if minimax_tts.is_configured():
        return "minimax"
    if mimo_tts.is_configured():
        return "mimo"
    if iflytek_tts.is_configured():
        return "iflytek"
    return None


def preferred_asr_provider() -> str | None:
    if mimo_asr.is_configured():
        return "mimo"
    if iat.is_configured():
        return "iflytek"
    return None


@router.get("/status")
async def voice_status() -> dict[str, Any]:
    provider = preferred_tts_provider()
    asr_provider = preferred_asr_provider()
    features = [
        "barge_in",
        "adaptive_endpointing",
        "persistent_call",
        "voice_commands",
        "agent_actions",
    ]
    if asr_provider == "iflytek":
        features.insert(0, "partial_transcript")
    return {
        "asr_ready": asr_provider is not None,
        "asr_provider": asr_provider,
        "tts_ready": provider is not None,
        "tts_provider": provider,
        "sample_rate": 16_000,
        "features": features,
    }


@router.post("/tts")
async def synthesize_voice(req: VoiceTtsRequest):
    """Synthesize one short, cacheable sentence for low-latency playback."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="播报文本不能为空")
    provider = preferred_tts_provider()
    if provider is None:
        raise HTTPException(status_code=503, detail="没有可用的语音合成服务")

    signature = "|".join(
        (
            provider,
            (
                settings.MIMO_TTS_MODEL
                if provider == "mimo"
                else settings.MINIMAX_TTS_MODEL
                if provider == "minimax"
                else settings.IFLYTEK_AVATAR_VCN
            ),
            (
                settings.MIMO_TTS_VOICE
                if provider == "mimo"
                else settings.MINIMAX_TTS_VOICE_ID
                if provider == "minimax"
                else "xiaoyan"
            ),
            text,
        )
    )
    audio_id = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:32]
    suffix = ".wav" if provider == "mimo" else ".mp3"
    output_path = Path(settings.MEDIA_OUTPUT_DIR) / "voice" / f"{audio_id}{suffix}"
    if not output_path.is_file():
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if provider == "mimo":
                await mimo_tts.synthesize(text, output_path)
            elif provider == "minimax":
                await minimax_tts.synthesize(text, output_path)
            else:
                await iflytek_tts.synthesize(text, output_path, voice="xiaoyan")
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return FileResponse(
        output_path,
        media_type="audio/wav" if suffix == ".wav" else "audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Voice-Provider": provider,
        },
    )


@router.post("/action")
async def resolve_voice_action(req: VoiceActionRequest) -> dict[str, Any]:
    """Let the teacher choose one safe UI action from real resource candidates."""
    return await plan_voice_action(
        req.utterance,
        [item.model_dump() for item in req.resources],
    )


@router.websocket("/asr")
async def realtime_asr(websocket: WebSocket) -> None:
    """Recognize browser PCM turns with MiMo, falling back to iFlytek."""
    await websocket.accept()
    send_lock = asyncio.Lock()
    recognizer: mimo_asr.BufferedAsrSession | iat.StreamingIatSession | None = None
    provider = preferred_asr_provider()

    async def send(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    if provider is None:
        await send({"type": "error", "code": "asr_not_configured", "message": "语音识别服务尚未配置"})
        await websocket.close(code=1011)
        return

    try:
        while True:
            event = await websocket.receive()
            if event.get("type") == "websocket.disconnect":
                break
            audio = event.get("bytes")
            if isinstance(audio, bytes):
                if recognizer is not None:
                    await recognizer.send_audio(audio)
                continue

            raw = event.get("text")
            if not isinstance(raw, str):
                continue
            try:
                command = json.loads(raw)
            except json.JSONDecodeError:
                await send({"type": "error", "code": "invalid_message", "message": "语音协议消息无效"})
                continue
            message_type = str(command.get("type") or "")

            if message_type == "start":
                if recognizer is not None:
                    await recognizer.close()
                language = str(command.get("language") or "zh_cn")
                recognizer = (
                    mimo_asr.BufferedAsrSession(language=language)
                    if provider == "mimo"
                    else iat.StreamingIatSession(language=language, on_transcript=send)
                )
                await recognizer.start()
                await send({"type": "ready", "sample_rate": 16_000, "provider": provider})
            elif message_type == "commit" and recognizer is not None:
                final_text = await recognizer.finish()
                await send({"type": "final", "text": final_text})
                await recognizer.close()
                recognizer = None
            elif message_type == "cancel" and recognizer is not None:
                await recognizer.close()
                recognizer = None
                await send({"type": "cancelled"})
            elif message_type == "ping":
                await send({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await send({"type": "error", "code": "asr_failed", "message": str(exc)})
        except Exception:
            pass
    finally:
        if recognizer is not None:
            await recognizer.close()
