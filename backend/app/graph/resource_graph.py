"""Resource generation graph.

Pipeline:
outliner clarification/outline -> supervisor -> parallel chapter resource agents
-> per-material outline -> agent fills content -> reviewer/rework -> integrator -> planner.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.core.agent_trace import trace_event
from app.graph.state import ResourceState

GENERATOR_NAMES = [
    "explainer", "mindmap", "quiz", "solution", "reading", "code", "video", "courseware", "interactive"
]


MATERIAL_BLUEPRINTS: dict[str, list[dict[str, str]]] = {
    "explainer": [
        {"title": "先给结论", "goal": "用一句话说明本节最核心的概念"},
        {"title": "拆开解释", "goal": "按定义、性质、常见误区展开"},
        {"title": "学习抓手", "goal": "总结学生今天要记住的关键点"},
    ],
    "mindmap": [
        {"title": "中心节点", "goal": "锁定本节主题"},
        {"title": "一级分支", "goal": "拆出 3 到 5 个核心概念"},
        {"title": "二级节点", "goal": "补出关系、例子和易混点"},
    ],
    "quiz": [
        {"title": "基础辨析", "goal": "检查定义和基本性质"},
        {"title": "应用判断", "goal": "把知识点放到场景中考"},
        {"title": "错因解析", "goal": "每题都写清为什么选这个答案"},
    ],
    "reading": [
        {"title": "阅读目标", "goal": "说明为什么要读这份拓展资料"},
        {"title": "正文展开", "goal": "按概念、例子、延伸材料组织"},
        {"title": "读后问题", "goal": "留下可用于复盘的讨论问题"},
    ],
    "code": [
        {"title": "问题建模", "goal": "说明代码解决的具体问题"},
        {"title": "核心实现", "goal": "给出可读、可运行的关键代码"},
        {"title": "复杂度与变体", "goal": "解释时间空间复杂度和可替换写法"},
    ],
    "video": [
        {"title": "开场问题", "goal": "用一个场景引出本节知识"},
        {"title": "分镜讲解", "goal": "按概念、动画、例题组织镜头"},
        {"title": "结尾复盘", "goal": "收束为可执行的学习动作"},
    ],
    "courseware": [
        {"title": "标题页", "goal": "明确主题和学习目标"},
        {"title": "知识展开", "goal": "按 3 到 5 页讲清概念与例子"},
        {"title": "练习与复盘", "goal": "用最后几页安排课堂任务"},
    ],
    "interactive": [
        {"title": "演示目标", "goal": "说明这个演示要让学生直观看到什么"},
        {"title": "可视化主体", "goal": "用三维、公式或动画呈现核心概念"},
        {"title": "交互点", "goal": "设计 2 到 4 个可操作参数并说明观察重点"},
    ],
}


def build_material_outline(state: ResourceState, agent: str, chapter: dict[str, Any]) -> dict[str, Any]:
    """Build the per-resource outline that the concrete agent must fill."""

    chapter_id = str(chapter.get("id") or "general")
    chapter_title = str(chapter.get("title") or state["topic"])
    objective = str(
        chapter.get("objective")
        or chapter.get("summary")
        or state.get("requirements")
        or f"完成「{chapter_title}」的理解、练习和输出"
    )
    source_hints = []
    for index, ctx in enumerate((state.get("kb_context") or [])[:3], 1):
        content = str(ctx.get("content") or "").strip()
        if content:
            source_hints.append({"source": f"来源{index}", "hint": content[:120]})
    return {
        "agent": agent,
        "chapter_id": chapter_id,
        "chapter_title": chapter_title,
        "title": f"{chapter_title} · 资料大纲",
        "objective": objective,
        "sections": MATERIAL_BLUEPRINTS.get(agent, MATERIAL_BLUEPRINTS["explainer"]),
        "source_hints": source_hints,
        "fill_instruction": "根据资料大纲填充内容，输出必须符合该资源类型的 JSON 结构，并保留可用于学习路径挂载的标题、摘要和正文。",
    }


def _trace_run_id(state: ResourceState) -> str:
    return state.get("trace_run_id") or f"resource_{abs(hash(state['topic']))}"


def outliner_node(state: ResourceState) -> dict[str, Any]:
    """Ask for missing schedule details or create a chapter outline."""
    from langgraph.config import get_stream_writer

    from app.agents.outliner import build_learning_outline

    writer = get_stream_writer()
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="outliner",
            kind="outline",
            title="确认学习安排与生成大纲",
            status="running",
            detail="检查主题、学习周期、每日学习时长和章节拆分条件",
            narrative="我会先把学习目标、时间约束和主题范围核清楚，避免后面生成的资料散乱。",
            activity="正在确认学习周期和章节范围",
        )
    )
    writer({"event": "progress", "agent": "outliner", "status": "started", "detail": "确认学习周期与生成大纲"})
    outline = build_learning_outline(state)

    if outline.get("needs_clarification"):
        writer(
            trace_event(
                run_id=_trace_run_id(state),
                agent="outliner",
                kind="outline",
                title="等待补充学习安排",
                status="completed",
                detail="学习周期或每日学习时长不足，先向用户确认再生成资源",
                narrative="现在缺少学习天数或每天可用时间，我会先问清楚安排，再继续生成路径和资料。",
                activity="已暂停生成，等待补充安排",
            )
        )
        writer(
            {
                "event": "clarify",
                "agent": "outliner",
                "needs_clarification": True,
                "missing": outline.get("missing", []),
                "question": outline.get("question", ""),
                "defaults": outline.get("defaults", {"days": 7, "daily_minutes": 90}),
            }
        )
        writer({"event": "progress", "agent": "outliner", "status": "completed", "detail": "等待用户补充安排"})
        return {
            "outline": outline,
            "clarification_required": True,
            "reason": "学习周期或每日学习时长不足，先向用户确认。",
        }

    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="outliner",
            kind="outline",
            title="章节大纲已生成",
            status="completed",
            detail=f"{len(outline.get('chapters') or [])} 个章节进入资源分诊",
            narrative="学习范围已经拆成章节，接下来会按章节目标决定每一段需要讲解、导图、练习还是代码。",
            activity=f"已拆出 {len(outline.get('chapters') or [])} 个章节",
        )
    )
    writer({"event": "outline", "agent": "outliner", "outline": outline})
    writer({"event": "progress", "agent": "outliner", "status": "completed", "detail": "大纲已生成"})
    return {
        "outline": outline,
        "clarification_required": False,
        "selected": outline.get("selected_modules", []),
        "reason": outline.get("reason", ""),
    }


def route_after_outliner(state: ResourceState):
    if state.get("clarification_required"):
        return END
    return "supervisor"


def supervisor(state: ResourceState) -> dict[str, Any]:
    """Decide the module set and publish a plan event."""
    from langgraph.config import get_stream_writer

    writer = get_stream_writer()
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="supervisor",
            kind="plan",
            title="总控分诊",
            status="running",
            detail="根据章节目标、知识库上下文和学习画像选择资源 agent",
            source_count=len(state.get("kb_context") or []),
            narrative="我会把章节目标、知识库依据和学生画像放在一起判断，只让必要的资源 agent 参与。",
            activity=f"正在比对 {len(state.get('kb_context') or [])} 处依据",
        )
    )
    outline = state.get("outline") or {}
    forced = [m for m in (state.get("forced_modules") or []) if m in GENERATOR_NAMES]

    if forced:
        selected = forced
        reason = "按用户指定的资料类型生成，并套入大纲章节。"
    elif outline.get("selected_modules"):
        selected = [m for m in outline.get("selected_modules", []) if m in GENERATOR_NAMES]
        reason = outline.get("reason") or "按大纲章节选择资源类型。"
    else:
        from app.agents.supervisor import classify_modules

        selected, reason = classify_modules(
            state["topic"],
            state["kb_context"],
            state.get("profile"),
        )

    chapters = outline.get("chapters") or []
    tasks = []
    if chapters:
        for chapter in chapters:
            modules = forced or [m for m in (chapter.get("modules") or selected) if m in GENERATOR_NAMES]
            for module in modules:
                tasks.append(
                    {
                        "id": f"{module}_{chapter.get('id')}",
                        "agent": module,
                        "chapter_id": chapter.get("id"),
                        "chapter_title": chapter.get("title"),
                        "label": f"{chapter.get('title')} · {module}",
                    }
                )
    else:
        tasks = [{"id": module, "agent": module, "label": module} for module in selected]

    writer(
        {
            "event": "plan",
            "topic": state["topic"],
            "modules": selected,
            "tasks": tasks,
            "reason": reason,
            "outline": outline,
        }
    )
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="supervisor",
            kind="plan",
            title="资源 agent 编排完成",
            status="completed",
            detail=f"选用 {len(selected)} 类资源，生成 {len(tasks)} 个并行任务",
            narrative=f"资源生成范围已经收敛：本轮选用 {len(selected)} 类资源，并拆成 {len(tasks)} 个可并行任务。",
            activity=f"已排入 {len(tasks)} 个生成任务",
        )
    )
    return {"selected": selected, "reason": reason}


def fan_out(state: ResourceState):
    outline = state.get("outline") or {}
    chapters = outline.get("chapters") or []
    if chapters:
        sends = []
        for chapter in chapters:
            modules = state.get("forced_modules") or chapter.get("modules") or state.get("selected") or []
            for name in modules:
                if name in GENERATOR_NAMES:
                    sends.append(Send(name, {**state, "chapter": chapter}))
        return sends
    return [Send(name, state) for name in state["selected"]]


def make_generator_node(name: str):
    """Create a generation node for one resource agent."""

    def _node(state: ResourceState) -> dict[str, Any]:
        from langgraph.config import get_stream_writer

        writer = get_stream_writer()
        chapter = state.get("chapter") or {}
        chapter_id = str(chapter.get("id") or "general")
        chapter_title = str(chapter.get("title") or state["topic"])

        revise_note = next(
            (note for rid, note in (state.get("revise") or {}).items() if rid.startswith(f"{name}_{chapter_id}")),
            "",
        )
        writer(
            trace_event(
                run_id=_trace_run_id(state),
                agent=name,
                kind="outline",
                title=f"{chapter_title} · 资料大纲",
                status="running",
                detail="先为这一份资料生成结构大纲，再交给对应 agent 填内容",
                chapter_id=chapter_id,
                source_count=len(state.get("kb_context") or []),
                narrative=f"我会先确定「{chapter_title}」这份 {name} 资料应该包含哪些部分，再让生成 agent 按大纲填充。",
                activity="正在生成资料大纲",
            )
        )
        material_outline = build_material_outline(state, name, chapter)
        if revise_note:
            material_outline["revision"] = revise_note
        writer(
            trace_event(
                run_id=_trace_run_id(state),
                agent=name,
                kind="outline",
                title=f"{chapter_title} · 资料大纲",
                status="completed",
                detail=f"已生成 {len(material_outline.get('sections') or [])} 段资料大纲",
                chapter_id=chapter_id,
                source_count=len(state.get("kb_context") or []),
                narrative="资料大纲已经确定，下一步才调用 agent 根据资料大纲填充内容。",
                activity="已生成资料大纲",
            )
        )
        writer(
            trace_event(
                run_id=_trace_run_id(state),
                agent=name,
                kind="generation",
                title=f"{chapter_title} · {name}",
                status="rework" if revise_note else "running",
                detail=revise_note or "根据资料大纲填充内容，并对齐章节目标、知识库参考和个性化要求",
                chapter_id=chapter_id,
                source_count=len(state.get("kb_context") or []),
                narrative=(
                    "我会按审核意见重做这一项，先修正问题再交回审核。"
                    if revise_note
                    else f"我会围绕「{chapter_title}」按刚生成的资料大纲填充内容，并把知识库依据和学习目标一起纳入。"
                ),
                activity=("正在返工" if revise_note else "正在填充资料内容"),
            )
        )
        writer(
            {
                "event": "progress",
                "agent": name,
                "status": "started",
                "retry": bool(revise_note),
                "detail": f"{chapter_title} 生成中",
                "chapter_id": chapter_id,
                "chapter_title": chapter_title,
            }
        )

        from app.agents import get_agent

        agent_fn = get_agent(name)
        scoped_topic = f"{state['topic']} · {chapter_title}" if chapter else state["topic"]
        result = agent_fn(
            {
                **state,
                "topic": scoped_topic,
                "chapter": chapter,
                "revise_note": revise_note,
                "resource_outline": material_outline,
            }
        )
        reasoning_summary = str(result.pop("_reasoning_summary", "") or "")
        response_id = str(result.pop("_response_id", "") or "")
        usage = result.pop("_usage", None)

        result["type"] = name
        result["id"] = f"{name}_{chapter_id}"
        result["chapter_id"] = chapter_id
        result["chapter_title"] = chapter_title
        result["chapter_index"] = chapter.get("index")
        result["resource_outline"] = material_outline
        result.setdefault("title", f"{chapter_title} · {name}")

        if reasoning_summary:
            writer(
                trace_event(
                    run_id=_trace_run_id(state),
                    agent=name,
                    kind="reasoning_summary",
                    title=f"{chapter_title} · 推理摘要",
                    status="completed",
                    detail=reasoning_summary,
                    chapter_id=chapter_id,
                    response_id=response_id,
                    usage=usage if isinstance(usage, dict) else None,
                    narrative=reasoning_summary,
                    activity="已记录公开推理摘要",
                )
            )

        writer({"event": "content", "agent": name, "type": name, "data": result})
        writer({"event": "progress", "agent": name, "status": "completed", "chapter_id": chapter_id})
        writer(
            trace_event(
                run_id=_trace_run_id(state),
                agent=name,
                kind="generation",
                title=f"{chapter_title} · {name}",
                status="completed",
                detail="资源已生成，等待审核",
                chapter_id=chapter_id,
                narrative=f"「{chapter_title}」的 {name} 资源已经产出，下一步会进入审核而不是直接交付。",
                activity="已生成，等待审核",
            )
        )
        return {"resources": [result]}

    return _node


def reviewer_node(state: ResourceState) -> dict[str, Any]:
    """Review generated resources and optionally request one rework round."""
    from langgraph.config import get_stream_writer

    from app.agents.reviewer import review_resources

    writer = get_stream_writer()
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="reviewer",
            kind="review",
            title="审核生成资源",
            status="running",
            detail="根据知识库上下文进行事实校验和反幻觉审核",
            source_count=len(state.get("kb_context") or []),
            narrative="我会把生成内容和知识库来源逐项对照，先过滤掉不准确、解释不清或缺少依据的材料。",
            activity=f"正在审核 {len(state.get('resources') or [])} 项资源",
        )
    )

    seen: dict[str, dict] = {}
    for resource in state["resources"]:
        seen[resource.get("id", str(id(resource)))] = resource
    resources = list(seen.values())

    reviewed = review_resources(resources, state["kb_context"])
    retry_round = state.get("retry_round", 0)
    if retry_round >= 1:
        reviewed = _auto_release_legacy_reviews(reviewed)
    writer(
        {
            "event": "review",
            "results": [
                {
                    "id": r.get("id"),
                    "approved": r.get("review_approved") is True,
                    "issues": r.get("review_issues", []),
                    "sources": r.get("review_sources", []),
                }
                for r in reviewed
            ],
        }
    )

    if retry_round == 0:
        rejected = {
            r["id"]: "；".join(r.get("review_issues", []))[:300]
            for r in reviewed
            if r.get("review_approved") is not True and r.get("id")
        }
        if rejected:
            writer(
                trace_event(
                    run_id=_trace_run_id(state),
                    agent="reviewer",
                    kind="review",
                    title="审核发现需返工资源",
                    status="rework",
                    detail=f"{len(rejected)} 项资源未通过，已发回对应 agent 修正",
                    narrative=f"审核发现 {len(rejected)} 项资源还不稳，我会把问题发回对应生成器重做。",
                    activity=f"已驳回 {len(rejected)} 项资源",
                )
            )
            writer(
                {
                    "event": "progress",
                    "agent": "reviewer",
                    "status": "rework",
                    "detail": f"{len(rejected)} 项未过审，驳回重做",
                }
            )
            return {"revise": rejected, "retry_round": 1}

    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="reviewer",
            kind="review",
            title="资源审核通过",
            status="completed",
            detail=f"{len(reviewed)} 项资源进入整合",
            narrative=f"审核完成，{len(reviewed)} 项资源可以进入整合和路径编排。",
            activity=f"已通过 {len(reviewed)} 项资源",
        )
    )
    writer({"event": "progress", "agent": "reviewer", "status": "completed", "detail": "审核通过"})
    return {"retry_round": retry_round + 1}


def _auto_release_legacy_reviews(
    resources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Promote second-round content rejections while retaining audit warnings.

    The compatibility graph already routes to integration after one repair,
    but previously left the repaired artifacts marked as rejected.
    Infrastructure failures remain closed: only an explicit content rejection
    is eligible for this bounded release.
    """

    for resource in resources:
        if (
            resource.get("review_approved") is True
            or resource.get("review_status") != "rejected"
        ):
            continue
        warnings = [
            *[str(item) for item in resource.get("review_warnings") or [] if str(item)],
            *[str(item) for item in resource.get("review_issues") or [] if str(item)],
            "已完成一次自动返工；达到返工上限后携带审核告警自动放行。",
        ]
        resource["review_approved"] = True
        resource["review_status"] = "approved_after_rework_limit"
        resource["review_auto_released"] = True
        resource["review_warnings"] = list(dict.fromkeys(warnings))
        resource["review_issues"] = []
    return resources


