"""Behavioral contracts for policy, overlapping queues, provenance and recovery."""
import copy
import threading

import pytest

from app.schemas.resource_plan import PlanArtifact
from app.services.orchestration_profiles import resolve_policy
from app.services.artifact_versions import content_hash, review_matches
from tests.test_resource_plan_models import sample_plan_dict


def plan(effort="standard"):
    payload = sample_plan_dict()
    payload["collaboration"] = {"effort": effort}
    payload["tasks"][1]["depends_on"] = []
    return PlanArtifact.model_validate(payload)


def candidate(task):
    return {"id": task["task_id"], "task_id": task["task_id"], "type": task["type"],
            "title": task["title"], "content": "随机访问 插入删除 LIFO FIFO", "retry_count": task.get("retry_count", 0)}


@pytest.fixture
def workers(monkeypatch):
    from app.graph import planned_resource_graph as graph
    def generate(state):
        return {"resources": [candidate(state["plan_task"])]}
    def review(state, **kwargs):
        task = state["plan_task"]
        return {"reviews": {task["task_id"]: {"approved": True, "score": 1., "retry_count": task.get("retry_count", 0)}}}
    monkeypatch.setattr(graph, "run_planned_task", generate)
    monkeypatch.setattr(graph, "review_tasks", review)
    return graph


def test_manual_effort_does_not_change_scope_or_network_permission():
    tasks = [t.model_dump() for t in plan().tasks]
    policies = [resolve_policy({"effort": e, "sources": {"web": False}}, tasks) for e in ("fast", "standard", "deep", "rigorous")]
    assert all(p["sources"]["web"] is False and p["generation_concurrency"] == 4 for p in policies)
    assert [p["effective_effort"] for p in policies] == ["fast", "standard", "deep", "rigorous"]
    assert policies[0]["repair_rounds"] < policies[2]["repair_rounds"]
    assert policies[3]["independent_review"]
    assert resolve_policy({"effort": "auto", "auto_max_effort": "fast"}, tasks * 8)["effective_effort"] == "fast"
    assert [t["task_id"] for t in tasks] == ["explainer-d1", "quiz-d2"]


def test_dependency_released_before_unrelated_slow_generation_finishes(workers, monkeypatch):
    p = plan()
    child = p.tasks[0].model_copy(deep=True)
    child.task_id = "child-d1"
    child.depends_on = ["explainer-d1"]
    p.tasks.append(child)
    p.days[0].task_ids.append(child.task_id)
    child_started = threading.Event()
    slow_started = threading.Event()
    def generate(state):
        task = state["plan_task"]
        if task["task_id"] == "quiz-d2":
            slow_started.set()
            assert child_started.wait(3), "downstream waited for unrelated slow task"
        elif task["task_id"] == "explainer-d1":
            assert slow_started.wait(3)
        else:
            assert state["reviews"]["explainer-d1"]["approved"]
            child_started.set()
        return {"resources": [candidate(task)]}
    monkeypatch.setattr(workers, "run_planned_task", generate)
    result = workers.planned_resource_app.invoke(workers.build_planned_state(p, {}))
    assert result["delivery_status"] == "completed"
    assert [b["task_id"] for b in result["bindings"]] == [t.task_id for t in p.tasks]
    assert all(b["content_hash"] for b in result["bindings"])


def test_failed_dependency_is_terminal_and_never_generated(workers, monkeypatch):
    p = plan()
    p.tasks[1].depends_on = [p.tasks[0].task_id]
    calls = []
    def generate(state):
        calls.append(state["plan_task"]["task_id"])
        return {"reviews": {calls[-1]: {"approved": False, "terminal": True, "retryable": False, "issues": ["provider unavailable"]}}}
    monkeypatch.setattr(workers, "run_planned_task", generate)
    result = workers.planned_resource_app.invoke(workers.build_planned_state(p, {}))
    assert calls == ["explainer-d1"]
    assert result["reviews"]["quiz-d2"]["failure_kind"] == "dependency_blocked"
    assert result["bindings"] == []
    assert result["delivery_status"] == "failed"


def test_deep_has_bounded_additional_repair_and_no_auto_approval(workers, monkeypatch):
    def review(state, **kwargs):
        task = state["plan_task"]
        return {"reviews": {task["task_id"]: {"approved": False, "failure_kind": "quality", "retry_count": task.get("retry_count", 0), "retryable": True}}}
    monkeypatch.setattr(workers, "review_tasks", review)
    for effort, retries in [("fast", 1), ("deep", 2)]:
        result = workers.planned_resource_app.invoke(workers.build_planned_state(plan(effort), {}))
        assert all(r["retry_count"] == retries and not r["approved"] for r in result["reviews"].values())
        assert result["delivery_status"] == "failed"


