from __future__ import annotations

from copy import deepcopy
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_db
from app.models.base import Base
from app.models.learning import CodeExercise
from app.models.profile import Profile
from app.routers.auth import get_current_account
from app.routers.training import (
    TrainingCheckRequest, TrainingGenerateRequest, TrainingSource,
    check_training_task, generate_training_task, list_training_tasks, training_evidence, router,
)
from app.services.code_exercises import generate_code_exercise, normalize_code_exercise, validate_training_exercise


@pytest.fixture
async def training_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


def exercise_payload(kind="completion"):
    return {
        "title": "列表累计", "prompt": "返回所有数字的累计值", "difficulty": "基础",
        "knowledge_points": ["列表", "循环"], "constraints": ["保留函数名 total"], "function_name": "total",
        "starter_code": "def total(values):\n    result = 0\n    for value in values:\n        # TODO: 累加当前元素\n        pass\n    return result\n" if kind == "completion" else "def total(values):\n    result = 0\n    for value in values[1:]:\n        result += value\n    return result\n",
        "reference_solution": "def total(values):\n    return sum(values)\n",
        "tests": [{"args": [values], "expected": sum(values), "label": str(index)} for index, values in enumerate([[1, 2], [], [5], [-2, 3], [0, 0]])],
    }


def normalize(payload):
    return normalize_code_exercise(payload, context_title="列表", learning_context="循环累计")


@pytest.mark.parametrize("kind", ["completion", "debugging"])
def test_training_accepts_real_completion_and_debugging_starters(kind):
    payload = exercise_payload(kind)
    validate_training_exercise(payload, normalize(payload), kind)


def test_short_mimo_training_uses_complete_json_without_changing_other_model_calls(monkeypatch):
    bound = []
    class Model:
        model_name = "mimo-v2.5"
        def bind(self, **options):
            bound.append(options)
            return self
        def invoke(self, messages):
            assert "代码补全" in messages[0]["content"]
            return SimpleNamespace(content=json.dumps(exercise_payload()))
    monkeypatch.setattr("app.services.code_exercises.build_llm", lambda **options: Model())
    generated = generate_code_exercise("列表", "循环累计", exercise_kind="completion", strict=True)
    assert generated["used_fallback"] is False
    assert bound == [{"extra_body": {"thinking": {"type": "disabled"}}}]


def test_training_repairs_inconsistent_tests_once_using_real_execution_evidence(monkeypatch):
    attempts = []
    class Model:
        def invoke(self, messages):
            attempts.append(len(messages))
            payload = exercise_payload()
            if len(attempts) == 1:
                payload["tests"][0]["expected"] = 999
            else:
                assert "真实测试输出" in messages[-1]["content"]
                assert "不一致" in messages[-1]["content"]
            return SimpleNamespace(content=json.dumps(payload))
    monkeypatch.setattr("app.services.code_exercises.build_llm", lambda **options: Model())
    generated = generate_code_exercise("列表", "循环累计", exercise_kind="completion", strict=True)
    assert attempts == [2, 4]
    assert generated["tests"][0]["expected"] == 3


@pytest.mark.parametrize("invalid", ["no_scaffold", "already_solved", "wrong_test", "fallback", "debug_placeholder"])
def test_training_rejects_mislabeled_or_inconsistent_questions(invalid):
    payload = exercise_payload()
    kind = "completion"
    if invalid == "no_scaffold":
        payload["starter_code"] = "def total(values):\n    # TODO\n    pass\n"
    if invalid == "already_solved":
        payload["starter_code"] = "def total(values):\n    result = 0\n    for value in values:\n        # TODO: check\n        result += value\n    return result\n"
    if invalid == "wrong_test":
        payload["tests"][0]["expected"] = 999
    if invalid == "fallback":
        payload["tests"] = []
    if invalid == "debug_placeholder":
        kind = "debugging"
    with pytest.raises(ValueError):
        validate_training_exercise(payload, normalize(payload), kind)


def request(kind="completion"):
    return TrainingGenerateRequest(
        learning_date="2026-09-06", learning_context="课程：Python；当前节点：列表遍历与累加",
        exercise_kind=kind, source=TrainingSource(path_signature="path-123", node_index=2, node_title="列表遍历", node_day="第 3 天", course="Python"),
    )


