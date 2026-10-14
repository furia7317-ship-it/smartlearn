"""Teaching procedures: ownership, version identity, race safety, and activation."""

from __future__ import annotations

import asyncio
from copy import deepcopy

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.agent_run import AgentRun
from app.models.base import Base
from app.models.learning import OrchestrationRecord
from app.models.procedure_skills import ProcedureSkill, ProcedureSkillEvent, ProcedureSkillUsage, ProcedureSkillVersion
from app.schemas.procedure_skills import SkillDefinition, SkillDetail, SkillProposal
from app.services import procedure_skills as store


def definition(**changes):
    return {
        "name": "练习范围核对", "description": "生成练习前逐项核对用户指定的知识范围和题量。",
        "resource_types": ["quiz"], "triggers": ["生成练习", "题量不匹配"],
        "steps": ["列出用户要求的知识点和各题型数量。", "生成后逐项核对题目与范围。"],
        "checks": ["题量与原始要求一致。", "每道题的答案和解析相互对应。"], **changes,
    }


@pytest.fixture
async def sessions(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'skills.sqlite'}", connect_args={"timeout": 30})
    tables = [ProcedureSkill.__table__, ProcedureSkillVersion.__table__, ProcedureSkillEvent.__table__, ProcedureSkillUsage.__table__, AgentRun.__table__, OrchestrationRecord.__table__]
    async with engine.begin() as connection:
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def pass_version(db, version_id, **changes):
    row = await db.get(ProcedureSkillVersion, version_id)
    row.status = "passed"
    row.validation = {
        "passed": True, "completed": True, "status": "passed", "evaluator_id": store.EVALUATOR_ID,
        "content_hash": row.content_hash, "learning_effect_proven": False, **changes,
    }
    await db.commit()


async def test_proposal_dedup_is_bound_to_historical_content_and_does_not_activate(sessions):
    async with sessions() as db:
        db.add(OrchestrationRecord(id="record-1", run_id="run-1", student_id="alice", plan_id="p1", plan_version=1, kind="review", payload={}))
        await db.commit()
        first = await store.propose_skill(db, "alice", definition(), source_run_id="run-1")
        second = await store.propose_skill(db, "alice", definition(steps=["先核对题型数量，再检查知识点范围。"]), skill_id=first["id"])
        duplicate = await store.propose_skill(db, "alice", definition(), skill_id=first["id"])
        assert first["active_version_id"] is None
        assert second["latest_version"] == 2
        assert duplicate["proposed_version_id"] == first["proposed_version_id"]
        assert len(duplicate["versions"]) == 2
        assert len(duplicate["events"]) == 2
        assert duplicate["versions"][1]["source_run_id"] == "run-1"
        SkillDetail.model_validate(duplicate)


async def test_source_run_requires_verified_ownership(sessions):
    async with sessions() as db:
        db.add(OrchestrationRecord(id="record-bob", run_id="bob-run", student_id="bob", plan_id="p1", plan_version=1, kind="review", payload={}))
        db.add(AgentRun(id="alice-run", owner_id="alice"))
        await db.commit()
        for run_id in ["missing-run", "bob-run"]:
            with pytest.raises(HTTPException) as error:
                await store.propose_skill(db, "alice", definition(), source_run_id=run_id)
            assert error.value.status_code == 404
        detail = await store.propose_skill(db, "alice", definition(), source_run_id="alice-run")
        assert detail["versions"][0]["source_run_id"] == "alice-run"


async def test_concurrent_duplicate_and_distinct_proposals_are_atomic(sessions):
    async def create(payload):
        async with sessions() as db:
            return await store.propose_skill(db, "alice", payload)

    duplicates = await asyncio.gather(*(create(definition()) for _ in range(4)))
    assert len({row["id"] for row in duplicates}) == 1
    assert len({row["proposed_version_id"] for row in duplicates}) == 1
    revisions = await asyncio.gather(*(create(definition(steps=[f"第 {n} 种方法先核对题量，再逐项核对范围。 "])) for n in range(4)))
    assert len({row["proposed_version_id"] for row in revisions}) == 4
    async with sessions() as db:
        detail = await store.get_skill(db, "alice", duplicates[0]["id"])
        assert [version["version"] for version in detail["versions"]] == [5, 4, 3, 2, 1]
        assert (await db.scalar(select(func.count()).select_from(ProcedureSkillEvent))) == 5


async def test_proposal_can_join_reflection_transaction_without_partial_commit(sessions):
    async with sessions() as db:
        await store.propose_skill(db, "alice", definition(), commit=False)
        await db.rollback()
    async with sessions() as db:
        assert await store.list_skills(db, "alice") == []
        assert await db.scalar(select(func.count()).select_from(ProcedureSkillEvent)) == 0


