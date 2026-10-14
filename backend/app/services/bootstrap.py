"""启动引导：验证并按云端模型版本更新内置知识索引。"""
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

    try:
        result = await asyncio.to_thread(_run)
    except Exception as exc:  # noqa: BLE001 - background initialization must leave the app usable.
        print(f"[bootstrap] 云端知识索引初始化失败：{type(exc).__name__}；请检查服务配置后重试")
        return {"status": "unavailable", "error": type(exc).__name__}
    if result.get("status") == "ready":
        action = "重建" if result.get("rebuilt") else "验证"
        print(
            f"[bootstrap] 知识索引{action}完成："
            f"{result.get('chunks', result.get('actual_chunks', 0))} 块"
        )
    else:
        print(
            "[bootstrap] 知识索引不可用："
            f"{result.get('model_error') or '索引尚未完成'}"
        )
    return result
