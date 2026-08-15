"""LLM-backed plan builder contracts."""

from __future__ import annotations

import json

import httpx
import openai

import pytest

from tests.test_resource_plan_models import sample_plan_dict


class FakeResponse:
    def __init__(self, payload):
        self.content = json.dumps(payload, ensure_ascii=False)


class FakeLLM:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.prompts = []

    def invoke(self, messages):
        self.prompts.append(messages)
        response = next(self.responses)
        if callable(response):
            response = response(messages)
        return FakeResponse(response)


def test_execution_source_binding_retrieves_evidence_per_task():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_plan_builder import bind_plan_task_sources

    payload = sample_plan_dict()
    payload["tasks"][0]["title"] = "array and linked-list guide"
    payload["tasks"][0]["knowledge_points"] = ["array", "linked list"]
    payload["tasks"][1]["title"] = "stack and queue quiz"
    payload["tasks"][1]["knowledge_points"] = ["stack", "queue"]
    plan = PlanArtifact.model_validate(payload)
    calls: list[str] = []

    def retrieve(query: str, _student_id: str, _limit: int):
        calls.append(query)
        if "array" in query:
            return [{"id": "kb-array", "content": "array evidence", "metadata": {"title": "Arrays"}}]
        return [{"id": "kb-stack", "content": "stack evidence", "metadata": {"title": "Stacks"}}]

    rebound, context = bind_plan_task_sources(
        plan,
        [{"id": "kb-general", "content": "broad overview"}],
        student_id="student-1",
        retriever=retrieve,
    )

    assert len(calls) == 2
    assert rebound.tasks[0].source_ids == ["kb-array"]
    assert rebound.tasks[1].source_ids == ["kb-stack"]
    assert {item["id"] for item in context} == {"kb-array", "kb-stack"}
    assert {item["title"] for item in context} == {"Arrays", "Stacks"}


def test_execution_source_binding_falls_back_without_losing_gate_evidence():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_plan_builder import bind_plan_task_sources

    fallback = [{"id": "kb-general", "content": "broad overview"}]
    rebound, context = bind_plan_task_sources(
        PlanArtifact.model_validate(sample_plan_dict()),
        fallback,
        student_id="student-1",
        retriever=lambda *_args: (_ for _ in ()).throw(RuntimeError("retrieval down")),
    )

    assert all(task.source_ids == ["kb-general"] for task in rebound.tasks)
    assert context == fallback


def test_execution_source_binding_uses_domain_hints_for_hash_and_graph_tasks():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_plan_builder import bind_plan_task_sources

    payload = sample_plan_dict()
    payload["tasks"][0]["title"] = "哈希表与冲突处理"
    payload["tasks"][0]["knowledge_points"] = ["哈希函数", "链地址法"]
    payload["tasks"][1]["title"] = "最小生成树与最短路径"
    payload["tasks"][1]["knowledge_points"] = ["Prim", "Dijkstra"]
    plan = PlanArtifact.model_validate(payload)
    calls: list[str] = []

    def retrieve(query: str, _student_id: str, _limit: int):
        calls.append(query)
        if "查找算法" in query:
            return [{"id": "kb-search", "content": "哈希表与冲突处理"}]
        if "图" in query:
            return [{"id": "kb-graph", "content": "Prim 与 Dijkstra"}]
        return []

    rebound, _ = bind_plan_task_sources(plan, [], student_id="student-1", retriever=retrieve)

    assert any("查找算法" in call for call in calls)
    assert any("图" in call for call in calls)
    assert rebound.tasks[0].source_ids == ["kb-search"]
    assert rebound.tasks[1].source_ids == ["kb-graph"]


def test_builder_uses_kb_profile_and_returns_validated_plan():
    from app.services.resource_plan_builder import build_resource_plan

    payload = sample_plan_dict()
    fake = FakeLLM([payload])
    plan = build_resource_plan(
        request_text="生成数据结构两天学习路径",
        student_id=payload["student_id"],
        profile={"knowledge_level": {"链表": {"score": 0.3}}},
        kb_context=[
            {"id": "kb-1", "content": "线性表包括顺序存储和链式存储"},
            {"id": "kb-2", "content": "栈遵循 LIFO，队列遵循 FIFO"},
        ],
        llm=fake,
    )

    prompt = fake.prompts[0][1]["content"]
    assert plan.days[0].title == "线性表：数组与链表"
    assert plan.status == "awaiting_confirmation"
    assert plan.validation.valid is True
    assert "链表" in prompt
    assert "kb-1" in prompt