def route_after_review(state: ResourceState):
    """First rejected round returns to generators; otherwise integrate."""
    revise = state.get("revise") or {}
    if revise and state.get("retry_round") == 1:
        sends = [
            Send(rid.split("_", 1)[0], {**state, "chapter": _chapter_by_id(state, rid)})
            for rid in revise
            if rid.split("_", 1)[0] in GENERATOR_NAMES
        ]
        if sends:
            return sends
    return "integrator"


def _chapter_by_id(state: ResourceState, resource_id: str) -> dict[str, Any]:
    parts = resource_id.split("_", 1)
    chapter_id = parts[1] if len(parts) == 2 else ""
    for chapter in (state.get("outline") or {}).get("chapters", []):
        if str(chapter.get("id")) == chapter_id:
            return chapter
    return {}


def integrator_node(state: ResourceState) -> dict[str, Any]:
    from langgraph.config import get_stream_writer

    from app.agents.integrator import integrate_resources

    writer = get_stream_writer()
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="integrator",
            kind="integration",
            title="整合章节资源",
            status="running",
            detail="按章节合并过审资源，生成资源中心可用结构",
            narrative="我会把过审资源按章节合并，避免讲义、导图、题库和代码各自散落。",
            activity="正在整合章节资源",
        )
    )
    writer({"event": "progress", "agent": "integrator", "status": "started", "detail": "统一整合章节资源"})
    integrated = integrate_resources(state)
    writer({"event": "integrated", "agent": "integrator", "integrated": integrated})
    writer({"event": "progress", "agent": "integrator", "status": "completed", "detail": "整合完成"})
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="integrator",
            kind="integration",
            title="章节资源整合完成",
            status="completed",
            detail=f"整合 {integrated.get('total_resources', len(state.get('resources', [])))} 项资源",
            narrative="资源已经按章节归并完成，接下来会把它们放进每天的学习步骤。",
            activity=f"已整合 {integrated.get('total_resources', len(state.get('resources', [])))} 项资源",
        )
    )
    return {"integrated": integrated}


