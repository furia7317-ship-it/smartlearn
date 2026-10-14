"""Regression coverage for real generation failures found during recording."""
import json

import pytest

from app.services.resource_quality import review_resource
from app.services.resource_grounding import apply_grounding_gate


REQUIREMENT = "对空栈或空队列操作未做判空检查，导致运行时错误"
EVIDENCE = "弹出元素之前先检查容器是否为空；如果为空，就返回提示，避免索引异常。"


def fixture_candidate():
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict
    plan = PlanArtifact.model_validate(sample_plan_dict())
    task = plan.tasks[0]
    task.outline.sections[0].must_cover = [REQUIREMENT]
    task.outline.sections = task.outline.sections[:1]
    task.quality_criteria = ["包含边界处理说明"]
    resource = {"id": "candidate", "task_id": task.task_id, "type": "explainer",
                "explanation": EVIDENCE + "学习时先画出元素的进入和离开过程，再逐步执行代码确认输出。" * 15}
    return plan, task.model_dump(mode="json"), resource


def gate(resource, task, coverage, *, approved=True):
    return apply_grounding_gate(
        review_resource(resource, task), resource, task, [],
        semantic_verifier=lambda *_: {"approved": approved, "issues": [] if approved else ["内容缺失"],
                                     "coverage": coverage},
    )


def test_equivalent_explanation_is_accepted_only_with_semantic_evidence():
    _, task, resource = fixture_candidate()
    assert not review_resource(resource, task).approved
    assert not gate(resource, task, []).approved
    review = gate(resource, task, [{"index": 0, "covered": True, "evidence": EVIDENCE}])
    assert review.approved
    assert review.semantic_coverage == [REQUIREMENT]


@pytest.mark.parametrize("coverage", [
    [{"index": 0, "covered": True, "evidence": "这是一段不存在于实际候选正文里的伪造证据文字，应拒绝通过审核。"}],
    [{"index": 0, "covered": False, "evidence": EVIDENCE}],
    [{"index": True, "covered": True, "evidence": EVIDENCE}],
    [{"index": 99, "covered": True, "evidence": EVIDENCE}],
])
def test_missing_invalid_or_fabricated_coverage_does_not_approve(coverage):
    _, task, resource = fixture_candidate()
    assert not gate(resource, task, coverage).approved


def test_semantic_coverage_cannot_override_fact_or_structure_failure():
    _, task, resource = fixture_candidate()
    coverage = [{"index": 0, "covered": True, "evidence": EVIDENCE}]
    assert not gate(resource, task, coverage, approved=False).approved
    resource.update(type="code", code="def broken(:", language="python")
    review = gate(resource, task, coverage)
    assert not review.approved
    assert any("语法错误" in issue for issue in review.blocking_issues)


def test_code_quote_ignores_added_fences_and_accepts_separate_real_excerpts():
    _, task, resource = fixture_candidate()
    resource['explanation'] += '\n```python\nstack.append(1)\nprint(stack)\nstack.pop()\n```'
    review = gate(resource, task, [{"index": 0, "covered": True,
        "evidence": ['```python\nstack.append(1)\n```', '`stack.pop()`']}])
    assert review.approved


def test_short_descriptive_requirement_can_be_verified_semantically():
    _, task, resource = fixture_candidate()
    task['outline']['sections'][0]['must_cover'] = ['栈与队列的对比']
    quote = '前者在一端插入删除，后者在两端分别插入和删除，处理次序不同。'
    resource['explanation'] += quote
    assert not review_resource(resource, task).approved
    assert gate(resource, task, [{"index": 0, "covered": True, "evidence": [quote]}]).approved


def test_numbered_content_evidence_is_stable_without_copying_prose():
    _, task, resource = fixture_candidate()
    review = gate(resource, task, [{"index": 0, "covered": True, "line_numbers": [1]}])
    assert review.approved
    assert review.semantic_coverage_evidence[0]['line_numbers'] == [1]


@pytest.mark.parametrize('line_numbers', [[0], [-1], [999], [True], [], ['1']])
def test_invalid_content_line_references_cannot_approve(line_numbers):
    _, task, resource = fixture_candidate()
    assert not gate(resource, task, [{"index": 0, "covered": True, "line_numbers": line_numbers}]).approved


def test_sqlite_reader_does_not_block_live_event_writes(tmp_path):
    import sqlite3
    from app.core.config import _configure_sqlite_connection
    filename = str(tmp_path / 'concurrent.sqlite')
    with sqlite3.connect(filename) as setup:
        _configure_sqlite_connection(setup, None)
        setup.execute('CREATE TABLE events (value TEXT)')
        setup.execute("INSERT INTO events VALUES ('first')")
    reader = sqlite3.connect(filename)
    writer = sqlite3.connect(filename, timeout=.25)
    try:
        reader.execute('BEGIN')
        assert reader.execute('SELECT * FROM events').fetchall() == [('first',)]
        writer.execute("INSERT INTO events VALUES ('second')")
        writer.commit()
        reader.rollback()
        assert reader.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 2
    finally:
        reader.close()
        writer.close()