def test_builder_raises_after_one_invalid_repair_attempt():
    from app.services.resource_plan_builder import PlanBuildError, build_resource_plan

    invalid = sample_plan_dict()
    invalid["days"][0]["title"] = "数据结构基础定位"
    fake = FakeLLM([invalid, invalid])

    with pytest.raises(PlanBuildError, match="规划验证失败"):
        build_resource_plan(
            request_text="生成学习路径",
            student_id=invalid["student_id"],
            profile={},
            kb_context=[],
            llm=fake,
        )

    assert len(fake.prompts) == 2
    assert "标题过于泛化" in fake.prompts[1][1]["content"]


def test_builder_repairs_schema_errors_instead_of_using_a_generic_fallback():
    from app.services.resource_plan_builder import build_resource_plan

    invalid = sample_plan_dict()
    invalid["tasks"][0].pop("outline")
    valid = sample_plan_dict()
    fake = FakeLLM([invalid, valid])

    plan = build_resource_plan(
        request_text="生成数据结构学习路径，直接生成",
        student_id=valid["student_id"],
        profile={},
        kb_context=[],
        llm=fake,
    )

    assert len(fake.prompts) == 2
    assert plan.days[0].title == "线性表：数组与链表"
    assert plan.status == "approved"


def test_builder_consolidates_explicit_question_count_into_one_quiz_resource():
    from app.services.resource_plan_builder import build_resource_plan

    payload = sample_plan_dict()
    second_quiz = dict(payload["tasks"][1])
    second_quiz["task_id"] = "quiz-d2-second"
    second_quiz["title"] = "栈与队列练习题二"
    payload["tasks"].append(second_quiz)
    payload["days"][1]["task_ids"].append(second_quiz["task_id"])
    fake = FakeLLM([payload])

    plan = build_resource_plan(
        request_text="用一份讲义和两道练习题解释栈为什么后进先出，直接生成",
        student_id=payload["student_id"],
        profile={},
        kb_context=[],
        llm=fake,
    )

    quiz_tasks = [task for task in plan.tasks if task.type == "quiz"]
    assert len(quiz_tasks) == 1
    assert quiz_tasks[0].quality_criteria[0] == "必须生成 2 道题"
    assert plan.days[1].task_ids == ["quiz-d2"]
    assert "不要将每道题拆成独立资料" in fake.prompts[0][0]["content"]


def test_plan_draft_schema_rejects_fifth_compact_item_and_omits_lifecycle_fields():
    from pydantic import ValidationError
    from app.schemas.resource_plan import PlanArtifact, PlanDraft

    payload = sample_plan_dict()
    payload["tasks"][0]["quality_criteria"] = ["a", "b", "c", "d", "e"]
    with pytest.raises(ValidationError):
        PlanDraft.model_validate(payload)
    schema = PlanDraft.model_json_schema()
    serialized = json.dumps(schema, ensure_ascii=False)
    assert "retry_count" not in serialized
    assert "review" not in serialized
    assert len(serialized) < len(json.dumps(PlanArtifact.model_json_schema(), ensure_ascii=False))


class RaisingLLM:
    def __init__(self, exc):
        self.exc = exc
        self.calls = 0

    def invoke(self, messages):
        self.calls += 1
        raise self.exc


def _provider_exception(name: str):
    request = httpx.Request("POST", "https://provider.invalid")
    response = httpx.Response(400, request=request)
    if name == "APIConnectionError":
        return openai.APIConnectionError(message="SECRET body", request=request)
    if name == "APITimeoutError":
        return openai.APITimeoutError(request=request)
    return getattr(openai, name)("SECRET provider body", response=response, body={"secret": "SECRET"})


@pytest.mark.parametrize(
    ("name", "code", "status", "retryable", "calls"),
    [
        ("APIConnectionError", "plan_provider_unavailable", 503, True, 2),
        ("APITimeoutError", "plan_provider_unavailable", 503, True, 2),
        ("RateLimitError", "plan_provider_rate_limited", 429, True, 2),
        ("AuthenticationError", "plan_provider_auth_failed", 401, False, 1),
        ("PermissionDeniedError", "plan_provider_permission_denied", 403, False, 1),
        ("NotFoundError", "plan_provider_model_not_found", 404, False, 1),
        ("BadRequestError", "plan_provider_bad_request", 400, False, 1),
    ],
)
def test_builder_maps_real_openai_provider_errors(name, code, status, retryable, calls):
    from app.services.resource_plan_builder import PlanBuildError, build_resource_plan
    llm = RaisingLLM(_provider_exception(name))
    with pytest.raises(PlanBuildError) as error:
        build_resource_plan(request_text="数据结构", student_id="s", profile={}, kb_context=[{"id": "kb", "content": "数据结构"}], llm=llm)
    assert error.value.code == code
    assert error.value.http_status == status
    assert error.value.retryable is retryable
    assert llm.calls == calls
    assert "SECRET" not in str(error.value.payload())


