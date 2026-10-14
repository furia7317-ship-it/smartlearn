"""Buffered Xiaomi MiMo V2.5 speech recognition for realtime voice turns."""

from __future__ import annotations

import asyncio
import base64
import io
import wave
from typing import Any

import httpx

from app.core.config import settings


_MAX_ATTEMPTS = 3
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
_SAMPLE_RATE = 16_000
_SAMPLE_WIDTH = 2
_CHANNELS = 1


def is_configured() -> bool:
    return settings.MIMO_ASR_ENABLED and bool(settings.MIMO_API_KEY.strip())


def _endpoint() -> str:
    base_url = settings.MIMO_ASR_BASE_URL.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def pcm16_to_wav(pcm: bytes) -> bytes:
    """Wrap mono 16 kHz PCM frames in the WAV container required by MiMo."""

    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(_CHANNELS)
        stream.setsampwidth(_SAMPLE_WIDTH)
        stream.setframerate(_SAMPLE_RATE)
        stream.writeframes(pcm)
    return output.getvalue()


def build_request_payload(wav_audio: bytes, *, language: str = "auto") -> dict[str, Any]:
    normalized_language = language if language in {"auto", "zh", "en"} else "auto"
    encoded = base64.b64encode(wav_audio).decode("ascii")
    return {
        "model": settings.MIMO_ASR_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": f"data:audio/wav;base64,{encoded}",
                        },
                    }
                ],
            }
        ],
        "asr_options": {"language": normalized_language},
    }


def extract_transcript(payload: Any) -> str:
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("MiMo ASR 未返回识别文本") from exc
    if not isinstance(content, str):
        raise RuntimeError("MiMo ASR 返回格式无效")
    return content.strip()


async def transcribe_pcm(pcm: bytes, *, language: str = "auto") -> str:
    if not is_configured():
        raise RuntimeError("MiMo ASR 尚未配置")
    if not pcm:
        return ""

    headers = {
        "api-key": settings.MIMO_API_KEY.strip(),
        "Content-Type": "application/json",
    }
    payload = build_request_payload(pcm16_to_wav(pcm), language=language)
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        response: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await client.post(_endpoint(), headers=headers, json=payload)
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
            raise RuntimeError("MiMo ASR 请求未返回结果")
        try:
            result = response.json()
        except ValueError as exc:
            raise RuntimeError("MiMo ASR 返回格式无效") from exc
    return extract_transcript(result)


class BufferedAsrSession:
    """Collect one browser utterance, then submit a single WAV to MiMo ASR."""

    def __init__(self, *, language: str = "auto") -> None:
        configured_language = settings.MIMO_ASR_LANGUAGE.strip().lower() or "auto"
        requested_language = {"zh_cn": "zh", "zh": "zh", "en_us": "en", "en": "en"}.get(
            language.strip().lower(),
            configured_language,
        )
        self.language = requested_language if requested_language in {"auto", "zh", "en"} else "auto"
        self._audio = bytearray()
        self._closed = False
        self._max_bytes = max(1, settings.MIMO_ASR_MAX_SECONDS) * _SAMPLE_RATE * _SAMPLE_WIDTH

    async def start(self) -> None:
        if not is_configured():
            raise RuntimeError("MiMo ASR 尚未配置")

    async def send_audio(self, chunk: bytes) -> None:
        if self._closed:
            return
        if len(self._audio) + len(chunk) > self._max_bytes:
            raise RuntimeError(f"单次语音不能超过 {settings.MIMO_ASR_MAX_SECONDS} 秒")
        self._audio.extend(chunk)

    async def finish(self) -> str:
        if self._closed:
            return ""
        return await transcribe_pcm(bytes(self._audio), language=self.language)

    async def close(self) -> None:
        self._closed = True
        self._audio.clear()
