from __future__ import annotations

import asyncio
import re

from fastapi import FastAPI, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.core.config import get_db
from app.models.base import Base
from app.models.learning import LearningGoal
from app.models.profile import Profile
from app.routers.auth import Credentials, OnboardingRequest, _set_session_cookie
from app.routers.auth import router as auth_router
from app.services.auth import hash_password, hash_session_token, new_session_token, verify_password
from app.services.major_catalog import load_major_catalog, search_majors


def test_password_hash_is_salted_and_verifiable():
    first = hash_password("correct-horse-123")
    second = hash_password("correct-horse-123")

    assert first != second
    assert verify_password("correct-horse-123", first) is True
    assert verify_password("wrong-password", first) is False
    assert verify_password("correct-horse-123", "damaged") is False


def test_session_token_only_persists_as_digest():
    token = new_session_token()
    digest = hash_session_token(token)

    assert token not in digest
    assert len(digest) == 64
    assert digest == hash_session_token(token)


def test_credentials_normalize_login_without_mutating_password():
    credentials = Credentials(login="  Student@Example.com  ", password="PassWord123")

    assert credentials.login == "student@example.com"
    assert credentials.password == "PassWord123"


def test_onboarding_preferences_are_trimmed_and_deduplicated():
    request = OnboardingRequest(
        grade="大二",
        major=" 计算机科学与技术 ",
        major_code="080901",
        major_level="undergraduate",
        preferences=["图示讲解", " 图示讲解 ", "动手练习"],
        long_term_goal="掌握专业核心能力",
        mid_term_goal="完成数据结构课程",
        short_term_goal="本周掌握链表",
    )

    assert request.major == "计算机科学与技术"
    assert request.preferences == ["图示讲解", "动手练习"]


def test_goals_are_optional_during_first_use_onboarding():
    request = OnboardingRequest(
        grade="研一",
        major="计算机科学与技术",
        major_code="0812",
        major_level="graduate",
        preferences=["动手练习"],
    )

    assert request.long_term_goal == ""
    assert request.mid_term_goal == ""
    assert request.short_term_goal == ""


def test_official_major_catalog_has_expected_counts_and_keyword_search():
    entries = load_major_catalog()

    assert sum(entry["level"] == "undergraduate" for entry in entries) == 883
    assert sum(entry["level"] == "graduate" for entry in entries) == 181
    assert any(entry["code"] == "080901" for entry in search_majors("计算机", "undergraduate"))
    assert any(entry["code"] == "0812" for entry in search_majors("计算机", "graduate"))


def test_auth_router_is_registered():
    from app.main import app

    paths = set(app.openapi()["paths"])
    assert "/api/auth/register" in paths
    assert "/api/auth/login" in paths
    assert "/api/auth/me" in paths
    assert "/api/auth/session" in paths
    assert "/api/auth/onboarding" in paths


def test_electron_origin_uses_cross_site_compatible_session_cookie():
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/auth/login",
            "headers": [(b"origin", b"app://local")],
        }
    )
    response = Response()

    _set_session_cookie(response, "desktop-session-token", request)

    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=none" in cookie


def test_local_portable_web_uses_http_compatible_session_cookie():
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "server": ("127.0.0.1", 8000),
            "path": "/api/auth/login",
            "headers": [(b"origin", b"http://127.0.0.1:3000")],
        }
    )
    response = Response()

    _set_session_cookie(response, "portable-web-session-token", request)

    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "secure" not in cookie
    assert "samesite=lax" in cookie


def test_private_network_portable_web_uses_http_compatible_session_cookie():
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "server": ("172.24.20.109", 8000),
            "path": "/api/auth/login",
            "headers": [(b"origin", b"http://172.24.20.109:3000")],
        }
    )
    response = Response()

    _set_session_cookie(response, "portable-lan-session-token", request)

    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "secure" not in cookie
    assert "samesite=lax" in cookie


def test_cors_regex_allows_only_known_private_frontend_origins():
    from app.core.config import settings

    assert re.fullmatch(settings.CORS_ORIGIN_REGEX, "http://172.24.20.109:3000")
    assert re.fullmatch(settings.CORS_ORIGIN_REGEX, "http://192.168.1.25:5173")
    assert not re.fullmatch(settings.CORS_ORIGIN_REGEX, "https://172.24.20.109:3000")
    assert not re.fullmatch(settings.CORS_ORIGIN_REGEX, "http://172.24.20.109:8080")
    assert not re.fullmatch(settings.CORS_ORIGIN_REGEX, "http://example.com:3000")


def test_registration_onboarding_refresh_and_logout_use_one_cookie_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'auth.db'}")
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def prepare_database():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    asyncio.run(prepare_database())
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")
    from app.routers.materials import router as materials_router

    app.include_router(materials_router, prefix="/api/materials")
    app.dependency_overrides[get_db] = override_db

    with TestClient(app) as client:
        assert client.get("/api/auth/session").json() == {"user": None}
        assert client.get("/api/materials/anonymous").status_code == 401
        registered = client.post(
            "/api/auth/register",
            json={
                "login": "Learner@example.com",
                "password": "password-123",
                "anonymous_student_id": "local_11111111-1111-4111-8111-111111111111",
            },
        )
        assert registered.status_code == 201
        assert "httponly" in registered.headers["set-cookie"].lower()
        assert registered.json()["id"] == "local_11111111-1111-4111-8111-111111111111"

        assert client.get("/api/auth/me").status_code == 200
        assert (
            client.get(
                "/api/materials/local_11111111-1111-4111-8111-111111111111"
            ).status_code
            == 200
        )
        forbidden = client.get(
            "/api/materials/local_22222222-2222-4222-8222-222222222222"
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["detail"]["code"] == "student_scope_forbidden"
        forbidden_body = client.post(
            "/api/materials/reflections",
            json={
                "student_id": "local_22222222-2222-4222-8222-222222222222",
                "task_key": "foreign-task",
                "day": "D1",
                "title": "不应写入的复盘",
                "user_content": "这是一次跨账户写入尝试。",
            },
        )
        assert forbidden_body.status_code == 403
        assert forbidden_body.json()["detail"]["code"] == "student_scope_forbidden"
        assert client.get("/api/auth/session").json()["user"]["login"] == "learner@example.com"
        rejected = client.put(
            "/api/auth/onboarding",
            json={
                "grade": "大二",
                "major": "我自己输入的专业",
                "major_code": "080901",
                "major_level": "undergraduate",
                "preferences": ["图示讲解"],
            },
        )
        assert rejected.status_code == 422

        onboarded = client.put(
            "/api/auth/onboarding",
            json={
                "grade": "大二",
                "major": "计算机科学与技术",
                "major_code": "080901",
                "major_level": "undergraduate",
                "preferences": ["图示讲解", "动手练习"],
            },
        )
        assert onboarded.status_code == 200
        assert onboarded.json()["onboarding_completed"] is True
        assert client.get("/api/auth/me").json()["major"] == "计算机科学与技术"

        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401
        assert client.get("/api/auth/session").json() == {"user": None}

    async def inspect_database():
        async with sessions() as session:
            profile = await session.get(Profile, "local_11111111-1111-4111-8111-111111111111")
            goal_count = await session.scalar(
                select(func.count(LearningGoal.id)).where(
                    LearningGoal.student_id == "local_11111111-1111-4111-8111-111111111111"
                )
            )
            assert profile is not None
            assert profile.goals["education"]["major"] == "计算机科学与技术"
            assert goal_count == 0
        await engine.dispose()

    asyncio.run(inspect_database())
