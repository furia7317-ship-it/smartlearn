"""Validation and deterministic length policy for learning-path planning."""

from __future__ import annotations

import math
from typing import Any

from fastapi import HTTPException

from app.schemas.resource import LearningBaseline
from app.schemas.resource_plan import PlanArtifact

LENGTHS = {
    "novice": {"explainer": 2400, "reading": 3000},
    "basic": {"explainer": 2000, "reading": 2600},
    "intermediate": {"explainer": 1800, "reading": 2400},
    "advanced": {"explainer": 1800, "reading": 2400},
    "custom": {"explainer": 2000, "reading": 2600},
}


def require_learning_baseline(baseline: LearningBaseline | None) -> LearningBaseline:
    if baseline is None:
        raise HTTPException(status_code=422, detail={"code": "baseline_required", "message": "学习路径需要先确认学情依据"})
    if baseline.source == "explicit_default" and not baseline.explicit_default_confirmed:
        raise HTTPException(status_code=422, detail={"code": "baseline_required", "message": "请明确确认系统默认方案"})
    if baseline.source == "self_report" and baseline.level == "custom" and len(baseline.custom_description.strip()) < 4:
        raise HTTPException(status_code=422, detail={"code": "baseline_required", "message": "自定义学情需要说明已掌握与薄弱内容"})
    return baseline


def apply_length_policy(plan: PlanArtifact, baseline: dict[str, Any] | None) -> PlanArtifact:
    if baseline is None:
        plan.learner_context = None
        return plan

    level = str(baseline.get("level") or "basic")
    targets = LENGTHS.get(level, LENGTHS["basic"])
    for task in plan.tasks:
        if task.type not in targets:
            continue
        target = targets[task.type]
        sections = task.outline.sections
        remaining = target
        for index, section in enumerate(sections):
            share = math.ceil(remaining / max(1, len(sections) - index))
            section.target_words = min(3000, max(section.target_words, share))
            remaining -= section.target_words
        criterion = f"总字数不少于 {math.floor(target * 0.85)} 字"
        task.quality_criteria = [
            item for item in task.quality_criteria if not ("总字数" in item and ("字" in item or "字符" in item))
        ]
        task.quality_criteria = [criterion, *task.quality_criteria][:12]
    plan.learner_context = dict(baseline)
    return plan
