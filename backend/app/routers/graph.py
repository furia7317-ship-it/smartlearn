"""协作可视化图路由。"""

from __future__ import annotations

from fastapi import APIRouter

from app.graph.viz import get_all_graphs

router = APIRouter()


@router.get("")
async def get_graphs():
    """获取所有 LangGraph 图结构（Mermaid + 节点列表）。"""
    return get_all_graphs()
