"""辅导图 — RAG 检索 → 读画像 → 风格化作答。"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.state import TutorState


def rag_retrieve(state: TutorState) -> dict[str, Any]:
    """从 Chroma 检索相关知识库片段。"""
    from langgraph.config import get_stream_writer
    writer = get_stream_writer()

    writer({"event": "progress", "agent": "rag_retrieve", "status": "started", "detail": "检索知识库..."})

    from app.services.rag import retrieve_with_sources

    query = state["question"]
    if state.get("image_data"):
        from app.services.iflytek.ocr import ocr_image
        ocr_text = ocr_image(state["image_data"])
        query = f"{query}\n{ocr_text}"

    context, sources = retrieve_with_sources(query, state["student_id"])

    writer({"event": "progress", "agent": "rag_retrieve", "status": "completed", "detail": f"命中 {len(context)} 条"})
    return {"kb_context": context, "sources": sources}


def read_profile(state: TutorState) -> dict[str, Any]:
    """读取学生画像，确定认知风格。"""
    from langgraph.config import get_stream_writer
    writer = get_stream_writer()

    writer({"event": "progress", "agent": "read_profile", "status": "started", "detail": "读取学习画像..."})

    from app.agents.profiler import get_profile
    profile = get_profile(state["student_id"])

    style = profile.get("cognitive_style", {})
    dominant = max(style, key=style.get) if style else ""
    pct = int((style.get(dominant, 0)) * 100) if dominant else 0
    style_labels = {"visual": "视觉型", "verbal": "文字型", "practical": "实践型"}
    detail = f"{style_labels.get(dominant, dominant)} {pct}%" if dominant else "默认风格"

    writer({"event": "progress", "agent": "read_profile", "status": "completed", "detail": detail})
    return {"profile": profile}


def answer(state: TutorState) -> dict[str, Any]:
    """风格化作答（流式 token）。"""
    from langgraph.config import get_stream_writer
    writer = get_stream_writer()

    writer({"event": "progress", "agent": "answer", "status": "started", "detail": "组织回答..."})

    # 先发 sources 事件（角标溯源数据）
    writer({"event": "sources", "agent": "tutor", "data": state.get("sources", [])})

    from app.agents.tutor import generate_answer

    answer_text = generate_answer(
        question=state["question"],
        history=state.get("history", []),
        kb_context=state.get("kb_context", []),
        profile=state.get("profile", {}),
        sources=state.get("sources", []),
        on_delta=lambda t: writer({"event": "delta", "agent": "tutor", "text": t}),
    )

    writer({"event": "content", "agent": "tutor", "type": "answer", "data": answer_text})
    writer({"event": "progress", "agent": "answer", "status": "completed"})
    return {"answer": answer_text}


def build_tutor_graph() -> Any:
    g = StateGraph(TutorState)

    g.add_node("rag_retrieve", rag_retrieve)
    g.add_node("read_profile", read_profile)
    g.add_node("answer", answer)

    g.add_edge(START, "rag_retrieve")
    g.add_edge(START, "read_profile")
    g.add_edge("rag_retrieve", "answer")
    g.add_edge("read_profile", "answer")
    g.add_edge("answer", END)

    return g.compile()


tutor_app = build_tutor_graph()
