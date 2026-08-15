"""Plan coverage and exact schedule-integration contracts."""

from __future__ import annotations


def test_coverage_finds_only_missing_or_unapproved_tasks():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_coverage import audit_plan_coverage
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    resources = [
        {
            "id": "explainer-d1",
            "task_id": "explainer-d1",
            "review_approved": True,
            "review_score": 0.95,
            "overview": "数组支持随机访问，链表插入删除时不搬移后续元素",
        }
    ]

    coverage = audit_plan_coverage(plan, resources)

    assert coverage["missing_task_ids"] == ["quiz-d2"]
    assert coverage["ready_task_ids"] == ["explainer-d1"]
    assert coverage["complete"] is False


def test_coverage_selects_highest_scored_retry_and_reports_duplicates():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_coverage import select_best_resources
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    resources = [
        {
            "id": "old",
            "task_id": "explainer-d1",
            "review_approved": False,
            "review_score": 0.4,
            "retry_count": 0,
            "overview": "只有数组",
        },
        {
            "id": "new",
            "task_id": "explainer-d1",
            "review_approved": True,
            "review_score": 0.95,
            "retry_count": 1,
            "overview": "数组随机访问，链表插入删除",
        },
    ]

    selected, duplicate_ids = select_best_resources(plan, resources)

    assert selected["explainer-d1"]["id"] == "new"
    assert duplicate_ids == ["old"]


def test_schedule_uses_plan_days_and_exact_resource_ids():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.planned_integration import integrate_approved_plan
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    resources = [
        {
            "id": "explainer-d1",
            "task_id": "explainer-d1",
            "type": "explainer",
            "title": "讲义",
            "overview": "数组随机访问，链表插入删除",
            "review_approved": True,
            "review_score": 0.9,
        },
        {
            "id": "quiz-d2",
            "task_id": "quiz-d2",
            "type": "quiz",
            "title": "测验",
            "questions": [{"stem": "LIFO 与 FIFO 的区别", "answer": "栈与队列"}],
            "review_approved": True,
            "review_score": 0.9,
        },
    ]

    result = integrate_approved_plan(plan, resources)

    assert result["schedule"][0]["title"] == "线性表：数组与链表"
    assert result["schedule"][0]["steps"][0]["resources"][0]["id"] == "explainer-d1"
    assert result["schedule"][1]["steps"][1]["resources"][0]["id"] == "quiz-d2"
    assert result["schedule"][0]["steps"][-1]["type"] == "review"
    assert all(
        sum(step["minutes"] for step in scheduled_day["steps"])
        == scheduled_day["minutes"]
        for scheduled_day in result["schedule"]
    )
    assert all(
        {step["type"] for step in scheduled_day["steps"]} >= {"practice", "review"}
        for scheduled_day in result["schedule"]
    )
    assert all(
        step["completion_kind"] == "quiz_submission"
        for scheduled_day in result["schedule"]
        for step in scheduled_day["steps"]
        if step["type"] == "practice"
    )
    assert result["schedule"][0]["steps"][-2]["resources"][0]["id"] == "quiz-d2"
    assert "1 道题" in result["schedule"][0]["steps"][-2]["detail"]
    assert all(
        step["prompts"]
        and step["completion_kind"] == "written_response"
        for scheduled_day in result["schedule"]
        for step in scheduled_day["steps"]
        if step["type"] == "review"
    )


def test_auto_released_rework_is_selected_and_can_integrate_with_warnings():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_coverage import audit_plan_coverage, select_best_resources
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["days"][0]["task_ids"] = ["explainer-d1"]
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)
    resources = [
        {
            "id": "old",
            "task_id": "explainer-d1",
            "retry_count": 0,
            "overview": "旧版本分数较高但没有通过审核",
        },
        {
            "id": "reworked",
            "task_id": "explainer-d1",
            "retry_count": 1,
            "overview": "返工版本仍缺少部分大纲术语",
        },
    ]
    reviews = {
        "explainer-d1": {
            "approved": True,
            "auto_released": True,
            "gate_status": "approved_after_rework_limit",
            "retry_count": 1,
            "score": 0.35,
            "warnings": ["仍缺少边界案例"],
        }
    }

    selected, duplicates = select_best_resources(plan, resources, reviews)
    coverage = audit_plan_coverage(plan, resources, reviews)

    assert selected["explainer-d1"]["id"] == "reworked"
    assert selected["explainer-d1"]["review_warnings"] == ["仍缺少边界案例"]
    assert duplicates == ["old"]
    assert coverage["ready_task_ids"] == ["explainer-d1"]
    assert coverage["complete"] is True


