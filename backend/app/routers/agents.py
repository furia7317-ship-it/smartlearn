"""智能体路由 — 资源生成。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.sse import sse_format
from app.routers.auth import require_account_student_scope
from app.schemas.resource import ResourceRequest

router = APIRouter(dependencies=[Depends(require_account_student_scope)])


@router.post("/resource")
async def generate_resource(req: ResourceRequest):
    """Compatibility endpoint backed by the canonical planned pipeline."""

    from app.core.config import async_session
    from app.routers.materials import _save_material_once
    from app.services.agent_run_store import persist_stream_event
    from app.services.planned_resource_pipeline import stream_planned_resource_pipeline

    run_id = f"resource_{uuid.uuid4().hex[:12]}"
    publication_key = req.idempotency_key or run_id

    async def stream():
        async def persist(resources):
            saved = 0
            async with async_session() as db:
                for index, resource in enumerate(resources):
                    if resource.get("review_approved") is not True:
                        continue
                    await _save_material_once(
                        db,
                        publication_key=f"{publication_key}:{index}",
                        student_id=req.student_id,
                        type=str(resource.get("type") or "explainer"),
                        title=str(resource.get("title") or ""),
                        knowledge_points=req.knowledge_points or req.topic,
                        data=resource,
                        source="agent",
                    )
                    saved += 1
                await db.commit()
            return saved

        async for event, payload in stream_planned_resource_pipeline(
            req,
            persist=persist,
            source="agent",
            run_id=run_id,
        ):
            await persist_stream_event(event, payload, owner_id=req.student_id)
            yield sse_format(event, payload)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
    )
