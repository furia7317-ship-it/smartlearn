"""讯飞 TTS — WebSocket 流式语音合成。"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
import websockets

from app.core.config import settings


def is_configured() -> bool:
    """Return whether all credentials required by the TTS service are present."""

    return settings.IFLYTEK_TTS_ENABLED and all(
        value.strip()
        for value in (
            settings.IFLYTEK_APPID,
            settings.IFLYTEK_API_KEY,
            settings.IFLYTEK_API_SECRET,
        )
    )


def _build_auth_url(url: str) -> str:
    """构建带鉴权的 WebSocket URL（HMAC-SHA256 签名）。"""
    parsed = urlparse(url)
    host = parsed.hostname
    path = parsed.path
    now = datetime.utcnow()
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


async def synthesize(
    text: str,
    output_path: str | Path,
    voice: str = "xiaoyan",
    speed: int = 50,
    volume: int = 50,
) -> Path:
    """异步 TTS 合成，输出音频文件。

    Args:
        text: 要合成的文本
        output_path: 输出文件路径
        voice: 发音人（xiaoyan/xiaoyu/yufeng 等）
        speed: 语速 0-100
        volume: 音量 0-100

    Returns:
        输出文件路径
    """
    if not is_configured():
        raise RuntimeError("TTS 密钥尚未配置")
    url = _build_auth_url(settings.IFLYTEK_TTS_URL)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    request_data = {
        "common": {"app_id": settings.IFLYTEK_APPID},
        "business": {
            "aue": "lame",  # mp3
            "auf": "audio/L16;rate=16000",
            "vcn": voice,
            "speed": speed,
            "volume": volume,
        },
        "data": {
            "status": 2,
            "text": base64.b64encode(text.encode()).decode(),
        },
    }

    async with websockets.connect(url) as ws:
        await ws.send(json.dumps(request_data))

        audio_data = b""
        async for msg in ws:
            resp = json.loads(msg)
            if resp.get("code") != 0:
                raise RuntimeError(f"TTS 错误: {resp.get('message', '未知错误')}")

            audio_chunk = resp.get("data", {}).get("audio", "")
            if audio_chunk:
                audio_data += base64.b64decode(audio_chunk)

            if resp.get("data", {}).get("status") == 2:
                break

    output_path.write_bytes(audio_data)
    return output_path


def synthesize_sync(text: str, output_path: str | Path, **kwargs) -> Path:
    """同步包装。"""
    return asyncio.run(synthesize(text, output_path, **kwargs))
