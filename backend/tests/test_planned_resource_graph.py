"""Approved-plan execution graph contracts."""

from __future__ import annotations

import asyncio
import threading

import pytest


@pytest.fixture(autouse=True)
def _stub_production_semantic_reviewer(monkeypatch):
    """Keep graph unit tests provider-free; semantic behavior is overridden explicitly."""

    from app.graph import planned_resource_graph as graph

    monkeypatch.setattr(
        graph,
        "verify_resource_semantics",
        lambda *_args: {"approved": True, "issues": [], "claim_evidence": []},
    )


class RecordingGraph:
    def __init__(self, chunks):
        self.chunks = chunks
        self.config = None

    def stream(self, state, *, stream_mode, config=None):
        self.config = config
        yield from self.chunks


def test_planned_generators_receive_exact_task_outline(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    seen = []

    def fake_agent(state):
        seen.append(
            (
                state["plan_task"]["task_id"],
                state["resource_outline"],
                state["kb_context"],
            )
        )
        return {"title": state["plan_task"]["title"], "overview": "真实内容"}

    monkeypatch.setattr(graph, "get_agent", lambda name: fake_agent)
    plan = PlanArtifact.model_validate(sample_plan_dict())
    result = graph.run_planned_task(
        {
            "plan": plan.model_dump(mode="json"),
            "student_id": plan.student_id,
            "plan_task": plan.tasks[0].model_dump(mode="json"),
            "profile": {},
            "kb_context": [
                {"id": "kb-1", "content": "应使用"},
                {"id": "kb-2", "content": "不应使用"},
            ],
            "resources": [],
            "reviews": {},
            "repair_task_ids": [],
            "retry_round": 0,
            "trace_run_id": "test-run",
        }
    )

    assert seen[0][0] == "explainer-d1"
    assert seen[0][1]["sections"][0]["title"] == "存储布局"
    assert [item["id"] for item in seen[0][2]] == ["kb-1"]
    assert result["resources"][0]["task_id"] == "explainer-d1"


def test_worker_generation_does_not_emit_its_own_reasoning_summary(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    emitted = []
    monkeypatch.setattr(graph, "_emit", emitted.append)
    monkeypatch.setattr(
        graph,
        "get_agent",
        lambda _name: lambda state: {
            "title": state["plan_task"]["title"],
            "overview": "用于验证逐任务公开摘要。",
        },
    )
    plan = PlanArtifact.model_validate(sample_plan_dict())
    task = plan.tasks[0].model_dump(mode="json")

    graph.run_planned_task(
        {
            "plan": plan.model_dump(mode="json"),
            "student_id": plan.student_id,
            "plan_task": task,
            "profile": {},
            "kb_context": [{"id": "kb-1", "content": "数组与链表依据"}],
            "resources": [],
            "reviews": {},
            "repair_task_ids": [],
            "retry_round": 0,
            "trace_run_id": "task-summary-run",
        }
    )

    summaries = [
        event
        for event in emitted
        if event.get("event") == "trace"
        and event.get("kind") == "reasoning_summary"
    ]
    assert summaries == []


def test_orchestrator_emits_one_summary_before_and_after_a_tool_batch(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    emitted = []
    monkeypatch.setattr(graph, "_emit", emitted.append)
    payload = sample_plan_dict()
    payload["tasks"][1]["depends_on"] = []
    plan = PlanArtifact.model_validate(payload)
    base_state = {
        "plan": plan.model_dump(mode="json"),
        "student_id": plan.student_id,
        "resources": [],
        "reviews": {},
        "trace_run_id": "batch-summary-run",
        "run_started_at": 0.0,
        "retry_policy": {"max_run_seconds": 10**12},
    }

    dispatched = graph.dispatch_tasks(base_state)
    assert isinstance(dispatched, list)
    before = [
        event for event in emitted
        if event.get("event_type") == "reasoning"
    ]
    assert len(before) == 1
    assert before[0]["agent_id"] == "orchestrator"
    assert "作为一批" in before[0]["reasoning_text"]

    emitted.clear()
    approved = {
        task.task_id: {
            "approved": True,
            "retry_count": 0,
            "terminal": True,
        }
        for task in plan.tasks
    }
    routed = graph.dispatch_tasks({**base_state, "reviews": approved})
    assert routed == "coverage"
    after = [
        event for event in emitted
        if event.get("event_type") == "reasoning"
    ]
    assert len(after) == 1
    assert after[0]["agent_id"] == "orchestrator"
    assert "这一批工具结果已返回" in after[0]["reasoning_text"]


def test_quiz_task_forwards_the_planned_question_count(monkeypatch):
    from app.graph import planned_resource_graph as graph

    seen = {}

    def fake_agent(state):
        seen.update(state)
        return {
            "title": state["plan_task"]["title"],
            "questions": [
                {
                    "stem": f"第 {index + 1} 题",
                    "options": ["A. 正确", "B. 错误"],
                    "answer": "A",
                    "explanation": "用于验证题量配置。",
                }
                for index in range(state["quiz_config"]["choice"])
            ],
        }

    monkeypatch.setattr(graph, "get_agent", lambda name: fake_agent)
    task = {
        "task_id": "quiz-d1",
        "day": 1,
        "type": "quiz",
        "title": "栈的练习题",
        "agent": "quiz",
        "depends_on": [],
        "quality_criteria": ["包含 2 道练习题"],
        "outline": {"objective": "检验 LIFO", "sections": []},
    }

    graph.run_planned_task(
        {
            "plan": {"plan_id": "plan-1"},
            "student_id": 1,
            "plan_task": task,
            "profile": {},
            "kb_context": [],
            "resources": [],
            "reviews": {},
            "repair_task_ids": [],
            "retry_round": 0,
            "trace_run_id": "test-run",
        }
    )

    assert seen["quiz_config"] == {"choice": 2, "judge": 0, "short": 0}


def test_planned_task_receives_approved_dependency_summaries(monkeypatch):
    from app.graph import planned_resource_graph as graph

    seen = {}

    def fake_agent(state):
        seen.update(state)
        return {"title": state["plan_task"]["title"], "questions": []}

    monkeypatch.setattr(graph, "get_agent", lambda name: fake_agent)
    task = {
        "task_id": "quiz-d2",
        "day": "D2",
        "type": "quiz",
        "title": "依赖讲义的测验",
        "agent": "quiz",
        "depends_on": ["explainer-d1"],
        "quality_criteria": ["2 道题"],
        "outline": {"objective": "检验理解", "sections": []},
    }

    graph.run_planned_task(
        {
            "plan": {"plan_id": "plan-1"},
            "student_id": "student-1",
            "plan_task": task,
            "profile": {},
            "kb_context": [],
            "resources": [
                {
                    "task_id": "explainer-d1",
                    "title": "数组与链表讲义",
                    "type": "explainer",
                    "overview": "数组连续存储，链表通过指针连接。",
                }
            ],
            "reviews": {"explainer-d1": {"approved": True}},
            "repair_task_ids": [],
            "retry_round": 0,
            "trace_run_id": "test-run",
        }
    )

    assert seen["dependency_outputs"] == [
        {
            "task_id": "explainer-d1",
            "title": "数组与链表讲义",
            "type": "explainer",
            "summary": "数组与链表讲义\n数组连续存储，链表通过指针连接。",
        }
    ]


def test_done_event_is_emitted_after_delivery_completion(monkeypatch):
    from app.graph import planned_resource_graph as graph

    emitted = []
    monkeypatch.setattr(graph, "_emit", emitted.append)

    graph.finalize_generation(
        {
            "plan": {
                "tasks": [
                    {"task_id": "task-1"},
                    {"task_id": "task-2"},
                    {"task_id": "task-3"},
                ]
            },
            "resources": [
                {"task_id": "task-1"},
                {"task_id": "task-2"},
                {"task_id": "task-3"},
            ],
            "reviews": {
                "task-1": {"approved": True},
                "task-2": {"approved": True},
                "task-3": {"approved": False, "retry_count": 1},
            },
            "trace_run_id": "test-run",
        }
    )

    assert emitted[-1] == {
        "event": "done",
        "task_total": 3,
        "generated_total": 3,
        "ready_total": 2,
        "failed_total": 1,
        "completed": False,
        "error_code": "resource_review_failed",
        "failure_detail": "资料在一次定向返工后仍未通过质量门禁",
    }
    delivery = [
        event
        for event in emitted
        if event.get("phase") == "delivery" and event.get("status") == "failed"
    ][-1]
    assert delivery["status"] == "failed"
    assert emitted[-2]["event_type"] == "reasoning"
    assert emitted[-2]["agent_id"] == "orchestrator"


def test_dispatch_waits_until_task_dependencies_have_results():
    from app.graph.planned_resource_graph import dispatch_tasks
    from app.schemas.resource_plan import PlanArtifact
    from langgraph.types import Send
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    state = {
        "plan": plan.model_dump(mode="json"),
        "student_id": plan.student_id,
        "resources": [],
        "reviews": {},
    }
    first = dispatch_tasks(state)
    assert [send.arg["plan_task"]["task_id"] for send in first if isinstance(send, Send)] == [
        "explainer-d1"
    ]

    state["resources"] = [{"task_id": "explainer-d1", "title": "讲义"}]
    assert dispatch_tasks(state) == "review_tasks"
    state["reviews"] = {"explainer-d1": {"approved": True}}
    second = dispatch_tasks(state)
    assert [send.arg["plan_task"]["task_id"] for send in second if isinstance(send, Send)] == [
        "quiz-d2"
    ]


def test_compiled_graph_runs_dependency_layers_without_duplicate_tasks(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    def fake_agent(name):
        if name == "quiz":
            return lambda state: {
                "title": state["plan_task"]["title"],
                "questions": [
                    {
                        "stem": "栈遵循哪种顺序？",
                        "options": ["A. LIFO", "B. FIFO"],
                        "answer": "A",
                        "explanation": "栈后进先出，队列先进先出。",
                    }
                    for _ in range(5)
                ],
            }
        return lambda state: {
            "title": state["plan_task"]["title"],
            "overview": "顺序存储与链式存储的真实对比",
            "explanation": (
                "数组随机访问的时间复杂度为 O(1)，链表随机访问为 O(n)。"
                "例如查询密集场景选择数组，频繁插入删除场景适合链表。" * 12
            ),
            "key_points": ["随机访问", "插入删除"],
        }

    monkeypatch.setattr(graph, "get_agent", fake_agent)
    plan = PlanArtifact.model_validate(sample_plan_dict())

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 3},
    )

    assert [resource["task_id"] for resource in result["resources"]] == [
        "explainer-d1",
        "quiz-d2",
    ]
    assert result["schedule"][0]["steps"][0]["resources"][0]["id"] == "explainer-d1"
    assert result["coverage"]["complete"] is True


def test_fast_task_review_overlaps_a_slow_parallel_generation(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][1]["depends_on"] = []
    plan = PlanArtifact.model_validate(payload)
    fast_review_started = threading.Event()

    def fake_agent(name):
        def run(state):
            task_id = state["plan_task"]["task_id"]
            if task_id == "explainer-d1":
                assert fast_review_started.wait(timeout=2), (
                    "the fast task should enter review before the slow generation returns"
                )
                return {
                    "title": "数组与链表",
                    "overview": "顺序存储和链式存储",
                    "explanation": "数组支持随机访问，链表通过指针连接。" * 20,
                    "key_points": ["随机访问", "插入删除"],
                }
            return {
                "title": "栈练习",
                "questions": [
                    {
                        "stem": "栈遵循哪种顺序？",
                        "options": ["A. LIFO", "B. FIFO"],
                        "answer": "A",
                        "explanation": "栈后进先出。",
                    }
                    for _ in range(5)
                ],
            }

        return run

    def verify_semantics(_resource, task, _kb_context):
        if task["task_id"] == "quiz-d2":
            fast_review_started.set()
        return {"approved": True, "issues": [], "claim_evidence": []}

    monkeypatch.setattr(graph, "get_agent", fake_agent)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(graph, "verify_resource_semantics", verify_semantics)

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 2},
    )

    assert fast_review_started.is_set()
    assert result["coverage"]["complete"] is True