def test_independent_rejection_cannot_be_outvoted(workers, monkeypatch):
    monkeypatch.setattr("app.services.resource_grounding.verify_resource_semantics", lambda *_: {"approved": False, "issues": ["答案错误"]})
    result = workers.planned_resource_app.invoke(workers.build_planned_state(plan("rigorous"), {}))
    assert not result["bindings"]
    assert all(not r["approved"] for r in result["reviews"].values())


def test_independent_review_keeps_repaired_candidate_version_and_retry_budget(workers, monkeypatch):
    from app.schemas.resource_plan import TaskReview
    calls = []

    def independent(resource, task, evidence):
        calls.append((task["task_id"], task.get("retry_count", 0)))
        return {"approved": task.get("retry_count", 0) > 0, "issues": ["需修正"] if not task.get("retry_count") else []}

    # Reproduce the semantic gate rebuilding a review with default counters.
    def gate(review, resource, task, evidence, semantic_verifier):
        verdict = semantic_verifier()
        return TaskReview(approved=verdict["approved"], score=1.0,
                          issues=verdict["issues"], blocking_issues=verdict["issues"])

    monkeypatch.setattr("app.services.resource_grounding.verify_resource_semantics", independent)
    monkeypatch.setattr("app.services.resource_grounding.apply_grounding_gate", gate)
    monkeypatch.setattr("app.services.plan_consistency.review_consistency", lambda _: {"approved": True, "blocking": {}})
    result = workers.planned_resource_app.invoke(workers.build_planned_state(plan("rigorous"), {}))
    assert result["delivery_status"] == "completed"
    assert len(calls) == 4
    assert all(r["retry_count"] == 1 and r["artifact_version"] == 2 for r in result["reviews"].values())


def test_cross_review_revokes_dependent_binding(workers, monkeypatch):
    p = plan("deep")
    p.tasks[1].depends_on = [p.tasks[0].task_id]
    monkeypatch.setattr("app.services.plan_consistency.review_consistency", lambda _: {"approved": False, "blocking": {"explainer-d1": ["与练习答案矛盾"]}})
    result = workers.planned_resource_app.invoke(workers.build_planned_state(p, {}))
    assert result["bindings"] == []
    assert result["reviews"]["quiz-d2"]["failure_kind"] == "dependency_blocked"
    assert result["reviews"]["explainer-d1"]["retry_count"] == 2


def test_cross_review_repairs_and_rechecks_new_dependent_versions(workers, monkeypatch):
    p = plan("deep")
    p.tasks[1].depends_on = [p.tasks[0].task_id]
    generated, checked = [], []

    def generate(state):
        task = state["plan_task"]
        generated.append((task["task_id"], task.get("retry_count", 0)))
        if task.get("retry_count"):
            assert task["_repair_instructions"]
            if task["depends_on"]:
                assert state["reviews"]["explainer-d1"]["approved"]
                assert state["reviews"]["explainer-d1"]["artifact_version"] == 2
        return {"resources": [candidate(task)]}

    def consistency(state):
        checked.append({r["task_id"]: r["artifact_version"] for r in state["resources"]})
        if len(checked) == 1:
            return {"approved": False, "blocking": {"explainer-d1": ["讲义与题目结论冲突"]}}
        return {"approved": True, "blocking": {}}

    monkeypatch.setattr(workers, "run_planned_task", generate)
    monkeypatch.setattr("app.services.plan_consistency.review_consistency", consistency)
    result = workers.planned_resource_app.invoke(workers.build_planned_state(p, {}))
    assert result["delivery_status"] == "completed"
    assert len(checked) == 2 and set(checked[-1].values()) == {2}
    assert sorted(generated) == [("explainer-d1", 0), ("explainer-d1", 1), ("quiz-d2", 0), ("quiz-d2", 1)]
    assert all(b["artifact_version"] == 2 for b in result["bindings"])


def test_mutated_or_legacy_auto_approved_candidate_is_not_publishable():
    resource = {"task_id": "one", "content": "first", "retry_count": 0, "plan_version": 1}
    review = {"approved": True, "content_hash": content_hash(resource), "retry_count": 0, "plan_version": 1}
    assert review_matches(resource, review)
    assert not review_matches({**resource, "content": "changed"}, review)
    assert not review_matches({**resource, "plan_version": 2}, review)
    assert not review_matches(resource, {**review, "auto_released": True})


