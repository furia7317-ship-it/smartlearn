"""Provider adapters recognize attachments before tutor generation."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
from datetime import datetime, timezone

import pytest
from PIL import Image

from app.core.config import settings
from app.services.chat_attachments import extract_tutor_attachment
from app.services.iflytek import recognition


def _sample_png() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (320, 180), "white").save(output, format="PNG")
    return output.getvalue()


def test_pdf_signature_matches_documented_md5_hmac_sha1() -> None:
    timestamp = 1_700_000_000
    headers = recognition._pdf_headers("app-id", "secret", timestamp)
    auth = hashlib.md5(f"app-id{timestamp}".encode()).hexdigest()  # noqa: S324 - provider protocol
    expected = base64.b64encode(hmac.new(b"secret", auth.encode(), hashlib.sha1).digest()).decode()  # noqa: S324
    assert headers == {"appId": "app-id", "timestamp": str(timestamp), "signature": expected}


def test_image_auth_url_contains_only_short_lived_signature_parameters() -> None:
    url = recognition._build_ws_auth_url(
        "wss://spark-api.cn-huabei-1.xf-yun.com/v2.1/image",
        "api-key",
        "api-secret",
        now=datetime(2026, 7, 18, tzinfo=timezone.utc),
    )
    assert url.startswith("wss://spark-api.cn-huabei-1.xf-yun.com/v2.1/image?")
    assert "authorization=" in url
    assert "api-secret" not in url


@pytest.mark.asyncio
async def test_image_understanding_stream_is_collected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "IFLYTEK_VISION_APPID", "app-id")
    monkeypatch.setattr(settings, "IFLYTEK_VISION_API_KEY", "api-key")
    monkeypatch.setattr(settings, "IFLYTEK_VISION_API_SECRET", "api-secret")
    sent: dict = {}

    class FakeSocket:
        def __init__(self) -> None:
            self.messages = iter(
                [
                    json.dumps(
                        {
                            "header": {"code": 0, "status": 2},
                            "payload": {
                                "choices": {
                                    "status": 2,
                                    "text": [{"content": "图中题目为：1 + 1 = ?"}],
                                }
                            },
                        }
                    )
                ]
            )

        async def send(self, value: str) -> None:
            sent.update(json.loads(value))

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self.messages)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    class FakeConnection:
        async def __aenter__(self):
            return FakeSocket()

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(recognition.websockets, "connect", lambda *_args, **_kwargs: FakeConnection())
    result = await recognition.recognize_image(_sample_png())
    assert "1 + 1" in result
    messages = sent["payload"]["message"]["text"]
    assert messages[0]["content_type"] == "image"
    assert "不回答或求解" in messages[1]["content"]


@pytest.mark.asyncio
async def test_tutor_image_bypasses_iflytek_and_keeps_native_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def forbidden_recognize(_data: bytes) -> str:
        raise AssertionError("tutor image upload must not call the legacy image-understanding service")

    monkeypatch.setattr(recognition, "recognize_image", forbidden_recognize)
    payload = await extract_tutor_attachment("question.png", "image/png", _sample_png())
    assert payload["recognition_status"] == "native"
    assert payload["recognition_provider"] == "mimo-v2.5-native"
    assert payload["media_type"] == "image/png"
    assert payload["extracted_text"] == ""
    assert base64.b64decode(payload["image_data"]).startswith(b"\x89PNG")


@pytest.mark.asyncio
async def test_tutor_pdf_prefers_cloud_markdown(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_recognize(_name: str, _data: bytes) -> str:
        return "# 第 1 页\n\n公式：$E=mc^2$"

    monkeypatch.setattr(recognition, "recognize_pdf", fake_recognize)
    payload = await extract_tutor_attachment("notes.pdf", "application/pdf", b"%PDF-cloud-test")
    assert payload["recognition_status"] == "recognized"
    assert payload["recognition_provider"] == "iflytek-pdf-ocr"
    assert "E=mc^2" in payload["extracted_text"]


def test_pdf_result_download_rejects_untrusted_hosts() -> None:
    with pytest.raises(recognition.AttachmentRecognitionError, match="未受信任"):
        recognition._validated_result_url("http://127.0.0.1/private")
