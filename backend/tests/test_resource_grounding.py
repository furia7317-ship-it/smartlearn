from __future__ import annotations

import pytest


def _task() -> dict:
    return {
        "task_id": "explainer-d1",
        "type": "explainer",
        "source_ids": ["kb-dp"],
        "outline": {
            "objective": "理解动态规划",
            "sections": [
                {
                    "title": "复杂度",
                    "goal": "理解动态规划复杂度",
                    "must_cover": ["动态规划", "复杂度"],
                    "target_words": 200,
                }
            ],
        },
        "quality_criteria": ["解释动态规划复杂度"],
    }


def _kb() -> list[dict]:
    return [
        {
            "id": "kb-dp",
            "content": "动态规划通过保存子问题结果避免重复计算，时间复杂度取决于状态数量和每个状态的转移成本，并非恒定。",
        }
    ]


def test_structurally_complete_but_false_absolute_claim_and_fake_source_are_rejected():
    from app.services.resource_grounding import apply_grounding_gate
    from app.services.resource_quality import review_resource

    resource = {
        "type": "explainer",
        "sources": ["made-up-source"],
        "explanation": (
            "动态规划是一类保存子问题结果的方法。"
            "动态规划任何算法的复杂度永远是 O(1) [来源1]。"
            "复杂度因此与状态数量完全无关。" * 12
        ),
    }
    review = apply_grounding_gate(review_resource(resource, _task()), resource, _task(), _kb())

    assert review.approved is False
    assert review.gate_status == "rejected"
    assert any("绝对化复杂度" in issue for issue in review.blocking_issues)
    assert any("无法核验的来源" in issue for issue in review.blocking_issues)


def test_existing_citation_that_does_not_support_claim_is_rejected():
    from app.services.resource_grounding import apply_grounding_gate
    from app.services.resource_quality import review_resource

    resource = {
        "type": "explainer",
        "explanation": (
            "动态规划和复杂度是本节主题。"
            "红黑树的根节点是蓝色 [来源1]。" * 15
        ),
    }
    review = apply_grounding_gate(review_resource(resource, _task()), resource, _task(), _kb())

    assert review.approved is False
    assert any("不支持对应声明" in issue for issue in review.blocking_issues)


def test_numbered_source_labels_map_to_real_evidence_ids():
    from app.services.resource_grounding import _grounding_issues

    resource = {
        "type": "explainer",
        "sources": ["来源1"],
        "explanation": "动态规划是一类保存子问题结果的方法 [来源1]。",
    }
    issues, evidence_ids, mappings = _grounding_issues(resource, _task(), _kb())

    assert not any("无法核验的来源" in issue for issue in issues)
    assert evidence_ids == ["kb-dp"]
    assert mappings


def test_markdown_complexity_heading_is_not_treated_as_a_fact_claim():
    from app.services.resource_grounding import _grounding_issues

    resource = {
        "type": "explainer",
        "sources": [],
        "explanation": "### 时间复杂度与优化\n掌握时间复杂度和优化方法。",
    }
    issues, _, _ = _grounding_issues(resource, _task(), _kb())

    assert not any("关键事实声明缺少来源映射" in issue for issue in issues)


def test_illustrative_analogy_is_not_forced_into_fact_source_mapping():
    from app.services.resource_grounding import _grounding_issues

    resource = {
        "type": "explainer",
        "sources": ["来源1"],
        "explanation": "动态规划通过保存子问题结果避免重复计算 [来源1]。",
        "analogy": "就像整理抽屉，你永远先拿到最上层的物品。",
    }
    issues, _, _ = _grounding_issues(resource, _task(), _kb())

    assert not any("永远先拿到" in issue for issue in issues)


def test_semantic_reviewer_exception_is_unavailable_not_approved():
    from app.schemas.resource_plan import TaskReview
    from app.services.resource_grounding import ReviewUnavailable, apply_grounding_gate

    def unavailable(*_args):
        raise RuntimeError("embedding service down")

    with pytest.raises(ReviewUnavailable):
        apply_grounding_gate(
            TaskReview(approved=True, score=1.0),
            {"type": "explainer", "explanation": "动态规划复杂度说明。" * 20},
            _task(),
            _kb(),
            semantic_verifier=unavailable,
        )


