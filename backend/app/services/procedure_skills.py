"""Owned, immutable procedural-memory proposals and explicit activation gates.

All stored definitions are data. This module never evaluates code or interprets
filesystem paths from a procedure. Mutation functions own their DB transaction.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.procedure_skills import (
    ProcedureSkill,
    ProcedureSkillEvent,
    ProcedureSkillUsage,
    ProcedureSkillVersion,
)
from app.schemas.procedure_skills import SkillDefinition

SYSTEM_OWNER = "__system__"
EVALUATOR_ID = "procedure-skill-evaluator-v1"
MAX_PERSONAL_SKILLS = 200
MAX_SKILL_VERSIONS = 200


def canonical_definition_hash(definition: SkillDefinition | dict[str, Any]) -> str:
    payload = SkillDefinition.model_validate(definition).model_dump(mode="json")
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def version_is_approved(version: ProcedureSkillVersion) -> bool:
    """The evaluation must bind to this exact complete, immutable definition."""
    validation = version.validation or {}
    try:
        actual_hash = canonical_definition_hash(version.definition)
    except (ValueError, TypeError):
        return False
    return (
        version.status == "passed"
        and validation.get("passed") is True
        and validation.get("completed") is True
        and validation.get("status") == "passed"
        and validation.get("evaluator_id") == EVALUATOR_ID
        and validation.get("content_hash") == version.content_hash == actual_hash
    )


def _student_scope(student_id: str) -> str:
    value = str(student_id).strip()
    if not value or len(value) > 64 or value == SYSTEM_OWNER:
        raise HTTPException(status_code=403, detail="无效的个人教学方法归属")
    return value


async def _verify_source_run(db: AsyncSession, student_id: str, run_id: str) -> None:
    if not run_id:
        return
    from app.models.agent_run import AgentRun
    from app.models.learning import OrchestrationRecord

    owner = (await db.execute(select(AgentRun.owner_id).where(AgentRun.id == run_id))).scalar_one_or_none()
    if owner == student_id:
        return
    if owner is None:
        evidence = await db.scalar(select(OrchestrationRecord.id).where(
            OrchestrationRecord.run_id == run_id, OrchestrationRecord.student_id == student_id,
        ).limit(1))
        if evidence is not None:
            return
    raise HTTPException(status_code=404, detail="来源任务不存在或不属于当前学习者")


async def owned_skill(
    db: AsyncSession, student_id: str, skill_id: str, *, writable: bool = False
) -> ProcedureSkill:
    student_id = _student_scope(student_id)
    row = (await db.execute(select(ProcedureSkill).where(
        ProcedureSkill.id == skill_id,
        ProcedureSkill.owner_id.in_([student_id, SYSTEM_OWNER]),
    ))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="教学方法不存在")
    if writable and row.owner_id == SYSTEM_OWNER:
        raise HTTPException(status_code=403, detail="内置教学方法只读，可另建个人方法")
    return row


async def record_event(
    db: AsyncSession,
    skill_id: str,
    actor_id: str,
    event_type: str,
    version_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Append inside the caller's transaction; do not implicitly commit evaluation."""
    db.add(ProcedureSkillEvent(
        id=uuid.uuid4().hex, skill_id=skill_id, actor_id=actor_id,
        event_type=event_type, version_id=version_id, details=dict(details or {}),
    ))


