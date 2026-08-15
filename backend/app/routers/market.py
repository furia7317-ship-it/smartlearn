"""Community learning market for reviewed materials and learning paths."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import (
    CustomAgent,
    GeneratedMaterial,
    LearningMarketImport,
    LearningMarketListing,
)
from app.routers.materials import _material_is_approved, _save_material

router = APIRouter()
# 复用 learning_market_listings 现有列：kind 是无 CHECK 的 String(32)，
# payload 是无模式 JSON，自建智能体不需要第二张上架表。
MarketKind = Literal["material", "bundle", "learning_path", "agent"]
SENSITIVE_KEYS = {
    "api_key", "apikey", "authorization", "password", "secret", "token",
    "access_token", "refresh_token",
}


class MarketPublishRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    author_name: str = Field(default="学习者", max_length=80)
    kind: MarketKind
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=1200)
    tags: list[str] = Field(default_factory=list, max_length=12)
    material_ids: list[str] = Field(default_factory=list, max_length=30)
    path_snapshot: dict[str, Any] | None = None
    agent_id: str = Field(default="", max_length=64)


class MarketImportRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)


def _strip_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _strip_sensitive(item)
            for key, item in value.items()
            if str(key).strip().lower() not in SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [_strip_sensitive(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _material_snapshot(material: GeneratedMaterial) -> dict[str, Any]:
    return {
        "source_id": material.id,
        "type": material.type,
        "title": material.title,
        "subtitle": material.subtitle,
        "meta": material.meta or [],
        "sources": material.sources,
        "knowledge_points": material.knowledge_points,
        "data": _strip_sensitive(material.data or {}),
    }


def _custom_agent_snapshot(agent: CustomAgent) -> dict[str, Any]:
    """脱敏一份自建智能体：键名过滤 + 提示词正文里的明文密钥清理。"""

    from app.agents.common import redact_secret_shapes

    snapshot = _strip_sensitive(
        {
            "source_id": agent.id,
            "name": agent.name,
            "emoji": agent.emoji,
            "duty": agent.duty,
            "system_prompt": agent.system_prompt,
            "output_type": agent.output_type,
            "knowledge_scope": list(agent.knowledge_scope or []),
            "config": dict(agent.config or {}),
        }
    )
    # ``_strip_sensitive`` 只挡字典键名，挡不住提示词正文里写死的明文密钥。
    for field in ("system_prompt", "duty"):
        snapshot[field] = redact_secret_shapes(str(snapshot.get(field) or ""))
    return snapshot


async def _owned_custom_agent(db: AsyncSession, student_id: str, agent_id: str) -> CustomAgent:
    """归属校验照抄 _owned_materials 的思路：显式 where，项目没有 RLS。"""

    cleaned = agent_id.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="发布自建智能体必须指定 agent_id")
    stmt = select(CustomAgent).where(
        CustomAgent.id == cleaned,
        CustomAgent.owner_id == student_id,
    )
    agent = (await db.execute(stmt)).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=400, detail="只能发布自己创建的智能体")
    return agent


def _listing_summary(
    listing: LearningMarketListing,
    *,
    student_id: str = "",
    imported: bool = False,
) -> dict[str, Any]:
    payload = listing.payload if isinstance(listing.payload, dict) else {}
    materials = payload.get("materials") if isinstance(payload.get("materials"), list) else []
    path = payload.get("path") if isinstance(payload.get("path"), dict) else {}
    preview_items = [
        {
            "type": str(item.get("type") or "reading"),
            "title": str(item.get("title") or "学习资料"),
        }
        for item in materials[:4]
        if isinstance(item, dict)
    ]
    agent = payload.get("agent") if isinstance(payload.get("agent"), dict) else {}
    if agent:
        preview_items = [
            {
                "type": str(agent.get("output_type") or "reading"),
                "title": str(agent.get("name") or listing.title),
            }
        ]
    if path:
        steps = path.get("path") if isinstance(path.get("path"), list) else []
        path_preview = [
            {
                "type": "learning_path",
                "title": str(step.get("title") or f"学习阶段 {index + 1}"),
            }
            for index, step in enumerate(steps[:4])
            if isinstance(step, dict)
        ]
        preview_items = path_preview or [
            {"type": "learning_path", "title": str(path.get("title") or listing.title)}
        ]
    return {
        "id": listing.id,
        "kind": listing.kind,
        "title": listing.title,
        "description": listing.description,
        "tags": listing.tags or [],
        "author_name": listing.author_name,
        "item_count": listing.item_count,
        "saves": listing.saves,
        "created_at": str(listing.created_at),
        "owned": bool(student_id and listing.publisher_id == student_id),
        "already_imported": imported,
        "preview_items": preview_items,
    }


async def _owned_materials(
    db: AsyncSession,
    student_id: str,
    material_ids: list[str],
) -> list[GeneratedMaterial]:
    ordered_ids = list(dict.fromkeys(item.strip() for item in material_ids if item.strip()))
    if not ordered_ids:
        return []
    stmt = select(GeneratedMaterial).where(
        GeneratedMaterial.student_id == student_id,
        GeneratedMaterial.id.in_(ordered_ids),
    )
    rows = (await db.execute(stmt)).scalars().all()
    by_id = {row.id: row for row in rows if _material_is_approved(row)}
    if len(by_id) != len(ordered_ids):
        raise HTTPException(status_code=400, detail="只能发布自己资源中心内已通过审核的资料")
    return [by_id[item_id] for item_id in ordered_ids]


async def _create_listing(
    db: AsyncSession,
    req: MarketPublishRequest,
    *,
    payload: dict[str, Any],
    item_count: int,
) -> dict[str, Any]:
    tags = list(dict.fromkeys(tag.strip()[:30] for tag in req.tags if tag.strip()))[:12]
    listing = LearningMarketListing(
        id=str(uuid.uuid4()),
        publisher_id=req.student_id,
        author_name=req.author_name.strip() or "学习者",
        kind=req.kind,
        title=req.title.strip(),
        description=req.description.strip(),
        tags=tags,
        payload=payload,
        item_count=max(1, item_count),
        saves=0,
        status="published",
    )
    db.add(listing)
    await db.commit()
    await db.refresh(listing)
    return _listing_summary(listing, student_id=req.student_id)


@router.post("")
async def publish_listing(req: MarketPublishRequest, db: AsyncSession = Depends(get_db)):
    if req.kind == "agent":
        # 自建智能体上架的是一份定义快照，不是资源中心的资料，
        # 因此跳过 ``_owned_materials`` 的数量校验，只做归属校验。
        agent = await _owned_custom_agent(db, req.student_id, req.agent_id)
        payload = {"agent": _custom_agent_snapshot(agent)}
        return await _create_listing(db, req, payload=payload, item_count=1)

    materials = await _owned_materials(db, req.student_id, req.material_ids)
    if req.kind == "material" and len(materials) != 1:
        raise HTTPException(status_code=400, detail="单份资料发布必须且只能选择一项")
    if req.kind == "bundle" and len(materials) < 2:
        raise HTTPException(status_code=400, detail="资源包至少需要两份资料")

    payload: dict[str, Any] = {"materials": [_material_snapshot(item) for item in materials]}
    item_count = len(materials)
    if req.kind == "learning_path":
        path = _strip_sensitive(req.path_snapshot or {})
        if not isinstance(path, dict) or not str(path.get("title") or "").strip():
            raise HTTPException(status_code=400, detail="学习路径缺少标题")
        steps = path.get("path")
        if not isinstance(steps, list) or not steps:
            raise HTTPException(status_code=400, detail="学习路径没有可发布的阶段")
        if len(steps) > 180:
            raise HTTPException(status_code=400, detail="学习路径阶段数量超出发布上限")
        payload["path"] = path
        item_count = len(steps) + len(materials)

    return await _create_listing(db, req, payload=payload, item_count=item_count)


@router.get("")
async def list_market(
    student_id: str = Query(default="", max_length=64),
    kind: str = Query(default="all", max_length=32),
    q: str = Query(default="", max_length=120),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(LearningMarketListing).where(LearningMarketListing.status == "published")
    if kind in {"material", "bundle", "learning_path", "agent"}:
        stmt = stmt.where(LearningMarketListing.kind == kind)
    if q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            LearningMarketListing.title.ilike(needle),
            LearningMarketListing.description.ilike(needle),
        ))
    stmt = stmt.order_by(LearningMarketListing.created_at.desc())
    listings = (await db.execute(stmt)).scalars().all()

    imported_ids: set[str] = set()
    if student_id and listings:
        import_stmt = select(LearningMarketImport.listing_id).where(
            LearningMarketImport.student_id == student_id,
            LearningMarketImport.listing_id.in_([item.id for item in listings]),
        )
        imported_ids = set((await db.execute(import_stmt)).scalars().all())
    return [
        _listing_summary(item, student_id=student_id, imported=item.id in imported_ids)
        for item in listings
    ]


@router.get("/{listing_id}")
async def get_listing(
    listing_id: str,
    student_id: str = Query(default="", max_length=64),
    db: AsyncSession = Depends(get_db),
):
    listing = await db.get(LearningMarketListing, listing_id)
    if listing is None or listing.status != "published":
        raise HTTPException(status_code=404, detail="学习市场资源不存在")
    imported = False
    if student_id:
        stmt = select(LearningMarketImport).where(
            LearningMarketImport.listing_id == listing_id,
            LearningMarketImport.student_id == student_id,
        )
        imported = (await db.execute(stmt)).scalar_one_or_none() is not None
    return {
        **_listing_summary(listing, student_id=student_id, imported=imported),
        "payload": _strip_sensitive(listing.payload or {}),
    }


@router.post("/{listing_id}/import")
async def import_listing(
    listing_id: str,
    req: MarketImportRequest,
    db: AsyncSession = Depends(get_db),
):
    listing = await db.get(LearningMarketListing, listing_id)
    if listing is None or listing.status != "published":
        raise HTTPException(status_code=404, detail="学习市场资源不存在")

    previous_stmt = select(LearningMarketImport).where(
        LearningMarketImport.listing_id == listing_id,
        LearningMarketImport.student_id == req.student_id,
    )
    previous = (await db.execute(previous_stmt)).scalar_one_or_none()
    payload = _strip_sensitive(listing.payload or {})
    path_snapshot = payload.get("path") if isinstance(payload, dict) else None
    agent_snapshot = payload.get("agent") if isinstance(payload, dict) else None
    if previous is not None:
        return {
            "ok": True,
            "already_imported": True,
            "kind": listing.kind,
            "target_ids": previous.target_ids or [],
            "path_snapshot": path_snapshot,
            "agent_snapshot": agent_snapshot,
            "listing": _listing_summary(listing, student_id=req.student_id, imported=True),
        }

    target_ids: list[str] = []
    if isinstance(agent_snapshot, dict) and agent_snapshot:
        from app.agents.custom import normalize_output_type

        imported_agent = CustomAgent(
            id=str(uuid.uuid4()),
            owner_id=req.student_id,
            name=str(agent_snapshot.get("name") or listing.title)[:80],
            emoji=str(agent_snapshot.get("emoji") or "🤖")[:16],
            duty=str(agent_snapshot.get("duty") or ""),
            system_prompt=str(agent_snapshot.get("system_prompt") or ""),
            # 导入者不能借上架 payload 造出第 10 种资源类型。
            output_type=normalize_output_type(agent_snapshot.get("output_type")),
            knowledge_scope=[
                str(item).strip()[:80]
                for item in (agent_snapshot.get("knowledge_scope") or [])
                if str(item).strip()
            ][:12],
            config=dict(agent_snapshot.get("config") or {}),
            status="active",
            source_listing_id=listing.id,
        )
        db.add(imported_agent)
        target_ids.append(imported_agent.id)

    materials = payload.get("materials") if isinstance(payload, dict) else []
    if isinstance(materials, list):
        for snapshot in materials:
            if not isinstance(snapshot, dict):
                continue
            data = snapshot.get("data") if isinstance(snapshot.get("data"), dict) else {}
            imported_data = {
                **data,
                "reviewed": True,
                "review_approved": True,
                "market_listing_id": listing.id,
                "market_author": listing.author_name,
                "market_source_id": str(snapshot.get("source_id") or ""),
            }
            meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), list) else []
            material = _save_material(
                db,
                student_id=req.student_id,
                type=str(snapshot.get("type") or "reading"),
                title=str(snapshot.get("title") or listing.title),
                subtitle=str(snapshot.get("subtitle") or f"来自学习市场 · {listing.author_name}"),
                meta=[str(item) for item in meta if str(item).strip()][:6] + ["学习市场"],
                sources=int(snapshot.get("sources") or 0),
                knowledge_points=str(snapshot.get("knowledge_points") or ""),
                data=imported_data,
                source="market",
            )
            target_ids.append(material.id)

    record = LearningMarketImport(
        id=str(uuid.uuid4()),
        listing_id=listing.id,
        student_id=req.student_id,
        imported_kind=listing.kind,
        target_ids=target_ids,
    )
    db.add(record)
    listing.saves = int(listing.saves or 0) + 1
    await db.commit()
    return {
        "ok": True,
        "already_imported": False,
        "kind": listing.kind,
        "target_ids": target_ids,
        "path_snapshot": path_snapshot,
        "agent_snapshot": agent_snapshot,
        "listing": _listing_summary(listing, student_id=req.student_id, imported=True),
    }
