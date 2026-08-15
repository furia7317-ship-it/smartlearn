"""iFlytek image understanding and PDF OCR adapters.

Long-lived credentials stay in the backend.  The attachment upload route uses
these adapters before a file is allowed into the tutor context.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import time
import zipfile
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
import websockets
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings


_IMAGE_PROMPT = (
    "请完整识别并描述这张学习附件。逐项转写其中的文字、代码、数学公式、表格、图表标签和题目选项，"
    "并补充解题所需的关键视觉关系。保留原有结构，使用 Markdown；此步只做客观识别，不回答或求解题目。"
)
_ALLOWED_DOWNLOAD_HOST_SUFFIXES = (".xfyun.cn", ".openstorage.cn")
_IMAGE_REQUEST_LOCK = asyncio.Lock()


class AttachmentRecognitionError(RuntimeError):
    """A sanitized provider failure safe to surface to the upload route."""


def _first_non_empty(*values: str) -> str:
    return next((value.strip() for value in values if value and value.strip()), "")


def _vision_credentials() -> tuple[str, str, str]:
    return (
        _first_non_empty(settings.IFLYTEK_VISION_APPID, settings.IFLYTEK_AVATAR_APPID, settings.IFLYTEK_APPID),
        _first_non_empty(settings.IFLYTEK_VISION_API_KEY, settings.IFLYTEK_AVATAR_API_KEY, settings.IFLYTEK_API_KEY),
        _first_non_empty(
            settings.IFLYTEK_VISION_API_SECRET,
            settings.IFLYTEK_AVATAR_API_SECRET,
            settings.IFLYTEK_API_SECRET,
        ),
    )


def _pdf_credentials() -> tuple[str, str]:
    return (
        _first_non_empty(settings.IFLYTEK_PDF_OCR_APPID, settings.IFLYTEK_AVATAR_APPID, settings.IFLYTEK_APPID),
        _first_non_empty(
            settings.IFLYTEK_PDF_OCR_API_SECRET,
            settings.IFLYTEK_AVATAR_API_SECRET,
            settings.IFLYTEK_API_SECRET,
        ),
    )


def image_understanding_is_configured() -> bool:
    return all(_vision_credentials())


def pdf_ocr_is_configured() -> bool:
    return all(_pdf_credentials())


def _build_ws_auth_url(
    url: str,
    api_key: str,
    api_secret: str,
    *,
    now: datetime | None = None,
) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "wss" or not parsed.hostname or not parsed.path:
        raise AttachmentRecognitionError("图片识别服务地址配置无效")
    date = format_datetime(now or datetime.now(timezone.utc), usegmt=True)
    signature_origin = f"host: {parsed.hostname}\ndate: {date}\nGET {parsed.path} HTTP/1.1"
    digest = hmac.new(api_secret.encode("utf-8"), signature_origin.encode("utf-8"), hashlib.sha256).digest()
    signature = base64.b64encode(digest).decode("ascii")
    authorization_origin = (
        f'api_key="{api_key}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    query = urlencode(
        {
            "authorization": base64.b64encode(authorization_origin.encode("utf-8")).decode("ascii"),
            "date": date,
            "host": parsed.hostname,
        }
    )
    return f"{url}?{query}"


def _prepare_image(image_bytes: bytes) -> str:
    """Normalize every accepted browser image to a bounded JPEG payload."""

    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise AttachmentRecognitionError("图片文件已损坏或格式无法识别") from exc

    width, height = image.size
    if width < 51 or height < 51:
        scale = max(51 / max(width, 1), 51 / max(height, 1))
        image = image.resize((max(51, round(width * scale)), max(51, round(height * scale))))
    if max(image.size) > 5_800:
        image.thumbnail((5_800, 5_800))

    quality = 90
    while True:
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True)
        payload = output.getvalue()
        if len(payload) <= 3_800_000:
            return base64.b64encode(payload).decode("ascii")
        if quality > 55:
            quality -= 10
            continue
        image.thumbnail((max(640, int(image.width * 0.8)), max(640, int(image.height * 0.8))))
        if image.width <= 640 and image.height <= 640:
            raise AttachmentRecognitionError("图片压缩后仍超过识别服务的 4MB 限制")


def _image_request(app_id: str, image_base64: str, uid: str) -> dict[str, Any]:
    return {
        "header": {"app_id": app_id, "uid": uid},
        "parameter": {
            "chat": {
                "domain": "imagev3",
                "temperature": 0.1,
                "top_k": 1,
                "max_tokens": 4096,
            }
        },
        "payload": {
            "message": {
                "text": [
                    {"role": "user", "content": image_base64, "content_type": "image"},
                    {"role": "user", "content": _IMAGE_PROMPT, "content_type": "text"},
                ]
            }
        },
    }


async def recognize_image(image_bytes: bytes) -> str:
    """Return a structured transcription/description from Spark image understanding."""

    app_id, api_key, api_secret = _vision_credentials()
    if not (app_id and api_key and api_secret):
        raise AttachmentRecognitionError("图片识别尚未配置，请在后端配置讯飞图片理解凭据")
    image_base64 = await asyncio.to_thread(_prepare_image, image_bytes)
    uid = f"smartlearn-{hashlib.sha256(image_bytes).hexdigest()[:20]}"
    signed_url = _build_ws_auth_url(settings.IFLYTEK_VISION_URL, api_key, api_secret)
    chunks: list[str] = []

    async def exchange() -> None:
        async with websockets.connect(
            signed_url,
            open_timeout=15,
            close_timeout=5,
            max_size=4 * 1024 * 1024,
        ) as socket:
            await socket.send(json.dumps(_image_request(app_id, image_base64, uid), ensure_ascii=False))
            async for message in socket:
                payload = json.loads(message)
                header = payload.get("header") or {}
                code = int(header.get("code") or 0)
                if code:
                    raise AttachmentRecognitionError(f"图片识别失败（服务码 {code}）")
                choices = (payload.get("payload") or {}).get("choices") or {}
                for item in choices.get("text") or []:
                    content = str(item.get("content") or "")
                    if content:
                        chunks.append(content)
                if int(choices.get("status") or header.get("status") or 0) == 2:
                    break

    try:
        async with _IMAGE_REQUEST_LOCK:
            await asyncio.wait_for(exchange(), timeout=75)
    except AttachmentRecognitionError:
        raise
    except (TimeoutError, asyncio.TimeoutError) as exc:
        raise AttachmentRecognitionError("图片识别超时，请稍后重试") from exc
    except Exception as exc:  # noqa: BLE001 - never expose signed URLs or credentials
        raise AttachmentRecognitionError(f"图片识别服务连接失败（{type(exc).__name__}）") from exc
    result = "".join(chunks).strip()
    if not result:
        raise AttachmentRecognitionError("图片识别服务没有返回可读内容")
    return result


def _pdf_headers(app_id: str, api_secret: str, timestamp: int) -> dict[str, str]:
    auth = hashlib.md5(f"{app_id}{timestamp}".encode("utf-8")).hexdigest()  # noqa: S324 - provider protocol
    digest = hmac.new(api_secret.encode("utf-8"), auth.encode("utf-8"), hashlib.sha1).digest()  # noqa: S324
    return {
        "appId": app_id,
        "timestamp": str(timestamp),
        "signature": base64.b64encode(digest).decode("ascii"),
    }


def _decode_text_payload(data: bytes) -> str:
    if data.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                candidates = sorted(
                    (name for name in archive.namelist() if name.lower().endswith((".md", ".markdown", ".txt"))),
                    key=lambda name: (not name.lower().endswith((".md", ".markdown")), len(name)),
                )
                if candidates:
                    data = archive.read(candidates[0])
        except (zipfile.BadZipFile, KeyError) as exc:
            raise AttachmentRecognitionError("PDF 识别结果压缩包无法读取") from exc
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace").strip()


def _validated_result_url(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not host:
        raise AttachmentRecognitionError("PDF 识别结果地址无效")
    if not any(host == suffix[1:] or host.endswith(suffix) for suffix in _ALLOWED_DOWNLOAD_HOST_SUFFIXES):
        raise AttachmentRecognitionError("PDF 识别结果来自未受信任的下载域名")
    return value


async def recognize_pdf(filename: str, pdf_bytes: bytes) -> str:
    """Upload a PDF OCR task, poll at the documented 5-second interval, and fetch Markdown."""

    app_id, api_secret = _pdf_credentials()
    if not (app_id and api_secret):
        raise AttachmentRecognitionError("PDF 识别尚未配置，请在后端配置讯飞 PDF OCR 凭据")
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        if reader.is_encrypted:
            raise AttachmentRecognitionError("暂不支持带密码或权限保护的 PDF")
        if len(reader.pages) > 100:
            raise AttachmentRecognitionError("PDF 超过 100 页，请按章节拆分后上传")
    except AttachmentRecognitionError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AttachmentRecognitionError("PDF 文件已损坏或格式无法识别") from exc
    timeout_seconds = max(30, min(settings.IFLYTEK_PDF_OCR_TIMEOUT_SECONDS, 300))
    deadline = time.monotonic() + timeout_seconds
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        timestamp = int(time.time())
        try:
            response = await client.post(
                settings.IFLYTEK_PDF_OCR_START_URL,
                headers=_pdf_headers(app_id, api_secret, timestamp),
                data={"exportFormat": "markdown"},
                files={"file": (filename, pdf_bytes, "application/pdf")},
            )
            response.raise_for_status()
            start_payload = response.json()
        except Exception as exc:  # noqa: BLE001
            raise AttachmentRecognitionError(f"PDF 识别任务提交失败（{type(exc).__name__}）") from exc
        if not start_payload.get("flag") or int(start_payload.get("code") or 0) != 0:
            code = int(start_payload.get("code") or 0)
            raise AttachmentRecognitionError(f"PDF 识别任务提交失败（服务码 {code}）")
        task_no = str((start_payload.get("data") or {}).get("taskNo") or "").strip()
        if not task_no:
            raise AttachmentRecognitionError("PDF 识别任务未返回任务号")

        while time.monotonic() < deadline:
            await asyncio.sleep(5)
            timestamp = int(time.time())
            try:
                response = await client.get(
                    settings.IFLYTEK_PDF_OCR_STATUS_URL,
                    headers=_pdf_headers(app_id, api_secret, timestamp),
                    params={"taskNo": task_no},
                )
                response.raise_for_status()
                status_payload = response.json()
            except Exception as exc:  # noqa: BLE001
                raise AttachmentRecognitionError(f"PDF 识别状态查询失败（{type(exc).__name__}）") from exc
            data = status_payload.get("data") or {}
            status = str(data.get("status") or "").upper()
            if status in {"FAILED", "ANY_FAILED", "STOP"}:
                raise AttachmentRecognitionError(f"PDF 识别任务未完成（{status}）")
            if status != "FINISH":
                continue
            result_url = _validated_result_url(str(data.get("downUrl") or ""))
            try:
                result_response = await client.get(result_url)
                result_response.raise_for_status()
            except Exception as exc:  # noqa: BLE001
                raise AttachmentRecognitionError(f"PDF 识别结果下载失败（{type(exc).__name__}）") from exc
            result = _decode_text_payload(result_response.content)
            if not result:
                raise AttachmentRecognitionError("PDF 识别服务没有返回可读内容")
            return result
    raise AttachmentRecognitionError("PDF 识别超时；可稍后重试或拆分文档后上传")