def _long_skeleton(days=14, tasks=2):
    return {
        "request_summary": "长学习路径",
        "constraints": {"days": days, "daily_minutes": 60, "material_types": ["explainer", "quiz"]},
        "days": [
            {"day": f"D{i}", "title": f"第{i}天", "knowledge_points": [f"点{i}"], "objective": f"完成第{i}天学习目标", "minutes": 60, "prerequisites": [], "actions": ["学习", "复盘"], "task_keys": [f"task-{i}"] if i <= tasks else []}
            for i in range(1, days + 1)
        ],
        "tasks": [
            {"key": f"task-{i}", "day": f"D{i}", "type": "explainer" if i % 2 else "quiz", "title": f"资料{i}", "knowledge_points": [f"点{i}"], "difficulty": "基础", "audience": "初学者", "depends_on": []}
            for i in range(1, tasks + 1)
        ],
    }


def _long_schedule_only(days=14):
    schedule = _long_skeleton(days)
    schedule.pop("tasks")
    for day in schedule["days"]:
        day.pop("task_keys")
    return schedule


def _outline_batch(keys):
    return {"tasks": [{"key": key, "outline": {"objective": "解释核心概念", "sections": [{"title": "要点", "goal": "理解核心概念", "must_cover": ["定义"], "target_words": 200}]}, "quality_criteria": ["包含定义"]} for key in keys]}


def _outline_batch_for_request(messages):
    payload = json.loads(messages[1]["content"])
    return _outline_batch([task["key"] for task in payload["tasks"]])


def _long_plan_responses(schedule):
    return [schedule, _outline_batch_for_request, _outline_batch_for_request, _outline_batch_for_request]


@pytest.mark.parametrize("days", [14, 30])
def test_long_builder_expands_every_selected_type_per_day_without_redundant_outline_calls(days):
    from app.services.resource_plan_builder import build_resource_plan
    skeleton = _long_schedule_only(days)
    fake = FakeLLM(_long_plan_responses(skeleton))
    plan = build_resource_plan(
        request_text="数据结构长学习路径", student_id="s", profile={},
        kb_context=[{"id": "kb-1", "content": "数据结构"}],
        learning_path_preferences={"goal": "exam", "days": days, "daily_minutes": 60, "material_types": ["explainer", "quiz"]},
        llm=fake,
    )
    assert len(fake.prompts) == 1
    assert len(plan.tasks) == days * 2
    assert len(plan.days) == days and plan.validation.valid
    assert {task.type for task in plan.tasks} == {"explainer", "quiz"}
    assert all(len(day.task_ids) == 2 for day in plan.days)
    assert all(day.objective and day.actions for day in plan.days)
    assert all(task.outline.sections and task.source_ids for task in plan.tasks)
    assert all(task.depends_on == [] for task in plan.tasks)
    quiz_tasks = [task for task in plan.tasks if task.type == "quiz"]
    assert quiz_tasks
    assert all(sum(task.quiz_config.values()) >= 5 for task in quiz_tasks)
    assert all(task.quality_criteria[0].startswith("必须生成 ") for task in quiz_tasks)


def test_long_schedule_schema_excludes_tasks_and_ignores_extra_model_tasks():
    from app.schemas.resource_plan import LongPlanScheduleSkeleton

    schedule = _long_schedule_only(14)
    schedule["tasks"] = _long_skeleton(14, 2)["tasks"] * 13
    parsed = LongPlanScheduleSkeleton.model_validate(schedule)
    schema = LongPlanScheduleSkeleton.model_json_schema()

    assert len(parsed.days) == 14
    assert "tasks" not in schema["properties"]


