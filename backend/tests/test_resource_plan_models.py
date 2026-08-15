"""PlanArtifact schema and persistence contracts."""

from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
async def db_session():
    from app.models import learning  # noqa: F401
    from app.models.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


def sample_plan_dict() -> dict:
    return {
        "plan_id": "plan-1",
        "student_id": "local_11111111-1111-4111-8111-111111111111",
        "version": 1,
        "status": "awaiting_confirmation",
        "request_summary": "7 天掌握数据结构核心内容",
        "complexity": {
            "level": "complex",
            "reasons": ["multi_day", "multiple_chapters"],
            "auto_execute": False,
        },
        "constraints": {
            "days": 2,
            "daily_minutes": 60,
            "difficulty": "基础到进阶",
        },
        "days": [
            {
                "day": "D1",
                "title": "线性表：数组与链表",
                "knowledge_points": ["顺序存储", "链式存储"],
                "objective": "比较两种存储结构并能选择实现",
                "minutes": 60,
                "prerequisites": [],
                "task_ids": ["explainer-d1"],
                "actions": ["阅读讲义", "完成对比练习", "写复盘"],
            },
            {
                "day": "D2",
                "title": "栈与队列",
                "knowledge_points": ["LIFO", "FIFO"],
                "objective": "能用栈和队列解决基础问题",
                "minutes": 60,
                "prerequisites": ["线性表"],
                "task_ids": ["quiz-d2"],
                "actions": ["阅读解析", "完成测验", "整理错题"],
            },
        ],
        "tasks": [
            {
                "task_id": "explainer-d1",
                "day": "D1",
                "agent": "explainer",
                "type": "explainer",
                "title": "数组与链表对比讲义",
                "knowledge_points": ["顺序存储", "链式存储"],
                "difficulty": "基础",
                "audience": "软件工程大二",
                "outline": {
                    "objective": "解释结构差异和选型依据",
                    "sections": [
                        {
                            "title": "存储布局",
                            "goal": "对比连续与非连续内存",
                            "must_cover": ["随机访问", "插入删除"],
                            "target_words": 350,
                        }
                    ],
                },
                "quality_criteria": ["给出复杂度对比", "包含至少一个选型示例"],
                "source_ids": ["kb-1"],
                "depends_on": [],
                "status": "pending",
                "review": None,
                "retry_count": 0,
            },
            {
                "task_id": "quiz-d2",
                "day": "D2",
                "agent": "quiz",
                "type": "quiz",
                "title": "栈与队列巩固测验",
                "knowledge_points": ["LIFO", "FIFO"],
                "difficulty": "进阶",
                "audience": "软件工程大二",
                "outline": {
                    "objective": "检验结构识别与应用",
                    "sections": [
                        {
                            "title": "结构辨析题",
                            "goal": "区分栈与队列",
                            "must_cover": ["LIFO", "FIFO"],
                            "target_words": 200,
                        }
                    ],
                },
                "quality_criteria": ["5 道题", "每题有唯一答案和解析"],
                "source_ids": ["kb-2"],
                "depends_on": ["explainer-d1"],
                "status": "pending",
                "review": None,
                "retry_count": 0,
            },
        ],
        "validation": {"valid": True, "errors": [], "warnings": []},
    }


def test_plan_artifact_accepts_specific_daily_tasks_and_outlines():
    from app.schemas.resource_plan import PlanArtifact

    plan = PlanArtifact.model_validate(sample_plan_dict())

    assert plan.days[0].task_ids == ["explainer-d1"]
    assert plan.tasks[0].outline.sections[0].must_cover == ["随机访问", "插入删除"]


def test_task_review_normalizes_legacy_blocked_snapshot_to_review_unavailable():
    from app.schemas.resource_plan import TaskReview

    review = TaskReview.model_validate(
        {"approved": False, "score": 0.0, "gate_status": "blocked"}
    )

    assert review.gate_status == "review_unavailable"


