"""Agent 工具注册表。

对应 Hermes agent 的 `model_tools.py`：提供工具的 OpenAI function schema
（`TOOL_SCHEMAS`）与统一派发入口（`dispatch_tool`，对应 `handle_function_call`）。

内置工具：
- generate_learning_material：复用统一 planned resource 管线生成、审核并持久化资料。
- search_knowledge_base：检索《数据结构》课程知识库，为回答提供有出处的依据。

`emit` 是一个 `async (event:str, data:dict) -> None` 回调，工具执行期间用它向
SSE 流推进度/溯源事件，让前端答疑界面能看到工具活动。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from typing import Any, Awaitable, Callable

from app.services.planned_resource_pipeline import RESOURCE_TYPES

GENERATOR_NAMES = list(RESOURCE_TYPES)

# 工具进度里给各生成模块的中文名（与前端 LIVE_TITLES 对齐）
_MODULE_LABELS: dict[str, str] = {
    "explainer": "概念讲解",
    "mindmap": "思维导图",
    "quiz": "练习题",
    "reading": "拓展阅读",
    "code": "代码案例",
    "video": "讲解短片",
    "courseware": "课件 PPT",
    "interactive": "交互演示",
}

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]


# ────────────────────────── OpenAI function schemas ──────────────────────────

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "generate_learning_material",
            "description": (
                "为学生生成个性化、多模态学习资料（讲义 / 思维导图 / 练习题 / 拓展阅读 / "
                "代码案例 / 讲解短片 / 课件 / 交互演示）。当学生希望系统学习某主题、需要复习材料、练习题"
                "或配套学习资源时调用。底层经多智能体协同生成并质检，结果会自动保存到资源中心。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "学习主题或知识点，如『动态规划』『二叉树遍历』",
                    },
                    "modules": {
                        "type": "array",
                        "items": {"type": "string", "enum": GENERATOR_NAMES},
                        "description": (
                            "要生成的资料类型；留空则由系统按学生画像自动选择。可选："
                            "explainer(讲义) mindmap(思维导图) quiz(练习题) solution(题目解析) reading(拓展阅读) "
                            "code(代码案例) video(讲解短片) courseware(课件) interactive(交互演示)"
                        ),
                    },
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": (
                "在《数据结构》课程知识库中检索相关片段，为回答提供有出处的依据。"
                "回答概念性问题、需要引用课程内容或核实事实时调用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索关键词或问题"},
                },
                "required": ["query"],
            },
        },
    },
]

VALID_TOOL_NAMES: set[str] = {t["function"]["name"] for t in TOOL_SCHEMAS}

# Declarative capability policy. Current built-ins are safe to auto-run only
# after the tutor has satisfied the request-clarification rules above. Future
# external/destructive tools default to forbidden until explicitly classified.
TOOL_POLICIES: dict[str, dict[str, Any]] = {
    "generate_learning_material": {
        "effect": "write",
        "destructive": False,
        "open_world": False,
        "approval": "auto",
    },
    "search_knowledge_base": {
        "effect": "read",
        "destructive": False,
        "open_world": False,
        "approval": "auto",
    },
}


def tool_policy(name: str) -> dict[str, Any]:
    return dict(TOOL_POLICIES.get(name) or {
        "effect": "external",
        "destructive": True,
        "open_world": True,
        "approval": "forbidden",
    })


# ────────────────────────────── 工具实现 ──────────────────────────────


async def _generate_learning_material(
    args: dict[str, Any],
    *,
    student_id: str,
    emit: EmitFn,
    run_id: str | None = None,
    parent_span_id: str | None = None,
) -> str:
    """Run the canonical planned pipeline and return a public JSON summary."""
    from app.core.config import async_session
    from app.routers.materials import _save_material_once
    from app.schemas.resource import ResourceRequest
    from app.services.planned_resource_pipeline import stream_planned_resource_pipeline

    topic = str(args.get("topic") or "").strip()
    if not topic:
        return json.dumps({"error": "topic 不能为空"}, ensure_ascii=False)

    modules = [m for m in (args.get("modules") or []) if m in GENERATOR_NAMES]
    request_fingerprint = hashlib.sha256(
        json.dumps(
            {"topic": topic, "modules": modules},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:24]
    child_run_id = f"resource_{uuid.uuid4().hex[:12]}"
    publication_key = f"chat:{run_id or child_run_id}:{request_fingerprint}"

    await emit(
        "progress",
        {"agent": "generate_learning_material", "status": "started", "detail": f"开始生成「{topic}」学习资料"},
    )

    request = ResourceRequest(
        topic=topic,
        student_id=student_id,
        material_types=modules,
    )

    generated: list[dict[str, Any]] = []
    saved = 0
    terminal: dict[str, Any] = {}

    async def persist(resources: list[dict[str, Any]]) -> int:
        count = 0
        async with async_session() as db:
            for index, resource in enumerate(resources):
                if resource.get("review_approved") is not True:
                    continue
                await _save_material_once(
                    db,
                    publication_key=f"{publication_key}:{index}",
                    student_id=student_id,
                    type=str(resource.get("type") or "explainer"),
                    title=str(resource.get("title") or ""),
                    knowledge_points=topic,
                    data=resource,
                    source="studio",
                )
                count += 1
            await db.commit()
        return count

    async for event, payload in stream_planned_resource_pipeline(
        request,
        persist=persist,
        source="studio",
        parent_run_id=run_id,
        run_id=child_run_id,
    ):
        if event == "content" and isinstance(payload.get("data"), dict):
            generated.append(payload["data"])
        elif event == "saved":
            saved = int(payload.get("count") or 0)
        elif event == "done":
            terminal = payload
        if event == "trace":
            public_payload = dict(payload)
            if run_id:
                public_payload["parent_run_id"] = run_id
            if parent_span_id:
                public_payload["linked_parent_span_id"] = parent_span_id
            await emit("trace", public_payload)
        elif event == "progress":
            await emit("progress", payload)

    if terminal.get("status") != "completed":
        return json.dumps(
            {
                "error": {
                    "code": terminal.get("error_code") or "resource_generation_failed",
                    "status": terminal.get("status") or "failed",
                    "retryable": bool(terminal.get("retryable")),
                }
            },
            ensure_ascii=False,
        )

    await emit(
        "progress",
        {"agent": "generate_learning_material", "status": "completed", "detail": f"已生成并保存 {saved} 份资料到资源中心"},
    )

    summary = {
        "topic": topic,
        "count": saved,
        "generated": [
            {"type": resource.get("type"), "title": resource.get("title", "")}
            for resource in generated
        ],
        "note": "资料已保存到资源中心（/resources），可在那里查看完整内容。",
    }
    return json.dumps(summary, ensure_ascii=False)


async def _search_knowledge_base(
    args: dict[str, Any],
    *,
    student_id: str,
    emit: EmitFn,
    run_id: str | None = None,
    parent_span_id: str | None = None,
) -> str:
    """检索课程知识库，返回片段；同时向前端推 sources 事件。"""
    from app.services.rag import retrieve_with_sources

    query = str(args.get("query") or "").strip()
    if not query:
        return json.dumps({"error": "query 不能为空"}, ensure_ascii=False)

    context, sources = await asyncio.to_thread(retrieve_with_sources, query, student_id)
    if sources:
        await emit("sources", {"agent": "tutor", "data": sources})

    snippets = [
        {"n": i, "content": str(c.get("content", ""))[:500]}
        for i, c in enumerate(context[:5], 1)
        if str(c.get("content", "")).strip()
    ]
    return json.dumps(
        {"query": query, "count": len(snippets), "snippets": snippets}, ensure_ascii=False
    )


_DISPATCH: dict[str, Callable[..., Awaitable[str]]] = {
    "generate_learning_material": _generate_learning_material,
    "search_knowledge_base": _search_knowledge_base,
}


async def dispatch_tool(
    name: str,
    args: dict[str, Any],
    *,
    student_id: str,
    emit: EmitFn,
    run_id: str | None = None,
    parent_span_id: str | None = None,
) -> str:
    """统一派发（对应 Hermes 的 handle_function_call）。始终返回字符串结果。"""
    fn = _DISPATCH.get(name)
    if fn is None:
        return json.dumps(
            {"error": f"未知工具 '{name}'，可用：{sorted(VALID_TOOL_NAMES)}"},
            ensure_ascii=False,
        )
    return await fn(
        args,
        student_id=student_id,
        emit=emit,
        run_id=run_id,
        parent_span_id=parent_span_id,
    )
