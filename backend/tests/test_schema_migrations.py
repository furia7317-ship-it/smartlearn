import sqlite3

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.core import migrations


@pytest.mark.asyncio
async def test_legacy_database_is_backed_up_and_upgraded_once(tmp_path):
    database = tmp_path / "legacy.sqlite"
    with sqlite3.connect(database) as conn:
        conn.executescript("""
            CREATE TABLE resource_collections (
                id TEXT PRIMARY KEY, student_id TEXT, name TEXT, position INTEGER, created_at DATETIME
            );
            INSERT INTO resource_collections VALUES ('a', 'learner', 'keep this', 0, CURRENT_TIMESTAMP);
        """)
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    try:
        await migrations.migrate_database(engine)
        await migrations.migrate_database(engine)
        async with engine.connect() as conn:
            row = (await conn.exec_driver_sql("SELECT name, resource_ids FROM resource_collections WHERE id='a'")).one()
            assert row == ("keep this", "[]")
            versions = list((await conn.exec_driver_sql("SELECT version FROM schema_migrations ORDER BY version")).scalars())
            assert versions == [1, 2]
        backups = list((tmp_path / ".schema-backups").glob("*.sqlite"))
        assert len(backups) == 1
        with sqlite3.connect(backups[0]) as backup:
            assert backup.execute("SELECT name FROM resource_collections").fetchone() == ("keep this",)
            assert "resource_ids" not in {row[1] for row in backup.execute("PRAGMA table_info(resource_collections)")}
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_failed_migration_rolls_back_ddl_and_version(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def fail(conn):
        await conn.exec_driver_sql("CREATE TABLE should_not_survive (id INTEGER)")
        raise RuntimeError("interrupted")

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "broken", fail),))
    try:
        with pytest.raises(RuntimeError, match="interrupted"):
            await migrations.migrate_database(engine)
        async with engine.connect() as conn:
            names = set((await conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")).scalars())
            assert not {"schema_migrations", "should_not_survive"} & names
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_future_database_version_is_refused():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        await migrations.migrate_database(engine)
        async with engine.begin() as conn:
            await conn.exec_driver_sql("INSERT INTO schema_migrations (version,name) VALUES (999,'future')")
        with pytest.raises(RuntimeError, match="newer"):
            await migrations.migrate_database(engine)
    finally:
        await engine.dispose()
