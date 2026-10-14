"""SSE subscribers do not own long-running plan workers.

Snapshots and attempt records remain durable; an interrupted server is resumed
through the existing owner/version-checked execution endpoint.
"""
import asyncio
from collections import deque

from app.core.config import async_session
from app.core.sse import sse_format
from app.models.learning import ResourceGenerationPlan

_workers = {}


def start_execution(plan_id, state, graph):
    existing = _workers.get(plan_id)
    if existing and not existing["task"].done():
        return
    entry = {"events": deque(maxlen=4096), "revision": 0, "changed": asyncio.Condition()}

    async def publish(event):
        async with entry["changed"]:
            entry["revision"] += 1
            entry["events"].append((entry["revision"], event))
            entry["changed"].notify_all()

    async def run():
        from app.routers.resource_plans import stream_and_persist_planned_execution
        try:
            async with async_session() as db:
                row = await db.get(ResourceGenerationPlan, plan_id)
                async for event in stream_and_persist_planned_execution(graph, state, row, db):
                    await publish(event)
        except Exception:
            await publish(sse_format("error", {"message": "运行中断，已保存的进度可以恢复"}))
        finally:
            async with entry["changed"]:
                entry["finished"] = True
                entry["changed"].notify_all()

    entry["task"] = asyncio.create_task(run(), name=f"plan:{plan_id}")
    _workers[plan_id] = entry
    # Completed buffers are only a reconnect convenience, not authoritative storage.
    for key, previous in list(_workers.items()):
        if key != plan_id and previous.get("finished") and len(_workers) > 32:
            _workers.pop(key, None)


async def subscribe(plan_id):
    entry = _workers.get(plan_id)
    if entry is None:
        yield sse_format("snapshot_required", {"plan_id": plan_id})
        return
    cursor = 0
    while True:
        for revision, event in list(entry["events"]):
            if revision > cursor:
                cursor = revision
                yield event
        if entry.get("finished") and cursor >= entry["revision"]:
            return
        async with entry["changed"]:
            if cursor < entry["revision"]:
                continue
            try:
                await asyncio.wait_for(entry["changed"].wait(), 15)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
