from __future__ import annotations

import asyncio

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.core.config import get_db
from app.models.base import Base
from app.routers.auth import router as auth_router
from app.routers.profile import router as profile_router


def test_profile_identity_is_authenticated_scoped_and_persisted(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'profile-identity.db'}")
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
    app.include_router(profile_router, prefix="/api/profile")
    app.dependency_overrides[get_db] = override_db

    with TestClient(app) as client:
        registered = client.post(
            "/api/auth/register",
            json={"login": "portfolio@example.com", "password": "password-123"},
        )
        assert registered.status_code == 201
        student_id = registered.json()["id"]

        initial = client.get(f"/api/profile/{student_id}/identity")
        assert initial.status_code == 200
        assert initial.json()["display_name"] == "portfolio"
        assert initial.json()["strengths"]

        saved = client.put(
            f"/api/profile/{student_id}/identity",
            json={
                "display_name": "测试用户",
                "motto": "把复杂问题拆开，再稳稳解决。",
                "strengths": ["逻辑思维", "系统构建", "逻辑思维"],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["display_name"] == "测试用户"
        assert saved.json()["strengths"] == ["逻辑思维", "系统构建"]

        persisted = client.get(f"/api/profile/{student_id}/identity").json()
        assert persisted["motto"] == "把复杂问题拆开，再稳稳解决。"
        assert persisted["updated_at"]

        forbidden = client.get("/api/profile/local_22222222-2222-4222-8222-222222222222/identity")
        assert forbidden.status_code == 403

        assert client.post("/api/auth/logout").status_code == 200
        assert client.get(f"/api/profile/{student_id}/identity").status_code == 401

    asyncio.run(engine.dispose())