@pytest.mark.asyncio
async def test_training_persists_path_and_type_and_checks_all_cases_without_paid_review(training_db, monkeypatch):
    calls = []
    payload = normalize(exercise_payload())
    def generated(title, context, **options):
        calls.append((title, context, options))
        return deepcopy(payload)
    monkeypatch.setattr("app.routers.training.generate_code_exercise", generated)
    account = SimpleNamespace(id="learner-one")
    created = await generate_training_task(request(), account, training_db)
    assert calls[0][0] == "列表遍历"
    assert calls[0][2] == {"exercise_kind": "completion", "strict": True}
    assert created["training_metadata"]["node_index"] == 2
    assert created["test_count"] == 5
    assert len(created["examples"]) == 2
    assert not {"reference_solution", "hidden_tests", "tests"}.intersection(created)
    assert (await list_training_tasks(account, training_db))[0]["id"] == created["id"]
    assert await list_training_tasks(SimpleNamespace(id="another-learner"), training_db) == []

    def no_paid_review(*args, **kwargs):
        pytest.fail("A platform self-check must not invoke an AI review")
    monkeypatch.setattr("app.routers.code_lab.grade_code_feedback", no_paid_review)
    result = await check_training_task(created["id"], TrainingCheckRequest(code="def total(values):\n    return sum(values)"), account, training_db)
    assert result["passed"] is True
    assert result["passed_tests"] == result["total_tests"] == 5
    assert result["ai_status"] == "not_requested"
    evidence = await training_evidence(account, training_db)
    assert evidence[0]["score"] == 100
    assert evidence[0]["knowledgePoints"] == payload["knowledge_points"]
    assert evidence[0]["course"] == "Python"
    assert await training_evidence(SimpleNamespace(id="another-learner"), training_db) == []
    profile = await training_db.get(Profile, account.id)
    assert profile.knowledge_level["列表"]["source"] == "training"
    failed = await check_training_task(created["id"], TrainingCheckRequest(code=payload["starter_code"]), account, training_db)
    assert failed["passed"] is False
    with pytest.raises(HTTPException) as exc:
        await check_training_task(created["id"], TrainingCheckRequest(code="print(1)"), SimpleNamespace(id="another-learner"), training_db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_preset_checks_are_persisted_and_only_the_owner_can_read_them(training_db):
    account = SimpleNamespace(id="preset-learner")
    answer = "def binary_search(numbers, target):\n    return numbers.index(target) if target in numbers else -1"
    result = await check_training_task("binary-search", TrainingCheckRequest(code=answer), account, training_db)
    assert result["score"] == 100
    failed = await check_training_task("binary-search", TrainingCheckRequest(code="def binary_search(numbers, target):\n    return -1"), account, training_db)
    assert 0 < failed["score"] < 100
    rows = await training_evidence(account, training_db)
    assert len(rows) == 2
    assert all(row["taskId"] == "binary-search" and row["course"] == "Python 程序设计" for row in rows)
    assert "code" not in rows[0]
    assert await training_evidence(SimpleNamespace(id="other"), training_db) == []
    profile = await training_db.get(Profile, account.id)
    assert profile.knowledge_level["查找"]["attempts"] == 2
    assert profile.error_profile["代码实战·查找"]["source"] == "training"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["offline", "fallback"])
async def test_training_failure_never_persists_an_unrelated_fallback(training_db, monkeypatch, failure):
    def unavailable(*args, **kwargs):
        if failure == "fallback":
            return {"used_fallback": True}
        raise RuntimeError("offline")
    monkeypatch.setattr("app.routers.training.generate_code_exercise", unavailable)
    with pytest.raises(HTTPException):
        await generate_training_task(request(), SimpleNamespace(id="learner"), training_db)
    assert await training_db.scalar(select(func.count()).select_from(CodeExercise)) == 0


@pytest.mark.asyncio
async def test_training_http_requires_login_and_validates_task_types(training_db):
    app = FastAPI()
    app.include_router(router, prefix="/api/training")
    async def database():
        yield training_db
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/training")).status_code == 401
        assert (await client.post("/api/training", json=request().model_dump())).status_code == 401
        app.dependency_overrides[get_current_account] = lambda: SimpleNamespace(id="learner")
        invalid = {**request().model_dump(), "exercise_kind": "unknown"}
        assert (await client.post("/api/training", json=invalid)).status_code == 422
        invalid = {**request().model_dump(), "source": {}}
        assert (await client.post("/api/training", json=invalid)).status_code == 422
