from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
async def db_session():
    from app.models import learning  # noqa: F401
    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def _sample_plan():
    from app.schemas.resource_plan import PlanArtifact

    return PlanArtifact.model_validate(
        {
            "plan_id": "plan-adapter-test",
            "student_id": "student-1",
            "version": 1,
            "status": "approved",
            "request_summary": "生成动态规划学习资料",
            "complexity": {"level": "simple", "reasons": [], "auto_execute": True},
            "constraints": {
                "days": 1,
                "daily_minutes": 40,
                "difficulty": "适中",
                "material_types": ["explainer", "quiz"],
            },
            "days": [
                {
                    "day": "D1",
                    "title": "动态规划专题",
                    "knowledge_points": ["动态规划"],
                    "objective": "理解动态规划并完成练习",
                    "minutes": 40,
                    "prerequisites": [],
                    "task_ids": ["explain-dp", "quiz-dp"],
                    "actions": ["学习讲义", "完成练习"],
                }
            ],
            "tasks": [
                {
                    "task_id": "explain-dp",
                    "day": "D1",
                    "agent": "explainer",
                    "type": "explainer",
                    "title": "动态规划讲义",
                    "knowledge_points": ["动态规划"],
                    "difficulty": "适中",
                    "audience": "当前学习者",
                    "outline": {
                        "objective": "解释动态规划的状态与转移",
                        "sections": [
                            {
                                "title": "状态与转移",
                                "goal": "解释状态定义和转移方程",
                                "must_cover": ["动态规划"],
                                "target_words": 300,
                            }
                        ],
                    },
                    "quality_criteria": ["包含定义和示例"],
                    "source_ids": ["kb-1"],
                    "depends_on": [],
                },
                {
                    "task_id": "quiz-dp",
                    "day": "D1",
                    "agent": "quiz",
                    "type": "quiz",
                    "title": "动态规划测验",
                    "knowledge_points": ["动态规划"],
                    "difficulty": "适中",
                    "audience": "当前学习者",
                    "outline": {
                        "objective": "检查动态规划理解",
                        "sections": [
                            {
                                "title": "状态检查",
                                "goal": "检查状态定义和转移",
                                "must_cover": ["动态规划"],
                                "target_words": 200,
                            }
                        ],
                    },
                    "quality_criteria": ["2 道题且包含答案解析"],
                    "source_ids": ["kb-1"],
                    "depends_on": [],
                },
            ],
            "validation": {"valid": True, "errors": [], "warnings": []},
        }
    )


def test_production_code_has_no_legacy_resource_graph_import() -> None:
    import app

    app_root = Path(app.__file__).resolve().parent
    offenders: list[str] = []
    for path in app_root.rglob("*.py"):
        if path.name == "resource_graph.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "app.graph.resource_graph":
                offenders.append(str(path.relative_to(app_root)))
            if isinstance(node, ast.Import) and any(
                alias.name == "app.graph.resource_graph" for alias in node.names
            ):
                offenders.append(str(path.relative_to(app_root)))
    assert offenders == []


def test_explicit_single_type_projects_to_exactly_one_task_and_final_candidate() -> None:
    from app.schemas.resource import ResourceRequest
    from app.services.planned_resource_pipeline import approved_resources, project_plan_to_request

    request = ResourceRequest(
        topic="动态规划",
        student_id="student-1",
        material_types=["explainer"],
    )
    plan = project_plan_to_request(
        _sample_plan(),
        request,
        [{"id": "kb-1", "content": "动态规划使用状态转移复用子问题。"}],
    )
    assert len(plan.tasks) == 1
    assert plan.tasks[0].type == "explainer"
    assert plan.days[0].task_ids == [plan.tasks[0].task_id]

    task_id = plan.tasks[0].task_id
    candidates = approved_resources(
        {
            "resources": [
                {"task_id": task_id, "type": "explainer", "retry_count": 0, "title": "旧版"},
                {"task_id": task_id, "type": "explainer", "retry_count": 1, "title": "修复版"},
            ],
            "reviews": {task_id: {"approved": True, "retry_count": 1}},
        }
    )
    assert [item["title"] for item in candidates] == ["修复版"]
    assert candidates[0]["review_approved"] is True