async def test_concurrent_new_methods_respect_storage_limit(sessions, monkeypatch):
    monkeypatch.setattr(store, "MAX_PERSONAL_SKILLS", 1)

    async def create(name):
        async with sessions() as db:
            return await store.propose_skill(db, "alice", definition(name=name))

    results = await asyncio.gather(create("方法一"), create("方法二"), return_exceptions=True)
    assert len([item for item in results if isinstance(item, dict)]) == 1
    errors = [item for item in results if isinstance(item, HTTPException)]
    assert len(errors) == 1 and errors[0].status_code == 409
    async with sessions() as db:
        assert len(await store.list_skills(db, "alice")) == 1


async def test_personal_isolation_and_system_read_only(sessions):
    async with sessions() as db:
        alice = await store.propose_skill(db, "alice", definition())
        bob = await store.propose_skill(db, "bob", definition())
        assert alice["id"] != bob["id"]
        assert [item["id"] for item in await store.list_skills(db, "alice")] == [alice["id"]]
        for action in (
            lambda: store.get_skill(db, "bob", alice["id"]),
            lambda: store.propose_skill(db, "bob", definition(), skill_id=alice["id"]),
            lambda: store.activate_version(db, "bob", alice["id"], alice["latest_version_id"]),
            lambda: store.set_disabled(db, "bob", alice["id"], True),
        ):
            with pytest.raises(HTTPException) as error:
                await action()
            assert error.value.status_code == 404
        db.add(ProcedureSkill(id="builtin", owner_id=store.SYSTEM_OWNER, name="内置范围核对", version_counter=1))
        db.add(ProcedureSkillVersion(id="builtin-v1", skill_id="builtin", version=1, definition=definition(), content_hash=store.canonical_definition_hash(definition())))
        await db.commit()
        assert (await store.get_skill(db, "alice", "builtin"))["read_only"] is True
        for action in (
            lambda: store.propose_skill(db, "alice", definition(), skill_id="builtin"),
            lambda: store.activate_version(db, "alice", "builtin", "builtin-v1"),
            lambda: store.set_disabled(db, "alice", "builtin", True),
            lambda: store.propose_skill(db, store.SYSTEM_OWNER, definition()),
        ):
            with pytest.raises(HTTPException) as error:
                await action()
            assert error.value.status_code == 403


@pytest.mark.parametrize("changes", [
    {"content_hash": "bad"}, {"completed": False}, {"passed": False},
    {"status": "unavailable"}, {"evaluator_id": "model-self-approved"},
])
async def test_incomplete_or_wrong_evaluation_cannot_activate(sessions, changes):
    async with sessions() as db:
        detail = await store.propose_skill(db, "alice", definition())
        await pass_version(db, detail["latest_version_id"], **changes)
        with pytest.raises(HTTPException) as error:
            await store.activate_version(db, "alice", detail["id"], detail["latest_version_id"])
        assert error.value.status_code == 409
        assert (await store.get_skill(db, "alice", detail["id"]))["active_version_id"] is None


async def test_activation_rollback_disable_resume_and_audit(sessions):
    async with sessions() as db:
        first = await store.propose_skill(db, "alice", definition())
        v1 = first["latest_version_id"]
        await pass_version(db, v1)
        active = await store.activate_version(db, "alice", first["id"], v1)
        assert active["status"] == "active"
        second = await store.propose_skill(db, "alice", definition(steps=["先核对题型与范围，再生成并验证。"]), skill_id=first["id"])
        assert second["active_version_id"] == v1
        assert second["latest_version_status"] == "candidate"
        v2 = second["latest_version_id"]
        await pass_version(db, v2)
        await store.activate_version(db, "alice", first["id"], v2)
        rollback = await store.activate_version(db, "alice", first["id"], v1)
        assert rollback["active_version"] == 1
        disabled = await store.set_disabled(db, "alice", first["id"], True)
        assert disabled["status"] == "disabled"
        resumed = await store.set_disabled(db, "alice", first["id"], False)
        assert resumed["status"] == "active"
        assert {event["event_type"] for event in resumed["events"]} == {"proposed", "activated", "disabled", "resumed"}
        assert len(resumed["versions"]) == 2


async def test_definition_immutable_and_hash_tampering_fails_closed(sessions):
    async with sessions() as db:
        detail = await store.propose_skill(db, "alice", definition())
        row = await db.get(ProcedureSkillVersion, detail["latest_version_id"])
        row.definition = definition(steps=["被篡改的历史步骤"])
        with pytest.raises(ValueError, match="不可改写"):
            await db.commit()
        await db.rollback()
        await pass_version(db, detail["latest_version_id"])
        await db.execute(update(ProcedureSkillVersion).where(ProcedureSkillVersion.id == detail["latest_version_id"]).values(definition=definition(steps=["数据库外部篡改后的步骤"])))
        await db.commit()
        with pytest.raises(HTTPException) as error:
            await store.activate_version(db, "alice", detail["id"], detail["latest_version_id"])
        assert error.value.status_code == 409


