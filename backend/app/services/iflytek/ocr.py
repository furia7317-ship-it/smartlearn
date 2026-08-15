"""讯飞 OCR — HTTP 通用文字识别。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import settings


def _build_headers() -> dict[str, str]:
    """构建带鉴权的 HTTP 请求头。"""
    now = datetime.utcnow()
    date = now.strftime("%a, %d %b %Y %H:%M:%S GMT")

    signature_origin = f"host: webapi.xfyun.cn\ndate: {date}\nPOST /v1/ai/v1/ocr HTTP/1.1"
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

    return {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": authorization,
        "Date": date,
        "Host": "webapi.xfyun.cn",
    }


def ocr_image(image_data: str | Path, language: str = "cn") -> str:
    """通用 OCR 文字识别。

    Args:
        image_data: base64 编码的图片数据，或图片文件路径
        language: 语言（cn/en）

    Returns:
        识别出的文本
    """
    if isinstance(image_data, Path) or (isinstance(image_data, str) and len(image_data) < 500 and "/" in image_data):
        # 文件路径
        path = Path(image_data)
        with open(path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode()
    elif isinstance(image_data, str):
        # 已经是 base64
        image_b64 = image_data
    else:
        raise ValueError("image_data 必须是 base64 字符串或文件路径")

    headers = _build_headers()
    data = {
        "image": image_b64,
        "language": language,
    }

    resp = httpx.post(
        settings.IFLYTEK_OCR_URL,
        headers=headers,
        data=data,
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()

    if result.get("code") != "0":
        raise RuntimeError(f"OCR 错误: {result.get('desc', '未知错误')}")

    # 提取文本
    text_blocks = []
    for block in result.get("data", {}).get("block", []):
        for line in block.get("line", []):
            text_blocks.append(line.get("text", ""))

    return "\n".join(text_blocks)


async def ocr_image_async(image_data: str | Path, language: str = "cn") -> str:
    """异步 OCR。"""
    if isinstance(image_data, Path) or (isinstance(image_data, str) and len(image_data) < 500 and "/" in image_data):
        path = Path(image_data)
        with open(path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode()
    elif isinstance(image_data, str):
        image_b64 = image_data
    else:
        raise ValueError("image_data 必须是 base64 字符串或文件路径")

    headers = _build_headers()
    data = {
        "image": image_b64,
        "language": language,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            settings.IFLYTEK_OCR_URL,
            headers=headers,
            data=data,
            timeout=30,
        )
    resp.raise_for_status()
    result = resp.json()

    if result.get("code") != "0":
        raise RuntimeError(f"OCR 错误: {result.get('desc', '未知错误')}")

    text_blocks = []
    for block in result.get("data", {}).get("block", []):
        for line in block.get("line", []):
            text_blocks.append(line.get("text", ""))

    return "\n".join(text_blocks)