def test_semantic_no_evidence_sentinel_is_not_treated_as_a_fake_source():
    from app.schemas.resource_plan import TaskReview
    from app.services.resource_grounding import apply_grounding_gate

    review = apply_grounding_gate(
        TaskReview(approved=True, score=1.0),
        {"type": "explainer", "explanation": "A concise learner-facing summary."},
        _task(),
        _kb(),
        semantic_verifier=lambda *_args: {
            "approved": True,
            "issues": [],
            "claim_evidence": [
                {"claim": "No source mapping is needed for this sentence.", "evidence_id": "none"}
            ],
        },
    )

    assert review.approved is True
    assert not any("none" in issue for issue in review.blocking_issues)


def test_reviewer_side_unknown_evidence_alias_is_warning_not_an_impossible_repair():
    from app.schemas.resource_plan import TaskReview
    from app.services.resource_grounding import apply_grounding_gate

    review = apply_grounding_gate(
        TaskReview(approved=True, score=1.0),
        {"type": "explainer", "explanation": "A concise learner-facing summary."},
        _task(),
        _kb(),
        semantic_verifier=lambda *_args: {
            "approved": True,
            "issues": [],
            "claim_evidence": [
                {"claim": "A verified claim", "evidence_id": "受控来源证据-1"}
            ],
        },
    )

    assert review.approved is True
    assert not any("无法核验的证据标识" in issue for issue in review.blocking_issues)
    assert any("无法核验的证据标识" in warning for warning in review.warnings)


def test_semantically_verified_fact_is_not_blocked_only_for_missing_inline_citation():
    from app.schemas.resource_plan import TaskReview
    from app.services.resource_grounding import apply_grounding_gate

    review = apply_grounding_gate(
        TaskReview(approved=True, score=1.0),
        {"type": "explainer", "explanation": "该算法的时间复杂度为 O(n)。"},
        _task(),
        _kb(),
        semantic_verifier=lambda *_args: {
            "approved": True,
            "issues": [],
            "claim_evidence": [],
        },
    )

    assert review.approved is True
    assert not any("缺少来源映射" in issue for issue in review.blocking_issues)


def test_semantic_false_fact_remains_blocking_even_without_inline_citation():
    from app.schemas.resource_plan import TaskReview
    from app.services.resource_grounding import apply_grounding_gate

    review = apply_grounding_gate(
        TaskReview(approved=True, score=1.0),
        {"type": "explainer", "explanation": "任何算法的时间复杂度永远是 O(1)。"},
        _task(),
        _kb(),
        semantic_verifier=lambda *_args: {
            "approved": False,
            "issues": ["事实错误：复杂度并非恒为 O(1)"],
            "claim_evidence": [],
        },
    )

    assert review.approved is False
    assert any("事实错误" in issue for issue in review.blocking_issues)


def test_production_semantic_verifier_rejects_structurally_valid_false_fact():
    from app.services.resource_grounding import verify_resource_semantics

    captured: list[list[dict[str, str]]] = []

    class Response:
        content = """{
          "approved": false,
          "issues": ["事实错误：地球不是太阳系最大的行星，木星才是"],
          "claim_evidence": []
        }"""

    class Reviewer:
        def invoke(self, messages):
            captured.append(messages)
            return Response()

    verdict = verify_resource_semantics(
        {
            "type": "explainer",
            "title": "太阳系基础",
            "explanation": "地球是太阳系最大的行星。" + "太阳系由恒星和行星组成。" * 20,
        },
        {**_task(), "title": "太阳系基础"},
        _kb(),
        llm_factory=lambda **_kwargs: Reviewer(),
    )

    assert verdict["approved"] is False
    assert any("地球" in issue and "木星" in issue for issue in verdict["issues"])
    assert captured and captured[0][0]["role"] == "system"
    assert "地球是太阳系最大的行星" not in captured[0][0]["content"]
    assert "地球是太阳系最大的行星" in captured[0][1]["content"]


def test_production_semantic_verifier_provider_failure_is_fail_closed():
    from app.services.resource_grounding import ReviewUnavailable, verify_resource_semantics

    def unavailable(**_kwargs):
        raise RuntimeError("review provider offline")

    with pytest.raises(ReviewUnavailable, match="semantic reviewer unavailable"):
        verify_resource_semantics(
            {"type": "explainer", "explanation": "动态规划复杂度说明。" * 20},
            _task(),
            _kb(),
            llm_factory=unavailable,
        )
