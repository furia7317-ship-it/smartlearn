"""Curriculum invariants and real database execution, without provider calls."""
import copy
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_db
from app.models.focus import FocusGraph, FocusJob, FocusOperation, FocusPackage, FocusProgress
from app.routers.auth import get_current_account
from app.routers.focus import router
from app.schemas.focus import CourseGraph, StateAction, prerequisites_met, validate_graph
from app.services.focus import apply_action, ensure_catalog, grade, safe_package, snapshot
from app.services.focus_catalog import frontend_graph, starter_html_package


@pytest_asyncio.fixture
async def database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [m.__table__ for m in (FocusGraph, FocusJob, FocusOperation, FocusPackage, FocusProgress)]
    async with engine.begin() as connection:
        for table in tables:
            await connection.run_sync(table.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        await ensure_catalog(db, "alice")
        yield db, factory
    await engine.dispose()


async def graph_row(db):
    return await db.scalar(select(FocusGraph).where(FocusGraph.student_id == "alice"))


def action(revision=0, **changes):
    return StateAction(request_id=f"operation-{revision}-{changes.get('action', 'start')}", revision=revision, node_id="fe.html", action="start", **{k: v for k, v in changes.items() if k != "action"}) if "action" not in changes else StateAction(request_id=f"operation-{revision}-{changes['action']}", revision=revision, node_id="fe.html", **changes)


def test_reviewed_graph_has_real_splits_joins_and_choice_route():
    graph = frontend_graph()
    assert len(graph.nodes) == 36
    data = next(n for n in graph.nodes if n.id == "fe.data")
    assert not prerequisites_met(data, {"fe.fetch"})
    assert prerequisites_met(data, {"fe.dom", "fe.fetch"})
    assert prerequisites_met(data, {"fe.dom", "fe.axios"})
    assert not prerequisites_met(data, {"fe.dom"})
    assert len([n for n in graph.nodes if not n.prerequisites.all_of]) > 3


@pytest.mark.parametrize("problem", ["duplicate", "missing", "cycle", "coverage", "empty-choice", "module", "source"])
def test_invalid_agent_graph_cannot_publish(problem):
    graph = frontend_graph().model_dump()
    if problem == "duplicate": graph["nodes"][1]["id"] = graph["nodes"][0]["id"]
    if problem == "missing": graph["nodes"][0]["prerequisites"]["all_of"] = ["missing"]
    if problem == "cycle": graph["nodes"][0]["prerequisites"]["all_of"] = ["fe.dom"]
    if problem == "coverage": graph["knowledge_inventory"].append("missing-knowledge")
    if problem == "empty-choice": graph["nodes"][0]["prerequisites"]["any_of_groups"] = [[]]
    if problem == "module": graph["nodes"][0]["module_id"] = "missing"
    if problem == "source": graph["nodes"][0]["source_ids"] = ["invented"]
    with pytest.raises(ValueError): validate_graph(CourseGraph.model_validate(graph))


@pytest.mark.asyncio
async def test_time_changes_never_recreate_graph_or_erase_work(database):
    db, _ = database
    row = await graph_row(db)
    original = copy.deepcopy(row.payload)
    started = await apply_action(db, "alice", row.id, action())
    assert started["state"]["active_node_id"] == "fe.html"
    read = await apply_action(db, "alice", row.id, action(1, action="task", task="lesson", package_version=1))
    assert read["state"]["nodes"]["fe.html"]["status"] == "active"
    changed = await apply_action(db, "alice", row.id, action(2, action="budget", daily_minutes=15))
    assert sum(t["minutes"] for t in changed["state"]["plan"]["tasks"]) <= 15
    assert changed["state"]["nodes"]["fe.html"]["tasks"] == ["lesson"]
    assert row.payload == original and row.version == 1
    paused = await apply_action(db, "alice", row.id, action(3, action="pause"))
    assert paused["state"]["nodes"]["fe.html"]["status"] == "paused"
    assert paused["state"]["nodes"]["fe.html"]["tasks"] == ["lesson"]


@pytest.mark.asyncio
async def test_idempotency_and_optimistic_concurrency(database):
    db, _ = database
    row = await graph_row(db)
    original = action()
    first = await apply_action(db, "alice", row.id, original)
    assert await apply_action(db, "alice", row.id, original) == first
    with pytest.raises(HTTPException) as stale:
        await apply_action(db, "alice", row.id, StateAction(request_id="stale-request", revision=0, node_id="fe.html", action="pause"))
    assert stale.value.status_code == 409
    with pytest.raises(HTTPException) as reused:
        await apply_action(db, "alice", row.id, original.model_copy(update={"node_id": "fe.css"}))
    assert reused.value.status_code == 409


@pytest.mark.asyncio
async def test_only_server_scores_pass_and_a_failed_review_keeps_pass(database):
    db, _ = database
    row = await graph_row(db)
    package = await db.scalar(select(FocusPackage))
    public = safe_package(package)
    assert all("answer" not in q and "explanation" not in q for q in public["questions"])
    wrong = {q["id"]: "B" if q["answer"] == "A" else "A" for q in package.content["questions"]}
    failed = await apply_action(db, "alice", row.id, action(0, action="submit", package_version=1, answers=wrong))
    assert failed["assessment"]["passed"] is False
    assert not failed["state"]["nodes"]["fe.html"]["passed_at"]
    answers = {q["id"]: q["answer"] for q in package.content["questions"]}
    passed = await apply_action(db, "alice", row.id, action(1, action="submit", package_version=1, answers=answers))
    assert passed["assessment"]["passed"] and passed["state"]["nodes"]["fe.html"]["status"] == "passed"
    reviewed = await apply_action(db, "alice", row.id, action(2, action="submit", package_version=1, answers=wrong))
    assert reviewed["state"]["nodes"]["fe.html"]["status"] == "passed"
    assert reviewed["state"]["nodes"]["fe.dom"]["status"] == "locked"  # JavaScript still required.
    with pytest.raises(ValueError):
        StateAction.model_validate({"request_id": "forged-pass", "revision": 3, "action": "submit", "passed": True})


@pytest.mark.asyncio
async def test_routes_enforce_ownership_and_prepare_is_deduplicated(database):
    db, _ = database
    row = await graph_row(db)
    app = FastAPI()
    app.include_router(router, prefix="/focus")
    async def dependency(): yield db
    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_current_account] = lambda: SimpleNamespace(id="alice")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post(f"/focus/courses/{row.id}/nodes/fe.css/prepare", json={"request_id": "prepare-one"})
        second = await client.post(f"/focus/courses/{row.id}/nodes/fe.css/prepare", json={"request_id": "prepare-two"})
        assert first.status_code == second.status_code == 200
        assert first.json()["job"]["id"] == second.json()["job"]["id"]
        blocked = await client.post(f"/focus/courses/{row.id}/actions", json={"request_id": "locked-start", "revision": 0, "action": "start", "node_id": "fe.vue"})
        assert blocked.status_code == 409
        app.dependency_overrides[get_current_account] = lambda: SimpleNamespace(id="bob")
        for url in (f"/focus/courses/{row.id}", f"/focus/courses/{row.id}/nodes/fe.html/package", f"/focus/jobs/{first.json()['job']['id']}"):
            assert (await client.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_durable_generation_failure_preserves_existing_course(database, monkeypatch):
    db, factory = database
    from app.services import focus_generation
    row = await graph_row(db)
    original = copy.deepcopy(row.payload)
    db.add(FocusJob(id="failing-job", student_id="alice", kind="graph", target="course-new", status="pending", input={"title": "New", "goal": "Goal", "source_outline": "Data"}, result={}))
    await db.commit()
    monkeypatch.setattr(focus_generation, "async_session", factory)
    def fail(_): raise ValueError("invalid generated graph")
    monkeypatch.setattr(focus_generation, "generate_graph", fail)
    assert await focus_generation.process_next_job()
    db.expire_all()
    job = await db.get(FocusJob, "failing-job")
    assert job.status == "failed"
    refreshed = await graph_row(db)
    assert refreshed.payload == original and refreshed.status == "published"


@pytest.mark.asyncio
async def test_draft_edits_validate_before_publish_and_published_graph_is_immutable(database):
    db, _ = database
    payload = frontend_graph().model_dump()
    draft = FocusGraph(id="editable-draft", student_id="alice", course_id="new-course", version=1, status="draft", origin="generated", payload=payload)
    db.add(draft)
    await db.commit()
    app = FastAPI()
    app.include_router(router, prefix="/focus")
    async def dependency(): yield db
    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_current_account] = lambda: SimpleNamespace(id="alice")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        invalid = copy.deepcopy(payload)
        invalid["nodes"][0]["prerequisites"]["all_of"] = ["fe.dom"]
        assert (await client.post("/focus/courses/editable-draft/draft", json=invalid)).status_code == 422
        assert draft.version == 1
        payload["nodes"][0]["objective"] = "Explain semantic HTML and implement a readable page."
        saved = await client.post("/focus/courses/editable-draft/draft", json=payload)
        assert saved.status_code == 200 and saved.json()["version"] == 2
        published = await client.post("/focus/courses/editable-draft/publish", json={})
        assert published.status_code == 200 and published.json()["status"] == "published"
        assert (await client.post("/focus/courses/editable-draft/draft", json=payload)).status_code == 409
        assert (await client.post("/focus/courses/editable-draft/publish", json={})).status_code == 200
        assert len((await db.scalars(select(FocusProgress).where(FocusProgress.graph_id == draft.id))).all()) == 1