def test_quality_review_retries_only_the_failed_task_once(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    calls = 0

    def fake_agent(state):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"title": "数组与链表", "overview": "只有数组"}
        return {
            "title": "数组与链表",
            "overview": "顺序存储和链式存储的对比",
            "explanation": (
                "数组随机访问的时间复杂度为 O(1)，链表随机访问为 O(n)。"
                "例如查询密集场景选择数组，频繁插入删除场景适合链表。" * 12
            ),
            "key_points": ["随机访问", "插入删除"],
        }

    monkeypatch.setattr(graph, "get_agent", lambda name: fake_agent)
    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 3},
    )

    assert calls == 2
    assert result["reviews"]["explainer-d1"]["approved"] is True
    assert result["reviews"]["explainer-d1"]["retry_count"] == 1


def test_near_pass_stops_after_the_single_targeted_rework():
    from app.graph.planned_resource_graph import route_after_quality_review

    state = {
        "plan": {"tasks": [{"task_id": "dp-d1", "status": "failed"}]},
        "reviews": {
            "dp-d1": {
                "approved": False,
                "score": 0.82,
                "blocking_issues": ["大纲必须覆盖点缺失：边界初始化"],
                "issues": ["大纲必须覆盖点缺失：边界初始化"],
                "warnings": ["示例数量无法可靠判断"],
                "fixes": ["请在对应字段或正文中显式补写：大纲必须覆盖点缺失：边界初始化"],
                "retry_count": 1,
            }
        },
    }

    routed = route_after_quality_review(state)
    assert routed == "coverage"


