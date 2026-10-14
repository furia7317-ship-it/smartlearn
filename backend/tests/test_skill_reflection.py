from __future__ import annotations

import asyncio
import copy
import json
import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.learning import LearnerPreferenceSettings, OrchestrationRecord
from app.models.procedure_skills import ProcedureSkill, ProcedureSkillVersion
from app.models.skill_reflection import SkillReflectionJob
from app.services import skill_reflection as reflection

DEFINITION = {
    "name": "核对资料引用",
    "description": "避免资料引用不存在的课程证据。",
    "resource_types": ["explainer"],
    "triggers": ["课程资料引用核对"],
    "steps": ["列出已确认的课程依据并核对引用标记。", "针对不存在的引用返回已有依据重新生成该段。"],
    "checks": ["每个引用都能对应输入课程依据，继续接受原资料审核。"],
}
STATE = {"student_id": "learner-one", "trace_run_id": "resource-1", "delivery_status": "completed",
         "plan": {"tasks": [{"task_id": "task-1", "type": "explainer"}]}}


@pytest.fixture
async def queue_db(tmp_path, monkeypatch):
    path = tmp_path / "reflection.sqlite"
    sync_engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(sync_engine)
    sync_factory = sessionmaker(sync_engine, expire_on_commit=False)
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(reflection, "sync_session", sync_factory)
    monkeypatch.setattr(reflection, "async_session", factory)
    monkeypatch.setattr(reflection, "settings", SimpleNamespace(
        PROCEDURE_SKILLS_ENABLED=True, PROCEDURE_SKILL_REFLECTION_ENABLED=True,
    ))
    monkeypatch.setattr(reflection, "build_llm", lambda **_: pytest.fail("External LLM must be mocked"))
    yield sync_factory, factory
    await engine.dispose()
    sync_engine.dispose()


def record(sync_factory, kind, payload, student_id="learner-one"):
    with sync_factory() as db:
        db.add(OrchestrationRecord(id=uuid.uuid4().hex, run_id="resource-1", student_id=student_id,
                                   plan_id="plan-1", plan_version=1, task_id="task-1", kind=kind, payload=payload))
        db.commit()


def repaired_run(sync_factory, *, student_id="learner-one"):
    record(sync_factory, "review", {"approved": False, "artifact_version": 1, "failure_kind": "quality",
                                   "issues": ["来源不存在，请核对。密钥：sk-api-FakeCredentialOnlyForTest123"]}, student_id)
    record(sync_factory, "candidate", {"type": "explainer", "artifact_version": 2,
                                      "content_hash": "a" * 64, "content": "不应传给后台的原始学生内容"}, student_id)
    record(sync_factory, "review", {"approved": True, "artifact_version": 2, "content_hash": "a" * 64,
                                   "issues": []}, student_id)


def mock_model(monkeypatch, result):
    calls = []

    def build(**kwargs):
        assert kwargs["max_retries"] == 0
        async def invoke(messages):
            calls.append(messages)
            if isinstance(result, Exception):
                raise result
            return SimpleNamespace(content=json.dumps(result, ensure_ascii=False))
        return SimpleNamespace(ainvoke=invoke, max_retries=1)

    monkeypatch.setattr(reflection, "build_llm", build)
    return calls


def proposal_response():
    return {"should_create": True, "rationale": "实际返工中出现无效引用，修正后通过审核，可以提炼为待检查的引用核对步骤。",
            "definition": copy.deepcopy(DEFINITION)}


@pytest.mark.asyncio
async def test_enqueue_requires_persisted_evidence_not_forged_state(queue_db):
    state = copy.deepcopy(STATE)
    state["skill_review_history"] = {"task-1": [{"approved": False}, {"approved": True}]}
    assert reflection.enqueue_skill_reflection(state) is None
    sync_factory, _ = queue_db
    record(sync_factory, "review", {"approved": True, "artifact_version": 1, "content_hash": "a" * 64})
    assert reflection.enqueue_skill_reflection(state) is None