async def test_resume_cannot_bypass_revoked_validation(sessions):
    async with sessions() as db:
        detail = await store.propose_skill(db, "alice", definition())
        await pass_version(db, detail["latest_version_id"])
        await store.activate_version(db, "alice", detail["id"], detail["latest_version_id"])
        await store.set_disabled(db, "alice", detail["id"], True)
        row = await db.get(ProcedureSkillVersion, detail["latest_version_id"])
        row.status = "rejected"
        await db.commit()
        with pytest.raises(HTTPException) as error:
            await store.set_disabled(db, "alice", detail["id"], False)
        assert error.value.status_code == 409


async def test_search_and_usage_summary_never_include_other_students(sessions):
    async with sessions() as db:
        detail = await store.propose_skill(db, "alice", definition())
        for owner, approved in [("alice", True), ("alice", False), ("bob", True)]:
            item_id = f"{owner}-{approved}"
            db.add(ProcedureSkillUsage(id=item_id, student_id=owner, run_id=item_id, task_id="t1", skill_id=detail["id"], version_id=detail["latest_version_id"], outcome={"approved": approved}))
        await db.commit()
        rows = await store.list_skills(db, "alice", query="题量", resource_type="quiz")
        assert rows[0]["usage_summary"] == {"total": 2, "approved": 1, "failed": 1}
        assert await store.list_skills(db, "alice", resource_type="video") == []


def test_definition_contract_rejects_executable_fields_and_forged_approval():
    for extra in ({"script": "print('x')"}, {"permissions": ["admin"]}, {"validation": {"passed": True}}):
        with pytest.raises(ValidationError):
            SkillDefinition.model_validate({**definition(), **extra})
    for payload in (definition(steps=[]), definition(steps=["x" * 501]), definition(resource_types=["shell"]), definition(name=" \x00 ")):
        with pytest.raises(ValidationError):
            SkillDefinition.model_validate(payload)
    with pytest.raises(ValidationError):
        SkillProposal.model_validate({"student_id": "alice", "definition": definition(), "status": "passed"})
    ordered = deepcopy(definition())
    assert store.canonical_definition_hash(ordered) == store.canonical_definition_hash(dict(reversed(list(ordered.items()))))


async def test_api_shapes_and_real_account_scope_guard(sessions, monkeypatch):
    from app.core.config import get_db
    from app.routers.auth import get_current_account
    from app.routers.procedure_skills import router
    from app.services import skill_evaluation

    app = FastAPI()
    app.include_router(router, prefix="/api/procedure-skills")

    async def db_override():
        async with sessions() as db:
            yield db

    async def account_override():
        from types import SimpleNamespace
        return SimpleNamespace(id="alice")

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_current_account] = account_override

    async def mock_evaluate(db, student_id, skill_id, version_id):
        row = await db.get(ProcedureSkillVersion, version_id)
        row.status = "passed"
        row.validation = {"passed": True, "completed": True, "status": "passed", "evaluator_id": store.EVALUATOR_ID, "content_hash": row.content_hash}
        await db.flush()
        return await store.get_skill(db, student_id, skill_id)

    monkeypatch.setattr(skill_evaluation, "evaluate_skill_version", mock_evaluate)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/procedure-skills", json={"student_id": "alice", "definition": definition()})
        assert created.status_code == 200, created.text
        detail = created.json()
        SkillDetail.model_validate(detail)
        rows = await client.get("/api/procedure-skills", params={"student_id": "alice"})
        assert rows.json()[0]["id"] == detail["id"]
        read = await client.get(f'/api/procedure-skills/{detail["id"]}', params={"student_id": "alice"})
        assert read.status_code == 200
        denied = await client.post(f'/api/procedure-skills/{detail["id"]}/activate', json={"student_id": "alice", "version_id": detail["latest_version_id"]})
        assert denied.status_code == 409
        forged_scope = await client.get("/api/procedure-skills", params={"student_id": "bob"})
        assert forged_scope.status_code == 403
        forged_body = await client.post("/api/procedure-skills", json={"student_id": "bob", "definition": definition()})
        assert forged_body.status_code == 403
        forged_approval = await client.post("/api/procedure-skills", json={"student_id": "alice", "definition": definition(), "validation": {"passed": True}})
        assert forged_approval.status_code == 422
        checked = await client.post(f'/api/procedure-skills/{detail["id"]}/evaluate', json={"student_id": "alice", "version_id": detail["latest_version_id"]})
        assert checked.status_code == 200
        assert checked.json()["latest_version_status"] == "passed"
        activated = await client.post(f'/api/procedure-skills/{detail["id"]}/activate', json={"student_id": "alice", "version_id": detail["latest_version_id"]})
        assert activated.status_code == 200
        assert activated.json()["status"] == "active"
        disabled = await client.post(f'/api/procedure-skills/{detail["id"]}/disable', json={"student_id": "alice", "disabled": True})
        assert disabled.status_code == 200
        assert disabled.json()["status"] == "disabled"
