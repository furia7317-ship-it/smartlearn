from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.learning import CodeExercise, CodeSubmission, GeneratedMaterial
from app.models.profile import Profile
from app.routers.code_lab import (
    code_visualization_eligibility,
    create_code_exercise,
    execute_code,
    latest_code_exercise,
    submit_code_exercise,
    visualize_code,
)
from app.routers.materials import MaterialMediaLink, link_material_media
from app.schemas.code_lab import (
    CodeEligibilityRequest,
    CodeExerciseGenerateRequest,
    CodeExerciseSubmitRequest,
    CodeExecuteRequest,
    CodeVisualizeRequest,
)
from app.services.code_execution import execute_python
from app.services.code_exercises import fallback_grade_feedback, normalize_code_exercise
from app.services.code_visualization_store import CodeVisualizationStore


@pytest.fixture
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def test_python_runner_returns_authoritative_trace() -> None:
    result = execute_python("values = [3, 1, 2]\nvalues.sort()\nprint(values)")

    assert result["error"] is None
    assert result["stdout"] == "[1, 2, 3]\n"
    assert any(
        change["kind"] == "array.update" and change["after"] == [1, 2, 3]
        for step in result["trace"]
        for change in step["changes"]
    )


def test_python_runner_accepts_standard_main_guard() -> None:
    result = execute_python('if __name__ == "__main__":\n    print("ready")')

    assert result["error"] is None
    assert result["stdout"] == "ready\n"


def test_python_runner_supports_bounded_teaching_classes_and_standard_imports() -> None:
    result = execute_python(
        "\n".join(
            [
                "from collections import deque",
                "import heapq",
                "class Queue:",
                "    def __init__(self):",
                "        self._items = deque()",
                "    def push(self, value):",
                "        self._items.append(value)",
                "    def pop(self):",
                "        return self._items.popleft()",
                "queue = Queue()",
                "queue.push(3)",
                "queue.push(1)",
                "values = [queue.pop(), queue.pop(), 2]",
                "heapq.heapify(values)",
                "print([heapq.heappop(values) for _ in range(3)])",
            ]
        )
    )

    assert result["error"] is None
    assert result["stdout"] == "[1, 2, 3]\n"
    assert any(step["function"] == "push" for step in result["trace"])


def test_python_runner_supports_lambda_and_collection_deletion() -> None:
    result = execute_python(
        "values = [('b', 2), ('a', 1)]\n"
        "values.sort(key=lambda item: item[1])\n"
        "del values[1]\n"
        "print(values)"
    )

    assert result["error"] is None
    assert result["stdout"] == "[('a', 1)]\n"


def test_python_runner_serializes_partially_initialized_teaching_objects_safely() -> None:
    result = execute_python(
        "class Item:\n"
        "    def __init__(self):\n"
        "        self.value = 3\n"
        "    def __str__(self):\n"
        "        return str(self.value)\n"
        "item = Item()\n"
        "print(item)"
    )

    assert result["error"] is None
    assert result["stdout"] == "3\n"


def test_python_runner_bounds_dynamic_sequence_repetition() -> None:
    valid = execute_python("capacity = 4\nvalues = [None] * capacity\nprint(len(values))")
    rejected = execute_python("capacity = 100000000\nvalues = [None] * capacity")

    assert valid["error"] is None
    assert valid["stdout"] == "4\n"
    assert rejected["error"]["type"] == "RuntimeError"
    assert "10000" in rejected["error"]["message"]


@pytest.mark.parametrize(
    ("code", "message"),
    [
        ("import os", "os"),
        ("from pathlib import Path", "pathlib"),
        ("from collections import Counter", "Counter"),
        ("class Unsafe(object):\n    pass", "继承"),
        ("open('secret.txt')", "open"),
        ("items = [0] * 100000000", "10000"),
        ("value = 2 ** 999", "20"),
    ],
)
def test_python_runner_rejects_unsafe_or_unbounded_source(code: str, message: str) -> None:
    result = execute_python(code)

    assert result["error"]["type"] == "ValidationError"
    assert message in result["error"]["message"]
    assert result["trace"] == []


def test_python_runner_stops_unbounded_execution() -> None:
    result = execute_python("counter = 0\nwhile True:\n    counter += 1")

    assert result["error"]["type"] == "RuntimeError"
    assert "15000" in result["error"]["message"]


def test_truncated_trace_keeps_the_real_terminal_state() -> None:
    result = execute_python('for i in range(300):\n    value = i\nprint("done", value)')

    assert result["error"] is None
    assert result["trace_truncated"] is True
    assert len(result["trace"]) == 240
    assert result["trace"][-1]["event"] == "return"
    assert result["trace"][-1]["variables"]["value"] == 299
    assert result["trace"][-1]["stdout"] == "done 299\n"