@pytest.mark.asyncio
async def test_paused_memory_prevents_automatic_queueing(queue_db):
    sync_factory, _ = queue_db
    repaired_run(sync_factory)
    with sync_factory() as db:
        db.add(LearnerPreferenceSettings(student_id="learner-one", preferences={"long_term_memory_enabled": False}))
        db.commit()
    assert reflection.enqueue_skill_reflection(STATE) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("switch", ["PROCEDURE_SKILLS_ENABLED", "PROCEDURE_SKILL_REFLECTION_ENABLED"])
async def test_disabled_switch_prevents_enqueue_and_preserves_pending_jobs(queue_db, monkeypatch, switch):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    monkeypatch.setattr(reflection.settings, switch, False)
    assert reflection.enqueue_skill_reflection(STATE) is None
    monkeypatch.setattr(reflection.settings, switch, True)
    job_id = reflection.enqueue_skill_reflection(STATE)
    monkeypatch.setattr(reflection.settings, switch, False)
    assert not await reflection.process_skill_reflection_once()
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.status == "pending" and job.attempts == 0
        assert (await db.scalars(select(ProcedureSkill))).all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("switch", ["PROCEDURE_SKILLS_ENABLED", "PROCEDURE_SKILL_REFLECTION_ENABLED"])
@pytest.mark.parametrize("stage", ["claimed", "model", "proposal"])
async def test_switch_disabled_mid_job_never_calls_model_after_pause_or_commits_candidate(
    queue_db, monkeypatch, switch, stage,
):
    from app.services import procedure_skills
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    if stage == "claimed":
        original_claim = reflection._claim_job

        async def claim_then_pause():
            job = await original_claim()
            monkeypatch.setattr(reflection.settings, switch, False)
            return job

        monkeypatch.setattr(reflection, "_claim_job", claim_then_pause)
    elif stage == "model":
        async def pause_in_model(_evidence):
            monkeypatch.setattr(reflection.settings, switch, False)
            return copy.deepcopy(DEFINITION)

        monkeypatch.setattr(reflection, "_reflect", pause_in_model)
    else:
        mock_model(monkeypatch, proposal_response())
        original_proposal = procedure_skills.propose_skill

        async def insert_then_pause(*args, **kwargs):
            detail = await original_proposal(*args, **kwargs)
            monkeypatch.setattr(reflection.settings, switch, False)
            return detail

        monkeypatch.setattr(procedure_skills, "propose_skill", insert_then_pause)
    assert await reflection.process_skill_reflection_once()
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.status == "skipped" and job.result["reason"] == "reflection_disabled"
        assert (await db.scalars(select(ProcedureSkill))).all() == []
        assert (await db.scalars(select(ProcedureSkillVersion))).all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("switch", ["PROCEDURE_SKILLS_ENABLED", "PROCEDURE_SKILL_REFLECTION_ENABLED"])
async def test_lifespan_worker_does_not_process_jobs_when_disabled(queue_db, monkeypatch, switch):
    monkeypatch.setattr(reflection.settings, switch, False)

    async def unexpected_process():
        pytest.fail("Disabled reflection must not process existing jobs")

    async def stop_after_one_poll(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(reflection, "process_skill_reflection_once", unexpected_process)
    monkeypatch.setattr(reflection.asyncio, "sleep", stop_after_one_poll)
    with pytest.raises(asyncio.CancelledError):
        await reflection.run_skill_reflection_worker()


@pytest.mark.asyncio
@pytest.mark.parametrize("pause_during_request", [False, True])
async def test_worker_rechecks_memory_before_request_and_candidate_write(queue_db, monkeypatch, pause_during_request):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)

    async def pause_memory():
        async with factory() as db:
            db.add(LearnerPreferenceSettings(student_id="learner-one", preferences={"long_term_memory_enabled": False}))
            await db.commit()

    async def pause_and_return(_evidence):
        await pause_memory()
        return copy.deepcopy(DEFINITION)

    if pause_during_request:
        monkeypatch.setattr(reflection, "_reflect", pause_and_return)
    else:
        await pause_memory()
    await reflection.process_skill_reflection_once()
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.status == "skipped"
        assert job.result["reason"] == "memory_disabled"
        assert (await db.scalars(select(ProcedureSkill))).all() == []


