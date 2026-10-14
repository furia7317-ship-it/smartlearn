from app.schemas.resource import ResourceRequest
from app.services.planned_resource_pipeline import build_explicit_request_plan
from app.agents.common import prompt_extras


def test_explicit_dialogue_task_preserves_types_points_and_solution_dependency():
    request = ResourceRequest(topic="二叉树遍历", student_id="student-1",
        material_types=["explainer", "quiz", "solution", "code"],
        knowledge_points="前序遍历、中序遍历、后序遍历、递归、时间复杂度",
        requirements="生成讲义、5道选择题附解析和代码，共用同一棵树。",
        quiz_config={"choice": 5, "judge": 0, "short": 0})
    plan = build_explicit_request_plan(request, [{"id": "kb-1", "content": "二叉树教材"}])
    assert plan.validation.valid
    assert [t.type for t in plan.tasks] == request.material_types
    assert all(t.knowledge_points[-1] == "时间复杂度" for t in plan.tasks)
    assert plan.tasks[2].depends_on == [plan.tasks[1].task_id]
    assert plan.tasks[1].quiz_config == {"choice": 5, "judge": 0, "short": 0}


def test_solution_receives_complete_original_questions_and_late_shared_constraints():
    text = prompt_extras({"plan_task": {"type": "solution"},
        "requirements": "共同要求" * 200 + "统一示例树：A为根，左右B/C，B左右D/E。",
        "dependency_outputs": [{"title": "练习题", "summary": "略",
            "questions": [{"id": "q5", "stem": "最后一题完整题干", "answer": "A", "explanation": "解析"}]}]})
    assert "统一示例树：A为根" in text
    assert '"id": "q5"' in text and "最后一题完整题干" in text
    assert "不另出新题" in text
