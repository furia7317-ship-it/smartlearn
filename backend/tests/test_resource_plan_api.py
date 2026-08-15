"""Owner-scoped, versioned resource-plan API contracts."""

from __future__ import annotations

import asyncio
import json
import threading

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.test_resource_plan_models import sample_plan_dict


@pytest.fixture(autouse=True)
def matched_knowledge_gate(monkeypatch):
    """Plan persistence tests exercise their own concern, not local Chroma."""
    from app.routers import resource_plans
    from app.services.knowledge_gate import KnowledgeGateResult

    monkeypatch.setattr(
        resource_plans,
        "_require_knowledge",
        lambda query, student_id: KnowledgeGateResult("matched", query, [{"id": "kb-1", "content": "测试知识"}], 1.0),
    )


@pytest.fixture
async def db_session():
    from app.models import learning  # noqa: F401
    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def seeded_plan(db_session):
    from app.models.learning import ResourceGenerationPlan
    from app.schemas.resource_plan import PlanArtifact

    payload = sample_plan_dict()
    payload["student_id"] = "student-1"
    plan = PlanArtifact.model_validate(payload)
    db_session.add(
        ResourceGenerationPlan(
            id=plan.plan_id,
            student_id=plan.student_id,
            version=plan.version,
            status=plan.status,
            request_text="生成数据结构学习路径",
            artifact=plan.model_dump(mode="json"),
            validation=plan.validation.model_dump(mode="json"),
            execution_state={},
        )
    )
    await db_session.commit()
    return plan


@pytest.mark.asyncio
async def test_create_complex_plan_waits_for_confirmation(db_session, monkeypatch):
    from app.routers import resource_plans
    from app.schemas.resource import ResourceRequest

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    monkeypatch.setattr(
        resource_plans,
        "build_resource_plan",
        lambda **kwargs: resource_plans.PlanArtifact.model_validate(sample_plan_dict()),
    )

    response = await resource_plans.create_plan(
            ResourceRequest(topic="数据结构学习路径", student_id="student-1", planning_mode="learning_path", learning_baseline={"source":"self_report","level":"basic","confidence":0.6,"summary":"略懂基础"}),
        db_session,
    )

    assert response.plan.student_id == "student-1"
    assert response.plan.status == "awaiting_confirmation"
    assert response.execution.resources == []


@pytest.mark.asyncio
async def test_create_plan_returns_sanitized_schema_error_instead_of_500(db_session, monkeypatch):
    from app.routers import resource_plans
    from app.schemas.resource import ResourceRequest
    from app.services.resource_plan_builder import PlanBuildError

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))

    def reject_invalid_long_skeleton(**kwargs):
        raise PlanBuildError("plan_schema_invalid", "long plan structure is invalid")

    monkeypatch.setattr(resource_plans, "build_resource_plan", reject_invalid_long_skeleton)

    with pytest.raises(HTTPException) as error:
        await resource_plans.create_plan(
            ResourceRequest(
                topic="data structures learning path",
                student_id="student-1",
                planning_mode="learning_path",
                learning_baseline={
                    "source": "self_report",
                    "level": "basic",
                    "confidence": 0.6,
                    "summary": "basic knowledge",
                },
            ),
            db_session,
        )

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "plan_schema_invalid"


@pytest.mark.asyncio
async def test_get_plan_hides_other_owners_records(db_session, seeded_plan):
    from app.routers.resource_plans import get_plan

    with pytest.raises(HTTPException) as exc:
        await get_plan(seeded_plan.plan_id, "other", db_session)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_plan_recovers_orphaned_running_checkpoint(db_session, seeded_plan):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import get_plan
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = seeded_plan.model_copy(deep=True)
    plan.status = "running"
    plan.tasks[0].status = "ready"
    plan.tasks[1].status = "pending"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {
        "trace_run_id": "orphaned-after-worker-reload",
        "run_started_at": 1.0,
        "reviews": {"explainer-d1": {"approved": True, "score": 1.0}},
    }
    await db_session.commit()

    response = await get_plan(seeded_plan.plan_id, seeded_plan.student_id, db_session)

    assert response.plan.status == "approved"
    assert response.plan.tasks[0].status == "ready"
    assert response.plan.tasks[1].status == "pending"
    await db_session.refresh(row)
    assert "成功资料已保留" in row.last_error