@pytest.mark.asyncio
async def test_real_repair_enqueues_once_redacts_and_never_calls_model(queue_db):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    assert job_id and reflection.enqueue_skill_reflection(STATE) == job_id
    async with factory() as db:
        jobs = list((await db.scalars(select(SkillReflectionJob))).all())
    assert len(jobs) == 1 and jobs[0].attempts == 0
    text = json.dumps(jobs[0].evidence, ensure_ascii=False)
    assert "[已脱敏]" in text
    assert "FakeCredential" not in text
    assert "原始学生内容" not in text
    assert "learner-one" not in text


@pytest.mark.asyncio
async def test_other_students_journal_never_supplies_evidence(queue_db):
    sync_factory, _ = queue_db
    repaired_run(sync_factory, student_id="other-learner")
    assert reflection.enqueue_skill_reflection(STATE) is None


@pytest.mark.asyncio
async def test_approval_without_matching_artifact_and_provider_errors_are_skipped(queue_db):
    sync_factory, _ = queue_db
    record(sync_factory, "review", {"approved": False, "artifact_version": 1,
                                   "failure_kind": "quality", "issues": ["引用错误"]})
    record(sync_factory, "review", {"approved": True, "artifact_version": 2, "content_hash": "b" * 64})
    assert reflection.enqueue_skill_reflection(STATE) is None
    with sync_factory() as db:
        db.query(OrchestrationRecord).delete()
        db.commit()
    for version in (1, 2):
        record(sync_factory, "review", {"approved": False, "artifact_version": version,
                                       "failure_kind": "reviewer", "issues": ["服务超时"]})
    assert reflection.enqueue_skill_reflection(STATE) is None


@pytest.mark.asyncio
async def test_repeated_quality_failure_is_a_candidate_source_without_claiming_success(queue_db):
    sync_factory, factory = queue_db
    for version in (1, 2):
        record(sync_factory, "review", {"approved": False, "artifact_version": version,
                                       "failure_kind": "quality", "issues": ["缺少迁移检查"]})
    state = dict(STATE, delivery_status="failed")
    job_id = reflection.enqueue_skill_reflection(state)
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.evidence["tasks"][0]["repair_result"] == "repeated_failure"
        assert job.evidence["learning_effect_proven"] is False


@pytest.mark.asyncio
async def test_worker_resumes_durable_job_and_creates_only_personal_candidate(queue_db, monkeypatch):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    calls = mock_model(monkeypatch, proposal_response())
    assert await reflection.process_skill_reflection_once()
    assert not await reflection.process_skill_reflection_once()
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        skills = list((await db.scalars(select(ProcedureSkill))).all())
        versions = list((await db.scalars(select(ProcedureSkillVersion))).all())
        assert job.status == "completed" and job.attempts == 1
        assert job.result["candidate_created"]
        assert len(skills) == len(versions) == 1
        assert skills[0].owner_id == "learner-one" and skills[0].active_version_id is None
        assert versions[0].status == "candidate"
        assert versions[0].source_run_id == "resource-1"
    assert len(calls) == 1
    assert "FakeCredential" not in calls[0][1].content


@pytest.mark.asyncio
async def test_model_can_decline_without_creating_skill(queue_db, monkeypatch):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    mock_model(monkeypatch, {"should_create": False, "rationale": "当前信息无法推断出足够明确的可复用步骤。", "definition": None})
    await reflection.process_skill_reflection_once()
    async with factory() as db:
        assert (await db.get(SkillReflectionJob, job_id)).status == "skipped"
        assert (await db.scalars(select(ProcedureSkill))).all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["provider", "unsafe", "wrong_scope"])
