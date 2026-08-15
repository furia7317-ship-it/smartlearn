"""Compatibility resource graph bounded-review contracts."""

from __future__ import annotations


def test_second_round_content_rejection_is_released_with_warnings():
    from app.graph.resource_graph import _auto_release_legacy_reviews

    resources = _auto_release_legacy_reviews(
        [
            {
                "id": "explainer-d1",
                "review_approved": False,
                "review_status": "rejected",
                "review_issues": ["缺少边界案例"],
            }
        ]
    )

    resource = resources[0]
    assert resource["review_approved"] is True
    assert resource["review_status"] == "approved_after_rework_limit"
    assert resource["review_auto_released"] is True
    assert resource["review_issues"] == []
    assert "缺少边界案例" in resource["review_warnings"]


def test_reviewer_infrastructure_failure_is_never_auto_released():
    from app.graph.resource_graph import _auto_release_legacy_reviews

    resources = _auto_release_legacy_reviews(
        [
            {
                "id": "explainer-d1",
                "review_approved": False,
                "review_status": "review_unavailable",
                "review_error_code": "review_unavailable",
                "review_issues": ["provider unavailable"],
            }
        ]
    )

    assert resources[0]["review_approved"] is False
    assert resources[0]["review_status"] == "review_unavailable"
    assert "review_auto_released" not in resources[0]
