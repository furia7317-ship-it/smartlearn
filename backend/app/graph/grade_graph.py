"""评分+分析图 — 选择题规则判分 + 主观题 LLM 评分 → 合并 → 分析 → 回写画像。"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.state import GradeState


def rule_grade_mcq(state: GradeState) -> dict[str, Any]:
    """选择题规则判分（纯函数，不调 LLM）。"""
    from app.services.scoring import grade_mcq_questions

    mcq_results = grade_mcq_questions(state["questions"], state["answers"])
    return {"results": mcq_results}


def grader(state: GradeState) -> dict[str, Any]:
    """主观题 LLM 评分。"""
    from app.agents.grader import grade_subjective

    subjective_results = grade_subjective(state["questions"], state["answers"])
    return {"results": subjective_results}


def merge(state: GradeState) -> dict[str, Any]:
    """合并选择题和主观题评分结果，计算总分和掌握度。"""
    from app.services.scoring import calculate_mastery, calculate_overall

    results = state["results"]
    overall = calculate_overall(results)
    mastery = calculate_mastery(results, state["questions"])
    return {"overall": overall, "mastery": mastery}


def analyst(state: GradeState) -> dict[str, Any]:
    """分析 agent：生成学习建议和评估报告。"""
    from langgraph.config import get_stream_writer

    writer = get_stream_writer()
    writer({"event": "stage", "stage": "analyze", "detail": "生成分析报告..."})

    from app.agents.analyst import generate_assessment

    assessment = generate_assessment(
        results=state["results"],
        overall=state["overall"],
        mastery=state["mastery"],
        questions=state["questions"],
    )

    writer({
        "event": "graded",
        "results": {
            "overall": state["overall"],
            "mastery": state["mastery"],
            "results": state["results"],
        },
    })
    writer({"event": "report", "assessment": assessment})
    return {"assessment": assessment}


def profiler_update(_state: GradeState) -> dict[str, Any]:
    """画像由路由层在评分副作用的同一异步事务中持久化。"""

    return {}


# ── 构建图 ──

def build_grade_graph() -> Any:
    g = StateGraph(GradeState)

    g.add_node("rule_grade_mcq", rule_grade_mcq)
    g.add_node("grader", grader)
    g.add_node("merge", merge)
    g.add_node("analyst", analyst)
    g.add_node("profiler", profiler_update)

    g.add_edge(START, "rule_grade_mcq")
    g.add_edge(START, "grader")
    g.add_edge("rule_grade_mcq", "merge")
    g.add_edge("grader", "merge")
    g.add_edge("merge", "analyst")
    g.add_edge("analyst", "profiler")
    g.add_edge("profiler", END)

    return g.compile()


grade_app = build_grade_graph()