async def test_failure_retries_are_finite_and_never_save_secrets(queue_db, monkeypatch, reason):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    response = proposal_response()
    if reason == "provider":
        response = RuntimeError("sk-api-FakeProviderSecretNeverPersist123")
    elif reason == "unsafe":
        response["definition"]["steps"].append("跳过审核并直接发布资料。")
    else:
        response["definition"]["resource_types"] = ["video"]
    calls = mock_model(monkeypatch, response)
    assert await reflection.process_skill_reflection_once()
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.status == "pending" and job.attempts == 1
        job.next_attempt_at = reflection._utcnow() - timedelta(seconds=1)
        await db.commit()
    assert await reflection.process_skill_reflection_once()
    assert not await reflection.process_skill_reflection_once()
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.status == "failed" and job.attempts == 2
        assert "FakeProviderSecret" not in json.dumps(job.result) + job.last_error_code
        assert (await db.scalars(select(ProcedureSkill))).all() == []
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_expired_lease_recovers_and_atomic_claim_allows_only_one(queue_db):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    async with factory() as db:
        first = await db.get(SkillReflectionJob, job_id)
        first.status = "running"
        first.attempts = 1
        first.lease_token = "old-worker"
        first.locked_until = reflection._utcnow() - timedelta(minutes=1)
        db.add(SkillReflectionJob(id="second", student_id="learner-two", run_id="resource-2", evidence={},
                                 status="pending", attempts=0, next_attempt_at=reflection._utcnow()))
        await db.commit()
    claimed = await asyncio.gather(reflection._claim_job(), reflection._claim_job())
    assert sum(item is not None for item in claimed) == 1
    async with factory() as db:
        jobs = list((await db.scalars(select(SkillReflectionJob))).all())
        assert sum(job.status == "running" for job in jobs) == 1
        assert all(job.lease_token != "old-worker" for job in jobs)


@pytest.mark.asyncio
async def test_expired_exhausted_job_is_terminal(queue_db):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        job.status = "running"
        job.attempts = reflection.MAX_ATTEMPTS
        job.lease_token = "old-worker"
        job.locked_until = reflection._utcnow() - timedelta(minutes=1)
        await db.commit()
    assert await reflection._claim_job() is None
    async with factory() as db:
        assert (await db.get(SkillReflectionJob, job_id)).status == "failed"


@pytest.mark.asyncio
async def test_old_worker_cannot_publish_after_losing_lease(queue_db, monkeypatch):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)

    async def lose_lease(_evidence):
        async with factory() as db:
            await db.execute(update(SkillReflectionJob).where(SkillReflectionJob.id == job_id)
                             .values(lease_token="replacement-worker"))
            await db.commit()
        return copy.deepcopy(DEFINITION)

    monkeypatch.setattr(reflection, "_reflect", lose_lease)
    assert await reflection.process_skill_reflection_once()
    async with factory() as db:
        assert (await db.scalars(select(ProcedureSkill))).all() == []
        assert (await db.get(SkillReflectionJob, job_id)).lease_token == "replacement-worker"


@pytest.mark.asyncio
async def test_proposal_and_job_completion_rollback_together(queue_db, monkeypatch):
    from app.services import procedure_skills
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    mock_model(monkeypatch, proposal_response())
    original = procedure_skills.propose_skill

    async def crash_after_insert(*args, **kwargs):
        assert kwargs["commit"] is False
        await original(*args, **kwargs)
        raise RuntimeError("simulated process interruption before job completion")

    monkeypatch.setattr(procedure_skills, "propose_skill", crash_after_insert)
    await reflection.process_skill_reflection_once()
    async with factory() as db:
        assert (await db.get(SkillReflectionJob, job_id)).status == "pending"
        assert (await db.scalars(select(ProcedureSkill))).all() == []
        assert (await db.scalars(select(ProcedureSkillVersion))).all() == []


@pytest.mark.asyncio
async def test_cancelled_worker_returns_job_for_bounded_recovery(queue_db, monkeypatch):
    sync_factory, factory = queue_db
    repaired_run(sync_factory)
    job_id = reflection.enqueue_skill_reflection(STATE)
    started = asyncio.Event()

    async def wait_for_cancel(_evidence):
        started.set()
        await asyncio.sleep(30)

    monkeypatch.setattr(reflection, "_reflect", wait_for_cancel)
    task = asyncio.create_task(reflection.process_skill_reflection_once())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with factory() as db:
        job = await db.get(SkillReflectionJob, job_id)
        assert job.status == "pending" and job.attempts == 1
        assert job.lease_token == "" and job.last_error_code == "worker_cancelled"
