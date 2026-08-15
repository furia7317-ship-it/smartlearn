"""Security contract for the public avatar configuration endpoint."""

from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_avatar_config_never_returns_long_lived_credentials(monkeypatch):
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_API_KEY", "key-value")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_API_SECRET", "secret-value")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_APPID", "app-id")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_ID", "avatar-id")

    body = TestClient(app).get("/api/avatar/config").json()

    assert body["configured"] is True
    assert body["appId"] == "app-id"
    assert body["signedUrl"].startswith(
        "wss://avatar.cn-huadong-1.xf-yun.com/v1/interact?"
    )
    query = parse_qs(urlparse(body["signedUrl"]).query)
    assert {"authorization", "date", "host"} <= query.keys()
    assert "secret-value" not in body["signedUrl"]
    assert "key-value" not in body["signedUrl"]
    assert "apiKey" not in body
    assert "apiSecret" not in body


def test_avatar_config_stays_disabled_when_credentials_are_incomplete(monkeypatch):
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_API_KEY", "")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_API_SECRET", "secret-value")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_APPID", "app-id")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_ID", "avatar-id")

    body = TestClient(app).get("/api/avatar/config").json()

    assert body["configured"] is False
    assert body["signedUrl"] == ""
    assert body["appId"] == ""


def test_backend_startup_does_not_seed_a_shared_sample_identity():
    app_root = Path(__file__).resolve().parents[1] / "app"
    source = "\n".join([
        (app_root / "main.py").read_text(encoding="utf-8"),
        (app_root / "services" / "bootstrap.py").read_text(encoding="utf-8"),
    ])

    assert "demo_" + "student_001" not in source
    assert "seed_demo_data" not in source
