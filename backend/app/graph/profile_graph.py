"""对话建档图 — 3~5 轮引导对话，增量抽取六维画像。"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.state import ProfileState


def guide(state: ProfileState) -> dict[str, Any]:
    """引导对话 agent：生成下一轮引导问题。"""
    from langgraph.config import get_stream_writer

    writer = get_stream_writer()

    from app.agents.profiler import generate_guide_question

    question = generate_guide_question(
        dialogue=state["dialogue"],
        current_profile=state["current_profile"],
        round_num=state["round"],
    )

    writer({"event": "content", "agent": "profiler", "type": "question", "data": question})
    return {"dialogue": state["dialogue"] + [{"role": "assistant", "content": question}]}


def extract(state: ProfileState) -> dict[str, Any]:
    """抽取 agent：从用户回答中提取画像信息。"""
    from app.agents.profiler import extract_profile_info

    latest_user_msg = ""
    for msg in reversed(state["dialogue"]):
        if msg["role"] == "user":
            latest_user_msg = msg["content"]
            break

    updated, done = extract_profile_info(
        user_input=latest_user_msg,
        current_profile=state["current_profile"],
        round_num=state["round"],
    )

    return {
        "current_profile": updated,
        "round": state["round"] + 1,
        "done": done,
    }


def should_continue(state: ProfileState) -> str:
    """条件路由：继续对话或结束。"""
    if state["done"] or state["round"] >= state["max_rounds"]:
        return "finalize"
    return "guide"


def finalize(state: ProfileState) -> dict[str, Any]:
    """结束建档，写入数据库。"""
    from app.agents.profiler import save_profile

    save_profile(state["student_id"], state["current_profile"])
    return {"updated_profile": state["current_profile"]}


# ── 构建图 ──

def build_profile_graph() -> Any:
    g = StateGraph(ProfileState)

    g.add_node("guide", guide)
    g.add_node("extract", extract)
    g.add_node("finalize", finalize)

    g.add_edge(START, "extract")           # 先抽取用户刚发的这条消息
    g.add_conditional_edges("extract", should_continue, {"guide": "guide", "finalize": "finalize"})
    g.add_edge("guide", END)               # 追问一个问题就结束本次请求，等用户下条消息
    g.add_edge("finalize", END)

    return g.compile()


profile_app = build_profile_graph()
