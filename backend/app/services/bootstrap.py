"""启动引导：验证并按版本更新内置知识索引（仅 DEBUG）。"""
from __future__ import annotations

import asyncio


async def ensure_kb_imported():
    def _run() -> dict:
        from app.services.rag import build_knowledge_index, get_retrieval_health

        health = get_retrieval_health(load_model=True)
        if health["status"] == "ready":
            return {"status": "ready", "rebuilt": False, **health}
        if not health["model_available"]:
            return health
        return build_knowledge_index()

    result = await asyncio.to_thread(_run)
    if result.get("status") == "ready":
        action = "重建" if result.get("rebuilt") else "验证"
        print(
            f"[bootstrap] 知识索引{action}完成："
            f"{result.get('chunks', result.get('actual_chunks', 0))} 块"
        )
    else:
        print(
            "[bootstrap] 知识索引降级为关键词检索："
            f"{result.get('model_error') or '索引尚未完成'}"
        )
    return result
