"""One-time MiniMax voice-clone provisioning helpers."""

from __future__ import annotations

import re
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings


_ALLOWED_SUFFIXES = {".mp3", ".m4a", ".wav"}
_VOICE_ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$")


@dataclass(frozen=True)
class CloneAudioInfo:
    path: Path
    size_bytes: int
    duration_seconds: float | None


def validate_voice_id(voice_id: str) -> str:
    normalized = voice_id.strip()
    if not _VOICE_ID_PATTERN.fullmatch(normalized):
        raise ValueError("MiniMax voice_id 必须为 8-256 位，以字母开头，且只能包含字母、数字、-、_")
    return normalized


def inspect_clone_audio(path: str | Path) -> CloneAudioInfo:
    audio_path = Path(path).expanduser().resolve()
    if not audio_path.is_file():
        raise FileNotFoundError(f"克隆音频不存在：{audio_path}")
    if audio_path.suffix.lower() not in _ALLOWED_SUFFIXES:
        raise ValueError("MiniMax 克隆音频仅支持 mp3、m4a、wav")
    size_bytes = audio_path.stat().st_size
    if size_bytes > 20 * 1024 * 1024:
        raise ValueError("MiniMax 克隆音频不能超过 20 MB")

    duration_seconds: float | None = None
    if audio_path.suffix.lower() == ".wav":
        with wave.open(str(audio_path), "rb") as stream:
            duration_seconds = stream.getnframes() / stream.getframerate()
        if not 10 <= duration_seconds <= 300:
            raise ValueError("MiniMax 克隆音频时长必须在 10 秒到 5 分钟之间")
    return CloneAudioInfo(audio_path, size_bytes, duration_seconds)


def _raise_for_provider_error(payload: Any, fallback: str) -> None:
    base_resp = payload.get("base_resp") if isinstance(payload, dict) else None
    if isinstance(base_resp, dict) and int(base_resp.get("status_code") or 0) != 0:
        raise RuntimeError(str(base_resp.get("status_msg") or fallback))


async def clone_voice(source_path: str | Path, voice_id: str, *, model: str | None = None) -> str:
    if not settings.MINIMAX_API_KEY.strip():
        raise RuntimeError("缺少 MINIMAX_API_KEY，无法创建克隆音色")
    audio = inspect_clone_audio(source_path)
    normalized_voice_id = validate_voice_id(voice_id)
    headers = {"Authorization": f"Bearer {settings.MINIMAX_API_KEY.strip()}"}
    params = {"GroupId": settings.MINIMAX_GROUP_ID.strip()} if settings.MINIMAX_GROUP_ID.strip() else None

    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
        with audio.path.open("rb") as stream:
            upload_response = await client.post(
                settings.MINIMAX_VOICE_CLONE_UPLOAD_URL,
                headers=headers,
                params=params,
                data={"purpose": "voice_clone"},
                files={"file": (audio.path.name, stream)},
            )
        upload_response.raise_for_status()
        upload_payload = upload_response.json()
        _raise_for_provider_error(upload_payload, "MiniMax 上传克隆音频失败")
        try:
            file_id = int(upload_payload["file"]["file_id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("MiniMax 未返回克隆文件 ID") from exc

        clone_response = await client.post(
            settings.MINIMAX_VOICE_CLONE_URL,
            headers={**headers, "Content-Type": "application/json"},
            params=params,
            json={
                "file_id": file_id,
                "voice_id": normalized_voice_id,
                "model": model or settings.MINIMAX_TTS_MODEL,
                "need_noise_reduction": True,
                "need_volume_normalization": True,
            },
        )
        clone_response.raise_for_status()
        clone_payload = clone_response.json()
        _raise_for_provider_error(clone_payload, "MiniMax 音色克隆失败")
    return normalized_voice_id