def test_low_score_review_does_not_schedule_a_second_rework():
    from app.graph.planned_resource_graph import route_after_quality_review

    state = {
        "plan": {"tasks": [{"task_id": "dp-d1", "status": "failed"}]},
        "reviews": {
            "dp-d1": {
                "approved": False,
                "score": 0.42,
                "blocking_issues": ["讲义正文过短，至少需要 100 个字符"],
                "issues": ["讲义正文过短，至少需要 100 个字符"],
                "warnings": [],
                "retry_count": 1,
            }
        },
    }

    routed = route_after_quality_review(state)
    assert routed == "coverage"


def test_quality_candidate_is_auto_released_after_one_rework():
    from app.graph.planned_resource_graph import _auto_release_after_rework_limit

    released = _auto_release_after_rework_limit(
        {
            "approved": False,
            "failure_kind": "quality",
            "retry_count": 1,
            "issues": ["示例覆盖仍不完整"],
            "blocking_issues": ["缺少边界案例"],
            "warnings": [],
            "repair_instructions": [{"action": "补充边界案例"}],
        },
        {"task_id": "dp-d1", "type": "explainer"},
    )

    assert released["approved"] is True
    assert released["auto_released"] is True
    assert released["gate_status"] == "approved_after_rework_limit"
    assert released["blocking_issues"] == []
    assert "缺少边界案例" in released["warnings"]