@pytest.mark.asyncio
async def test_get_plan_terminalizes_an_orphaned_fully_ready_checkpoint(db_session, seeded_plan):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import get_plan
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = seeded_plan.model_copy(deep=True)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {
        "trace_run_id": "orphaned-after-successful-generation",
        "resources": [
            {"id": task.task_id, "task_id": task.task_id, "type": task.type, "title": task.title}
            for task in plan.tasks
        ],
        "reviews": {
            task.task_id: {
                "approved": True,
                "score": 1.0,
                "issues": [],
                "fixes": [],
                "gate_status": (
                    "approved_after_rework_limit" if index == 0 else "approved"
                ),
            }
            for index, task in enumerate(plan.tasks)
        },
        "coverage": {
            "complete": True,
            "ready_task_ids": [task.task_id for task in plan.tasks],
            "missing_task_ids": [],
            "failed_task_ids": [],
        },
        "schedule": [],
    }
    await db_session.commit()

    response = await get_plan(seeded_plan.plan_id, seeded_plan.student_id, db_session)

    assert response.plan.status == "completed"
    assert all(task.status == "ready" for task in response.plan.tasks)
    await db_session.refresh(row)
    assert row.status == "completed"
    assert row.last_error == ""


def test_successful_values_snapshot_waits_for_the_integrated_daily_schedule():
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact

    plan = PlanArtifact.model_validate(sample_plan_dict())
    task_ids = [task.task_id for task in plan.tasks]
    payload = {
        "plan": plan.model_dump(mode="json"),
        "resources": [
            {"task_id": task.task_id, "type": task.type, "title": task.title}
            for task in plan.tasks
        ],
        "reviews": {
            task_id: {"approved": True, "score": 1.0}
            for task_id in task_ids
        },
        "coverage": {
            "complete": True,
            "ready_task_ids": task_ids,
            "missing_task_ids": [],
            "failed_task_ids": [],
        },
        "schedule": [],
    }

    assert resource_plans._successful_values_chunk(("values", payload)) is False

    payload["schedule"] = [
        {"day": day.day, "title": day.title, "steps": []}
        for day in plan.days
    ]
    assert resource_plans._successful_values_chunk(("values", payload)) is True


@pytest.mark.asyncio
async def test_update_rejects_wrong_owner_and_stale_version(db_session, seeded_plan):
    from app.routers.resource_plans import update_plan
    from app.schemas.resource_plan import PlanUpdateRequest

    wrong_owner = PlanUpdateRequest(
        student_id="other",
        version=1,
        days=seeded_plan.days,
        tasks=seeded_plan.tasks,
        constraints=seeded_plan.constraints,
    )
    with pytest.raises(HTTPException) as owner_error:
        await update_plan(seeded_plan.plan_id, wrong_owner, db_session)
    assert owner_error.value.status_code == 404

    stale = wrong_owner.model_copy(update={"student_id": seeded_plan.student_id, "version": 2})
    with pytest.raises(HTTPException) as version_error:
        await update_plan(seeded_plan.plan_id, stale, db_session)
    assert version_error.value.status_code == 409


@pytest.mark.asyncio
async def test_update_increments_version_and_revalidates(db_session, seeded_plan):
    from app.routers.resource_plans import update_plan
    from app.schemas.resource_plan import PlanUpdateRequest

    days = [day.model_copy(deep=True) for day in seeded_plan.days]
    days[0].title = "线性表：顺序表与链表选型"
    response = await update_plan(
        seeded_plan.plan_id,
        PlanUpdateRequest(
            student_id=seeded_plan.student_id,
            version=1,
            days=days,
            tasks=seeded_plan.tasks,
            constraints=seeded_plan.constraints,
        ),
        db_session,
    )

    assert response.plan.version == 2
    assert response.plan.days[0].title == "线性表：顺序表与链表选型"
    assert response.plan.validation.valid is True


