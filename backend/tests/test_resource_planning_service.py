"""Deterministic request policy and plan-validation tests."""

from __future__ import annotations

from tests.test_resource_plan_models import sample_plan_dict


def test_complexity_policy_auto_runs_one_concept_with_three_tasks_or_less():
    from app.services.resource_planning import classify_complexity

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]
    result = classify_complexity("解释数组与链表", payload)

    assert result.model_dump() == {
        "level": "simple",
        "reasons": [],
        "auto_execute": True,
    }


def test_complexity_policy_pauses_learning_path_and_honors_direct_override():
    from app.services.resource_planning import classify_complexity

    payload = sample_plan_dict()
    paused = classify_complexity("生成 7 天数据结构学习路径", payload)
    direct = classify_complexity("生成 7 天数据结构学习路径，直接生成", payload)

    assert paused.level == "complex" and paused.auto_execute is False
    assert direct.level == "complex" and direct.auto_execute is True


def test_complexity_policy_honors_explicit_plan_first_request():
    from app.services.resource_planning import classify_complexity

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["tasks"] = [payload["tasks"][0]]

    result = classify_complexity("解释数组与链表，先看规划", payload)

    assert result.level == "complex"
    assert result.auto_execute is False
    assert "user_requested_confirmation" in result.reasons


def test_validator_rejects_generic_chapter_titles_and_duplicate_tasks():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    payload["days"][0]["title"] = "数据结构基础定位"
    payload["tasks"][1]["title"] = payload["tasks"][0]["title"]
    plan = PlanArtifact.model_validate(payload)

    result = validate_plan(plan)

    assert result.valid is False
    assert any("泛化" in error for error in result.errors)
    assert any("重复" in error for error in result.errors)


def test_validator_rejects_unknown_day_and_self_dependency():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    payload["tasks"][0]["day"] = "D9"
    payload["tasks"][0]["depends_on"] = ["explainer-d1"]
    plan = PlanArtifact.model_validate(payload)

    result = validate_plan(plan)

    assert result.valid is False
    assert any("不存在的学习日" in error for error in result.errors)
    assert any("依赖自身" in error for error in result.errors)


def test_validator_warns_when_day_is_close_to_daily_time_limit():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    payload["constraints"]["daily_minutes"] = 60
    payload["days"][0]["minutes"] = 60
    plan = PlanArtifact.model_validate(payload)

    result = validate_plan(plan)

    assert result.valid is True
    assert any("时长" in warning for warning in result.warnings)


def test_validator_rejects_dependency_cycles_and_unmounted_tasks():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    payload["tasks"][0]["depends_on"] = ["quiz-d2"]
    payload["days"][1]["task_ids"] = []
    plan = PlanArtifact.model_validate(payload)

    result = validate_plan(plan)

    assert result.valid is False
    assert any("依赖环" in error for error in result.errors)
    assert any("未挂载" in error for error in result.errors)


def test_validator_rejects_later_day_dependencies_and_wrong_day_mounts():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    payload["tasks"][0]["depends_on"] = ["quiz-d2"]
    payload["days"][0]["task_ids"] = ["quiz-d2"]
    payload["days"][1]["task_ids"] = ["explainer-d1"]
    plan = PlanArtifact.model_validate(payload)

    result = validate_plan(plan)

    assert result.valid is False
    assert any("晚于当前任务" in error for error in result.errors)
    assert any("挂载学习日" in error for error in result.errors)


def test_validation_normalizes_unambiguous_assessment_task_to_quiz_agent():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    task = payload["tasks"][1]
    task.update({"type": "reading", "agent": "reading", "title": "动态规划综合测验"})
    task["outline"]["objective"] = "完成共 6 道选择题，并提供答案解析。"
    task["quality_criteria"] = ["共 6 道题", "答案解析完整"]
    plan = PlanArtifact.model_validate(payload)

    assert validate_plan(plan).valid is True
    assert plan.tasks[1].type == "quiz"
    assert plan.tasks[1].agent == "quiz"


def test_validation_keeps_ordinary_extension_reading_as_reading():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_planning import validate_plan

    payload = sample_plan_dict()
    task = payload["tasks"][1]
    task.update({"type": "reading", "agent": "reading", "title": "动态规划延伸阅读"})
    task["outline"]["objective"] = "阅读一篇关于动态规划应用的延伸材料。"
    task["quality_criteria"] = ["至少 300 字"]
    plan = PlanArtifact.model_validate(payload)

    assert validate_plan(plan).valid is True
    assert plan.tasks[1].type == "reading"
    assert plan.tasks[1].agent == "reading"
