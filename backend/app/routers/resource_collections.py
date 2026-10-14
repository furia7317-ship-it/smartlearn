"""Account-scoped resource collections backed by approved material IDs."""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.account import UserAccount
from app.models.learning import GeneratedMaterial, ResourceCollection
from app.routers.auth import get_current_account


router = APIRouter()
MAX_COLLECTIONS = 24
MAX_COLLECTION_RESOURCES = 200


def _normalize_name(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if not normalized:
        raise ValueError("集合名称不能为空")
    return normalized


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    resource_ids: list[str] = Field(default_factory=list, max_length=MAX_COLLECTION_RESOURCES)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _normalize_name(value)


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    resource_ids: list[str] | None = Field(default=None, max_length=MAX_COLLECTION_RESOURCES)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return _normalize_name(value) if value is not None else None


def _serialize(
    collection: ResourceCollection,
    valid_resource_ids: set[str] | None = None,
) -> dict[str, object]:
    resource_ids = list(collection.resource_ids or [])
    if valid_resource_ids is not None:
        resource_ids = [resource_id for resource_id in resource_ids if resource_id in valid_resource_ids]
    return {
        "id": collection.id,
        "name": collection.name,
        "resource_ids": resource_ids,
        "created_at": str(collection.created_at),
        "updated_at": str(collection.updated_at or collection.created_at),
    }


async def _validated_resource_ids(
    db: AsyncSession,
    student_id: str,
    resource_ids: list[str],
) -> list[str]:
    requested = list(dict.fromkeys(value.strip() for value in resource_ids if value.strip()))
    if not requested:
        return []
    rows = (
        await db.execute(
            select(GeneratedMaterial).where(
                GeneratedMaterial.student_id == student_id,
                GeneratedMaterial.id.in_(requested),
            )
        )
    ).scalars().all()
    valid = {
        material.id
        for material in rows
        if isinstance(material.data, dict) and material.data.get("review_approved") is True
    }
    invalid = [resource_id for resource_id in requested if resource_id not in valid]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_collection_resources",
                "message": "集合中包含不存在、未审核或不属于当前账号的资料。",
            },
        )
    return requested


async def _owned_collection(
    db: AsyncSession,
    account: UserAccount,
    collection_id: str,
) -> ResourceCollection:
    collection = await db.scalar(
        select(ResourceCollection).where(
            ResourceCollection.id == collection_id,
            ResourceCollection.student_id == account.id,
        )
    )
    if collection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="集合不存在")
    return collection


@router.get("")
async def list_collections(
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    collections = (
        await db.execute(
            select(ResourceCollection)
            .where(ResourceCollection.student_id == account.id)
            .order_by(ResourceCollection.updated_at.desc(), ResourceCollection.created_at.desc())
        )
    ).scalars().all()
    materials = (
        await db.execute(
            select(GeneratedMaterial).where(GeneratedMaterial.student_id == account.id)
        )
    ).scalars().all()
    valid_resource_ids = {
        material.id
        for material in materials
        if isinstance(material.data, dict) and material.data.get("review_approved") is True
    }
    return [_serialize(collection, valid_resource_ids) for collection in collections]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_collection(
    request: CollectionCreate,
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    collection_count = int(
        await db.scalar(
            select(func.count(ResourceCollection.id)).where(ResourceCollection.student_id == account.id)
        )
        or 0
    )
    if collection_count >= MAX_COLLECTIONS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"每个账号最多创建 {MAX_COLLECTIONS} 个集合")
    duplicate = await db.scalar(
        select(ResourceCollection.id).where(
            ResourceCollection.student_id == account.id,
            func.lower(ResourceCollection.name) == request.name.casefold(),
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="已有同名集合")
    collection = ResourceCollection(
        id=f"collection_{uuid4().hex}",
        student_id=account.id,
        name=request.name,
        position=collection_count,
        resource_ids=await _validated_resource_ids(db, account.id, request.resource_ids),
    )
    db.add(collection)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="已有同名集合") from error
    await db.refresh(collection)
    return _serialize(collection)


@router.put("/{collection_id}")
async def update_collection(
    collection_id: str,
    request: CollectionUpdate,
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    collection = await _owned_collection(db, account, collection_id)
    if request.name is not None and request.name != collection.name:
        duplicate = await db.scalar(
            select(ResourceCollection.id).where(
                ResourceCollection.student_id == account.id,
                ResourceCollection.id != collection.id,
                func.lower(ResourceCollection.name) == request.name.casefold(),
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="已有同名集合")
        collection.name = request.name
    if request.resource_ids is not None:
        collection.resource_ids = await _validated_resource_ids(db, account.id, request.resource_ids)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="已有同名集合") from error
    await db.refresh(collection)
    return _serialize(collection)


@router.delete("/{collection_id}")
async def delete_collection(
    collection_id: str,
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    collection = await _owned_collection(db, account, collection_id)
    await db.delete(collection)
    await db.commit()
    return {"ok": True, "id": collection_id}