def test_final_coverage_uses_only_hash_matched_semantic_review():
    from app.services.artifact_versions import content_hash
    from app.services.resource_coverage import audit_plan_coverage
    plan, task, resource = fixture_candidate()
    review = gate(resource, task, [{"index": 0, "covered": True, "evidence": EVIDENCE}]).model_dump()
    review["content_hash"] = content_hash(resource)
    reviews = {task["task_id"]: review}
    assert task["task_id"] in audit_plan_coverage(plan, [resource], reviews)["ready_task_ids"]
    resource["explanation"] = "修改后实际缺少全部边界处理说明。" * 20
    assert task["task_id"] in audit_plan_coverage(plan, [resource], reviews)["failed_task_ids"]
    resource["review_approved"] = True
    resource["_semantic_covered_requirements"] = [REQUIREMENT]
    assert task["task_id"] in audit_plan_coverage(plan, [resource])["failed_task_ids"]


@pytest.mark.asyncio
async def test_terminal_pipeline_failure_cannot_restart_with_rephrased_arguments():
    from app.agent.harness import AgentHarness
    calls = []
    events = []

    async def dispatch(name, args, **_):
        calls.append((name, args))
        return json.dumps({"error": {"code": "run_time_budget_exhausted", "retryable": False,
                                     "retry_requires_user": True}})

    async def emit(event, data):
        events.append((event, data))

    harness = AgentHarness(object(), "model", [], {"generate_learning_material"},
                           emit=emit, dispatch=dispatch, student_id="student", max_turns=4)
    turns = iter([
        ("", [{"id": "one", "name": "generate_learning_material", "arguments": '{"topic":"栈与队列"}'}]),
        ("", [{"id": "two", "name": "generate_learning_material", "arguments": '{"topic":"重新生成栈和队列"}'}]),
        ("本次生成未完成，可以调整要求后重试。", []),
    ])

    async def stream_turn(_messages, *, turn=0):
        return next(turns)

    harness._stream_turn = stream_turn
    result = await harness.run([{"role": "user", "content": "生成讲义"}])
    assert len(calls) == 1
    assert result.finished_naturally
    failed = [data for event, data in events if event == "trace" and data.get("status") == "failed"]
    assert failed and all(data.get("retryable") is False for data in failed)


@pytest.mark.asyncio
async def test_planning_latency_does_not_consume_execution_budget(monkeypatch):
    from types import SimpleNamespace
    from app.schemas.resource import ResourceRequest
    from app.services import planned_resource_pipeline as pipeline
    clock = [1000.0]
    monkeypatch.setattr(pipeline, "time", SimpleNamespace(time=lambda: clock[0]))

    def collect(*_, **__):
        clock[0] = 1250.0  # A slow evidence/planning stage.
        return SimpleNamespace(matched=True, context=[{"id": "kb-1", "content": "栈使用后进先出的顺序。"}])

    monkeypatch.setattr(pipeline, "collect_evidence", collect)
    monkeypatch.setattr("app.services.evidence.collect_evidence", collect)
    monkeypatch.setattr("app.agents.profiler.get_profile", lambda *_: {})
    starts = []

    async def stream(_graph, state, _modes, config=None):
        starts.append(state["run_started_at"])
        yield "values", {**state, "coverage": {"complete": False}, "delivery_status": "failed"}

    monkeypatch.setattr(pipeline, "astream_via_thread", stream)
    _ = [event async for event in pipeline.stream_planned_resource_pipeline(
        ResourceRequest(topic="栈", student_id="student", material_types=["explainer"]),
        persist=None, source="form", run_id="phase-budget-regression",
    )]
    assert starts == [1250.0]


def test_fast_single_lecture_compiles_full_contract_without_a_planner():
    from app.schemas.resource import ResourceRequest
    from app.services.planned_resource_pipeline import _can_compile_fast_lecture, _build_fast_lecture_plan
    request = ResourceRequest(topic='栈与队列', student_id='student', material_types=['explainer'],
        collaboration={'effort': 'fast'},
        requirements='生成一份讲义，约600字。说明LIFO与FIFO，用一张表对比栈和队列，各举一个生活例子，并提醒两个常见误区。不需要练习或代码。')
    assert _can_compile_fast_lecture(request)
    plan = _build_fast_lecture_plan(request, [{'id': 'kb-real', 'content': '课程教材'}])
    assert len(plan.tasks) == 1 and plan.validation.valid
    task = plan.tasks[0]
    assert request.requirements in task.outline.objective
    assert task.outline.sections[0].target_words == 600
    assert '并提醒两个常见误区' in task.outline.sections[0].must_cover
    assert task.source_ids == ['kb-real']
    assert task.review is None  # Compilation never approves content or bypasses review.
    assert not review_resource({'type': 'explainer', 'explanation': '内容缺失'}, task.model_dump()).approved


@pytest.mark.parametrize('changes', [
    {'collaboration': {'effort': 'deep'}}, {'planning_mode': 'learning_path'},
    {'material_types': ['explainer', 'quiz']}, {'requirements': '生成两份讲义，约600字。'},
    {'requirements': '生成一份讲义，约3000字。'},
    {'requirements': '生成一份讲义，每天讲解一个主题。'},
])
def test_fast_compiler_does_not_shrink_complex_requests(changes):
    from app.schemas.resource import ResourceRequest
    from app.services.planned_resource_pipeline import _can_compile_fast_lecture
    data = dict(topic='栈与队列', student_id='student', material_types=['explainer'],
                collaboration={'effort': 'fast'}, requirements='生成一份讲义，约600字。')
    data.update(changes)
    assert not _can_compile_fast_lecture(ResourceRequest(**data))
