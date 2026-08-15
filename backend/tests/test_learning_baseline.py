from __future__ import annotations

import pytest
from fastapi import HTTPException


def baseline(**overrides):
    value = {"source": "self_report", "level": "basic", "confidence": 0.6, "summary": "略懂基础"}
    value.update(overrides)
    return value


def test_learning_path_baseline_rules_and_one_off_compatibility():
    from app.schemas.resource import LearningBaseline
    from app.services.learning_baseline import require_learning_baseline

    with pytest.raises(HTTPException) as exc:
        require_learning_baseline(None)
    assert exc.value.detail["code"] == "baseline_required"
    with pytest.raises(HTTPException):
        require_learning_baseline(LearningBaseline(**baseline(source="explicit_default")))
    with pytest.raises(HTTPException):
        require_learning_baseline(LearningBaseline(**baseline(level="custom", custom_description="")))
    assert require_learning_baseline(LearningBaseline(**baseline())).level == "basic"


def test_length_policy_applies_by_level_without_touching_quiz_or_code():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.learning_baseline import apply_length_policy
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][0]["type"] = payload["tasks"][0]["agent"] = "explainer"
    payload["tasks"][1]["type"] = payload["tasks"][1]["agent"] = "quiz"
    plan = apply_length_policy(PlanArtifact.model_validate(payload), baseline(level="novice"))
    explainer = plan.tasks[0]
    assert sum(section.target_words for section in explainer.outline.sections) >= 2400
    assert "总字数不少于 2040 字" in explainer.quality_criteria
    assert not any("总字数" in item for item in plan.tasks[1].quality_criteria)


def test_length_policy_leaves_one_off_resources_untouched_without_baseline():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.learning_baseline import apply_length_policy
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][0]["type"] = payload["tasks"][0]["agent"] = "explainer"
    original_words = [section["target_words"] for section in payload["tasks"][0]["outline"]["sections"]]
    original_criteria = list(payload["tasks"][0]["quality_criteria"])

    plan = apply_length_policy(PlanArtifact.model_validate(payload), None)

    assert [section.target_words for section in plan.tasks[0].outline.sections] == original_words
    assert plan.tasks[0].quality_criteria == original_criteria
    assert plan.learner_context is None


def test_explicit_default_uses_basic_length_policy():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.learning_baseline import apply_length_policy
    from tests.test_resource_plan_models import sample_plan_dict

    payload = sample_plan_dict()
    payload["tasks"][0]["type"] = payload["tasks"][0]["agent"] = "explainer"
    plan = apply_length_policy(
        PlanArtifact.model_validate(payload),
        baseline(source="explicit_default", level="basic", explicit_default_confirmed=True),
    )

    assert sum(section.target_words for section in plan.tasks[0].outline.sections) >= 2000
    assert "总字数不少于 1700 字" in plan.tasks[0].quality_criteria


def test_old_plan_and_short_explainer_are_compatible_and_blocked():
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_quality import review_resource
    from tests.test_resource_plan_models import sample_plan_dict

    plan = PlanArtifact.model_validate(sample_plan_dict())
    assert plan.learner_context is None
    review = review_resource(
        {"type": "explainer", "explanation": "短文"},
        {"type": "explainer", "quality_criteria": ["总字数不少于 2000 字"], "outline": {"sections": []}},
    )
    assert review.approved is False
    assert any("2000" in issue for issue in review.blocking_issues)
    assert any(item.target_field == "explanation" for item in review.repair_instructions)
