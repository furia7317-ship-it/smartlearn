"""导出图结构给前端可视化。"""

from __future__ import annotations

from typing import Any

from app.graph.exam_graph import exam_app
from app.graph.grade_graph import grade_app
from app.graph.profile_graph import profile_app
from app.graph.planned_resource_graph import planned_resource_app
from app.graph.tutor_graph import tutor_app


def get_all_graphs() -> dict[str, Any]:
    """返回所有图的 Mermaid 结构 + 节点列表，供前端绘制协作可视化面板。"""
    graphs = {
        "resource": planned_resource_app,
        "exam": exam_app,
        "grade": grade_app,
        "tutor": tutor_app,
        "profile": profile_app,
    }

    result = {}
    for name, app in graphs.items():
        try:
            graph_obj = app.get_graph()
            mermaid = graph_obj.draw_mermaid()
            # 提取节点列表
            nodes = list(graph_obj.nodes.keys()) if hasattr(graph_obj, "nodes") else []
            result[name] = {"mermaid": mermaid, "nodes": nodes}
        except Exception as e:
            result[name] = {"mermaid": "", "nodes": [], "error": str(e)}

    return result
