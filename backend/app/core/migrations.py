"""Ordered SQLite schema migrations, including upgrades from the unversioned app."""

from __future__ import annotations

import asyncio
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import inspect

from app.models.base import Base


def _table_columns(sync_connection, table_name: str) -> set[str]:
    inspector = inspect(sync_connection)
    if table_name not in inspector.get_table_names():
        return set()
    return {str(column["name"]) for column in inspector.get_columns(table_name)}


async def _migrate_resource_collections(connection) -> None:
    """Add membership fields to the earlier name-only collection prototype."""

    columns = await connection.run_sync(_table_columns, "resource_collections")
    if not columns:
        return
    if "resource_ids" not in columns:
        await connection.exec_driver_sql(
            "ALTER TABLE resource_collections ADD COLUMN resource_ids JSON NOT NULL DEFAULT '[]'"
        )
    if "updated_at" not in columns:
        # SQLite cannot add a column with CURRENT_TIMESTAMP as a non-constant
        # default. Existing rows safely fall back to created_at when serialized.
        await connection.exec_driver_sql(
            "ALTER TABLE resource_collections ADD COLUMN updated_at DATETIME"
        )


async def _migrate_agent_memory(connection) -> None:
    """Add the explicit session and episodic-memory layer fields in place."""

    session_columns = await connection.run_sync(_table_columns, "conversation_sessions")
    if session_columns:
        if "entry_channel" not in session_columns:
            await connection.exec_driver_sql(
                "ALTER TABLE conversation_sessions ADD COLUMN entry_channel VARCHAR(32) "
                "NOT NULL DEFAULT 'desktop'"
            )
        if "context_metadata" not in session_columns:
            await connection.exec_driver_sql(
                "ALTER TABLE conversation_sessions ADD COLUMN context_metadata JSON "
                "NOT NULL DEFAULT '{}'"
            )

    episode_columns = await connection.run_sync(_table_columns, "memory_episodes")
    if not episode_columns:
        return
    additions = (
        ("structured_summary", "JSON NOT NULL DEFAULT '{}'"),
        ("source_start_index", "INTEGER NOT NULL DEFAULT 0"),
        ("source_end_index", "INTEGER NOT NULL DEFAULT 0"),
        ("updated_at", "DATETIME"),
    )
    for name, declaration in additions:
        if name not in episode_columns:
            await connection.exec_driver_sql(
                f"ALTER TABLE memory_episodes ADD COLUMN {name} {declaration}"
            )


async def _baseline(connection):
    await connection.run_sync(Base.metadata.create_all)
    await _migrate_resource_collections(connection)
    await _migrate_agent_memory(connection)


async def _conversation_versions(connection):
    from app.models.learning import ConversationSyncState
    await connection.run_sync(lambda conn: ConversationSyncState.__table__.create(conn, checkfirst=True))


MIGRATIONS = ((1, "baseline_and_legacy_columns", _baseline), (2, "conversation_versions", _conversation_versions))


def _backup(database: Path, version: int):
    directory = database.parent / ".schema-backups"
    directory.mkdir(exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    destination = directory / f"{database.name}.before-v{version}.{stamp}.sqlite"
    with sqlite3.connect(str(database)) as source, sqlite3.connect(str(destination)) as target:
        source.backup(target)
    return destination


async def migrate_database(engine):
    """Acquire the SQLite writer lock before inspecting versions; commit schema
    and version records together. A failed migration rolls back all its DDL.
    Unknown future versions fail closed rather than running an older schema.
    """
    async with engine.connect() as connection:
        await connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            exists = await connection.run_sync(lambda conn: inspect(conn).has_table("schema_migrations"))
            applied = set((await connection.exec_driver_sql("SELECT version FROM schema_migrations")).scalars()) if exists else set()
            known = {version for version, _, _ in MIGRATIONS}
            if applied - known:
                raise RuntimeError("Database schema is newer than this application; use the newer application")
            pending = [(version, name, migrate) for version, name, migrate in MIGRATIONS if version not in applied]
            database = engine.url.database
            if pending and database and database != ":memory:" and Path(database).is_file():
                await asyncio.to_thread(_backup, Path(database), pending[0][0])
            await connection.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version INTEGER PRIMARY KEY, name TEXT NOT NULL, "
                "applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            for version, name, migrate in pending:
                await migrate(connection)
                await connection.exec_driver_sql(
                    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)", (version, name),
                )
            await connection.commit()
        except BaseException:
            await connection.rollback()
            raise
