"""Export one demo account into a NEW database; never copy/delete source pages.

Only run for an explicitly authorized private demo distribution. Service keys
are copied into ignored build resources, never into source files or build logs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
GLOBAL_TABLES = {"schema_migrations", "runtime_app_settings", "llm_provider_configs", "agent_requirement_contracts"}
EMPTY_TABLES = {"user_sessions", "teaching_classes", "teaching_assets", "class_enrollments", "class_publications", "class_submissions"}
OWNED_TABLES = {
    "assessments", "behavior_events", "code_exercises", "code_submissions",
    "conversation_sessions", "conversation_sync_states", "custom_agents",
    "exam_papers", "generated_materials", "learner_preference_settings",
    "learner_training_archives", "learner_training_runs", "learner_workspace_states",
    "learning_data_revisions", "learning_data_states", "learning_evidence",
    "learning_goals", "learning_market_imports", "learning_market_listings",
    "learning_paths", "media_assets", "memory_cards", "memory_episodes",
    "orchestration_records", "procedure_skill_usages", "profiles",
    "resource_collections", "resource_generation_plans", "review_logs",
    "semantic_memory_facts", "skill_reflection_jobs", "wrong_questions", "agent_runs",
}
CHILD_TABLES = {"agent_run_events", "procedure_skill_versions", "procedure_skill_events"}


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def export_database(source: Path, destination: Path, login: str) -> dict:
    """Read one transaction and insert selected rows into an empty SQLite file."""
    if destination.exists() or source.resolve() == destination.resolve():
        raise ValueError("Export destination must be a new file")
    src = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    src.execute("BEGIN")
    account = src.execute("SELECT * FROM user_accounts WHERE login=?", (login,)).fetchone()
    if account is None:
        raise ValueError("Demo account not found")
    sid = account["id"]
    forbidden = [r[0] for r in src.execute("SELECT id FROM user_accounts WHERE id<>?", (sid,))]
    schemas = src.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    known = GLOBAL_TABLES | EMPTY_TABLES | OWNED_TABLES | CHILD_TABLES | {"user_accounts", "procedure_skills"}
    unknown = {r["name"] for r in schemas} - known
    if unknown:
        raise ValueError("Review ownership of new tables before export: " + ", ".join(sorted(unknown)))
    out = sqlite3.connect(destination)
    counts = {}
    try:
        for schema in schemas:
            out.execute(schema["sql"])
        for schema in schemas:
            table = schema["name"]
            if table in EMPTY_TABLES:
                counts[table] = 0
                continue
            args = ()
            condition = "1"
            if table == "user_accounts":
                condition, args = "id=?", (sid,)
            elif table == "procedure_skills":
                condition, args = "owner_id IN (?, '__system__')", (sid,)
            elif table in OWNED_TABLES:
                cols = {r[1] for r in src.execute(f"PRAGMA table_info({quote(table)})")}
                owner = next(k for k in ("student_id", "owner_id", "publisher_id") if k in cols)
                condition, args = f"{quote(owner)}=?", (sid,)
            elif table == "agent_run_events":
                condition, args = "run_id IN (SELECT id FROM agent_runs WHERE owner_id=?)", (sid,)
            elif table in {"procedure_skill_versions", "procedure_skill_events"}:
                condition, args = "skill_id IN (SELECT id FROM procedure_skills WHERE owner_id IN (?, '__system__'))", (sid,)
            rows = src.execute(f"SELECT * FROM {quote(table)} WHERE {condition}", args).fetchall()
            for row in rows:
                # Reject cross-account references hidden inside retained JSON too.
                for value in row:
                    if isinstance(value, str) and any(other in value for other in forbidden):
                        raise ValueError(f"Cross-account reference requires review in {table}")
            if rows:
                out.executemany(f"INSERT INTO {quote(table)} VALUES ({','.join('?' for _ in rows[0])})", [tuple(r) for r in rows])
            counts[table] = len(rows)
        for index in src.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"):
            out.execute(index[0])
        out.commit()
        assert out.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not out.execute("PRAGMA foreign_key_check").fetchall()
        assert out.execute("SELECT count(*) FROM user_accounts").fetchone()[0] == 1
        assert out.execute("SELECT count(*) FROM user_sessions").fetchone()[0] == 0
        return {"login": login, "student_id": sid, "table_counts": counts, "excluded_accounts": len(forbidden)}
    finally:
        out.close()
        src.close()


def export_environment(files: list[Path], destination: Path) -> list[str]:
    allowed = set(json.loads((ROOT / "frontend/electron/backend-env-keys.json").read_text(encoding="utf-8")))
    values = {}
    for file in files:
        if not file.is_file():
            raise FileNotFoundError("Environment input is missing")
        for key, value in dotenv_values(file).items():
            if key in allowed and value:
                if any(c in value for c in "\r\n"):
                    raise ValueError("Multiline setting requires explicit handling: " + key)
                values[key] = value
    destination.write_text("# Private demo service configuration\n" + "\n".join(f"{k}={v}" for k, v in sorted(values.items())) + "\n", encoding="utf-8")
    return sorted(values)


def export_vectors(source: Path, public_seed: Path, destination: Path, student_id: str) -> dict:
    # Re-insert vectors; copying a Chroma directory would also copy other users.
    os.environ["ANONYMIZED_TELEMETRY"] = "False"
    import chromadb
    from chromadb.config import Settings
    options = Settings(anonymized_telemetry=False)
    public = chromadb.PersistentClient(path=str(public_seed), settings=options)
    personal = chromadb.PersistentClient(path=str(source), settings=options)
    target = chromadb.PersistentClient(path=str(destination), settings=options)
    manifest = json.loads((public_seed / "knowledge-index.json").read_text(encoding="utf-8"))
    name = manifest["active_collection"]
    suffix = hashlib.sha256(manifest["embedding_model_identity"].encode()).hexdigest()[:12]
    personal_name = "personal_" + hashlib.sha256(student_id.encode()).hexdigest()[:32]
    selections = [(public, name, None)]
    names = {c.name for c in personal.list_collections()}
    for name, owner_key in [(f"{personal_name}_{suffix}", "owner_id"), (f"memory_episodes_v1_{suffix}", "student_id")]:
        if name in names:
            selections.append((personal, name, {owner_key: student_id}))
    counts = {}
    for client, name, where in selections:
        old = client.get_collection(name, embedding_function=None)
        new = target.create_collection(name, metadata=old.metadata or {"hnsw:space": "cosine"}, embedding_function=None)
        offset = 0
        while True:
            data = old.get(limit=128, offset=offset, where=where, include=["documents", "metadatas", "embeddings"])
            if not data["ids"]:
                break
            if where:
                key = next(iter(where))
                assert all(m and m.get(key) == student_id for m in data["metadatas"])
            new.add(ids=data["ids"], documents=data["documents"], metadatas=data["metadatas"], embeddings=data["embeddings"])
            offset += len(data["ids"])
        counts[name] = new.count()
    assert counts[manifest["active_collection"]] == manifest["chunks"]
    (destination / "knowledge-index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return counts


def export_media(source: Path, destination: Path, student_id: str) -> list[str]:
    """Only persist media whose on-disk ownership manifest matches the demo."""
    source = source.resolve()
    files = set()
    for candidate in (source / "code_visualizations").glob("*.json"):
        payload = json.loads(candidate.read_text(encoding="utf-8"))
        if payload.get("student_id") == student_id:
            files.add(candidate.resolve())
    for manifest in (source / "video_tasks").glob("*/progress.json"):
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        if payload.get("student_id") != student_id:
            continue
        files.update(p.resolve() for p in manifest.parent.rglob("*") if p.is_file())
        if payload.get("file_path"):
            video = Path(payload["file_path"]).resolve()
            if not video.is_relative_to(source) or not video.is_file():
                raise ValueError("Owned video is missing or outside the media directory")
            files.add(video)

    def portable(value):
        if isinstance(value, dict):
            if value.get("student_id") and value["student_id"] != student_id:
                raise ValueError("Media manifest contains another account")
            return {k: portable(v) for k, v in value.items()}
        if isinstance(value, list):
            return [portable(item) for item in value]
        if isinstance(value, str):
            for prefix in (str(source), source.as_posix()):
                value = value.replace(prefix, "__XUESHU_MEDIA_ROOT__")
            if value.startswith("__XUESHU_MEDIA_ROOT__"):
                value = value.replace("\\", "/")
        return value

    exported = []
    for file in sorted(files):
        if not file.is_relative_to(source):
            raise ValueError("Media file escapes source directory")
        relative = file.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if file.suffix.lower() == ".json":
            value = portable(json.loads(file.read_text(encoding="utf-8")))
            target.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        else:
            shutil.copy2(file, target)
        exported.append(relative.as_posix())
    return exported


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login", default="furia")
    parser.add_argument("--env-file", action="append", type=Path, required=True, help="Low to high precedence; values are never logged")
    args = parser.parse_args()
    runtime = (ROOT / "frontend/runtime").resolve()
    target = runtime / "private-demo"
    staging = runtime / f"private-demo-{uuid.uuid4().hex}"
    staging.mkdir()
    report = export_database(ROOT / "backend/smartlearn.db", staging / "smartlearn.db", args.login)
    report["env_keys"] = export_environment(args.env_file, staging / "backend.env")
    # Chroma retains native file handles until process exit on Windows. Export in
    # a worker so publishing the completed directory cannot race those handles.
    worker = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--vector-worker",
        str(ROOT / "backend/chroma"), str(runtime / "assets/chroma_seed_cs2026_cloud_v1"),
        str(staging / "chroma"), report["student_id"]], check=True, capture_output=True, text=True,
        encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    report["vector_counts"] = json.loads(worker.stdout)
    report["media_files"] = export_media(ROOT / "backend/media/output", staging / "media", report["student_id"])
    # No owned file-backed media currently exists; fail rather than copy a shared media tree.
    db = sqlite3.connect(staging / "smartlearn.db")
    try:
        if db.execute("SELECT count(*) FROM media_assets WHERE file_path IS NOT NULL AND file_path<>''").fetchone()[0]:
            raise ValueError("Owned media files need an explicit file manifest before packaging")
    finally:
        db.close()
    report.update({"format": 1, "product_name": "学枢演示版", "contains_service_credentials": True})
    (staging / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    # Preserve the previous build. Only checked directories under runtime move.
    assert target.resolve().parent == runtime and staging.resolve().parent == runtime
    if target.exists():
        target.rename(runtime / f"private-demo.previous-{uuid.uuid4().hex}")
    staging.rename(target)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--vector-worker":
        print(json.dumps(export_vectors(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5])))
    else:
        main()