def test_compiled_graph_auto_releases_second_quality_rejection(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["days"][0]["task_ids"] = ["explainer-d1"]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    calls = 0

    def always_incomplete(_state):
        nonlocal calls
        calls += 1
        return {"title": "数组", "overview": "内容仍不完整"}

    monkeypatch.setattr(graph, "get_agent", lambda _name: always_incomplete)
    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 3},
    )

    review = result["reviews"]["explainer-d1"]
    assert calls == 2
    assert review["retry_count"] == 1
    assert review["approved"] is True
    assert review["auto_released"] is True
    assert review["gate_status"] == "approved_after_rework_limit"
    assert review["warnings"]
    assert result["coverage"]["complete"] is True
    assert result["integration"]["coverage"]["complete"] is True
    assert result["integration"]["resources"][0]["retry_count"] == 1


def test_failed_dependency_retries_until_ready_before_downstream_starts(
    monkeypatch,
):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    calls: list[str] = []
    dependency_outputs: list[list[dict]] = []

    def fake_agent(name):
        def run(state):
            task_id = state["plan_task"]["task_id"]
            calls.append(task_id)
            if task_id == "explainer-d1":
                return {"title": "Incomplete explainer", "overview": "too short"}
            dependency_outputs.append(state["dependency_outputs"])
            return {
                "title": "Dependency fallback quiz",
                "questions": [
                    {
                        "stem": f"Question {index + 1}",
                        "options": ["A. LIFO", "B. FIFO"],
                        "answer": "A",
                        "explanation": "A stack follows last-in, first-out ordering.",
                    }
                    for index in range(5)
                ],
            }

        return run

    def fake_review(resource, task):
        approved = task["task_id"] == "quiz-d2" or calls.count("explainer-d1") >= 2
        return TaskReview(
            approved=approved,
            score=1.0 if approved else 0.0,
            issues=[] if approved else ["outline coverage is incomplete"],
            fixes=[] if approved else ["cover the full outline"],
        )

    monkeypatch.setattr(graph, "get_agent", fake_agent)
    monkeypatch.setattr(graph, "review_resource", fake_review)
    monkeypatch.setattr(graph, "_wait_before_retry", lambda _attempt, _run_id="": None)
    plan = PlanArtifact.model_validate(sample_plan_dict())

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 10},
    )

    assert calls.count("explainer-d1") == 2
    assert calls.count("quiz-d2") == 1
    assert dependency_outputs and dependency_outputs[0]
    assert result["reviews"]["explainer-d1"]["approved"] is True
    assert result["reviews"]["quiz-d2"]["approved"] is True


