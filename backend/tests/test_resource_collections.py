from __future__ import annotations

import asyncio

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.core.config import get_db
from app.main import _migrate_resource_collections
from app.models.base import Base
from app.models.learning import GeneratedMaterial
from app.routers.auth import router as auth_router
from app.routers.resource_collections import router as collections_router


def test_legacy_name_only_collection_table_is_upgraded_without_data_loss(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'legacy-collections.db'}")

    async def migrate():
        async with engine.begin() as connection:
            await connection.exec_driver_sql(
                """CREATE TABLE resource_collections (
                    id VARCHAR(64) PRIMARY KEY,
                    student_id VARCHAR(64) NOT NULL,
                    name VARCHAR(40) NOT NULL,
                    position INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
                )"""
            )
            await connection.exec_driver_sql(
                "INSERT INTO resource_collections (id, student_id, name, position) VALUES ('legacy-one', 'student-one', '旧集合', 0)"
            )
            await _migrate_resource_collections(connection)
            columns = await connection.exec_driver_sql("PRAGMA table_info(resource_collections)")
            column_names = {row[1] for row in columns.fetchall()}
            row = (
                await connection.exec_driver_sql(
                    "SELECT name, resource_ids FROM resource_collections WHERE id = 'legacy-one'"
                )
            ).one()
        await engine.dispose()
        return column_names, row

    column_names, row = asyncio.run(migrate())
    assert {"resource_ids", "updated_at"}.issubset(column_names)
    assert row == ("旧集合", "[]")


def test_resource_collections_manage_only_current_accounts_approved_materials(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'collections.db'}")
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
    app.include_router(collections_router, prefix="/api/resource-collections")
    app.dependency_overrides[get_db] = override_db

    with TestClient(app) as client:
        registered = client.post(
            "/api/auth/register",
            json={"login": "collector@example.com", "password": "password-123"},
        )
        assert registered.status_code == 201
        student_id = registered.json()["id"]

        async def seed_materials():
            async with sessions() as session:
                session.add_all(
                    [
                        GeneratedMaterial(
                            id="approved-one",
                            student_id=student_id,
                            type="reading",
                            title="已审核资料一",
                            data={"review_approved": True},
                        ),
                        GeneratedMaterial(
                            id="approved-two",
                            student_id=student_id,
                            type="quiz",
                            title="已审核资料二",
                            data={"review_approved": True},
                        ),
                        GeneratedMaterial(
                            id="unapproved",
                            student_id=student_id,
                            type="reading",
                            title="未审核资料",
                            data={"review_approved": False},
                        ),
                        GeneratedMaterial(
                            id="foreign-approved",
                            student_id="another-account",
                            type="reading",
                            title="其他账号资料",
                            data={"review_approved": True},
                        ),
                    ]
                )
                await session.commit()

        asyncio.run(seed_materials())

        created = client.post(
            "/api/resource-collections",
            json={"name": " 期末   重点 ", "resource_ids": ["approved-one"]},
        )
        assert created.status_code == 201
        collection_id = created.json()["id"]
        assert created.json()["name"] == "期末 重点"
        assert created.json()["resource_ids"] == ["approved-one"]

        duplicate = client.post(
            "/api/resource-collections",
            json={"name": "期末 重点", "resource_ids": []},
        )
        assert duplicate.status_code == 409

        unapproved = client.post(
            "/api/resource-collections",
            json={"name": "不安全集合", "resource_ids": ["unapproved"]},
        )
        assert unapproved.status_code == 400
        assert unapproved.json()["detail"]["code"] == "invalid_collection_resources"
        foreign = client.post(
            "/api/resource-collections",
            json={"name": "越权集合", "resource_ids": ["foreign-approved"]},
        )
        assert foreign.status_code == 400

        updated = client.put(
            f"/api/resource-collections/{collection_id}",
            json={"name": "算法复习", "resource_ids": ["approved-one", "approved-two", "approved-one"]},
        )
        assert updated.status_code == 200
        assert updated.json()["resource_ids"] == ["approved-one", "approved-two"]

        async def remove_second_material():
            async with sessions() as session:
                material = await session.get(GeneratedMaterial, "approved-two")
                assert material is not None
                await session.delete(material)
                await session.commit()

        asyncio.run(remove_second_material())

        listed = client.get("/api/resource-collections")
        assert listed.status_code == 200
        assert [(item["name"], item["resource_ids"]) for item in listed.json()] == [
            ("算法复习", ["approved-one"])
        ]

        assert client.delete(f"/api/resource-collections/{collection_id}").status_code == 200
        assert client.get("/api/resource-collections").json() == []

    asyncio.run(engine.dispose())