def test_long_builder_uses_only_selected_material_type():
    from app.services.resource_plan_builder import build_resource_plan

    plan = build_resource_plan(
        request_text="data structures long learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "data structures"}],
        learning_path_preferences={
            "goal": "starter",
            "days": 30,
            "daily_minutes": 60,
            "material_types": ["reading"],
        },
        llm=FakeLLM(_long_plan_responses(_long_schedule_only(30))),
    )

    assert len(plan.tasks) == 30
    assert {task.type for task in plan.tasks} == {"reading"}


def test_short_plan_with_all_material_types_uses_bounded_schedule_builder():
    from app.services.resource_plan_builder import build_resource_plan

    selected_types = ["explainer", "quiz", "code", "mindmap", "courseware"]
    fake = FakeLLM(_long_plan_responses(_long_schedule_only(7)))

    plan = build_resource_plan(
        request_text="data structures seven day learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "data structures"}],
        learning_path_preferences={
            "goal": "exam",
            "days": 7,
            "daily_minutes": 60,
            "material_types": selected_types,
        },
        llm=fake,
    )

    assert plan.validation.valid
    assert len(plan.days) == 7
    assert set(selected_types) == {task.type for task in plan.tasks}
    assert len(plan.tasks) == 7 * len(selected_types)
    assert all(len(day.task_ids) == len(selected_types) for day in plan.days)


def test_long_builder_accepts_single_character_titles_and_cumulative_prerequisites():
    from app.schemas.resource_plan import LongPlanSkeleton
    from app.services.resource_plan_builder import build_resource_plan

    skeleton = _long_skeleton(14, 2)
    skeleton["days"][4]["title"] = "栈"
    skeleton["days"][9]["title"] = "堆"
    skeleton["days"][13]["prerequisites"] = [f"D{index}" for index in range(1, 14)]
    skeleton["days"][13]["actions"] = ["完成模拟考试"]

    parsed = LongPlanSkeleton.model_validate(skeleton)
    assert parsed.days[4].title == "栈"
    assert parsed.days[9].title == "堆"
    assert len(parsed.days[13].prerequisites) == 13
    assert parsed.days[13].actions == ["完成模拟考试"]

    fake = FakeLLM(_long_plan_responses(skeleton))
    plan = build_resource_plan(
        request_text="data structures long learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "data structures"}],
        learning_path_preferences={
            "goal": "exam",
            "days": 14,
            "daily_minutes": 60,
            "material_types": ["explainer", "quiz"],
        },
        llm=fake,
    )

    assert plan.validation.valid
    assert plan.days[4].title == "栈"
    assert plan.days[9].title == "堆"
    assert len(plan.days[13].prerequisites) == 13
    assert plan.days[13].actions == ["完成模拟考试"]


def test_long_builder_accepts_five_graph_knowledge_points_for_one_day():
    from app.schemas.resource_plan import LongPlanSkeleton
    from app.services.resource_plan_builder import build_resource_plan

    skeleton = _long_skeleton(14, 2)
    graph_points = ["图的定义", "邻接矩阵", "邻接表", "DFS", "BFS"]
    skeleton["days"][8]["knowledge_points"] = graph_points
    assert LongPlanSkeleton.model_validate(skeleton).days[8].knowledge_points == graph_points

    plan = build_resource_plan(
        request_text="graph theory long learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "graph traversal"}],
        learning_path_preferences={
            "goal": "exam",
            "days": 14,
            "daily_minutes": 60,
            "material_types": ["explainer", "quiz"],
        },
        llm=FakeLLM(_long_plan_responses(skeleton)),
    )

    assert plan.days[8].knowledge_points == graph_points
    assert plan.validation.valid


def test_long_builder_ignores_model_tasks_and_derives_day_tasks_from_schedule():
    from app.services.resource_plan_builder import build_resource_plan

    skeleton = _long_skeleton(14, 2)
    skeleton["days"][0]["task_keys"] = ["task-1", "task-13", "task-26"]
    skeleton["days"][1]["task_keys"] = ["task-2", "task-13"]
    skeleton["tasks"] = [
        {
            "key": f"task-{index}",
            "day": "D1",
            "type": "explainer",
            "title": "ignored task",
            "knowledge_points": ["ignored"],
            "difficulty": "basic",
            "audience": "learner",
            "depends_on": [],
        }
        for index in range(1, 27)
    ]

    fake = FakeLLM(_long_plan_responses(skeleton))
    plan = build_resource_plan(
        request_text="data structures long learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "data structures"}],
        learning_path_preferences={
            "goal": "exam",
            "days": 14,
            "daily_minutes": 60,
            "material_types": ["explainer", "quiz"],
        },
        llm=fake,
    )

    task_ids = {task.task_id for task in plan.tasks}
    assert len(plan.tasks) == 28
    assert all(len(day.task_ids) == 2 for day in plan.days)
    assert all(set(day.task_ids) <= task_ids for day in plan.days)
    assert all("task-13" not in day.task_ids for day in plan.days)
    assert all("task-26" not in day.task_ids for day in plan.days)
    assert all(task.task_id != "task-1" for task in plan.tasks)
    assert plan.validation.valid
    first_request = json.loads(fake.prompts[0][1]["content"])
    assert "repair" not in first_request
    assert "tasks" not in first_request["schema"]["properties"]