def test_task_review_accepts_approved_after_rework_limit():
    from app.schemas.resource_plan import TaskReview

    review = TaskReview.model_validate(
        {
            "approved": True,
            "score": 1.0,
            "gate_status": "approved_after_rework_limit",
        }
    )

    assert review.gate_status == "approved_after_rework_limit"


def test_plan_artifact_accepts_more_than_twelve_unique_tasks():
    from app.schemas.resource_plan import PlanArtifact

    payload = sample_plan_dict()
    template = payload["tasks"][0]
    payload["tasks"] = []
    for index in range(13):
        task = copy.deepcopy(template)
        task["task_id"] = f"explainer-extra-{index}"
        task["title"] = f"扩展讲义 {index}"
        payload["tasks"].append(task)
    payload["days"][0]["task_ids"] = [task["task_id"] for task in payload["tasks"]]
    payload["days"][1]["task_ids"] = []

    plan = PlanArtifact.model_validate(payload)

    assert len(plan.tasks) == 13


def test_plan_artifact_rejects_more_than_maximum_tasks():
    from app.schemas.resource_plan import PlanArtifact

    payload = sample_plan_dict()
    template = payload["tasks"][0]
    payload["tasks"] = []
    for index in range(211):
        task = copy.deepcopy(template)
        task["task_id"] = f"explainer-extra-{index}"
        task["title"] = f"扩展讲义 {index}"
        payload["tasks"].append(task)

    with pytest.raises(ValidationError):
        PlanArtifact.model_validate(payload)


def test_plan_artifact_requires_a_real_outline_for_each_task():
    from app.schemas.resource_plan import PlanArtifact

    payload = sample_plan_dict()
    payload["tasks"][0].pop("outline")

    with pytest.raises(ValidationError):
        PlanArtifact.model_validate(payload)


@pytest.mark.asyncio
async def test_generation_plan_round_trips_artifact(db_session):
    from app.models.learning import ResourceGenerationPlan
    from sqlalchemy import select

    row = ResourceGenerationPlan(
        id="plan-1",
        student_id="student-1",
        version=1,
        status="awaiting_confirmation",
        request_text="生成数据结构学习路径",
        artifact=sample_plan_dict(),
        validation={"valid": True, "errors": [], "warnings": []},
        execution_state={"resources": [], "schedule": [], "task_progress": {}},
    )
    db_session.add(row)
    await db_session.commit()

    loaded = await db_session.scalar(
        select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == "plan-1")
    )
    assert loaded is not None
    assert loaded.artifact["days"][0]["title"] == "线性表：数组与链表"


@pytest.mark.asyncio
async def test_plan_update_uses_database_compare_and_swap(db_session):
    from app.models.learning import ResourceGenerationPlan
    from app.schemas.resource_plan import PlanArtifact
    from app.services.resource_plan_store import PlanVersionError, update_artifact
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    payload = sample_plan_dict()
    payload["student_id"] = "student-1"
    plan = PlanArtifact.model_validate(payload)
    row = ResourceGenerationPlan(
        id=plan.plan_id,
        student_id=plan.student_id,
        version=1,
        status=plan.status,
        request_text="生成数据结构学习路径",
        artifact=plan.model_dump(mode="json"),
        validation=plan.validation.model_dump(mode="json"),
        execution_state={},
    )
    db_session.add(row)
    await db_session.commit()

    other_factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with other_factory() as other_session:
        stale_row = await other_session.scalar(
            select(ResourceGenerationPlan).where(ResourceGenerationPlan.id == plan.plan_id)
        )
        first = plan.model_copy(deep=True)
        first.days[0].title = "数组与链表第一次编辑"
        second = plan.model_copy(deep=True)
        second.days[0].title = "数组与链表第二次编辑"

        await update_artifact(db_session, row, first, 1)
        with pytest.raises(PlanVersionError):
            await update_artifact(other_session, stale_row, second, 1)