@pytest.mark.asyncio
async def test_cancelled_plan_cannot_be_updated(db_session, seeded_plan):
    from app.routers.resource_plans import cancel_plan, update_plan
    from app.schemas.resource_plan import PlanActionRequest, PlanUpdateRequest

    cancelled = await cancel_plan(
        seeded_plan.plan_id,
        PlanActionRequest(student_id=seeded_plan.student_id, version=1),
        db_session,
    )
    assert cancelled.plan.status == "cancelled"

    with pytest.raises(HTTPException) as exc:
        await update_plan(
            seeded_plan.plan_id,
            PlanUpdateRequest(
                student_id=seeded_plan.student_id,
                version=2,
                days=seeded_plan.days,
                tasks=seeded_plan.tasks,
                constraints=seeded_plan.constraints,
            ),
            db_session,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_running_plan_can_be_cancelled(db_session, seeded_plan):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import cancel_plan
    from app.schemas.resource_plan import PlanActionRequest, PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {"trace_run_id": "running-plan-cancel"}
    await db_session.commit()

    cancelled = await cancel_plan(
        seeded_plan.plan_id,
        PlanActionRequest(student_id=seeded_plan.student_id, version=1),
        db_session,
    )

    assert cancelled.plan.status == "cancelled"
    assert cancelled.plan.version == 2


@pytest.mark.asyncio
async def test_inflight_cancel_stops_followup_calls_and_keeps_cancelled_terminal(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.graph import planned_resource_graph as planned_graph
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanActionRequest, PlanArtifact, TaskReview
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    payload = sample_plan_dict()
    payload["student_id"] = seeded_plan.student_id
    payload["status"] = "running"
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    payload["days"][0]["task_ids"] = [payload["tasks"][0]["task_id"]]
    plan = PlanArtifact.model_validate(payload)
    trace_run_id = "plan-inflight-cancel"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {"trace_run_id": trace_run_id}
    await db_session.commit()

    generator_started = threading.Event()
    allow_generator_return = threading.Event()
    calls = {"generator": 0, "reviewer": 0}

    def generate(_state):
        calls["generator"] += 1
        generator_started.set()
        assert allow_generator_return.wait(timeout=3)
        return {
            "type": "explainer",
            "title": "candidate that must never reach review",
            "explanation": "candidate that must never be persisted",
        }

    def review(*_args):
        calls["reviewer"] += 1
        return TaskReview(approved=True, score=1.0)

    monkeypatch.setattr(planned_graph, "get_agent", lambda _name: generate)
    monkeypatch.setattr(planned_graph, "review_resource", review)
    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))

    state = resource_plans.build_planned_state(plan, row.execution_state)

    async def consume() -> list[str]:
        return [
            event
            async for event in resource_plans.stream_and_persist_planned_execution(
                planned_graph.planned_resource_app,
                state,
                row,
                db_session,
            )
        ]

    stream_task = asyncio.create_task(consume())
    assert await asyncio.to_thread(generator_started.wait, 3)
    cancelled = await resource_plans.cancel_plan(
        seeded_plan.plan_id,
        PlanActionRequest(student_id=seeded_plan.student_id, version=1),
        db_session,
    )
    allow_generator_return.set()
    events = await asyncio.wait_for(stream_task, timeout=5)

    await db_session.refresh(row)
    assert cancelled.plan.status == "cancelled"
    assert row.status == "cancelled"
    assert row.artifact["status"] == "cancelled"
    assert calls == {"generator": 1, "reviewer": 0}

    decoded = [
        (
            event.splitlines()[0].removeprefix("event: "),
            json.loads(event.split("data: ", 1)[1].split("\n", 1)[0]),
        )
        for event in events
    ]
    assert all(event_name != "error" for event_name, _payload in decoded)
    done_payloads = [payload for event_name, payload in decoded if event_name == "done"]
    assert done_payloads == [
        {
            "run_id": trace_run_id,
            "status": "cancelled",
            "completed": False,
            "error_code": "cancelled_by_user",
            "retryable": False,
        }
    ]
    trace_payloads = [payload for event_name, payload in decoded if event_name == "trace"]
    assert any(
        payload.get("parent_span_id") is None and payload.get("status") == "cancelled"
        for payload in trace_payloads
    )
    assert not any(payload.get("status") == "failed" for payload in trace_payloads)