def test_task_free_calendar_day_still_fills_the_selected_learning_time():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.planned_integration import integrate_approved_plan
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["days"][1]["task_ids"] = []
    payload["tasks"] = [payload["tasks"][0]]
    plan = PlanArtifact.model_validate(payload)

    result = integrate_approved_plan(plan, [])
    day = result["schedule"][1]

    assert [step["type"] for step in day["steps"]] == ["study", "practice", "review"]
    assert sum(step["minutes"] for step in day["steps"]) == 60
    assert all(step["minutes"] > 0 for step in day["steps"])
    assert day["steps"][1]["resources"] == []
    assert len(day["steps"][1]["prompts"]) == 2
    assert day["steps"][1]["completion_kind"] == "written_response"


def test_integration_does_not_substitute_a_same_type_resource_for_missing_task():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.planned_integration import integrate_approved_plan
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    resources = [
        {
            "id": "other-quiz",
            "task_id": "not-in-plan",
            "type": "quiz",
            "title": "其他测验",
            "review_approved": True,
            "review_score": 1.0,
        }
    ]

    result = integrate_approved_plan(plan, resources)

    assert all(
        resource["id"] != "other-quiz"
        for day in result["schedule"]
        for step in day["steps"]
        for resource in step.get("resources", [])
    )


def test_coverage_accepts_definition_terms_explained_in_natural_language():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_coverage import audit_plan_coverage
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["days"] = [payload["days"][0]]
    payload["days"][0]["task_ids"] = ["explainer-d1"]
    payload["tasks"] = [payload["tasks"][0]]
    payload["tasks"][0]["outline"]["sections"][0]["must_cover"] = ["栈定义", "LIFO原则"]
    plan = PlanArtifact.model_validate(payload)

    coverage = audit_plan_coverage(
        plan,
        [
            {
                "id": "explainer-d1",
                "task_id": "explainer-d1",
                "review_approved": True,
                "review_score": 0.9,
                "overview": "栈是一种受限线性表，遵循后进先出（LIFO）。",
            }
        ],
    )

    assert coverage["ready_task_ids"] == ["explainer-d1"]


def test_integration_embeds_code_and_reading_in_one_daily_handout():
    import copy

    from app.schemas.resource_plan import PlanArtifact
    from app.services.planned_integration import integrate_approved_plan
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["constraints"]["days"] = 1
    payload["constraints"]["material_types"] = ["explainer", "code", "reading"]
    payload["days"] = [payload["days"][0]]
    explainer = payload["tasks"][0]
    code = copy.deepcopy(explainer)
    code.update({"task_id": "code-d1", "type": "code", "agent": "code", "title": "代码演示"})
    reading = copy.deepcopy(explainer)
    reading.update({"task_id": "reading-d1", "type": "reading", "agent": "reading", "title": "拓展阅读"})
    payload["tasks"] = [explainer, code, reading]
    payload["days"][0]["task_ids"] = ["explainer-d1", "code-d1", "reading-d1"]
    plan = PlanArtifact.model_validate(payload)
    common = {"review_approved": True, "review_score": 0.9, "overview": "数组随机访问，链表插入删除"}
    resources = [
        {**common, "id": "explainer-d1", "task_id": "explainer-d1", "type": "explainer", "title": "讲义", "explanation": "数组与链表"},
        {**common, "id": "code-d1", "task_id": "code-d1", "type": "code", "title": "代码", "code": "print('数组与链表')"},
        {**common, "id": "reading-d1", "task_id": "reading-d1", "type": "reading", "title": "阅读", "content": "数组与链表的延伸"},
    ]

    result = integrate_approved_plan(plan, resources)
    study = result["schedule"][0]["steps"][0]
    handout = result["composite_resources"][0]

    assert [item["type"] for item in study["resources"]] == ["explainer"]
    assert study["resource_types"] == ["explainer"]
    assert handout["embedded_code_examples"][0]["task_id"] == "code-d1"
    assert handout["embedded_readings"][0]["task_id"] == "reading-d1"
