"""Agent 注册表 — 按名称获取 agent 函数。"""

from __future__ import annotations

from typing import Any, Callable

# Agent 注册表（延迟导入避免循环）
_AGENT_REGISTRY: dict[str, Callable] = {}


def _lazy_load():
    """延迟加载所有 agent。"""
    if _AGENT_REGISTRY:
        return

    from app.agents.explainer import generate as explainer_generate
    from app.agents.mindmap import generate as mindmap_generate
    from app.agents.quiz import generate as quiz_generate
    from app.agents.solution import generate as solution_generate
    from app.agents.reading import generate as reading_generate
    from app.agents.code import generate as code_generate
    from app.agents.video import generate as video_generate
    from app.agents.courseware import generate as courseware_generate
    from app.agents.interactive import generate as interactive_generate

    _AGENT_REGISTRY.update({
        "explainer": explainer_generate,
        "mindmap": mindmap_generate,
        "quiz": quiz_generate,
        "solution": solution_generate,
        "reading": reading_generate,
        "code": code_generate,
        "video": video_generate,
        "courseware": courseware_generate,
        "interactive": interactive_generate,
    })


def get_agent(name: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """获取指定名称的 agent 函数。"""
    _lazy_load()
    if name not in _AGENT_REGISTRY:
        raise ValueError(f"未知 agent: {name}，可选: {list(_AGENT_REGISTRY.keys())}")
    return _AGENT_REGISTRY[name]
