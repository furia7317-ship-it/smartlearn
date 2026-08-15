"""讯飞 IAT WebSocket 语音听写与实时转写会话。"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import websockets

from app.core.config import settings


TranscriptCallback = Callable[[dict[str, Any]], Awaitable[None]]


def is_configured() -> bool:
    """Return whether the shared iFlytek credentials can open an IAT session."""
    return all(
        value.strip()
        for value in (
            settings.IFLYTEK_APPID,
            settings.IFLYTEK_API_KEY,
            settings.IFLYTEK_API_SECRET,
        )
    )


def _build_auth_url(url: str) -> str:
    """构建带鉴权的 WebSocket URL。"""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    path = parsed.path
    now = datetime.now(timezone.utc)
    date = now.strftime("%a, %d %b %Y %H:%M:%S GMT")

    signature_origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    signature_sha = hmac.new(
        settings.IFLYTEK_API_SECRET.encode(),
        signature_origin.encode(),
        hashlib.sha256,
    ).digest()
    signature = base64.b64encode(signature_sha).decode()

    authorization_origin = (
        f'api_key="{settings.IFLYTEK_API_KEY}", '
        f'algorithm="hmac-sha256", '
        f'headers="host date request-line", '
        f'signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode()).decode()

    params = {
        "authorization": authorization,
        "date": date,
        "host": host,
    }
    return f"{url}?{urlencode(params)}"


def _result_text(result: dict[str, Any]) -> str:
    return "".join(
        str(candidate.get("w") or "")
        for word in result.get("ws", [])
        if isinstance(word, dict)
        for candidate in word.get("cw", [])
        if isinstance(candidate, dict)
    )


class IatTranscriptAssembler:
    """Apply iFlytek dynamic-correction packets without duplicating words."""

    def __init__(self) -> None:
        self._segments: dict[int, str] = {}

    @property
    def text(self) -> str:
        return "".join(self._segments[key] for key in sorted(self._segments))

    def apply(self, result: dict[str, Any]) -> str:
        try:
            sequence = int(result.get("sn", len(self._segments)))
        except (TypeError, ValueError):
            sequence = len(self._segments)

        replacement = result.get("rg")
        if result.get("pgs") == "rpl" and isinstance(replacement, list) and len(replacement) == 2:
            try:
                start, end = int(replacement[0]), int(replacement[1])
            except (TypeError, ValueError):
                start, end = sequence, sequence
            for key in range(start, end + 1):
                self._segments.pop(key, None)

        self._segments[sequence] = _result_text(result)
        return self.text


class StreamingIatSession:
    """One upstream IAT connection for a single user utterance."""

    def __init__(
        self,
        *,
        language: str = "zh_cn",
        on_transcript: TranscriptCallback | None = None,
        vad_eos_ms: int = 10_000,
    ) -> None:
        self.language = language
        self.on_transcript = on_transcript
        self.vad_eos_ms = max(1_000, min(30_000, vad_eos_ms))
        self.assembler = IatTranscriptAssembler()
        self._socket: Any = None
        self._receiver: asyncio.Task[None] | None = None
        self._first_frame = True
        self._finished = False

    async def start(self) -> None:
        if not is_configured():
            raise RuntimeError("讯飞语音识别尚未配置")
        if self._socket is not None:
            return
        self._socket = await websockets.connect(
            _build_auth_url(settings.IFLYTEK_IAT_URL),
            ping_interval=20,
            ping_timeout=20,
            close_timeout=2,
            max_size=2**20,
        )
        self._receiver = asyncio.create_task(self._receive_updates())

    def _packet(self, audio: bytes, status: int) -> str:
        payload: dict[str, Any] = {
            "data": {
                "status": status,
                "format": "audio/L16;rate=16000",
                "encoding": "raw",
                "audio": base64.b64encode(audio).decode(),
            }
        }
        if status == 0:
            payload["common"] = {"app_id": settings.IFLYTEK_APPID}
            payload["business"] = {
                "language": self.language,
                "domain": "iat",
                "accent": "mandarin",
                "dwa": "wpgs",
                # Client-side Silero VAD owns endpointing. Keep provider VAD as
                # a bounded safety net instead of letting it cut slow speakers.
                "vad_eos": self.vad_eos_ms,
            }
        return json.dumps(payload, ensure_ascii=False)

    async def send_audio(self, audio: bytes) -> None:
        if self._finished:
            return
        if self._socket is None:
            await self.start()
        if not audio:
            return
        status = 0 if self._first_frame else 1
        self._first_frame = False
        await self._socket.send(self._packet(audio, status))

    async def finish(self) -> str:
        if self._finished:
            return self.assembler.text
        self._finished = True
        if self._socket is None:
            await self.start()
        status = 0 if self._first_frame else 2
        self._first_frame = False
        await self._socket.send(self._packet(b"", status))
        if status == 0:
            await self._socket.send(self._packet(b"", 2))
        if self._receiver is not None:
            await self._receiver
        return self.assembler.text

    async def close(self) -> None:
        self._finished = True
        if self._socket is not None:
            await self._socket.close()
        if self._receiver is not None and not self._receiver.done():
            self._receiver.cancel()
            await asyncio.gather(self._receiver, return_exceptions=True)

    async def _receive_updates(self) -> None:
        if self._socket is None:
            return
        async for message in self._socket:
            response = json.loads(message)
            if response.get("code") != 0:
                raise RuntimeError(f"IAT 错误: {response.get('message', '未知错误')}")
            data = response.get("data") if isinstance(response.get("data"), dict) else {}
            result = data.get("result") if isinstance(data.get("result"), dict) else None
            if result is not None:
                text = self.assembler.apply(result)
                if self.on_transcript is not None:
                    await self.on_transcript(
                        {
                            "type": "transcript",
                            "text": text,
                            "final": data.get("status") == 2,
                        }
                    )
            if data.get("status") == 2:
                break


async def recognize(audio_path: str | Path, language: str = "zh_cn") -> str:
    """Recognize a PCM16 file through the same streaming implementation."""
    audio_data = Path(audio_path).read_bytes()
    session = StreamingIatSession(language=language, vad_eos_ms=10_000)
    await session.start()
    try:
        for offset in range(0, len(audio_data), 1_280):
            await session.send_audio(audio_data[offset : offset + 1_280])
        return await session.finish()
    finally:
        await session.close()


def recognize_sync(audio_path: str | Path, **kwargs: Any) -> str:
    """同步包装。"""
    return asyncio.run(recognize(audio_path, **kwargs))
