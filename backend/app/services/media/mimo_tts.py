"""Xiaomi MiMo V2.5 speech synthesis for educational narration."""

from __future__ import annotations

import asyncio
import base64
import binascii
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings


_MAX_ATTEMPTS = 3
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


@dataclass(frozen=True)
class MiMoSynthesis:
    path: Path


def is_configured() -> bool:
    return settings.MIMO_TTS_ENABLED and bool(settings.MIMO_API_KEY.strip())


def _endpoint() -> str:
    base_url = settings.MIMO_TTS_BASE_URL.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def build_request_payload(text: str) -> dict[str, Any]:
    """Build the MiMo chat-completions payload used by the official TTS API."""

    messages: list[dict[str, str]] = []
    style = settings.MIMO_TTS_STYLE.strip()
    if style:
        messages.append({"role": "user", "content": style})
    messages.append({"role": "assistant", "content": text})
    return {
        "model": settings.MIMO_TTS_MODEL,
        "messages": messages,
        "audio": {
            "format": "wav",
            "voice": settings.MIMO_TTS_VOICE,
        },
    }


def decode_audio_payload(payload: Any) -> bytes:
    """Decode choices[0].message.audio.data from a MiMo response."""

    try:
        audio = payload["choices"][0]["message"]["audio"]
        encoded = audio["data"] if isinstance(audio, dict) else ""
    except (KeyError, IndexError, TypeError):
        encoded = ""
    if not isinstance(encoded, str) or not encoded.strip():
        raise RuntimeError("MiMo TTS 未返回音频数据")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RuntimeError("MiMo TTS 音频编码无效") from exc
    if not decoded:
        raise RuntimeError("MiMo TTS 返回了空音频")
    return decoded


async def synthesize(text: str, output_path: str | Path) -> MiMoSynthesis:
    if not is_configured():
        raise RuntimeError("MiMo TTS 尚未配置")
    if not text.strip():
        raise ValueError("MiMo TTS 文本不能为空")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    headers = {
        "api-key": settings.MIMO_API_KEY.strip(),
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        response: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await client.post(
                    _endpoint(),
                    headers=headers,
                    json=build_request_payload(text),
                )
                response.raise_for_status()
                break
            except httpx.HTTPStatusError as exc:
                if (
                    exc.response.status_code not in _RETRYABLE_STATUS_CODES
                    or attempt == _MAX_ATTEMPTS - 1
                ):
                    raise
            except httpx.TransportError:
                if attempt == _MAX_ATTEMPTS - 1:
                    raise
            await asyncio.sleep(0.35 * (2**attempt))
        if response is None:
            raise RuntimeError("MiMo TTS 请求未返回结果")
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError("MiMo TTS 返回格式无效") from exc
    output_path.write_bytes(decode_audio_payload(payload))
    return MiMoSynthesis(path=output_path)
