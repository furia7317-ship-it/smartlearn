"""出卷图 — classifier → examiner → persist → END。"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.state import ExamState


def classifier(state: ExamState) -> dict[str, Any]:
    """分类器：根据主题和薄弱点确定题目组成。"""
    from langgraph.config import get_stream_writer

    writer = get_stream_writer()
    writer({"event": "stage", "stage": "classify", "detail": "分析知识点分布..."})

    from app.agents.classifier import classify_exam_scope

    composition = classify_exam_scope(
        state["topic"],
        state["scope_points"],
        state.get("kb_context", []),
        paper_type=state.get("paper_type", "mixed"),
        weak_points=state.get("weak_points", []),
    )
    return {"composition": composition}


def examiner(state: ExamState) -> dict[str, Any]:
    """出题 agent：按 composition 生成试卷。"""
    from langgraph.config import get_stream_writer

    writer = get_stream_writer()
    writer({"event": "stage", "stage": "generate", "detail": "生成试题..."})

    from app.agents.examiner import generate_paper

    questions = generate_paper(
        topic=state["topic"],
        composition=state["composition"],
        scope_points=state["scope_points"],
        kb_context=state.get("kb_context", []),
        paper_type=state.get("paper_type", "mixed"),
        weak_points=state.get("weak_points", []),
    )

    writer({"event": "exam", "questions": questions})
    return {"questions": questions}


def persist(state: ExamState) -> dict[str, Any]:
    """持久化试卷到数据库。"""
    import uuid

    exam_id = str(uuid.uuid4())
    paper_id = str(uuid.uuid4())

    # 注意：实际写库需要 async session，这里通过状态传递 ID
    # 实际写入在 router 层完成
    return {"exam_id": exam_id, "paper_id": paper_id}


# ── 构建图 ──

def build_exam_graph() -> Any:
    g = StateGraph(ExamState)

    g.add_node("classifier", classifier)
    g.add_node("examiner", examiner)
    g.add_node("persist", persist)

    g.add_edge(START, "classifier")
    g.add_edge("classifier", "examiner")
    g.add_edge("examiner", "persist")
    g.add_edge("persist", END)

    return g.compile()


exam_app = build_exam_graph()
