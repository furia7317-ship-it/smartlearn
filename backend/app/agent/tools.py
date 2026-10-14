"""Agent 工具注册表。

对应 Hermes agent 的 `model_tools.py`：提供工具的 OpenAI function schema
（`TOOL_SCHEMAS`）与统一派发入口（`dispatch_tool`，对应 `handle_function_call`）。

内置工具：
- generate_learning_material：复用统一 planned resource 管线生成、审核并持久化资料。
- search_knowledge_base：检索《数据结构》课程知识库，为回答提供有出处的依据。
- search_app_guide / open_app_page：检索内置使用说明，并打开已知页面或功能。

`emit` 是一个 `async (event:str, data:dict) -> None` 回调，工具执行期间用它向
SSE 流推进度/溯源事件，让前端答疑界面能看到工具活动。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from typing import Any, Awaitable, Callable
from app.services.app_guide import DESTINATIONS, navigation_requested, search_app_guide

from app.services.planned_resource_pipeline import RESOURCE_TYPES
from app.agent.procedure_tools import PROCEDURE_TOOL_SCHEMAS, dispatch_procedure_tool

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
                    "requirements": {"type": "string", "description": "完整任务合同：教材范围、语言、功能、排除项、学习基础与各资料要求。保留用户原意，不缩减。"},
                    "knowledge_points": {"type": "string"},
                    "document_ids": {"type": "array", "items": {"type": "string"}, "description": "只使用指定的已检索资料或附件 ID。仅缩小来源范围，不授予额外访问权限。"},
                    "delivery": {"type": "string", "enum": ["resources", "learning_path"]},
                    "days": {"type": "integer", "minimum": 1, "maximum": 30},
                    "daily_minutes": {"type": "integer", "minimum": 15, "maximum": 480},
                    "quiz_config": {"type": "object", "properties": {"choice": {"type": "integer", "minimum": 0, "maximum": 50}, "judge": {"type": "integer", "minimum": 0, "maximum": 50}, "short": {"type": "integer", "minimum": 0, "maximum": 50}}},
                },
                "required": ["topic", "modules", "requirements", "delivery"],
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

TOOL_SCHEMAS.extend([
    {"type": "function", "function": {
        "name": "search_app_guide",
        "description": "检索学枢内置使用说明：软件功能、按钮在哪个页面、如何进入、具体操作步骤。与课程知识检索分开，不依赖云模型或课程索引。",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"], "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "open_app_page",
        "description": "用户明确要求进入页面或功能时，通知客户端打开指定页面/页签。只问操作方法时不要调用。teacher-create 和 teacher-plan 打开独立小窗。可先检索使用说明来确定目标。不会生成资料或修改数据。",
        "parameters": {"type": "object", "properties": {"target": {"type": "string", "enum": list(DESTINATIONS)}}, "required": ["target"], "additionalProperties": False},
    }},
])

TOOL_SCHEMAS.extend(PROCEDURE_TOOL_SCHEMAS)
VALID_TOOL_NAMES: set[str] = {t["function"]["name"] for t in TOOL_SCHEMAS}

# Declarative capability policy. Current built-ins are safe to auto-run only
# after the tutor has satisfied the request-clarification rules above. Future
# external/destructive tools default to forbidden until explicitly classified.
TOOL_POLICIES: dict[str, dict[str, Any]] = {
    "skill_search": {"effect": "read", "destructive": False, "open_world": False, "approval": "auto"},
    "skill_read": {"effect": "read", "destructive": False, "open_world": False, "approval": "auto"},
    "skill_propose": {"effect": "write", "destructive": False, "open_world": False, "approval": "auto", "scope": "personal_candidate"},
    "search_app_guide": {"effect": "read", "destructive": False, "open_world": False, "approval": "auto"},
    "open_app_page": {"effect": "write", "destructive": False, "open_world": False, "approval": "auto"},
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
            {"topic": topic, "modules": modules, "contract": args},
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
        requirements="\n".join(filter(None, [str(args.get("_original_request") or ""), str(args.get("requirements") or ""),
                         f"学习周期：{int(args['days'])} 天" if args.get("days") else "",
                         f"每天学习 {int(args['daily_minutes'])} 分钟" if args.get("daily_minutes") else ""])),
        knowledge_points=str(args.get("knowledge_points") or ""),
        planning_mode="learning_path" if args.get("delivery") == "learning_path" else "resource",
        quiz_config=args.get("quiz_config"),
        collaboration=args.get("_collaboration") or {},
        attachment_evidence=args.get("_attachments") or [],
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
        persist=persist if request.planning_mode == "resource" else None,
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
        elif event == "orchestration":
            await emit("orchestration", payload)

    if terminal.get("plan_id") and request.planning_mode == "learning_path":
        from app.services.resource_plan_store import get_owned_plan, to_response
        async with async_session() as db:
            record = to_response(await get_owned_plan(db, terminal["plan_id"], student_id))
            await emit("resource_plan", record.model_dump(mode="json"))
        saved = len(generated)

    if terminal.get("status") != "completed":
        return json.dumps(
            {
                "error": {
                    "code": terminal.get("error_code") or "resource_generation_failed",
                    "status": terminal.get("status") or "failed",
                    "retryable": False,
                    "retry_requires_user": True,
                    "plan_id": terminal.get("plan_id"),
                    "saved_count": saved,
                    "reason": terminal.get("message") or "资料未通过本轮审核",
                    "failure_details": terminal.get("failure_details") or [],
                    "message": "本轮生成及内部修复已结束。请说明失败原因，等待用户调整要求或主动重试；不要在同一轮重新启动生成管线。",
                }
            },
            ensure_ascii=False,
        )

    await emit(
        "progress",
        {"agent": "generate_learning_material", "status": "completed", "detail": f"已生成并保存 {saved} 份资料到资源中心"},
    )

    summary = {
        "plan_id": terminal.get("plan_id"),
        "delivery": request.planning_mode,
        "topic": topic,
        "count": saved,
        "generated": [
            {"type": resource.get("type"), "title": resource.get("title", "")}
            for resource in generated
        ],
        "note": "学习路径已保存，可以在学习路径中查看。" if request.planning_mode == "learning_path" else "资料已保存到资源中心，可在那里查看完整内容。",
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
    from app.services.evidence import collect_evidence

    query = str(args.get("query") or "").strip()
    if not query:
        return json.dumps({"error": "query 不能为空"}, ensure_ascii=False)

    options = args.get("_collaboration") or {}
    from app.services.orchestration_profiles import resolve_policy
    source_count = resolve_policy(options)["sources_per_task"]
    result = await asyncio.to_thread(collect_evidence, query, student_id, source_count, policy=options.get("sources"), attachments=args.get("_attachments"))
    context = result.context
    sources = [{"id": c["id"], "title": (c.get("metadata") or {}).get("source", "参考资料"),
                "url": (c.get("metadata") or {}).get("url", ""), "scope": (c.get("metadata") or {}).get("access_scope", "course")} for c in context]
    if sources:
        await emit("sources", {"agent": "tutor", "data": sources})

    snippets = [
        {"n": i, "id": c.get("id"), "content": str(c.get("content", ""))[:1600]}
        for i, c in enumerate(context[:source_count], 1)
        if str(c.get("content", "")).strip()
    ]
    return json.dumps(
        {"query": query, "count": len(snippets), "snippets": snippets}, ensure_ascii=False
    )


async def _search_app_guide(args: dict[str, Any], **_kwargs) -> str:
    return json.dumps({"entries": search_app_guide(str(args.get("query") or ""))}, ensure_ascii=False)


async def _open_app_page(args: dict[str, Any], *, emit: EmitFn, **_kwargs) -> str:
    target = DESTINATIONS.get(str(args.get("target") or ""))
    if not target or not navigation_requested(str(args.get("_original_request") or "")):
        return json.dumps({"error": "只能在用户本轮明确要求打开功能时，选择内置页面目标；仅询问使用方法请回答步骤。"}, ensure_ascii=False)
    await emit("app_action", {"type": "open_page", "target": target["id"]})
    return json.dumps({"status": "requested", "title": target["title"], "note": "已向客户端发送打开请求。没有生成资料或修改数据。"}, ensure_ascii=False)


_DISPATCH: dict[str, Callable[..., Awaitable[str]]] = {
    "search_app_guide": _search_app_guide,
    "open_app_page": _open_app_page,
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
    if tool_policy(name).get("approval") != "auto":
        return json.dumps({"error": "该工具没有自动执行权限"}, ensure_ascii=False)
    if name in {"skill_search", "skill_read", "skill_propose"}:
        return await dispatch_procedure_tool(name, args, student_id=student_id)
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