def test_one_agent_exception_retries_without_restarting_successful_other_tasks(
    monkeypatch,
):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][1]["depends_on"] = []
    plan = PlanArtifact.model_validate(payload)
    emitted: list[dict] = []

    explainer_calls = 0

    def fake_agent(name):
        if name == "explainer":
            def fail(state):
                nonlocal explainer_calls
                explainer_calls += 1
                if explainer_calls < 2:
                    raise RuntimeError("provider timeout")
                return {"title": "Recovered explainer", "overview": "complete"}

            return fail
        return lambda state: {
            "title": "Independent quiz",
            "questions": [
                {
                    "stem": f"Question {index + 1}",
                    "options": ["A. LIFO", "B. FIFO"],
                    "answer": "A",
                    "explanation": "A stack follows last-in, first-out ordering.",
                }
                for index in range(5)
            ],
        }

    monkeypatch.setattr(graph, "get_agent", fake_agent)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda resource, task: TaskReview(
            approved=True,
            score=1.0,
            issues=[],
            fixes=[],
        ),
    )
    monkeypatch.setattr(graph, "_emit", emitted.append)
    monkeypatch.setattr(graph, "_wait_before_retry", lambda _attempt, _run_id="": None)

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 10},
    )

    recovered_review = result["reviews"]["explainer-d1"]
    assert recovered_review["approved"] is True
    assert recovered_review["retry_count"] == 1
    assert result["reviews"]["quiz-d2"]["approved"] is True
    assert any(
        event.get("event") == "task_progress"
        and event.get("task_id") == "explainer-d1"
        and event.get("status") == "rework"
        for event in emitted
    )
    assert any(
        event.get("event") == "task_review"
        and event.get("task_id") == "explainer-d1"
        and event.get("approved") is False
        for event in emitted
    )


def test_agent_lookup_exception_retries_until_lookup_recovers(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    calls: dict[str, int] = {}

    def fail_lookup(name):
        calls[name] = calls.get(name, 0) + 1
        if calls[name] == 1:
            raise RuntimeError(f"{name} agent unavailable")
        return lambda state: {"title": state["plan_task"]["title"], "overview": "recovered"}

    monkeypatch.setattr(graph, "get_agent", fail_lookup)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(graph, "_wait_before_retry", lambda _attempt, _run_id="": None)
    plan = PlanArtifact.model_validate(sample_plan_dict())

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 10},
    )

    assert set(result["reviews"]) == {"explainer-d1", "quiz-d2"}
    assert all(review["approved"] is True for review in result["reviews"].values())
    assert all(count == 2 for count in calls.values())


def test_parallel_agent_failures_retry_independently(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][1]["depends_on"] = []
    plan = PlanArtifact.model_validate(payload)

    calls: dict[str, int] = {}

    def fake_agent(name):
        def fail(state):
            calls[name] = calls.get(name, 0) + 1
            if calls[name] == 1:
                raise RuntimeError(f"{name} unavailable")
            return {"title": state["plan_task"]["title"], "overview": "recovered"}

        return fail

    monkeypatch.setattr(graph, "get_agent", fake_agent)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(graph, "_wait_before_retry", lambda _attempt, _run_id="": None)

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 10},
    )

    assert set(result["reviews"]) == {"explainer-d1", "quiz-d2"}
    assert all(review["approved"] is True for review in result["reviews"].values())
    assert calls == {"explainer": 2, "quiz": 2}


def test_review_failure_is_isolated_to_one_generated_task(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][1]["depends_on"] = []
    for task in payload["tasks"]:
        task["status"] = "generated"
    plan = PlanArtifact.model_validate(payload)

    def fake_review(resource, task):
        if task["task_id"] == "explainer-d1":
            raise RuntimeError("reviewer crashed")
        return TaskReview(
            approved=True,
            score=1.0,
            issues=[],
            fixes=[],
        )

    monkeypatch.setattr(graph, "review_resource", fake_review)
    result = graph.review_tasks(
        {
            "plan": plan.model_dump(mode="json"),
            "resources": [
                {
                    "task_id": "explainer-d1",
                    "type": "explainer",
                    "retry_count": 0,
                },
                {
                    "task_id": "quiz-d2",
                    "type": "quiz",
                    "retry_count": 0,
                },
            ],
            "reviews": {},
            "trace_run_id": "test-run",
        }
    )

    failed_review = result["reviews"]["explainer-d1"]
    assert failed_review["approved"] is False
    assert failed_review["retry_count"] == 0
    assert failed_review["retryable"] is True
    assert failed_review["gate_status"] == "review_unavailable"
    assert failed_review["error_code"] == "review_unavailable"
    assert "审核基础设施不可用" in failed_review["issues"][0]
    assert result["reviews"]["quiz-d2"]["approved"] is True


