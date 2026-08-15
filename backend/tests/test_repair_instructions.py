"""Regression coverage for structured, bounded resource repair work orders."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _stub_production_semantic_reviewer(monkeypatch):
    """These repair tests exercise tickets, not the external semantic provider."""

    from app.graph import planned_resource_graph as graph

    monkeypatch.setattr(
        graph,
        "verify_resource_semantics",
        lambda *_args: {"approved": True, "issues": [], "claim_evidence": []},
    )


def test_legacy_review_payload_remains_readable_without_repair_fields():
    from app.schemas.resource_plan import TaskReview

    review = TaskReview.model_validate(
        {
            "approved": False,
            "score": 0.5,
            "issues": ["旧版缺口"],
            "fixes": ["旧版修复建议"],
        }
    )

    assert review.repair_instructions == []
    assert review.blocking_fingerprints == []


def test_must_cover_gap_has_a_section_specific_repair_instruction():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {"type": "explainer", "explanation": "动态规划保存子问题结果。" * 12},
        {
            "type": "explainer",
            "quality_criteria": ["解释准确"],
            "outline": {
                "sections": [
                    {"title": "状态转移", "must_cover": ["状态转移方程"]}
                ]
            },
        },
    )

    instruction = review.repair_instructions[0]
    assert instruction.issue.startswith("大纲必须覆盖点缺失")
    assert instruction.location == "大纲章节「状态转移」"
    assert instruction.target_field == "explanation"
    assert instruction.required_terms == ["状态转移方程"]
    assert "现有审核器" in instruction.acceptance_check


def test_must_cover_fingerprint_is_stable_when_the_missing_batch_shrinks():
    from app.services.resource_quality import review_resource

    task = {
        "type": "explainer",
        "quality_criteria": ["解释准确"],
        "outline": {
            "sections": [
                {"title": "核心术语", "must_cover": ["术语A", "术语B"]}
            ]
        },
    }
    first = review_resource({"type": "explainer", "explanation": "背景说明。" * 30}, task)
    second = review_resource(
        {"type": "explainer", "explanation": "术语B 已补齐。" * 30}, task
    )

    first_a = next(
        item.fingerprint for item in first.repair_instructions if item.required_terms == ["术语A"]
    )
    second_a = next(
        item.fingerprint for item in second.repair_instructions if item.required_terms == ["术语A"]
    )
    assert first_a == second_a


def test_shrunk_must_cover_batch_marks_the_remaining_term_as_repeated():
    from app.graph import planned_resource_graph as graph
    from app.services.resource_quality import review_resource

    task = {
        "task_id": "terms-d1",
        "type": "explainer",
        "quality_criteria": ["解释准确"],
        "outline": {
            "sections": [
                {"title": "核心术语", "must_cover": ["术语A", "术语B"]}
            ]
        },
    }
    first = review_resource({"type": "explainer", "explanation": "背景说明。" * 30}, task)
    first_a = next(
        item.fingerprint for item in first.repair_instructions if item.required_terms == ["术语A"]
    )
    reviewed = graph.review_tasks(
        {
            "plan": {"tasks": [task]},
            "resources": [
                {
                    "task_id": "terms-d1",
                    "type": "explainer",
                    "retry_count": 1,
                    "explanation": "术语B 已补齐。" * 30,
                }
            ],
            "reviews": {"terms-d1": {"blocking_fingerprints": first.blocking_fingerprints}},
            "trace_run_id": "test-run",
        }
    )["reviews"]["terms-d1"]

    assert reviewed["repeated_fingerprints"] == [first_a]
    instruction = next(
        item for item in reviewed["repair_instructions"] if item["required_terms"] == ["术语A"]
    )
    assert instruction["escalated"] is True


def test_structural_repair_evidence_is_positive_and_field_specific():
    from app.services.resource_quality import review_resource

    cases = [
        (
            {"type": "code", "language": "python", "code": "def broken(:"},
            {"type": "code", "quality_criteria": ["代码可运行"], "outline": {"sections": []}},
            "code 可被目标语言编译",
        ),
        (
            {"type": "quiz", "questions": [{"stem": "题干", "options": ["A", "B"]}]},
            {"type": "quiz", "quality_criteria": ["1 道题"], "outline": {"sections": []}},
            "questions[].answer 非空",
        ),
        (
            {"type": "mindmap", "nodes": []},
            {"type": "mindmap", "quality_criteria": ["层级清晰"], "outline": {"sections": []}},
            "nodes 至少包含 3 个一级分支",
        ),
        (
            {"type": "courseware", "slides": []},
            {"type": "courseware", "quality_criteria": ["8 页"], "outline": {"sections": []}},
            "slides 至少包含 8 页",
        ),
        (
            {"type": "video", "narration": []},
            {"type": "video", "quality_criteria": ["60 秒"], "outline": {"sections": []}},
            "scenes/narration 至少包含 2 个连续段落",
        ),
        (
            {"type": "explainer", "explanation": "短文"},
            {"type": "explainer", "quality_criteria": ["解释准确"], "outline": {"sections": []}},
            "explanation 正文至少达到 100 个字符",
        ),
    ]

    for resource, task, expected in cases:
        review = review_resource(resource, task)
        evidence = [item for instruction in review.repair_instructions for item in instruction.required_evidence]
        assert any(expected in item for item in evidence)
        assert not any(any(marker in item for marker in ("缺少", "错误", "不足")) for item in evidence)


def test_code_formula_must_cover_targets_comment_or_explanation_without_keyword_hint():
    from app.services.resource_quality import review_resource

    formula = "dp[i][w] = max(dp[i-1][w], dp[i-1][w-weight[i]] + value[i])"
    review = review_resource(
        {"type": "code", "language": "python", "code": "print('dynamic programming')"},
        {
            "type": "code",
            "quality_criteria": ["代码可运行"],
            "outline": {"sections": [{"title": "背包实现", "must_cover": [formula]}]},
        },
    )

    instruction = review.repair_instructions[0]
    assert instruction.target_field == "code（注释）或 explanation"
    assert formula in instruction.action
    assert any(formula in item for item in instruction.required_evidence)


def test_code_and_quiz_gaps_map_to_their_real_output_fields():
    from app.services.resource_quality import review_resource

    code_review = review_resource(
        {"type": "code", "language": "python", "code": "def broken(:"},
        {"type": "code", "quality_criteria": ["代码可运行"], "outline": {"sections": []}},
    )
    quiz_review = review_resource(
        {
            "type": "quiz",
            "questions": [{"stem": "什么是栈？", "options": ["A", "B"], "answer": "A"}],
        },
        {"type": "quiz", "quality_criteria": ["1 道题"], "outline": {"sections": []}},
    )

    assert any(item.target_field == "code" for item in code_review.repair_instructions)
    assert any(
        item.target_field == "questions[].explanation"
        for item in quiz_review.repair_instructions
    )


def test_repair_prompt_includes_work_order_previous_summary_and_preservation_rule():
    from app.agents.common import prompt_extras

    prompt = prompt_extras(
        {
            "repair_instructions": [
                {
                    "issue": "大纲必须覆盖点缺失：边界初始化",
                    "location": "大纲章节「边界条件」",
                    "target_field": "explanation",
                    "action": "补写边界初始化。",
                    "acceptance_check": "现有审核器可在正文识别该术语。",
                    "required_terms": ["边界初始化"],
                    "required_evidence": ["dp[0][w] = 0"],
                }
            ],
            "repair_context": {
                "previous_resource": {
                    "title": "旧版动态规划讲义",
                    "content_excerpt": "已有状态转移内容。",
                    "questions": [
                        {
                            "id": "q1",
                            "stem": "原题",
                            "answer": "A",
                            "explanation": "原解析",
                        }
                    ],
                }
            },
        }
    )

    assert "结构化返工工单" in prompt
    assert "旧版动态规划讲义" in prompt
    assert "保留已经满足审核的内容" in prompt
    assert "边界初始化" in prompt
    assert "上一版完整 questions JSON" in prompt


def test_quality_review_upgrades_only_repeated_blocking_fingerprints(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import RepairInstruction, TaskReview

    fingerprint = "repeat-must-cover"
    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda resource, task: TaskReview(
            approved=False,
            score=0.82,
            issues=["大纲必须覆盖点缺失：边界初始化"],
            blocking_issues=["大纲必须覆盖点缺失：边界初始化"],
            blocking_fingerprints=[fingerprint],
            repair_instructions=[
                RepairInstruction(
                    issue="大纲必须覆盖点缺失：边界初始化",
                    location="大纲章节「边界条件」",
                    target_field="explanation",
                    action="补写边界初始化",
                    acceptance_check="正文可识别",
                    required_terms=["边界初始化"],
                    required_evidence=["dp[0][w] = 0"],
                    fingerprint=fingerprint,
                )
            ],
        ),
    )
    state = {
        "plan": {"tasks": [{"task_id": "dp-d1", "type": "explainer"}]},
        "resources": [{"task_id": "dp-d1", "retry_count": 1, "explanation": "旧内容"}],
        "reviews": {"dp-d1": {"blocking_fingerprints": [fingerprint], "retry_count": 0}},
        "trace_run_id": "test-run",
    }

    review = graph.review_tasks(state)["reviews"]["dp-d1"]

    assert review["repeated_fingerprints"] == [fingerprint]
    assert review["repair_instructions"][0]["escalated"] is True
    assert "生成前自检" in review["repair_instructions"][0]["action"]


def test_first_occurrence_does_not_escalate_a_fingerprint(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from app.schemas.resource_plan import RepairInstruction, TaskReview

    monkeypatch.setattr(
        graph,
        "review_resource",
        lambda resource, task: TaskReview(
            approved=False,
            score=0.82,
            blocking_issues=["大纲必须覆盖点缺失：边界初始化"],
            blocking_fingerprints=["first-only"],
            repair_instructions=[
                RepairInstruction(
                    issue="大纲必须覆盖点缺失：边界初始化",
                    location="大纲章节「边界条件」",
                    target_field="explanation",
                    action="补写边界初始化",
                    acceptance_check="正文可识别",
                    required_terms=["边界初始化"],
                    fingerprint="first-only",
                )
            ],
        ),
    )
    state = {
        "plan": {"tasks": [{"task_id": "dp-d1", "type": "explainer"}]},
        "resources": [{"task_id": "dp-d1", "retry_count": 0, "explanation": "候选"}],
        "reviews": {},
        "trace_run_id": "test-run",
    }

    review = graph.review_tasks(state)["reviews"]["dp-d1"]

    assert review["repeated_fingerprints"] == []
    assert review["repair_instructions"][0].get("escalated") is False


def test_rework_route_uses_the_latest_candidate_as_bounded_repair_context(monkeypatch):
    from app.graph import planned_resource_graph as graph
    from langgraph.types import Send

    emitted: list[dict] = []
    monkeypatch.setattr(graph, "_emit", emitted.append)

    state = {
        "plan": {"tasks": [{"task_id": "dp-d1", "status": "failed", "type": "explainer"}]},
        "resources": [
            {"task_id": "dp-d1", "retry_count": 0, "explanation": "first candidate"},
            {
                "task_id": "dp-d1",
                "retry_count": 0,
                "type": "quiz",
                "explanation": "latest candidate",
                "questions": [
                    {
                        "id": "q1",
                        "stem": "保留题目",
                        "answer": "A",
                        "explanation": "保留解析",
                    }
                ],
            },
        ],
        "reviews": {
            "dp-d1": {
                "approved": False,
                "score": 0.82,
                "blocking_issues": ["大纲必须覆盖点缺失：边界初始化"],
                "blocking_fingerprints": ["missing-boundary"],
                "repair_instructions": [
                    {
                        "issue": "大纲必须覆盖点缺失：边界初始化",
                        "location": "大纲章节「边界条件」",
                        "target_field": "explanation",
                        "action": "补写边界初始化",
                        "acceptance_check": "正文可识别",
                        "required_terms": ["边界初始化"],
                        "required_evidence": ["dp[0][w] = 0"],
                        "fingerprint": "missing-boundary",
                    }
                ],
                "retry_count": 0,
            }
        },
        "trace_run_id": "test-run",
    }

    routed = graph.route_after_quality_review(state)
    assert len(routed) == 1 and isinstance(routed[0], Send)
    repair_task = routed[0].arg["plan_task"]
    assert repair_task["_repair_context"]["previous_resource"]["content_excerpt"].startswith(
        "latest candidate"
    )
    assert repair_task["_repair_context"]["previous_resource"]["questions"][0]["stem"] == "保留题目"
    assert repair_task["_repair_instructions"][0]["target_field"] == "explanation"
    assert repair_task["retry_count"] == 1
    assert any(
        event.get("event") == "task_progress"
        and event.get("status") == "rework"
        and event.get("blocking_count") == 1
        and "边界条件" in event.get("detail", "")
        for event in emitted
    )


def test_last_mile_normalizer_does_not_fabricate_semantic_content():
    from app.graph.planned_resource_graph import _normalize_candidate_for_review

    repaired = _normalize_candidate_for_review(
        {
            "type": "explainer",
            "title": "斐波那契讲义",
            "explanation": "这里已经讲解了递归、记忆化和自底向上的表格方法。",
        },
        {
            "type": "explainer",
            "outline": {
                "sections": [
                    {
                        "title": "斐波那契数列",
                        "goal": "比较递归、记忆化与表格法的输入、过程和复杂度。",
                        "must_cover": ["动态规划实现"],
                    }
                ]
            },
        },
        [
            {
                "target_field": "explanation",
                "required_terms": ["动态规划实现"],
            }
        ],
    )

    assert "## 审核补充" not in repaired["explanation"]
    assert "动态规划实现" not in repaired["explanation"]
    assert "斐波那契数列" not in repaired["explanation"]


def test_last_mile_normalizer_makes_mindmap_labels_unique_without_dropping_nodes():
    from app.graph.planned_resource_graph import _normalize_candidate_for_review

    repaired = _normalize_candidate_for_review(
        {
            "type": "mindmap",
            "nodes": [
                {"label": "定义", "children": [{"label": "特点"}]},
                {"label": "应用", "children": [{"label": "特点"}]},
                {"label": "比较", "children": [{"label": "特点"}]},
            ],
        },
        {"type": "mindmap"},
        [],
    )

    labels = [
        child["label"]
        for node in repaired["nodes"]
        for child in node.get("children", [])
    ]
    assert len(labels) == 3
    assert len(set(labels)) == 3


def test_last_mile_normalizer_does_not_fabricate_video_narration():
    from app.graph.planned_resource_graph import _normalize_candidate_for_review
    from app.services.resource_quality import extract_resource_text

    repaired = _normalize_candidate_for_review(
        {
            "type": "video",
            "scenes": [
                {"title": f"分镜 {index}", "narration": "保留原有讲解。", "duration": 25}
                for index in range(1, 7)
            ],
            "narration": [
                {"text": "保留原有讲解。", "duration": 25}
                for _index in range(6)
            ],
        },
        {"type": "video", "outline": {"sections": []}},
        [
            {
                "target_field": "scenes/narration",
                "required_terms": ["栈的定义与操作", "循环队列"],
            }
        ],
    )

    visible = extract_resource_text(repaired)
    assert visible
    assert "栈的定义与操作" not in visible
    assert "循环队列" not in visible
    assert all("focus_terms" not in scene for scene in repaired["scenes"])