@pytest.mark.asyncio
async def test_visualization_eligibility_uses_runner_validation_without_execution() -> None:
    valid = await code_visualization_eligibility(
        CodeEligibilityRequest(code="values = [3, 1]\nvalues.sort()")
    )
    too_long = await code_visualization_eligibility(
        CodeEligibilityRequest(code="\n".join("value = 1" for _ in range(301)))
    )
    unsafe = await code_visualization_eligibility(CodeEligibilityRequest(code="import os"))
    comments_are_free = await code_visualization_eligibility(
        CodeEligibilityRequest(
            code="\n".join(
                [*(f"# comment {index}" for index in range(250)), "value = 1", "print(value)"]
            )
        )
    )

    assert valid["eligible"] is True
    assert too_long == {
        "eligible": False,
        "reason": "代码不能超过 300 行",
        "line": None,
    }
    assert unsafe["eligible"] is False
    assert "os" in unsafe["reason"]
    assert comments_are_free["eligible"] is True


def test_code_visualization_store_survives_reload_and_invalidates_changed_code(
    tmp_path,
    monkeypatch,
) -> None:
    from app.services import code_visualization_store as store_module

    monkeypatch.setattr(store_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    store = CodeVisualizationStore()
    result = {
        "execution": {"trace": [{"line": 1}], "error": None},
        "ai_status": "completed",
        "plan": {"overview": "数组交换", "steps": [], "challenge": None},
    }

    assert store.save(
        student_id="student-1",
        resource_id="resource-1",
        code="values = [2, 1]",
        result=result,
    ) is True
    assert store.load(
        student_id="student-1",
        resource_id="resource-1",
        code="values = [2, 1]",
    ) == result
    assert store.load(
        student_id="student-1",
        resource_id="resource-1",
        code="values = [1, 2]",
    ) is None


@pytest.mark.asyncio
async def test_execute_endpoint_does_not_call_ai_unless_requested(monkeypatch) -> None:
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("AI review must remain lazy")

    monkeypatch.setattr("app.routers.code_lab.diagnose_code", fail_if_called)
    response = await execute_code(CodeExecuteRequest(code="print(3)", include_ai_review=False))

    assert response["execution"]["stdout"] == "3\n"
    assert response["ai_status"] == "not_requested"


@pytest.mark.asyncio
async def test_visualize_endpoint_keeps_trace_when_ai_is_unavailable(monkeypatch) -> None:
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("provider offline")

    monkeypatch.setattr("app.routers.code_lab.build_visual_plan", unavailable)
    response = await visualize_code(CodeVisualizeRequest(code="value = 4\nprint(value)"))

    assert response["ai_status"] == "unavailable"
    assert response["execution"]["stdout"] == "4\n"
    assert response["plan"]["steps"]


@pytest.mark.asyncio
async def test_daily_code_exercise_is_persisted_without_exposing_hidden_tests(
    db_session,
    monkeypatch,
) -> None:
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("provider offline")

    monkeypatch.setattr("app.routers.code_lab.generate_code_exercise", unavailable)
    created = await create_code_exercise(
        CodeExerciseGenerateRequest(
            student_id="student-code",
            learning_date="2026-07-17",
            context_title="列表与循环",
            learning_context="今天学习遍历列表与累加。",
        ),
        db_session,
    )

    stored = await db_session.get(CodeExercise, created["id"])
    assert created["context_title"] == "列表与循环"
    assert created["ai_status"] == "unavailable"
    assert created["test_count"] == 5
    assert "hidden_tests" not in created
    assert len(stored.hidden_tests) == 5
    restored = await latest_code_exercise(
        "student-code",
        "2026-07-17",
        db_session,
    )
    assert restored["id"] == created["id"]


@pytest.mark.asyncio
async def test_code_submission_awards_100_only_when_every_hidden_test_passes(
    db_session,
    monkeypatch,
) -> None:
    exercise = CodeExercise(
        id="exercise-score",
        student_id="student-code",
        learning_date="2026-07-17",
        context_title="列表",
        learning_context="列表求和",
        title="列表求和",
        prompt="实现 total(values)",
        difficulty="基础",
        knowledge_points=["列表"],
        constraints=["保留函数名"],
        starter_code="def total(values):\n    pass\n",
        function_name="total",
        examples=[],
        hidden_tests=[
            {"args": [[1, 2, 3]], "expected": 6, "label": "普通列表"},
            {"args": [[]], "expected": 0, "label": "空列表"},
            {"args": [[5]], "expected": 5, "label": "单元素"},
            {"args": [[-2, 3]], "expected": 1, "label": "负数"},
            {"args": [[0, 0]], "expected": 0, "label": "全零"},
        ],
        ai_status="completed",
    )
    db_session.add(exercise)
    await db_session.commit()

    def deterministic_feedback(_code, *, exercise, execution, case_results, score):
        failed = [
            {"label": exercise["tests"][index]["label"]}
            for index, item in enumerate(case_results)
            if not item.get("passed")
        ]
        return fallback_grade_feedback(
            score=score,
            passed_tests=sum(bool(item.get("passed")) for item in case_results),
            total_tests=len(exercise["tests"]),
            execution=execution,
            failed_cases=failed,
        )

    monkeypatch.setattr("app.routers.code_lab.grade_code_feedback", deterministic_feedback)
    perfect = await submit_code_exercise(
        exercise.id,
        CodeExerciseSubmitRequest(
            student_id="student-code",
            code="def total(values):\n    return sum(values)",
        ),
        db_session,
    )
    partial = await submit_code_exercise(
        exercise.id,
        CodeExerciseSubmitRequest(
            student_id="student-code",
            code="def total(values):\n    return 0",
        ),
        db_session,
    )

    assert perfect["score"] == 100
    assert perfect["passed"] is True
    assert perfect["passed_tests"] == perfect["total_tests"] == 5
    assert "程序未产生 print 输出" in perfect["execution"]["stdout"]
    assert "返回值测试：5/5 通过，本次得分 100 分" in perfect["execution"]["stdout"]
    assert partial["score"] == 40
    assert partial["passed"] is False
    assert partial["diagnosis"]["issues"]
    assert "返回值测试：2/5 通过，本次得分 40 分" in partial["execution"]["stdout"]
    assert await db_session.get(CodeSubmission, perfect["submission_id"]) is not None
    profile = await db_session.get(Profile, "student-code")
    assert profile.knowledge_level["列表"]["source"] == "code_lab"
    assert profile.knowledge_level["列表"]["attempts"] == 2
    assert "40 分" in profile.knowledge_level["列表"]["evidence"]
    assert profile.error_profile["代码实战·列表"]["count"] == 1


def test_generated_exercise_recomputes_expected_values_from_reference_solution() -> None:
    normalized = normalize_code_exercise(
        {
            "title": "平方",
            "prompt": "返回数字的平方",
            "function_name": "square",
            "starter_code": "def square(value):\n    pass\n",
            "reference_solution": "def square(value):\n    return value * value\n",
            "tests": [
                {"args": [value], "expected": 999, "label": f"场景 {value}"}
                for value in [0, 1, 2, -3, 10]
            ],
        },
        context_title="函数",
        learning_context="函数返回值",
    )

    assert [item["expected"] for item in normalized["tests"]] == [0, 1, 4, 9, 100]


@pytest.mark.asyncio
async def test_video_task_link_is_written_to_material_primary_data(db_session, monkeypatch) -> None:
    material = GeneratedMaterial(
        id="material-video",
        student_id="student-1",
        type="video",
        title="排序视频",
        subtitle="",
        meta=[],
        sources=0,
        knowledge_points="排序",
        data={
            "reviewed": True,
            "review_approved": True,
            "task_id": "material-1-video",
        },
        source="form",
    )
    db_session.add(material)
    await db_session.commit()
    monkeypatch.setattr(
        "app.services.media.task.media_task_manager.get_progress",
        lambda task_id: {
            "id": task_id,
            "student_id": "student-1",
            "kind": "video",
            "status": "completed",
            "workflow_version": "workflow-v1",
        },
    )

    linked = await link_material_media(
        "missing-viewer-id",
        MaterialMediaLink(
            student_id="student-1",
            task_id="task-123",
            resource_task_id="material-1-video",
        ),
        db_session,
    )

    await db_session.refresh(material)
    assert linked["material_id"] == material.id
    assert material.data["media_task_id"] == "task-123"
    assert material.data["media_status"] == "completed"
    assert material.data["media_file_url"] == "/api/media/video/task-123/file"


@pytest.mark.asyncio
async def test_video_task_link_rejects_another_students_task(db_session, monkeypatch) -> None:
    material = GeneratedMaterial(
        id="material-owner",
        student_id="student-1",
        type="video",
        title="视频",
        subtitle="",
        meta=[],
        sources=0,
        knowledge_points="",
        data={"reviewed": True, "review_approved": True},
        source="form",
    )
    db_session.add(material)
    await db_session.commit()
    monkeypatch.setattr(
        "app.services.media.task.media_task_manager.get_progress",
        lambda task_id: {
            "id": task_id,
            "student_id": "student-2",
            "kind": "video",
            "status": "rendering",
        },
    )

    with pytest.raises(HTTPException) as exc:
        await link_material_media(
            material.id,
            MaterialMediaLink(student_id="student-1", task_id="task-other"),
            db_session,
        )
    assert exc.value.status_code == 403
