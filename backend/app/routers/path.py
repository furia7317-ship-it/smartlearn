"""学习路径路由。"""

from __future__ import annotations

import asyncio
import copy
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.deps import get_llm
from app.core.llm import parse_json_response
from app.models.learning import (
    Assessment,
    ExamPaper,
    LearningGoal,
    LearningPath,
    MemoryCard,
    WrongQuestion,
)
from app.services.goals import recalculate_goal

router = APIRouter()


class PathNodeUpdate(BaseModel):
    status: str


@router.get("/workspace/{student_id}/summary")
async def get_path_workspace_summary(
    student_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return durable counts used by the learning-path navigation workspaces."""

    async def count(model, *conditions) -> int:
        value = await db.scalar(
            select(func.count()).select_from(model).where(*conditions)
        )
        return int(value or 0)

    return {
        "student_id": student_id,
        "active_goals": await count(
            LearningGoal,
            LearningGoal.student_id == student_id,
            LearningGoal.status == "active",
        ),
        "completed_goals": await count(
            LearningGoal,
            LearningGoal.student_id == student_id,
            LearningGoal.status == "completed",
        ),
        "assessments": await count(
            Assessment,
            Assessment.student_id == student_id,
        ),
        "available_exams": await count(
            ExamPaper,
            ExamPaper.student_id == student_id,
            ExamPaper.archived.is_(False),
            ExamPaper.status != "graded",
        ),
        "graded_exams": await count(
            ExamPaper,
            ExamPaper.student_id == student_id,
            ExamPaper.status == "graded",
        ),
        "wrong_questions": await count(
            WrongQuestion,
            WrongQuestion.student_id == student_id,
        ),
        "due_reviews": await count(
            MemoryCard,
            MemoryCard.student_id == student_id,
            MemoryCard.due_date <= date.today().isoformat(),
        ),
    }


def _update_node_status(nodes: list[dict], node_id: str, status: str) -> bool:
    for node in nodes:
        if node.get("id") == node_id:
            node["status"] = status
            return True
        if _update_node_status(node.get("children") or [], node_id, status):
            return True
    return False


def _node_progress(nodes: list[dict]) -> float:
    flattened: list[dict] = []

    def collect(items: list[dict]) -> None:
        for item in items:
            flattened.append(item)
            collect(item.get("children") or [])

    collect(nodes)
    if not flattened:
        return 0.0
    completed = sum(1 for node in flattened if node.get("status") == "completed")
    return round(completed / len(flattened), 4)


@router.patch("/{path_id}/nodes/{node_id}")
async def update_path_node(
    path_id: str,
    node_id: str,
    req: PathNodeUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新任意层级节点状态并联动目标进度。"""
    if req.status not in {"completed", "current", "pending"}:
        raise HTTPException(status_code=422, detail="无效的节点状态")

    path = await db.get(LearningPath, path_id)
    if path is None:
        raise HTTPException(status_code=404, detail="路径不存在")

    nodes = copy.deepcopy(path.nodes or [])
    if not _update_node_status(nodes, node_id, req.status):
        raise HTTPException(status_code=404, detail="节点不存在")

    path.nodes = nodes
    path.progress = _node_progress(nodes)

    response: dict = {"progress": path.progress}
    goal_stmt = select(LearningGoal).where(LearningGoal.path_id == path.id)
    goal = (await db.execute(goal_stmt)).scalars().first()
    if goal:
        await recalculate_goal(db, goal)
        response["goal"] = {"id": goal.id, "progress": goal.progress}

    await db.commit()
    return response


@router.get("/{student_id}")
async def get_paths(student_id: str, db: AsyncSession = Depends(get_db)):
    """获取学生学习路径列表。"""
    stmt = select(LearningPath).where(LearningPath.student_id == student_id)
    result = await db.execute(stmt)
    paths = result.scalars().all()
    return [
        {"id": p.id, "topic": p.topic, "nodes": p.nodes, "progress": p.progress}
        for p in paths
    ]


@router.post("")
async def create_path(req: dict, db: AsyncSession = Depends(get_db)):
    """根据主题 + 画像薄弱点生成学习路径。"""
    from app.agents.profiler import get_profile

    student_id = req.get("student_id", "")
    topic = req.get("topic", "")
    if not student_id or not topic:
        raise HTTPException(status_code=400, detail="student_id 和 topic 必填")

    profile = await asyncio.to_thread(get_profile, student_id)
    weak = [
        kp for kp, v in (profile.get("knowledge_level") or {}).items()
        if isinstance(v, dict) and v.get("score", 1) < 0.6
    ]

    llm = get_llm(temperature=0.3)
    prompt = (
        f"为学习主题「{topic}」规划学习路径，3-6 个递进节点。"
        f"薄弱点（优先安排）：{weak or '无'}。\n"
        '输出 JSON 数组：[{"id":"n1","title":"...","knowledge_points":["..."],"status":"pending","children":[]}]'
    )
    resp = await llm.ainvoke(prompt)
    nodes = parse_json_response(resp.content)
    if isinstance(nodes, dict):
        nodes = nodes.get("nodes", [])

    path = LearningPath(
        id=str(uuid.uuid4()),
        student_id=student_id,
        topic=topic,
        nodes=nodes,
        progress=0.0,
    )
    db.add(path)
    await db.commit()
    return {"id": path.id, "topic": path.topic, "nodes": nodes, "progress": 0.0}


@router.get("/{path_id}/recommend")
async def get_recommendation(path_id: str, db: AsyncSession = Depends(get_db)):
    """获取今日学习简报。"""
    stmt = select(LearningPath).where(LearningPath.id == path_id)
    result = await db.execute(stmt)
    path = result.scalar_one_or_none()

    if path is None:
        raise HTTPException(status_code=404, detail="路径不存在")

    nodes = path.nodes or []

    def first_pending(ns):
        for n in ns:
            if n.get("status") in ("pending", "current"):
                return n
            child = first_pending(n.get("children") or [])
            if child:
                return child
        return None

    node = first_pending(nodes)
    recs = []
    if node:
        recs.append({
            "type": "learn",
            "title": f"学习「{node['title']}」",
            "knowledge_points": node.get("knowledge_points", []),
        })

    wrong_stmt = (
        select(WrongQuestion)
        .where(WrongQuestion.student_id == path.student_id, WrongQuestion.topic == path.topic)
        .order_by(WrongQuestion.created_at.desc())
        .limit(3)
    )
    wrongs = (await db.execute(wrong_stmt)).scalars().all()
    if wrongs:
        recs.append({
            "type": "review",
            "title": f"复习 {len(wrongs)} 道错题",
            "knowledge_points": [w.knowledge_point for w in wrongs],
        })

    due_count = await db.scalar(
        select(func.count())
        .select_from(MemoryCard)
        .where(
            MemoryCard.student_id == path.student_id,
            MemoryCard.due_date <= date.today().isoformat(),
        )
    )
    if due_count:
        recs.append({
            "type": "memory",
            "title": f"复习 {due_count} 张到期卡",
            "knowledge_points": [],
        })

    return {"path_id": path_id, "topic": path.topic, "recommendations": recs, "message": ""}