@pytest.mark.asyncio
async def test_completed_plan_streams_one_result_summary_not_resource_bodies(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()

    resources = [
        {
            "id": task.task_id,
            "task_id": task.task_id,
            "type": task.type,
            "title": task.title,
            "explanation": f"PRIVATE BODY {task.task_id}",
            "review_approved": True,
        }
        for task in plan.tasks
    ]
    reviews = {
        task.task_id: {
            "approved": True,
            "score": 1.0,
            "issues": [],
            "fixes": [],
            "retry_count": 0,
        }
        for task in plan.tasks
    }
    final_state = {
        "resources": resources,
        "reviews": reviews,
        "task_progress": {
            task.task_id: {"status": "ready"} for task in plan.tasks
        },
        "coverage": {"complete": True, "missing_task_ids": []},
        "schedule": [],
        "trace_run_id": "single-summary-run",
    }

    class CompletedGraph:
        def stream(self, state, *, stream_mode, config=None):
            for resource in resources:
                yield ("custom", {"event": "content", "task_id": resource["task_id"], "data": resource})
            yield ("values", final_state)

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    events = [
        event
        async for event in resource_plans.stream_and_persist_planned_execution(
            CompletedGraph(),
            resource_plans.build_planned_state(plan, {}),
            row,
            db_session,
        )
    ]
    decoded = [
        (
            event.splitlines()[0].removeprefix("event: "),
            json.loads(event.split("data: ", 1)[1].split("\n", 1)[0]),
        )
        for event in events
    ]
    event_names = [name for name, _payload in decoded]
    assert "content" not in event_names
    assert "content_start" not in event_names
    assert "content_delta" not in event_names
    assert event_names.count("result_start") == 1
    assert event_names.count("result") == 1
    assert event_names[-1] == "done"
    deltas = [payload["delta"] for name, payload in decoded if name == "result_delta"]
    assert len(deltas) >= 2
    summary = "".join(deltas)
    assert "学习路径已生成完成" in summary
    assert f"{len(plan.tasks)} 份资料全部通过审核" in summary
    assert "PRIVATE BODY" not in "".join(events)


@pytest.mark.asyncio
async def test_replan_replaces_artifact_at_next_version(db_session, seeded_plan, monkeypatch):
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanActionRequest

    replacement = sample_plan_dict()
    replacement["days"][0]["title"] = "线性表：存储模型与操作代价"
    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    monkeypatch.setattr(
        resource_plans,
        "build_resource_plan",
        lambda **kwargs: resource_plans.PlanArtifact.model_validate(replacement),
    )

    response = await resource_plans.replan(
        seeded_plan.plan_id,
            PlanActionRequest(
                student_id=seeded_plan.student_id,
                version=1,
                feedback="增加复杂度分析",
                learning_baseline={"source":"self_report","level":"basic","confidence":0.6,"summary":"略懂基础"},
        ),
        db_session,
    )

    assert response.plan.version == 2
    assert response.plan.plan_id == seeded_plan.plan_id
    assert response.plan.days[0].title == "线性表：存储模型与操作代价"


@pytest.mark.asyncio
async def test_complex_plan_requires_explicit_execution_confirmation(db_session, seeded_plan):
    from app.routers.resource_plans import execute_plan
    from app.schemas.resource_plan import PlanExecuteRequest

    with pytest.raises(HTTPException) as exc:
        await execute_plan(
            seeded_plan.plan_id,
            PlanExecuteRequest(
                student_id=seeded_plan.student_id,
                version=seeded_plan.version,
                confirm=False,
            ),
            db_session,
        )

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_complex_plan_executes_after_explicit_confirmation(db_session, seeded_plan):
    from app.routers.resource_plans import execute_plan
    from app.schemas.resource_plan import PlanExecuteRequest

    response = await execute_plan(
        seeded_plan.plan_id,
        PlanExecuteRequest(
            student_id=seeded_plan.student_id,
            version=seeded_plan.version,
            confirm=True,
        ),
        db_session,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_approved_simple_plan_executes_without_confirmation(db_session, seeded_plan):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import execute_plan
    from app.schemas.resource_plan import PlanExecuteRequest
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = seeded_plan.model_copy(deep=True)
    plan.status = "approved"
    row.status = "approved"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()

    response = await execute_plan(
        seeded_plan.plan_id,
        PlanExecuteRequest(
            student_id=seeded_plan.student_id,
            version=seeded_plan.version,
            confirm=False,
        ),
        db_session,
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_running_plan_rejects_a_second_execution_claim(db_session, seeded_plan):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import execute_plan
    from app.schemas.resource_plan import PlanExecuteRequest
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = seeded_plan.model_copy(deep=True)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {
        "resources": [{"id": "explainer-d1", "task_id": "explainer-d1"}],
        "schedule": [],
        "task_progress": {"explainer-d1": {"status": "ready"}},
    }
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await execute_plan(
            seeded_plan.plan_id,
            PlanExecuteRequest(
                student_id=seeded_plan.student_id,
                version=seeded_plan.version,
                confirm=False,
            ),
            db_session,
        )

    assert exc.value.status_code == 409
    assert "正在执行" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_failed_plan_retry_keeps_approved_resources_and_resets_failed_task(
    db_session,
    seeded_plan,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import execute_plan
    from app.schemas.resource_plan import PlanExecuteRequest, TaskReview
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = seeded_plan.model_copy(deep=True)
    plan.status = "failed"
    plan.tasks[0].status = "ready"
    plan.tasks[0].review = TaskReview(
        approved=True, score=1, issues=[], fixes=[]
    )
    plan.tasks[1].status = "failed"
    plan.tasks[1].retry_count = 1
    plan.tasks[1].review = TaskReview(
        approved=False,
        score=0.5,
        issues=["缺少解析"],
        fixes=["补充解析"],
    )
    row.status = "failed"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {
        "resources": [
            {"id": "explainer-d1", "task_id": "explainer-d1"},
            {"id": "quiz-d2", "task_id": "quiz-d2"},
        ],
        "reviews": {
            "explainer-d1": {"approved": True},
            "quiz-d2": {"approved": False, "retry_count": 1},
        },
    }
    await db_session.commit()

    response = await execute_plan(
        seeded_plan.plan_id,
        PlanExecuteRequest(
            student_id=seeded_plan.student_id,
            version=seeded_plan.version,
            confirm=False,
        ),
        db_session,
    )

    assert response.status_code == 200
    await db_session.refresh(row)
    assert [item["task_id"] for item in row.execution_state["resources"]] == [
        "explainer-d1"
    ]
    refreshed = row.artifact
    failed_task = next(task for task in refreshed["tasks"] if task["task_id"] == "quiz-d2")
    assert failed_task["status"] == "pending"
    assert failed_task["retry_count"] == 0
    assert failed_task["review"] is None


@pytest.mark.asyncio
async def test_resumable_approved_checkpoint_drops_stale_failures_and_old_budget(
    db_session,
    seeded_plan,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers.resource_plans import execute_plan
    from app.schemas.resource_plan import PlanExecuteRequest, TaskReview
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = seeded_plan.model_copy(deep=True)
    plan.status = "approved"
    plan.tasks[0].status = "ready"
    plan.tasks[0].review = TaskReview(approved=True, score=1)
    plan.tasks[1].status = "failed"
    plan.tasks[1].review = TaskReview(approved=False, score=0)
    row.status = "approved"
    row.artifact = plan.model_dump(mode="json")
    row.execution_state = {
        "trace_run_id": "old-run",
        "run_started_at": 1.0,
        "retry_policy": {"max_model_calls": 36},
        "resources": [
            {"id": "explainer-d1", "task_id": "explainer-d1"},
            {"id": "quiz-d2", "task_id": "quiz-d2"},
        ],
        "reviews": {
            "explainer-d1": {"approved": True, "score": 1},
            "quiz-d2": {"approved": False, "score": 0, "retry_count": 2},
        },
    }
    await db_session.commit()

    response = await execute_plan(
        seeded_plan.plan_id,
        PlanExecuteRequest(
            student_id=seeded_plan.student_id,
            version=seeded_plan.version,
            confirm=False,
        ),
        db_session,
    )

    assert response.status_code == 200
    await db_session.refresh(row)
    assert row.status == "running"
    assert row.execution_state["trace_run_id"] != "old-run"
    assert row.execution_state["run_started_at"] > 1.0
    assert row.execution_state["retry_policy"]["max_model_calls"] >= 48
    assert list(row.execution_state["reviews"]) == ["explainer-d1"]
    assert [item["task_id"] for item in row.execution_state["resources"]] == [
        "explainer-d1"
    ]
    failed_task = next(
        task for task in row.artifact["tasks"] if task["task_id"] == "quiz-d2"
    )
    assert failed_task["status"] == "pending"
    assert failed_task["review"] is None


@pytest.mark.asyncio
async def test_partial_quality_failure_keeps_plan_retryable(db_session, seeded_plan, monkeypatch):
    from app.core.config import settings
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()

    final_state = {
        "resources": [
            {"id": "explainer-d1", "task_id": "explainer-d1"},
            {"id": "quiz-d2", "task_id": "quiz-d2"},
        ],
        "reviews": {
            "explainer-d1": {"approved": True, "score": 1, "issues": [], "fixes": []},
            "quiz-d2": {
                "approved": False,
                "score": 0.5,
                "issues": ["缺少解析"],
                "fixes": ["补充解析"],
                "retry_count": 1,
            },
        },
        "coverage": {"complete": False, "missing_task_ids": ["quiz-d2"]},
        "schedule": [],
        "trace_run_id": "test-run",
    }

    class FinalStateGraph:
        config = None

        def stream(self, state, *, stream_mode, config=None):
            self.config = config
            yield ("values", final_state)

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    graph = FinalStateGraph()
    _ = [
        event
        async for event in resource_plans.stream_and_persist_planned_execution(
            graph,
            resource_plans.build_planned_state(plan, {}),
            row,
            db_session,
        )
    ]

    await db_session.refresh(row)
    assert graph.config == {
        "max_concurrency": min(30, max(1, settings.AGENT_MAX_CONCURRENCY)),
        "recursion_limit": 256,
    }
    assert row.status == "failed"
    assert row.artifact["status"] == "failed"
    assert row.artifact["tasks"][0]["status"] == "ready"
    assert row.artifact["tasks"][1]["status"] == "failed"
    assert "缺少解析" in row.last_error
    assert [item["task_id"] for item in row.execution_state["resources"]] == ["explainer-d1"]


@pytest.mark.asyncio
async def test_terminal_persistence_marks_tasks_without_resources_as_failed(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()

    final_state = {
        "resources": [{"id": "explainer-d1", "task_id": "explainer-d1"}],
        "reviews": {
            "explainer-d1": {
                "approved": True,
                "score": 1.0,
                "issues": [],
                "fixes": [],
                "retry_count": 0,
            }
        },
        "task_progress": {
            "explainer-d1": {"status": "running"},
            "quiz-d2": {"status": "pending"},
        },
        "coverage": {"complete": False, "missing_task_ids": ["quiz-d2"]},
        "schedule": [],
        "trace_run_id": "test-run",
    }

    class FinalStateGraph:
        def stream(self, state, *, stream_mode, config=None):
            yield ("values", final_state)

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    _ = [
        event
        async for event in resource_plans.stream_and_persist_planned_execution(
            FinalStateGraph(),
            resource_plans.build_planned_state(plan, {}),
            row,
            db_session,
        )
    ]

    await db_session.refresh(row)
    task_statuses = {task["task_id"]: task["status"] for task in row.artifact["tasks"]}
    progress = row.execution_state["task_progress"]
    missing_review = row.execution_state["reviews"]["quiz-d2"]

    assert set(task_statuses.values()) <= {"ready", "failed"}
    assert task_statuses == {"explainer-d1": "ready", "quiz-d2": "failed"}
    assert {item["status"] for item in progress.values()} <= {"ready", "failed"}
    assert progress["quiz-d2"]["status"] == "failed"
    assert missing_review["approved"] is False
    assert "任务未产生可审核资料" in missing_review["issues"][0]
    assert row.last_error


@pytest.mark.asyncio
async def test_failed_done_is_emitted_when_terminal_persistence_fails(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()

    class DoneGraph:
        def stream(self, state, *, stream_mode, config=None):
            yield ("custom", {"event": "done", "task_total": len(plan.tasks)})

    original_commit = db_session.commit
    commit_calls = 0

    async def fail_terminal_commit_once():
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == 1:
            raise RuntimeError("terminal commit failed")
        await original_commit()

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    monkeypatch.setattr(db_session, "commit", fail_terminal_commit_once)
    events = [
        event
        async for event in resource_plans.stream_and_persist_planned_execution(
            DoneGraph(),
            resource_plans.build_planned_state(plan, {}),
            row,
            db_session,
        )
    ]

    event_names = [event.splitlines()[0] for event in events]
    assert event_names == ["event: trace", "event: error", "event: trace", "event: done"]
    assert "terminal commit failed" in events[1]
    done = json.loads(events[-1].split("data: ", 1)[1].split("\n", 1)[0])
    assert done["status"] == "failed"
    assert done["completed"] is False


@pytest.mark.asyncio
async def test_failed_transaction_rolls_back_before_persisting_resumable_state(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()

    duplicate_payload = {
        "id": row.id,
        "student_id": row.student_id,
        "version": row.version,
        "status": row.status,
        "request_text": row.request_text,
        "artifact": row.artifact,
        "validation": row.validation,
        "execution_state": row.execution_state,
        "last_error": row.last_error,
    }
    db_session.expunge(row)
    db_session.add(ResourceGenerationPlan(**duplicate_payload))
    with pytest.raises(IntegrityError):
        await db_session.flush()

    class DoneGraph:
        def stream(self, state, *, stream_mode, config=None):
            yield ("custom", {"event": "done", "task_total": len(plan.tasks)})

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    events = [
        event
        async for event in resource_plans.stream_and_persist_planned_execution(
            DoneGraph(),
            resource_plans.build_planned_state(plan, {}),
            row,
            db_session,
        )
    ]

    recovered = await db_session.get(ResourceGenerationPlan, seeded_plan.plan_id)
    event_names = [event.splitlines()[0] for event in events]
    assert event_names == ["event: trace", "event: error", "event: trace", "event: done"]
    done = json.loads(events[-1].split("data: ", 1)[1].split("\n", 1)[0])
    assert done["status"] == "failed"
    assert recovered.status == "approved"
    assert recovered.last_error


@pytest.mark.asyncio
async def test_global_failure_appends_to_task_failure_reasons(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()
    final_state = {
        "resources": [
            {"id": "explainer-d1", "task_id": "explainer-d1"},
            {"id": "quiz-d2", "task_id": "quiz-d2"},
        ],
        "reviews": {
            "explainer-d1": {
                "approved": False,
                "score": 0.0,
                "issues": ["explainer quality failed"],
                "fixes": ["retry explainer"],
                "retry_count": 1,
            },
            "quiz-d2": {
                "approved": True,
                "score": 1.0,
                "issues": [],
                "fixes": [],
                "retry_count": 0,
            },
        },
    }

    class FailingGraph:
        def stream(self, state, *, stream_mode, config=None):
            yield ("values", final_state)
            raise RuntimeError("graph crashed")

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    _ = [
        event
        async for event in resource_plans.stream_and_persist_planned_execution(
            FailingGraph(),
            resource_plans.build_planned_state(plan, {}),
            row,
            db_session,
        )
    ]

    await db_session.refresh(row)
    assert "explainer quality failed" in row.last_error
    assert "graph crashed" in row.last_error
    assert len(row.last_error) <= 1000


@pytest.mark.asyncio
async def test_cancellation_appends_to_task_failure_reasons(
    db_session,
    seeded_plan,
    monkeypatch,
):
    from app.models.learning import ResourceGenerationPlan
    from app.routers import resource_plans
    from app.schemas.resource_plan import PlanArtifact
    from sqlalchemy import select

    row = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == seeded_plan.plan_id)
    )
    plan = PlanArtifact.model_validate(row.artifact)
    plan.status = "running"
    row.status = "running"
    row.artifact = plan.model_dump(mode="json")
    await db_session.commit()
    final_state = {
        "resources": [{"id": "explainer-d1", "task_id": "explainer-d1"}],
        "reviews": {
            "explainer-d1": {
                "approved": False,
                "score": 0.0,
                "issues": ["explainer provider failed"],
                "fixes": ["retry explainer"],
                "retry_count": 1,
            }
        },
    }

    async def cancel_after_values(*args, **kwargs):
        yield ("values", final_state)
        raise asyncio.CancelledError

    monkeypatch.setattr(resource_plans, "load_plan_context", lambda *args: ({}, []))
    monkeypatch.setattr(resource_plans, "astream_via_thread", cancel_after_values)
    with pytest.raises(asyncio.CancelledError):
        _ = [
            event
            async for event in resource_plans.stream_and_persist_planned_execution(
                object(),
                resource_plans.build_planned_state(plan, {}),
                row,
                db_session,
            )
        ]

    await db_session.refresh(row)
    assert "explainer provider failed" in row.last_error
    assert "SSE 连接中断" in row.last_error
    assert len(row.last_error) <= 1000