def planner_node(state: ResourceState) -> dict[str, Any]:
    from langgraph.config import get_stream_writer

    from app.agents.scheduler import build_daily_schedule

    writer = get_stream_writer()
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="planner",
            kind="schedule",
            title="规划学习路径",
            status="running",
            detail="把章节资源排入每日学习步骤",
            narrative="我会把资源排进每天的学习任务里，让每天该学、该练、该复盘的动作更明确。",
            activity="正在编排每日任务",
        )
    )
    writer({"event": "progress", "agent": "planner", "status": "started", "detail": "安排每日学习步骤"})
    schedule = build_daily_schedule(state)
    writer({"event": "schedule", "agent": "planner", "schedule": schedule, "path": schedule})
    writer({"event": "progress", "agent": "planner", "status": "completed", "detail": "学习路径已写入"})
    writer(
        trace_event(
            run_id=_trace_run_id(state),
            agent="planner",
            kind="schedule",
            title="学习路径已写入",
            status="completed",
            detail=f"{len(schedule)} 天学习步骤已生成",
            narrative=f"学习路径已经写入，{len(schedule)} 天内每天的学习、练习和复盘步骤都已生成。",
            activity=f"已生成 {len(schedule)} 天学习路径",
        )
    )
    writer({"event": "done", "summary": {"total": len(state.get("resources", [])), "days": len(schedule)}})
    return {"schedule": schedule}


def build_resource_graph() -> Any:
    g = StateGraph(ResourceState)

    g.add_node("outliner", outliner_node)
    g.add_node("supervisor", supervisor)
    for name in GENERATOR_NAMES:
        g.add_node(name, make_generator_node(name))
    g.add_node("reviewer", reviewer_node)
    g.add_node("integrator", integrator_node)
    g.add_node("planner", planner_node)

    g.add_edge(START, "outliner")
    g.add_conditional_edges("outliner", route_after_outliner, {"supervisor": "supervisor", END: END})
    g.add_conditional_edges("supervisor", fan_out, GENERATOR_NAMES)
    for name in GENERATOR_NAMES:
        g.add_edge(name, "reviewer")
    g.add_conditional_edges("reviewer", route_after_review, GENERATOR_NAMES + ["integrator"])
    g.add_edge("integrator", "planner")
    g.add_edge("planner", END)

    return g.compile()


resource_app = build_resource_graph()