def test_source_restriction_never_reads_course_or_network(monkeypatch):
    from app.services import evidence
    monkeypatch.setattr(evidence, "check_knowledge_gate", lambda *_: pytest.fail("course read forbidden"))
    monkeypatch.setattr("app.services.web_search.bocha_search", lambda *_args, **_kw: pytest.fail("network forbidden"))
    gate = evidence.collect_evidence("队列", "alice", policy={"course": False, "personal": False, "web": False},
                                     attachments=[{"id": "attachment-1", "content": "指定教材原文", "metadata": {"document_id": "attachment-1"}}])
    assert gate.matched
    assert gate.context[0]["metadata"]["owner_id"] == "alice"
    assert gate.context[0]["evidence_version"]
    assert evidence.personal_collection("alice") != evidence.personal_collection("bob")


def test_web_fallback_uses_body_instead_of_search_snippet(monkeypatch):
    from app.services import evidence
    monkeypatch.setattr("app.services.web_search.bocha_search", lambda *_args, **_kw: [{"title": "教材", "url": "https://example.org/book", "snippet": "wrong snippet"}])
    monkeypatch.setattr("app.services.web_search.fetch_readable_text", lambda *_args, **_kw: "真实教材正文，介绍队列先进先出的行为。" * 30)
    result = evidence.collect_evidence("队列", "alice", policy={"course": False, "personal": False, "web": True})
    assert result.matched
    assert all("wrong snippet" not in c["content"] for c in result.context)
    assert result.context[0]["metadata"]["url"] == "https://example.org/book"


def test_journal_is_idempotent_and_owner_scoped(workers):
    from sqlalchemy import select
    from app.core.config import sync_session
    from app.models.learning import OrchestrationRecord
    from app.services.orchestration_journal import record
    state = workers.build_planned_state(plan(), {})
    record(state, "candidate", "one", {"content": "draft"})
    record(state, "candidate", "one", {"content": "draft"})
    with sync_session() as db:
        rows = db.scalars(select(OrchestrationRecord).where(OrchestrationRecord.run_id == state["trace_run_id"])).all()
        assert len(rows) == 1
        assert rows[0].student_id == state["student_id"]


def test_render_metadata_preserves_approved_script_identity():
    from app.services.artifact_versions import content_hash, review_matches
    script = {"type": "video", "narration": "队列先进先出", "retry_count": 0}
    review = {"approved": True, "content_hash": content_hash(script)}
    rendered = {**script, "media_task_id": "render-1", "media_status": "rendering"}
    assert review_matches(rendered, review)
    assert not review_matches({**rendered, "narration": "队列后进先出"}, review)


def test_review_adapter_only_sets_supported_provider_parameter():
    from app.services.review_model import adapt_review_model
    class Model:
        model_name = "mimo-v2.5"
        def bind(self, **kwargs):
            self.options = kwargs
            return self
    mimo = Model()
    assert adapt_review_model(mimo).options == {"extra_body": {"thinking": {"type": "disabled"}}}
    other = Model()
    other.model_name = "another-model"
    assert adapt_review_model(other) is other
    assert not hasattr(other, "options")


@pytest.mark.asyncio
async def test_disconnect_does_not_cancel_background_plan_and_reconnect_replays(monkeypatch):
    import asyncio
    from app.services import execution_streams
    permit = asyncio.Event()
    class DB:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, *args): return object()
    async def producer(*args):
        yield 'event: progress\ndata: {"step":1}\n\n'
        await permit.wait()
        yield 'event: done\ndata: {"completed":true}\n\n'
    monkeypatch.setattr(execution_streams, "async_session", DB)
    monkeypatch.setattr("app.routers.resource_plans.stream_and_persist_planned_execution", producer)
    execution_streams.start_execution("reconnect-test", {}, None)
    subscriber = execution_streams.subscribe("reconnect-test")
    assert "progress" in await anext(subscriber)
    await subscriber.aclose()
    assert not execution_streams._workers["reconnect-test"]["task"].done()
    permit.set()
    await asyncio.wait_for(execution_streams._workers["reconnect-test"]["task"], 1)
    replay = [event async for event in execution_streams.subscribe("reconnect-test")]
    assert len(replay) == 2 and '"completed":true' in replay[-1]
    execution_streams._workers.pop("reconnect-test")
