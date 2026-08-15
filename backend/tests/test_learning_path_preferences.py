from __future__ import annotations

import copy

import pytest

from app.schemas.resource import LearningPathPreferences
from app.schemas.resource_plan import PlanArtifact
from app.services.resource_plan_builder import apply_learning_path_preferences
from app.services.resource_planning import validate_plan
from tests.test_resource_plan_models import sample_plan_dict


def make_plan() -> PlanArtifact:
    return PlanArtifact.model_validate(sample_plan_dict())


def test_learning_path_request_accepts_every_supported_material_type():
    material_types = [
        "explainer",
        "quiz",
        "reading",
        "code",
        "video",
        "mindmap",
        "courseware",
    ]

    preferences = LearningPathPreferences(
        goal="exam",
        days=7,
        daily_minutes=60,
        material_types=material_types,
    )

    assert preferences.material_types == material_types


def assert_preference_contract(plan: PlanArtifact, days: int, material_types: list[str]) -> None:
    assert len(plan.days) == days
    assert [day.day for day in plan.days] == [f"D{index}" for index in range(1, days + 1)]
    assert all(day.minutes == 40 for day in plan.days)
    assert len(plan.tasks) == days * len(material_types)
    task_ids = {task.task_id for task in plan.tasks}
    day_ids = {day.day for day in plan.days}
    assert all(task.type in material_types and task.agent in material_types for task in plan.tasks)
    assert all(set(day.task_ids) <= task_ids for day in plan.days)
    assert all(task.day in day_ids and set(task.depends_on) <= task_ids for task in plan.tasks)
    assert validate_plan(plan).valid


def test_apply_learning_path_preferences_none_is_noop():
    plan = make_plan()
    original = copy.deepcopy(plan.model_dump(mode="json"))

    result = apply_learning_path_preferences(plan, None)

    assert result.model_dump(mode="json") == original


def test_apply_learning_path_preferences_truncates_existing_seven_day_plan_to_three_days():
    plan = apply_learning_path_preferences(
        make_plan(),
        {
            "goal": "starter",
            "days": 7,
            "daily_minutes": 40,
            "material_types": ["explainer", "quiz"],
        },
    )
    result = apply_learning_path_preferences(
        plan,
        {"goal": "starter", "days": 3, "daily_minutes": 40, "material_types": ["explainer", "quiz"]},
    )
    assert_preference_contract(result, 3, ["explainer", "quiz"])
    assert all(task.day in {"D1", "D2", "D3"} for task in result.tasks)
    assert all(day.day != "D4" for day in result.days)
    assert all(set(task.depends_on) <= {item.task_id for item in result.tasks} for task in result.tasks)


@pytest.mark.parametrize("days", [14, 30])
def test_apply_learning_path_preferences_generates_every_selected_type_each_day(days: int):
    plan = make_plan()
    result = apply_learning_path_preferences(
        plan,
        {"goal": "exam", "days": days, "daily_minutes": 40, "material_types": ["explainer"]},
    )
    assert_preference_contract(result, days, ["explainer"])


def test_apply_learning_path_preferences_expands_colliding_model_tasks_per_day():
    payload = sample_plan_dict()
    payload["tasks"][1]["knowledge_points"] = payload["tasks"][0]["knowledge_points"]
    plan = PlanArtifact.model_validate(payload)

    result = apply_learning_path_preferences(
        plan,
        {"goal": "starter", "days": 7, "daily_minutes": 40, "material_types": ["explainer"]},
    )

    assert len(result.tasks) == 7
    assert all(len(day.task_ids) == 1 for day in result.days)
    assert len({task.task_id for task in result.tasks}) == 7
    assert validate_plan(result).valid


def test_apply_learning_path_preferences_mounts_all_types_on_every_day():
    result = apply_learning_path_preferences(
        make_plan(),
        {
            "goal": "starter",
            "days": 3,
            "daily_minutes": 40,
            "material_types": ["explainer", "reading", "video", "quiz"],
        },
    )

    assert len(result.tasks) == 12
    for day in result.days:
        mounted = {task.type for task in result.tasks if task.task_id in day.task_ids}
        assert mounted == {"explainer", "reading", "video", "quiz"}