def test_review_time_budget_is_not_reported_as_infrastructure_failure(monkeypatch):
    from app.core.run_control import RunBudgetExceeded
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"] = [payload["tasks"][0]]
    payload["days"] = [payload["days"][0]]
    payload["days"][0]["task_ids"] = [payload["tasks"][0]["task_id"]]
    plan = PlanArtifact.model_validate(payload)
    monkeypatch.setattr(graph, "_emit", lambda _payload: None)
    monkeypatch.setattr(
        graph,
        "_model_call_checkpoint",
        lambda _state: (_ for _ in ()).throw(
            RunBudgetExceeded(
                "wall-clock budget exhausted",
                error_code="run_time_budget_exhausted",
            )
        ),
    )

    result = graph.review_tasks({
        "plan": plan.model_dump(mode="json"),
        "resources": [{
            "task_id": plan.tasks[0].task_id,
            "type": plan.tasks[0].type,
            "retry_count": 0,
        }],
        "reviews": {},
        "trace_run_id": "time-budget-run",
        "run_started_at": 0.0,
        "retry_policy": {"max_run_seconds": 300},
    })

    review = result["reviews"][plan.tasks[0].task_id]
    assert review["error_code"] == "run_time_budget_exhausted"
    assert review["terminal"] is True
    assert review["retryable"] is True
    assert "300 秒时限" in review["issues"][0]
    assert "基础设施不可用" not in review["issues"][0]


def test_planned_review_always_runs_semantic_fact_gate_and_rejects_false_fact(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import TaskReview

    calls = []

    def reject_false_fact(resource, task, kb_context):
        calls.append((resource, task, kb_context))
        return {
            "approved": False,
            "issues": ["事实错误：地球不是太阳系最大的行星，木星才是"],
            "claim_evidence": [],
        }

    monkeypatch.setattr(graph, "verify_resource_semantics", reject_false_fact)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(graph, "_emit", lambda _payload: None)
    state = {
        "trace_run_id": "semantic-fact-run",
        "plan": {
            "tasks": [
                {
                    "task_id": "astronomy-d1",
                    "type": "explainer",
                    "agent": "explainer",
                    "title": "太阳系基础",
                    "source_ids": ["kb-solar"],
                    "outline": {"sections": []},
                    "quality_criteria": [],
                }
            ]
        },
        "resources": [
            {
                "task_id": "astronomy-d1",
                "type": "explainer",
                "retry_count": 0,
                "explanation": "地球是太阳系最大的行星。" + "太阳系基础知识。" * 20,
            }
        ],
        "reviews": {},
        "kb_context": [
            {"id": "kb-solar", "content": "木星是太阳系中体积和质量最大的行星。"}
        ],
    }

    review = graph.review_tasks(state)["reviews"]["astronomy-d1"]

    assert len(calls) == 1
    assert review["approved"] is False
    assert review["gate_status"] == "rejected"
    assert review["failure_kind"] == "quality"
    assert any("地球" in issue and "木星" in issue for issue in review["blocking_issues"])


def test_semantic_reviewer_outage_is_review_unavailable_not_content_rejection(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import TaskReview
    from app.services.resource_grounding import ReviewUnavailable

    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(
        graph,
        "verify_resource_semantics",
        lambda *_args: (_ for _ in ()).throw(ReviewUnavailable("provider offline")),
    )
    monkeypatch.setattr(graph, "_emit", lambda _payload: None)
    state = {
        "trace_run_id": "semantic-outage-run",
        "plan": {
            "tasks": [
                {
                    "task_id": "topic-d1",
                    "type": "explainer",
                    "agent": "explainer",
                    "title": "主题讲义",
                    "source_ids": [],
                    "outline": {"sections": []},
                    "quality_criteria": [],
                }
            ]
        },
        "resources": [
            {
                "task_id": "topic-d1",
                "type": "explainer",
                "retry_count": 0,
                "explanation": "结构完整的候选资料。" * 20,
            }
        ],
        "reviews": {},
        "kb_context": [],
    }

    review = graph.review_tasks(state)["reviews"]["topic-d1"]

    assert review["approved"] is False
    assert review["gate_status"] == "review_unavailable"
    assert review["failure_kind"] == "reviewer"
    assert review["error_code"] == "review_unavailable"
    assert review["retryable"] is True


def test_coverage_route_repairs_only_missing_tasks_once():
    from app.graph.planned_resource_graph import coverage_node, route_after_coverage
    from app.schemas.resource_plan import PlanArtifact
    from langgraph.types import Send
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    state = {
        "plan": plan.model_dump(mode="json"),
        "student_id": plan.student_id,
        "resources": [
            {
                "id": "explainer-d1",
                "task_id": "explainer-d1",
                "type": "explainer",
                "overview": "数组随机访问，链表插入删除",
            }
        ],
        "reviews": {
            "explainer-d1": {"approved": True, "score": 0.9, "retry_count": 0}
        },
        "repair_task_ids": [],
    }
    coverage = coverage_node(state)["coverage"]
    routed = route_after_coverage({**state, "coverage": coverage})

    assert [send.arg["plan_task"]["task_id"] for send in routed if isinstance(send, Send)] == [
        "quiz-d2"
    ]
    assert route_after_coverage(
        {**state, "coverage": coverage, "repair_task_ids": ["quiz-d2"]}
    ) == "integrate"


def test_successful_coverage_repair_is_reviewed_as_a_new_attempt(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    agent_calls = 0
    review_calls = 0

    def fake_agent(name):
        def run(state):
            nonlocal agent_calls
            agent_calls += 1
            if agent_calls == 1:
                raise RuntimeError("initial provider failure")
            return {
                "title": "Recovered explainer",
                "overview": "Coverage repair generated a complete explainer.",
            }

        return run

    def fake_review(resource, task):
        nonlocal review_calls
        review_calls += 1
        return TaskReview(
            approved=True,
            score=1.0,
            issues=[],
            fixes=[],
        )

    monkeypatch.setattr(graph, "get_agent", fake_agent)
    monkeypatch.setattr(graph, "review_resource", fake_review)

    result = graph.planned_resource_app.invoke(
        graph.build_planned_state(plan, {}),
        config={"max_concurrency": 10},
    )

    assert agent_calls == 2
    assert review_calls == 1
    assert result["reviews"]["explainer-d1"]["approved"] is True
    assert result["reviews"]["explainer-d1"]["retry_count"] == 1


def test_plan_schema_accepts_the_second_coverage_repair_attempt():
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][0]["retry_count"] = 2

    plan = PlanArtifact.model_validate(payload)

    assert plan.tasks[0].retry_count == 2


def test_transient_generation_failure_retries_with_the_exact_failure_ticket(monkeypatch):
    """The second generator call receives the main agent's actionable reason."""

    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    repair_states = []
    emitted = []

    def agent(state):
        repair_states.append(state)
        if len(repair_states) == 1:
            raise RuntimeError("provider timeout while requesting output")
        return {"title": state["plan_task"]["title"], "overview": "recovered"}

    monkeypatch.setattr(graph, "get_agent", lambda _name: agent)
    monkeypatch.setattr(graph, "_wait_before_retry", lambda _attempt, _run_id="": None)
    monkeypatch.setattr(graph, "_emit", emitted.append)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0, issues=[], fixes=[]),
    )

    result = graph.planned_resource_app.invoke(graph.build_planned_state(plan, {}))

    assert len(repair_states) == 2
    ticket = repair_states[1]["repair_instructions"][0]
    assert "provider timeout" in ticket["issue"]
    assert ticket["location"]
    assert ticket["action"]
    assert ticket["acceptance_check"]
    feedback = next(
        event
        for event in emitted
        if event.get("event") == "trace" and event.get("to_agent") == "explainer"
    )
    assert feedback["from_agent"] == "supervisor"
    assert feedback["task_id"] == "explainer-d1"
    assert feedback["improvement_actions"]
    assert feedback["acceptance_check"]
    assert result["reviews"]["explainer-d1"]["approved"] is True
    assert result["reviews"]["explainer-d1"]["retry_count"] == 1


