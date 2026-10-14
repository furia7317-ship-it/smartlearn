"""Authoritative focus execution. Neither layout nor a client checkbox awards mastery."""
from __future__ import annotations
import copy
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.focus import FocusGraph, FocusJob, FocusOperation, FocusPackage, FocusProgress
from app.schemas.focus import CourseGraph, StateAction, prerequisites_met
from app.services.focus_catalog import frontend_graph, starter_html_package


def uid() -> str:
    return str(uuid4())


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def owned_graph(db: AsyncSession, owner: str, graph_id: str) -> FocusGraph:
    row = await db.scalar(select(FocusGraph).where(FocusGraph.id == graph_id, FocusGraph.student_id == owner))
    if not row:
        raise HTTPException(404, "课程图不存在")
    return row


async def ensure_catalog(db: AsyncSession, owner: str):
    exists = await db.scalar(select(FocusGraph.id).where(FocusGraph.student_id == owner, FocusGraph.course_id == "starter.frontend"))
    if exists:
        return
    graph_id = uid()
    db.add(FocusGraph(id=graph_id, student_id=owner, course_id="starter.frontend", version=1, status="published", origin="starter", payload=frontend_graph().model_dump()))
    db.add(FocusProgress(id=uid(), student_id=owner, graph_id=graph_id, records={}, revision=0))
    db.add(FocusPackage(id=uid(), student_id=owner, graph_id=graph_id, node_id="fe.html", version=1, content=starter_html_package()))
    from sqlalchemy.exc import IntegrityError
    try:
        await db.commit()
    except IntegrityError:
        # Concurrent first loads may both bootstrap; the unique course key wins.
        await db.rollback()


async def progress_for(db: AsyncSession, owner: str, graph_id: str) -> FocusProgress:
    progress = await db.scalar(select(FocusProgress).where(FocusProgress.student_id == owner, FocusProgress.graph_id == graph_id))
    if not progress:
        raise HTTPException(409, "请先确认并启用这份课程图")
    return progress


def node_states(graph: CourseGraph, progress: FocusProgress) -> dict:
    passed = {key for key, value in progress.records.items() if value.get("passed_at")}
    states = {}
    for node in graph.nodes:
        record = progress.records.get(node.id, {})
        available = prerequisites_met(node, passed)
        states[node.id] = {
            "status": "passed" if node.id in passed else "active" if progress.active_node_id == node.id else "paused" if record.get("started_at") else "available" if available else "locked",
            "available": available, "tasks": record.get("tasks", []), "passed_at": record.get("passed_at"),
            "last_score": record.get("last_score"),
            "review_due": bool(record.get("review_at") and record["review_at"] <= iso_now()),
        }
    return states


def daily_plan(graph: CourseGraph, progress: FocusProgress, states: dict) -> dict:
    focus = next((n for n in graph.nodes if n.id == progress.active_node_id), None)
    if not focus:
        # Recommendation only; a schedule never starts or passes a node.
        focus = next((n for n in graph.nodes if states[n.id]["available"] and states[n.id]["status"] != "passed" and n.kind != "extension"), None)
        if not focus:
            needed = {p for n in graph.nodes if n.kind != "extension" and states[n.id]["status"] != "passed"
                      for group in n.prerequisites.any_of_groups for p in group}
            focus = next((n for n in graph.nodes if n.id in needed and states[n.id]["available"] and states[n.id]["status"] != "passed"), None)
    remaining = progress.daily_minutes
    tasks = []
    # One review can coexist with one main focus, without resetting past passes.
    review = next((n for n in graph.nodes if states[n.id]["review_due"] and n.id != (focus.id if focus else None)), None)
    if review:
        minutes = min(10, remaining)
        tasks.append({"node_id": review.id, "task": "review", "title": f"复习 · {review.title}", "minutes": minutes})
        remaining -= minutes
    if focus:
        for key, name, weight in (("lesson", "理解讲解", .4), ("example", "示例练习", .35), ("assessment", "独立核验", .25)):
            if key in states[focus.id]["tasks"] or remaining <= 0:
                continue
            expected = max(5, math.ceil(focus.estimated_minutes * weight))
            minutes = min(remaining, expected)
            tasks.append({"node_id": focus.id, "task": key, "title": f"{focus.title} · {name}", "minutes": minutes, "continued": minutes < expected})
            remaining -= minutes
    return {"daily_minutes": progress.daily_minutes, "focus_node_id": focus.id if focus else None, "tasks": tasks}


async def snapshot(db: AsyncSession, row: FocusGraph, progress: FocusProgress | None = None) -> dict:
    graph = CourseGraph.model_validate(row.payload)
    if progress is None:
        progress = await db.scalar(select(FocusProgress).where(FocusProgress.graph_id == row.id, FocusProgress.student_id == row.student_id))
    if progress is None:
        progress = FocusProgress(records={}, revision=0, active_node_id=None, daily_minutes=60)
    states = node_states(graph, progress)
    ready = set((await db.scalars(select(FocusPackage.node_id).where(FocusPackage.graph_id == row.id))).all())
    jobs = (await db.scalars(select(FocusJob).where(FocusJob.student_id == row.student_id, FocusJob.kind == "package", FocusJob.target.like(f"{row.id}:%")))).all()
    resources = {n.id: "ready" if n.id in ready else "unprepared" for n in graph.nodes}
    for job in jobs:
        node_id = job.input.get("node_id")
        if node_id not in ready:
            resources[node_id] = job.status
    required = [n for n in graph.nodes if n.kind != "extension"]
    return {"id": row.id, "course_id": row.course_id, "version": row.version, "status": row.status, "origin": row.origin,
            "graph": graph.model_dump(), "revision": progress.revision, "active_node_id": progress.active_node_id,
            "nodes": states, "resources": resources, "plan": daily_plan(graph, progress, states),
            "progress": {"passed": sum(states[n.id]["status"] == "passed" for n in required), "total": len(required)}}