@pytest.mark.asyncio
async def test_adapter_runs_planned_graph_and_persists_only_approved_final(monkeypatch):
    from app.schemas.resource import ResourceRequest
    from app.services import planned_resource_pipeline as pipeline

    class Gate:
        matched = True
        context = [{"id": "kb-1", "content": "动态规划使用状态转移复用子问题。"}]

    monkeypatch.setattr(pipeline, "check_knowledge_gate", lambda *args: Gate())
    monkeypatch.setattr("app.agents.profiler.get_profile", lambda *_args: {})
    monkeypatch.setattr(
        pipeline,
        "build_resource_plan",
        lambda **_kwargs: pytest.fail("explicit resource types must not call the model planner"),
    )
    planned_graph = object()
    monkeypatch.setattr(pipeline, "planned_resource_app", planned_graph)
    seen_graph: list[object] = []

    async def fake_stream(graph, state, modes, config=None):
        seen_graph.append(graph)
        task_id = state["plan"]["tasks"][0]["task_id"]
        yield "custom", {
            "event": "content",
            "task_id": task_id,
            "agent": "explainer",
            "data": {"title": "未审核候选"},
        }
        yield "values", {
            **state,
            "resources": [
                {"task_id": task_id, "type": "explainer", "title": "旧版", "retry_count": 0},
                {"task_id": task_id, "type": "explainer", "title": "批准版", "retry_count": 1},
            ],
            "reviews": {task_id: {"approved": True, "retry_count": 1}},
        }

    monkeypatch.setattr(pipeline, "astream_via_thread", fake_stream)
    persisted: list[dict[str, Any]] = []

    async def persist(resources):
        persisted.extend(resources)
        return len(resources)

    events = [
        item
        async for item in pipeline.stream_planned_resource_pipeline(
            ResourceRequest(
                topic="动态规划",
                student_id="student-1",
                material_types=["explainer"],
            ),
            persist=persist,
            source="form",
            run_id="resource-adapter-test",
        )
    ]
    assert seen_graph == [planned_graph]
    assert [item["title"] for item in persisted] == ["批准版"]
    assert [payload["data"]["title"] for event, payload in events if event == "content"] == ["批准版"]
    assert next(payload for event, payload in events if event == "saved")["count"] == 1
    assert next(payload for event, payload in events if event == "done")["status"] == "completed"


def test_explicit_request_plan_is_valid_and_uses_exact_selected_types() -> None:
    from app.schemas.resource import ResourceRequest
    from app.services.planned_resource_pipeline import build_explicit_request_plan

    plan = build_explicit_request_plan(
        ResourceRequest(
            topic="0-1 背包",
            student_id="student-1",
            material_types=["explainer"],
            knowledge_points="状态定义、状态转移、滚动数组",
        ),
        [{"id": "kb-1", "content": "0-1 背包的状态转移方程。"}],
    )

    assert plan.validation.valid is True
    assert [task.type for task in plan.tasks] == ["explainer"]
    assert plan.days[0].task_ids == [plan.tasks[0].task_id]
    assert plan.tasks[0].source_ids == ["kb-1"]
    assert plan.tasks[0].knowledge_points == ["状态定义", "状态转移", "滚动数组"]


def test_parent_cancel_propagates_to_child_run() -> None:
    from app.core.run_control import (
        is_run_cancelled,
        register_run,
        release_run,
        request_run_cancel,
        run_owner,
    )

    register_run("chat-parent", owner_id="student-1")
    register_run("resource-child", parent_run_id="chat-parent")
    try:
        assert run_owner("resource-child") == "student-1"
        request_run_cancel("chat-parent")
        assert is_run_cancelled("chat-parent") is True
        assert is_run_cancelled("resource-child") is True
    finally:
        release_run("resource-child")
        release_run("chat-parent")


def test_explicit_model_call_budget_stops_retry() -> None:
    from app.graph.planned_resource_graph import _review_can_retry

    review = {"approved": False, "retryable": True, "retry_count": 0}
    state = {
        "run_started_at": 0,
        "retry_policy": {
            "max_run_seconds": 10**12,
            "max_total_attempts": 36,
            "max_model_calls": 1,
        },
        "reviews": {"task-1": review},
    }
    assert _review_can_retry(review, state) is False


def test_run_scoped_model_call_budget_is_atomic_and_finite() -> None:
    from app.core.run_control import (
        RunBudgetExceeded,
        model_calls_used,
        register_run,
        release_run,
        reserve_model_calls,
    )

    run_id = "resource-model-budget-test"
    register_run(run_id, model_call_limit=2)
    try:
        assert reserve_model_calls(run_id) == 1
        assert reserve_model_calls(run_id) == 2
        with pytest.raises(RunBudgetExceeded, match="budget exhausted"):
            reserve_model_calls(run_id)
        assert model_calls_used(run_id) == 2
    finally:
        release_run(run_id)