def test_permanent_configuration_failure_does_not_retry(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    calls = 0

    class NonRetryableProviderError(RuntimeError):
        retryable = False

    repair_states = []

    def unavailable(state):
        nonlocal calls
        calls += 1
        repair_states.append(state)
        if calls < 3:
            raise NonRetryableProviderError("provider rejected this request")
        return {"title": state["plan_task"]["title"], "overview": "recovered"}

    monkeypatch.setattr(graph, "get_agent", lambda _name: unavailable)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(graph, "_wait_before_retry", lambda _attempt, _run_id="": None)
    result = graph.planned_resource_app.invoke(graph.build_planned_state(plan, {}))

    review = result["reviews"]["explainer-d1"]
    assert calls == 1
    assert review["approved"] is False
    assert review["retryable"] is False
    assert review["terminal"] is True
    assert review["error_code"] == "generation_permanent_error"


def test_review_budget_exhaustion_is_a_supported_terminal_gate_state(monkeypatch):
    from app.core.run_control import RunBudgetExceeded
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact, TaskReview
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda *_args: TaskReview(approved=True, score=1.0),
    )
    monkeypatch.setattr(
        graph,
        "_model_call_checkpoint",
        lambda _state: (_ for _ in ()).throw(RunBudgetExceeded("review budget exhausted")),
    )
    monkeypatch.setattr(graph, "_emit", lambda _payload: None)

    result = graph.review_tasks(
        {
            "plan": plan.model_dump(mode="json"),
            "resources": [
                {
                    "id": "explainer-d1",
                    "task_id": "explainer-d1",
                    "type": "explainer",
                    "retry_count": 0,
                }
            ],
            "reviews": {},
            "kb_context": [],
            "trace_run_id": "budget-review-run",
            "retry_policy": {},
        }
    )

    review = result["reviews"]["explainer-d1"]
    assert TaskReview.model_validate(review).gate_status == "review_unavailable"
    assert review["failure_kind"] == "budget"
    assert review["terminal"] is True