def safe_package(row: FocusPackage) -> dict:
    content = copy.deepcopy(row.content)
    # Answers and explanations are returned only after a recorded submission.
    content["questions"] = [{k: q[k] for k in ("id", "stem", "options") if k in q} for q in content.get("questions", [])]
    return {"id": row.id, "graph_id": row.graph_id, "node_id": row.node_id, "content_version": row.version, **content}


def grade(content: dict, answers: dict[str, str]) -> dict:
    questions = content.get("questions", [])
    if not questions:
        raise HTTPException(409, "本节点尚未准备好可评分的核验题")
    ids = {q["id"] for q in questions}
    if set(answers) != ids:
        raise HTTPException(422, "请完成全部题目，不要提交其他节点的答案")
    results = []
    for q in questions:
        answer = answers[q["id"]].strip().upper()
        allowed = {chr(65 + i) for i in range(len(q["options"]))}
        if answer not in allowed:
            raise HTTPException(422, "提交的选项无效")
        results.append({"id": q["id"], "correct": answer == q["answer"], "answer": q["answer"], "explanation": q.get("explanation", "")})
    score = sum(item["correct"] for item in results) / len(results)
    return {"score": round(score * 100), "passed": score >= content.get("pass_ratio", .8), "questions": results}


async def apply_action(db: AsyncSession, owner: str, graph_id: str, request: StateAction) -> dict:
    digest = hashlib.sha256(json.dumps({"graph_id": graph_id, **request.model_dump()}, sort_keys=True).encode()).hexdigest()
    prior = await db.scalar(select(FocusOperation).where(FocusOperation.student_id == owner, FocusOperation.request_id == request.request_id))
    if prior:
        if prior.request_hash != digest:
            raise HTTPException(409, "此操作编号已经用于另一项操作")
        return prior.result
    row = await owned_graph(db, owner, graph_id)
    if row.status != "published":
        raise HTTPException(409, "课程图尚未启用")
    graph = CourseGraph.model_validate(row.payload)
    progress = await progress_for(db, owner, graph_id)
    if progress.revision != request.revision:
        raise HTTPException(409, "学习记录已在其他页面更新，请刷新后重试")
    records = copy.deepcopy(progress.records)
    active = progress.active_node_id
    budget = progress.daily_minutes
    result = None
    node = next((n for n in graph.nodes if n.id == request.node_id), None)
    if request.action != "budget" and not node:
        raise HTTPException(404, "知识节点不存在")
    if request.action == "budget":
        if request.daily_minutes is None:
            raise HTTPException(422, "需要提供每日学习时间")
        budget = request.daily_minutes
    else:
        states = node_states(graph, progress)
        record = records.setdefault(node.id, {"tasks": []})
        if request.action in ("start", "submit") and not states[node.id]["available"]:
            raise HTTPException(409, "请先完成这项能力的前置条件")
        if request.action == "start":
            active = node.id
            record.setdefault("started_at", iso_now())
        elif request.action == "pause":
            if active == node.id:
                active = None
        elif request.action == "task":
            if active != node.id or request.task is None:
                raise HTTPException(409, "请先开始当前节点")
            package = await db.scalar(select(FocusPackage).where(FocusPackage.graph_id == graph_id, FocusPackage.node_id == node.id, FocusPackage.version == request.package_version))
            if not package:
                raise HTTPException(409, "学习包版本已变化，请重新打开")
            record["tasks"] = sorted(set(record.get("tasks", [])) | {request.task})
        elif request.action == "submit":
            package = await db.scalar(select(FocusPackage).where(FocusPackage.graph_id == graph_id, FocusPackage.node_id == node.id, FocusPackage.version == request.package_version))
            if not package:
                raise HTTPException(409, "核验题版本不匹配，请重新打开")
            result = grade(package.content, request.answers)
            record["last_score"] = result["score"]
            record["last_submission_at"] = iso_now()
            if result["passed"]:
                record.setdefault("passed_at", iso_now())
                record["review_at"] = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
                record["tasks"] = sorted(set(record.get("tasks", [])) | {"assessment"})
                if active == node.id:
                    active = None
    updated = await db.execute(update(FocusProgress).where(FocusProgress.id == progress.id, FocusProgress.revision == request.revision).values(
        revision=request.revision + 1, records=records, active_node_id=active, daily_minutes=budget))
    if updated.rowcount != 1:
        await db.rollback()
        raise HTTPException(409, "学习记录已更新，请刷新后重试")
    await db.refresh(progress)
    response = {"state": await snapshot(db, row, progress), "assessment": result}
    db.add(FocusOperation(id=uid(), student_id=owner, request_id=request.request_id, request_hash=digest, result=response))
    await db.commit()
    return response