@pytest.mark.parametrize("invalid_field", ["duplicate_key", "unknown_day"])
def test_legacy_long_skeleton_validates_task_consistency(invalid_field):
    from pydantic import ValidationError
    from app.schemas.resource_plan import LongPlanSkeleton

    invalid = _long_skeleton(14, 2)
    if invalid_field == "duplicate_key":
        invalid["tasks"][1]["key"] = invalid["tasks"][0]["key"]
    else:
        invalid["tasks"][1]["day"] = "D99"

    with pytest.raises(ValidationError):
        LongPlanSkeleton.model_validate(invalid)


def test_long_builder_accepts_valid_outline_items_and_repairs_only_missing_keys():
    from app.services.resource_plan_builder import build_resource_plan

    skeleton = _long_schedule_only(3)
    calls = []

    def response(messages):
        payload = json.loads(messages[1]["content"])
        calls.append(payload)
        if payload["phase"] == "long_plan_skeleton":
            return skeleton
        if payload["phase"] == "outline_batch" and len(calls) == 2:
            first = _outline_batch([payload["tasks"][0]["key"]])
            return first
        return _outline_batch_for_request(messages)

    fake = FakeLLM([response] * 20)
    plan = build_resource_plan(
        request_text="data structures long learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "data structures"}],
        learning_path_preferences={"goal": "starter", "days": 3, "daily_minutes": 60, "material_types": ["explainer", "quiz", "code", "reading"]},
        llm=fake,
    )

    assert plan.validation.valid
    assert len(plan.tasks) == 12
    # The first batch is requested once, repaired once, and the two later
    # batches are each requested once.  Successful keys never re-enter repair.
    assert len(calls) == 5
    assert calls[1]["phase"] == "outline_batch"
    assert calls[2]["phase"] == "outline_batch_repair"
    assert calls[2]["repair"]["only_task_keys"]


def test_long_builder_falls_back_to_single_tasks_after_batch_repair_failure():
    from app.services.resource_plan_builder import build_resource_plan

    skeleton = _long_schedule_only(3)
    calls = []

    def response(messages):
        payload = json.loads(messages[1]["content"])
        calls.append(payload)
        if payload["phase"] == "long_plan_skeleton":
            return skeleton
        if payload["phase"] == "outline_batch" and len(calls) == 2:
            tasks = payload["tasks"]
            # One valid entry, one duplicate key and one field-invalid entry;
            # the fourth key is omitted.  Only the three failed keys should be repaired.
            valid = _outline_batch([tasks[0]["key"]])["tasks"][0]
            invalid = dict(valid, key=tasks[1]["key"], quality_criteria=[])
            duplicate = dict(valid, key=tasks[0]["key"])
            return {"tasks": [valid, duplicate, invalid]}
        if payload["phase"] == "outline_batch_repair" and len(calls) == 3:
            return {"tasks": []}
        if payload["phase"] == "outline_single_repair":
            return {"task": _outline_batch([payload["task"]["key"]])["tasks"][0]}
        return _outline_batch_for_request(messages)

    fake = FakeLLM([response] * 30)
    plan = build_resource_plan(
        request_text="data structures long learning path",
        student_id="s",
        profile={},
        kb_context=[{"id": "kb-1", "content": "data structures"}],
        learning_path_preferences={"goal": "starter", "days": 3, "daily_minutes": 60, "material_types": ["explainer", "quiz", "code", "reading"]},
        llm=fake,
    )

    assert plan.validation.valid
    assert len(plan.tasks) == 12
    assert [payload["phase"] for payload in calls[:5]] == [
        "long_plan_skeleton", "outline_batch", "outline_batch_repair",
        "outline_single_repair", "outline_single_repair",
    ]
    assert all(task.outline.sections for task in plan.tasks)
