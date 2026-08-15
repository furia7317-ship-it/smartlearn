"""Tests for the richer resource planning pipeline."""

from __future__ import annotations


def test_outliner_requires_schedule_details_before_generation():
    from app.agents.outliner import build_learning_outline, infer_study_constraints

    constraints = infer_study_constraints("帮我生成动态规划学习资料")

    assert constraints["needs_clarification"] is True
    assert constraints["missing"] == ["days", "daily_minutes"]

    outline = build_learning_outline(
        {
            "topic": "帮我生成动态规划学习资料",
            "requirements": "",
            "kb_context": [],
            "profile": {},
        }
    )

    assert outline["needs_clarification"] is True
    assert "几天" in outline["question"]
    assert "每天" in outline["question"]


def test_outliner_uses_default_when_user_delegates_schedule():
    from app.agents.outliner import build_learning_outline

    outline = build_learning_outline(
        {
            "topic": "帮我生成动态规划学习资料，你看着安排",
            "requirements": "",
            "kb_context": [],
            "profile": {},
        }
    )

    assert outline["needs_clarification"] is False
    assert outline["constraints"]["days"] == 7
    assert outline["constraints"]["daily_minutes"] == 90
    assert len(outline["chapters"]) >= 4
    assert all(chapter["modules"] for chapter in outline["chapters"])


def test_outliner_sanitizes_learning_path_request_before_scheduling():
    from app.agents.outliner import build_learning_outline
    from app.agents.scheduler import build_daily_schedule

    outline = build_learning_outline(
        {
            "topic": "来一份数据结构的学习路径来告诉我怎么学习 不要多余的东西，你看着安排",
            "requirements": "",
            "kb_context": [],
            "profile": {},
        }
    )

    assert outline["needs_clarification"] is False
    assert outline["topic"] == "数据结构"
    for chapter in outline["chapters"]:
        assert chapter["title"].startswith("数据结构")
        assert "不要多余" not in chapter["title"]
        assert "告诉我怎么学习" not in chapter["title"]
        assert "学习路径" not in chapter["title"]

    schedule = build_daily_schedule({"outline": outline, "integrated": {}, "resources": []})

    assert schedule[0]["title"] == "数据结构基础定位"
    assert schedule[0]["steps"][0]["title"] == "学习：数据结构基础定位"
    assert "不要多余" not in schedule[0]["desc"]


def test_outliner_removes_quantity_prefix_from_generated_path_request():
    from app.agents.outliner import build_learning_outline

    outline = build_learning_outline(
        {
            "topic": "帮我生成一份数据结构的学习路径，你看着安排",
            "requirements": "",
            "kb_context": [],
            "profile": {},
        }
    )

    assert outline["needs_clarification"] is False
    assert outline["topic"] == "数据结构"
    assert outline["chapters"][0]["title"] == "数据结构基础定位"


def test_integrator_and_scheduler_create_daily_steps():
    from app.agents.integrator import integrate_resources
    from app.agents.scheduler import build_daily_schedule

    outline = {
        "title": "动态规划学习计划",
        "constraints": {"days": 3, "daily_minutes": 60},
        "chapters": [
            {"id": "c1", "title": "问题识别", "goal": "识别状态和选择", "modules": ["explainer", "quiz"]},
            {"id": "c2", "title": "状态转移", "goal": "写出状态转移方程", "modules": ["mindmap", "code"]},
        ],
    }
    resources = [
        {"id": "explainer_c1", "type": "explainer", "chapter_id": "c1", "title": "问题识别讲义"},
        {"id": "quiz_c1", "type": "quiz", "chapter_id": "c1", "title": "问题识别练习"},
        {"id": "code_c2", "type": "code", "chapter_id": "c2", "title": "状态转移代码"},
    ]

    integrated = integrate_resources({"outline": outline, "resources": resources})
    schedule = build_daily_schedule({"outline": outline, "integrated": integrated, "resources": resources})

    assert integrated["chapters"][0]["resource_count"] == 2
    assert len(schedule) == 3
    assert schedule[0]["day"] == "D1"
    assert schedule[0]["state"] == "current"
    assert schedule[0]["minutes"] == 60
    assert schedule[0]["steps"]
    assert schedule[0]["steps"][0]["title"].startswith("学习")
    assert schedule[1]["state"] == "todo"


def test_scheduler_attaches_concrete_resources_to_daily_steps():
    from app.agents.integrator import integrate_resources
    from app.agents.scheduler import build_daily_schedule

    outline = {
        "title": "数据结构学习计划",
        "constraints": {"days": 2, "daily_minutes": 70},
        "chapters": [
            {"id": "c1", "title": "数组与链表", "goal": "理解线性结构", "modules": ["explainer", "quiz"]},
            {"id": "c2", "title": "栈与队列", "goal": "掌握受限线性表", "modules": ["mindmap", "code"]},
        ],
    }
    resources = [
        {"id": "explainer_c1", "type": "explainer", "chapter_id": "c1", "title": "数组与链表讲义"},
        {"id": "quiz_c1", "type": "quiz", "chapter_id": "c1", "title": "数组与链表练习"},
        {"id": "mindmap_c2", "type": "mindmap", "chapter_id": "c2", "title": "栈与队列导图"},
        {"id": "code_c2", "type": "code", "chapter_id": "c2", "title": "栈与队列代码"},
    ]

    integrated = integrate_resources({"outline": outline, "resources": resources})
    schedule = build_daily_schedule({"outline": outline, "integrated": integrated, "resources": resources})

    assert schedule[0]["types"] == ["explainer", "quiz"]
    assert schedule[0]["steps"][0]["resources"] == [
        {"id": "explainer_c1", "type": "explainer", "title": "数组与链表讲义"}
    ]
    assert schedule[0]["steps"][1]["resources"] == [
        {"id": "quiz_c1", "type": "quiz", "title": "数组与链表练习"}
    ]
    assert schedule[1]["steps"][0]["resources"] == [
        {"id": "mindmap_c2", "type": "mindmap", "title": "栈与队列导图"}
    ]
    assert schedule[1]["steps"][1]["title"] == "代码挑战：栈与队列"
    assert schedule[1]["steps"][1]["resources"] == [
        {"id": "code_c2", "type": "code", "title": "栈与队列代码"}
    ]
    assert schedule[1]["steps"][2]["title"] == "复盘输出"


def test_scheduler_dispatches_code_as_a_separate_completion_task():
    from app.agents.scheduler import build_daily_schedule

    outline = {
        "constraints": {"days": 1, "daily_minutes": 60},
        "chapters": [{
            "id": "c1",
            "title": "线性表",
            "goal": "掌握线性表",
            "modules": ["explainer", "reading", "code", "video", "quiz"],
        }],
    }
    resources = [
        {"id": kind, "type": kind, "title": kind}
        for kind in ["explainer", "reading", "code", "video", "quiz"]
    ]
    integrated = {
        "chapters": [{"id": "c1", "resources": resources}],
    }

    day = build_daily_schedule({"outline": outline, "integrated": integrated})[0]

    assert day["steps"][0]["resource_types"] == ["explainer", "reading", "video"]
    assert day["steps"][1]["title"] == "代码挑战：线性表"
    assert day["steps"][1]["resource_types"] == ["code"]
    assert day["steps"][1]["completion_kind"] == "written_response"
    assert day["steps"][2]["resource_types"] == ["quiz"]
    assert day["steps"][3]["title"] == "复盘输出"