def test_retry_migrates_legacy_long_plan_chain_and_time_sizes_quizzes():
    from copy import deepcopy

    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    third = deepcopy(payload["tasks"][1])
    third.update(
        {
            "task_id": "reading-d2",
            "agent": "reading",
            "type": "reading",
            "title": "栈与队列延伸阅读",
            "depends_on": ["quiz-d2"],
        }
    )
    payload["tasks"].append(third)
    payload["days"][1]["task_ids"].append("reading-d2")
    payload["learning_path_preferences"] = {
        "goal": "exam",
        "days": 2,
        "daily_minutes": 60,
        "material_types": ["explainer", "quiz", "reading"],
    }
    plan = PlanArtifact.model_validate(payload)

    state = graph.build_planned_state(plan, {})

    assert all(task["depends_on"] == [] for task in state["plan"]["tasks"])
    quiz = next(task for task in state["plan"]["tasks"] if task["type"] == "quiz")
    assert sum(quiz["quiz_config"].values()) == 6


def test_cancelled_run_starts_no_new_generator_or_reviewer_call(monkeypatch):
    from app.core.run_control import release_run, request_run_cancel
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import PlanArtifact
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    state = graph.build_planned_state(plan, {})
    calls = {"generator": 0, "reviewer": 0}

    def generate(_state):
        calls["generator"] += 1
        return {"type": "explainer", "explanation": "不应执行"}

    def review(*_args):
        calls["reviewer"] += 1
        raise AssertionError("reviewer must not start after cancellation")

    monkeypatch.setattr(graph, "get_agent", lambda _name: generate)
    monkeypatch.setattr(graph, "review_resource", review)
    request_run_cancel(state["trace_run_id"])
    try:
        with pytest.raises(Exception, match="cancelled"):
            graph.planned_resource_app.invoke(state)
    finally:
        release_run(state["trace_run_id"])

    assert calls == {"generator": 0, "reviewer": 0}


@pytest.mark.asyncio
async def test_sse_bridge_forwards_max_concurrency():
    from app.core.sse import astream_via_thread

    graph = RecordingGraph([("custom", {"event": "done"})])
    chunks = [
        chunk
        async for chunk in astream_via_thread(
            graph,
            {"plan": {}},
            ["custom", "values"],
            config={"max_concurrency": 3},
        )
    ]

    assert chunks
    assert graph.config == {"max_concurrency": 3}


@pytest.mark.asyncio
async def test_sse_bridge_can_finish_after_a_terminal_snapshot_even_if_worker_stays_open():
    from app.core.sse import astream_via_thread

    worker_waiting = threading.Event()
    release_worker = threading.Event()
    worker_finished = threading.Event()
    terminal = ("values", {"coverage": {"complete": True}})

    class StuckAfterTerminalGraph:
        def stream(self, state, *, stream_mode, config=None):
            try:
                yield terminal
                worker_waiting.set()
                release_worker.wait(timeout=2)
            finally:
                worker_finished.set()

    try:
        stream = astream_via_thread(
            StuckAfterTerminalGraph(), {}, ["custom", "values"],
            stop_when=lambda chunk: chunk == terminal,
            stop_grace_seconds=0.02,
        )
        assert await anext(stream) == terminal
        # Handshake before resuming the consumer: the producer really is stuck
        # after its terminal yield, independently of OS thread scheduling.
        assert await asyncio.to_thread(worker_waiting.wait, 1)
        assert [chunk async for chunk in stream] == []
        assert not worker_finished.is_set()
    finally:
        release_worker.set()
        assert await asyncio.to_thread(worker_finished.wait, 1)


@pytest.mark.asyncio
async def test_sse_cancellation_waits_for_the_worker_to_stop():
    from app.core.sse import astream_via_thread

    started = threading.Event()
    first_gate = threading.Event()
    second_gate = threading.Event()
    finished = threading.Event()

    class BlockingGraph:
        def stream(self, state, *, stream_mode, config=None):
            try:
                started.set()
                first_gate.wait(timeout=2)
                yield ("custom", {"event": "first"})
                second_gate.wait(timeout=2)
                yield ("custom", {"event": "second"})
            finally:
                finished.set()

    async def consume():
        async for _ in astream_via_thread(BlockingGraph(), {}, ["custom"]):
            pass

    task = asyncio.create_task(consume())
    await asyncio.to_thread(started.wait, 1)
    task.cancel()
    first_gate.set()
    try:
        with pytest.raises(asyncio.CancelledError):
            await task
        assert finished.is_set()
    finally:
        second_gate.set()