@pytest.mark.asyncio
async def test_approved_quiz_publication_is_idempotent(db_session) -> None:
    from app.models.learning import ExamPaper, GeneratedMaterial
    from app.routers.materials import _save_material_once

    resource = {
        "type": "quiz",
        "title": "动态规划测验",
        "questions": [
            {
                "stem": "动态规划通常复用什么？",
                "options": ["重叠子问题", "随机输入"],
                "answer": "重叠子问题",
                "explanation": "状态保存已求解的子问题。",
            }
        ],
        "reviewed": True,
        "review_approved": True,
    }
    first, first_created = await _save_material_once(
        db_session,
        publication_key="request-123:0",
        student_id="student-1",
        type="quiz",
        title="动态规划测验",
        knowledge_points="动态规划",
        data=resource,
        source="form",
    )
    second, second_created = await _save_material_once(
        db_session,
        publication_key="request-123:0",
        student_id="student-1",
        type="quiz",
        title="动态规划测验",
        knowledge_points="动态规划",
        data=resource,
        source="form",
    )
    await db_session.commit()

    material_count = await db_session.scalar(select(func.count(GeneratedMaterial.id)))
    paper_count = await db_session.scalar(select(func.count(ExamPaper.id)))
    assert first.id == second.id
    assert first.exam_id == second.exam_id
    assert first_created is True
    assert second_created is False
    assert material_count == 1
    assert paper_count == 1


def _approved_external_candidate() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    content = "动态规划通过定义状态和状态转移复用重叠子问题。" * 10
    resource = {
        "student_id": "student-token",
        "type": "reading",
        "title": "动态规划学习笔记",
        "subtitle": "状态与转移",
        "meta": ["网页"],
        "sources": 1,
        "knowledge_points": "动态规划",
        "data": {
            "content": content,
            "sources": [{"title": "课程资料", "url": "https://example.com/dp"}],
        },
        "source": "web",
    }
    evidence = [{"id": "https://example.com/dp", "content": content}]
    return resource, evidence


@pytest.mark.asyncio
async def test_direct_save_requires_matching_server_approval(
    db_session,
    monkeypatch,
) -> None:
    from app.routers.materials import MaterialSave, save_material
    from app.services import material_approval

    monkeypatch.setattr(
        material_approval,
        "verify_resource_semantics",
        lambda *_args: {"approved": True, "issues": [], "claim_evidence": []},
    )

    resource, evidence = _approved_external_candidate()
    token, review = material_approval.issue_material_approval(
        resource["student_id"],
        resource,
        evidence_context=evidence,
    )
    assert review.approved is True
    assert token

    for invalid in ("", "forged.token"):
        with pytest.raises(HTTPException) as exc:
            await save_material(MaterialSave(**resource, approval_token=invalid), db_session)
        assert exc.value.status_code == 403

    tampered = {**resource, "title": "被篡改的标题"}
    with pytest.raises(HTTPException) as exc:
        await save_material(MaterialSave(**tampered, approval_token=token), db_session)
    assert exc.value.status_code == 403

    saved = await save_material(MaterialSave(**resource, approval_token=token), db_session)
    assert saved["title"] == resource["title"]
    assert saved["source"] == "web"
    assert saved["review_approved"] is True


@pytest.mark.asyncio
async def test_material_reads_hide_unapproved_and_enforce_owner(db_session) -> None:
    from app.routers.materials import (
        _save_material,
        get_material,
        list_materials,
    )

    rejected = _save_material(
        db_session,
        student_id="student-1",
        type="explainer",
        title="被驳回候选",
        knowledge_points="动态规划",
        data={"review_approved": False},
        source="form",
    )
    approved = _save_material(
        db_session,
        student_id="student-1",
        type="explainer",
        title="最终批准版",
        knowledge_points="动态规划",
        data={"reviewed": True, "review_approved": True},
        source="form",
    )
    await db_session.commit()

    listed = await list_materials("student-1", db=db_session)
    assert [item["id"] for item in listed] == [approved.id]
    assert listed[0]["review_approved"] is True

    detail = await get_material(approved.id, "student-1", db_session)
    assert detail["data"]["review_approved"] is True
    for material_id, student_id in (
        (rejected.id, "student-1"),
        (approved.id, "student-2"),
    ):
        with pytest.raises(HTTPException) as exc:
            await get_material(material_id, student_id, db_session)
        assert exc.value.status_code == 404


def test_external_material_reviewer_failure_issues_no_approval_token(monkeypatch) -> None:
    from app.services import material_approval
    from app.services.resource_grounding import ReviewUnavailable

    def unavailable(*_args):
        raise ReviewUnavailable("semantic provider offline")

    monkeypatch.setattr(material_approval, "verify_resource_semantics", unavailable)
    resource, evidence = _approved_external_candidate()

    token, review = material_approval.issue_material_approval(
        resource["student_id"],
        resource,
        evidence_context=evidence,
    )

    assert token is None
    assert review.approved is False
    assert review.gate_status == "review_unavailable"
    assert review.failure_kind == "reviewer"
    assert review.error_code == "review_unavailable"
    assert review.retryable is True