def _timestamp(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _version_view(version: ProcedureSkillVersion) -> dict[str, Any]:
    return {
        "id": version.id, "skill_id": version.skill_id, "version": version.version,
        "definition": version.definition, "content_hash": version.content_hash,
        "status": version.status, "validation": version.validation or {},
        "source_run_id": version.source_run_id or "", "created_at": _timestamp(version.created_at),
    }


def _summary(
    skill: ProcedureSkill, versions: list[ProcedureSkillVersion], outcomes: list[dict[str, Any]]
) -> dict[str, Any]:
    latest = versions[0]
    active = next((v for v in versions if v.id == skill.active_version_id), None)
    definition = latest.definition
    approved = sum(outcome.get("approved") is True or outcome.get("review_approved") is True for outcome in outcomes)
    failed = sum(
        outcome.get("approved") is False or outcome.get("review_approved") is False
        or outcome.get("status") in {"failed", "rejected"}
        for outcome in outcomes
    )
    usable_active = active and (
        version_is_approved(active) if skill.owner_id != SYSTEM_OWNER else active.status == "passed"
    )
    status = "disabled" if skill.disabled else "active" if usable_active else latest.status
    return {
        "id": skill.id, "name": skill.name, "description": definition.get("description", ""),
        "owner_id": skill.owner_id, "read_only": skill.owner_id == SYSTEM_OWNER,
        "disabled": bool(skill.disabled), "active_version_id": skill.active_version_id,
        "active_version": active.version if active else None,
        "latest_version_id": latest.id, "latest_version": latest.version,
        "latest_version_status": latest.status,
        "status": status, "resource_types": definition.get("resource_types", []),
        "created_at": _timestamp(skill.created_at), "updated_at": _timestamp(skill.updated_at),
        "usage_summary": {"total": len(outcomes), "approved": approved, "failed": failed},
    }


async def list_skills(
    db: AsyncSession, student_id: str, query: str = "", resource_type: str = ""
) -> list[dict[str, Any]]:
    student_id = _student_scope(student_id)
    skills = (await db.execute(select(ProcedureSkill).where(
        ProcedureSkill.owner_id.in_([student_id, SYSTEM_OWNER]),
    ).order_by(ProcedureSkill.updated_at.desc(), ProcedureSkill.id))).scalars().all()
    if not skills:
        return []
    ids = [row.id for row in skills]
    versions = (await db.execute(select(ProcedureSkillVersion).where(
        ProcedureSkillVersion.skill_id.in_(ids),
    ).order_by(ProcedureSkillVersion.version.desc()))).scalars().all()
    usages = (await db.execute(select(ProcedureSkillUsage.skill_id, ProcedureSkillUsage.outcome).where(
        ProcedureSkillUsage.skill_id.in_(ids), ProcedureSkillUsage.student_id == student_id,
    ))).all()
    grouped_versions: dict[str, list[ProcedureSkillVersion]] = {}
    grouped_outcomes: dict[str, list[dict[str, Any]]] = {}
    for version in versions:
        grouped_versions.setdefault(version.skill_id, []).append(version)
    for skill_id, outcome in usages:
        grouped_outcomes.setdefault(skill_id, []).append(outcome or {})
    rows = []
    search = query.strip().casefold()[:200]
    for skill in skills:
        history = grouped_versions.get(skill.id, [])
        if not history:
            continue
        row = _summary(skill, history, grouped_outcomes.get(skill.id, []))
        if resource_type and resource_type not in row["resource_types"]:
            continue
        searchable = f'{row["name"]} {row["description"]} {" ".join(history[0].definition.get("triggers", []))}'
        if search and search not in searchable.casefold():
            continue
        rows.append(row)
    return rows


async def get_skill(db: AsyncSession, student_id: str, skill_id: str) -> dict[str, Any]:
    skill = await owned_skill(db, student_id, skill_id)
    versions = (await db.execute(select(ProcedureSkillVersion).where(
        ProcedureSkillVersion.skill_id == skill_id,
    ).order_by(ProcedureSkillVersion.version.desc()))).scalars().all()
    if not versions:
        raise HTTPException(status_code=404, detail="教学方法没有可查看的版本")
    outcomes = (await db.execute(select(ProcedureSkillUsage.outcome).where(
        ProcedureSkillUsage.skill_id == skill_id, ProcedureSkillUsage.student_id == student_id,
    ))).scalars().all()
    events = (await db.execute(select(ProcedureSkillEvent).where(
        ProcedureSkillEvent.skill_id == skill_id,
    ).order_by(ProcedureSkillEvent.created_at.desc(), ProcedureSkillEvent.id.desc()).limit(50))).scalars().all()
    return {
        **_summary(skill, versions, list(outcomes)), "proposed_version_id": None,
        "versions": [_version_view(v) for v in versions],
        "events": [{
            "id": row.id, "event_type": row.event_type, "actor_id": row.actor_id,
            "version_id": row.version_id, "details": row.details or {}, "created_at": _timestamp(row.created_at),
        } for row in events],
    }


async def propose_skill(
    db: AsyncSession, student_id: str, definition: SkillDefinition | dict[str, Any],
    source_run_id: str = "", skill_id: str | None = None,
    *, commit: bool = True,
) -> dict[str, Any]:
    student_id = _student_scope(student_id)
    validated = SkillDefinition.model_validate(definition)
    payload = validated.model_dump(mode="json")
    content_hash = canonical_definition_hash(validated)
    if len(source_run_id) > 64:
        raise HTTPException(status_code=422, detail="来源任务标识过长")
    try:
        await _verify_source_run(db, student_id, source_run_id)
        if skill_id:
            await owned_skill(db, student_id, skill_id, writable=True)
        else:
            identity = hashlib.sha256(f"{student_id}\0{validated.name.casefold()}".encode()).hexdigest()[:40]
            skill_id = f"skill_{identity}"
            await db.execute(insert(ProcedureSkill).values(
                id=skill_id, owner_id=student_id, name=validated.name,
                disabled=False, version_counter=0,
            ).on_conflict_do_nothing(index_elements=["id"]))
            # Count after obtaining the SQLite write lock, so simultaneous
            # first proposals cannot race past the per-student storage cap.
            count = (await db.execute(select(func.count()).select_from(ProcedureSkill).where(
                ProcedureSkill.owner_id == student_id,
            ))).scalar_one()
            if count > MAX_PERSONAL_SKILLS:
                raise HTTPException(status_code=409, detail="个人教学方法已达 200 个，请复用已有方法")
        # A write, even with an unchanged counter, serializes allocations across
        # sessions/processes in SQLite. Unique constraints are the final guard.
        locked = (await db.execute(update(ProcedureSkill).where(
            ProcedureSkill.id == skill_id, ProcedureSkill.owner_id == student_id,
        ).values(version_counter=ProcedureSkill.version_counter, updated_at=ProcedureSkill.updated_at)
            .returning(ProcedureSkill.version_counter))).scalar_one_or_none()
        if locked is None:
            raise HTTPException(status_code=404, detail="教学方法不存在")
        duplicate = (await db.execute(select(ProcedureSkillVersion).where(
            ProcedureSkillVersion.skill_id == skill_id, ProcedureSkillVersion.content_hash == content_hash,
        ))).scalar_one_or_none()
        if duplicate is not None:
            proposed_version_id = duplicate.id
        else:
            if locked >= MAX_SKILL_VERSIONS:
                raise HTTPException(status_code=409, detail="该教学方法已达 200 个版本")
            number = locked + 1
            proposed_version_id = uuid.uuid4().hex
            db.add(ProcedureSkillVersion(
                id=proposed_version_id, skill_id=skill_id, version=number,
                definition=payload, content_hash=content_hash, status="candidate",
                validation={}, source_run_id=source_run_id,
            ))
            await db.execute(update(ProcedureSkill).where(ProcedureSkill.id == skill_id).values(
                version_counter=number, name=validated.name, updated_at=func.now(),
            ))
            await record_event(db, skill_id, student_id, "proposed", proposed_version_id, {
                "version": number, "content_hash": content_hash, "source_run_id": source_run_id,
            })
        if commit:
            await db.commit()
        else:
            await db.flush()
    except Exception:
        await db.rollback()
        raise
    result = await get_skill(db, student_id, skill_id)
    result["proposed_version_id"] = proposed_version_id
    return result


async def activate_version(
    db: AsyncSession, student_id: str, skill_id: str, version_id: str
) -> dict[str, Any]:
    try:
        skill = await owned_skill(db, student_id, skill_id, writable=True)
        version = (await db.execute(select(ProcedureSkillVersion).where(
            ProcedureSkillVersion.id == version_id, ProcedureSkillVersion.skill_id == skill.id,
        ))).scalar_one_or_none()
        if version is None:
            raise HTTPException(status_code=404, detail="教学方法版本不存在")
        if not version_is_approved(version):
            raise HTTPException(status_code=409, detail="该版本尚未通过完整的方法检查，请先检查再启用")
        if skill.active_version_id != version.id or skill.disabled:
            previous = skill.active_version_id
            skill.active_version_id = version.id
            skill.disabled = False
            await record_event(db, skill.id, student_id, "activated", version.id, {
                "previous_version_id": previous, "content_hash": version.content_hash,
                "learning_effect_proven": False,
            })
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return await get_skill(db, student_id, skill_id)


async def set_disabled(
    db: AsyncSession, student_id: str, skill_id: str, disabled: bool
) -> dict[str, Any]:
    try:
        skill = await owned_skill(db, student_id, skill_id, writable=True)
        # Resuming is another activation gate, not a bypass through a boolean.
        if not disabled:
            version = await db.get(ProcedureSkillVersion, skill.active_version_id) if skill.active_version_id else None
            if version is None or version.skill_id != skill.id or not version_is_approved(version):
                raise HTTPException(status_code=409, detail="请先选择检查通过的版本启用")
        if skill.disabled != disabled:
            skill.disabled = disabled
            await record_event(db, skill.id, student_id, "disabled" if disabled else "resumed", skill.active_version_id)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return await get_skill(db, student_id, skill_id)
