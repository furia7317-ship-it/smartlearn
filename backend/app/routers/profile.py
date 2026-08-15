"""画像路由 — 对话建档 + 查询。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.sse import astream_via_thread, sse_format
from app.graph.profile_graph import profile_app
from app.models.profile import Profile
from app.models.account import UserAccount
from app.routers.auth import account_display_name, require_account_student_scope
from app.schemas.profile import (
    ProfileDialogueRequest,
    ProfileIdentityResponse,
    ProfileIdentityWrite,
    ProfileResponse,
)

router = APIRouter()

DEFAULT_PROFILE_MOTTO = "管理个人头脑，并查看由诊断、练习和学习行为形成的知识掌握图谱；聚焦基础，稳步提升，构建系统化的知识体系。"
DEFAULT_PROFILE_STRENGTHS = ["逻辑思维", "系统构建", "稳步提升"]


def _identity_response(account: UserAccount, profile: Profile | None) -> ProfileIdentityResponse:
    goals = dict(profile.goals or {}) if profile is not None else {}
    identity = goals.get("identity") if isinstance(goals.get("identity"), dict) else {}
    display_name = str(identity.get("display_name") or account_display_name(account)).strip()
    motto = str(identity.get("motto") or DEFAULT_PROFILE_MOTTO).strip()
    strengths = identity.get("strengths")
    if not isinstance(strengths, list):
        strengths = DEFAULT_PROFILE_STRENGTHS
    normalized_strengths = [str(item).strip() for item in strengths if str(item).strip()][:5]
    return ProfileIdentityResponse(
        student_id=account.id,
        display_name=display_name,
        major=account.major or "",
        grade=account.grade or "",
        motto=motto,
        strengths=normalized_strengths,
        updated_at=str(profile.updated_at) if profile is not None and profile.updated_at else None,
    )


@router.get("/{student_id}/identity", response_model=ProfileIdentityResponse)
async def get_profile_identity(
    student_id: str,
    account: UserAccount = Depends(require_account_student_scope),
    db: AsyncSession = Depends(get_db),
):
    """读取个人主页身份卡；账户身份是兜底，画像字段保存用户自定义内容。"""

    profile = await db.get(Profile, student_id)
    return _identity_response(account, profile)


@router.put("/{student_id}/identity", response_model=ProfileIdentityResponse)
async def save_profile_identity(
    student_id: str,
    payload: ProfileIdentityWrite,
    account: UserAccount = Depends(require_account_student_scope),
    db: AsyncSession = Depends(get_db),
):
    """保存个人主页身份信息，不覆盖知识画像与学习目标。"""

    profile = await db.get(Profile, student_id)
    if profile is None:
        profile = Profile(student_id=student_id)
        db.add(profile)

    goals = dict(profile.goals or {})
    goals["identity"] = {
        "display_name": payload.display_name.strip(),
        "motto": payload.motto.strip(),
        "strengths": list(dict.fromkeys(item.strip() for item in payload.strengths if item.strip()))[:5],
    }
    profile.goals = goals
    await db.commit()
    await db.refresh(profile)
    return _identity_response(account, profile)


@router.get("/{student_id}", response_model=ProfileResponse)
async def get_profile(student_id: str, db: AsyncSession = Depends(get_db)):
    """获取学生画像。"""
    stmt = select(Profile).where(Profile.student_id == student_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    if profile is None:
        return ProfileResponse(
            student_id=student_id,
            knowledge_level={},
            cognitive_style={"visual": 0.33, "verbal": 0.33, "practical": 0.34},
            goals={},
            error_profile={},
            pace={"preferred_duration_min": 30, "frequency": "daily", "question_count": 5},
            interests=[],
        )

    return ProfileResponse.model_validate(profile)


@router.post("/dialogue")
async def profile_dialogue(req: ProfileDialogueRequest, db: AsyncSession = Depends(get_db)):
    """对话建档（SSE 流式）。"""
    stmt = select(Profile).where(Profile.student_id == req.student_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    current_profile = req.current_profile
    if profile and not current_profile:
        current_profile = {
            "knowledge_level": profile.knowledge_level or {},
            "cognitive_style": profile.cognitive_style or {},
            "goals": profile.goals or {},
            "error_profile": profile.error_profile or {},
            "pace": profile.pace or {},
            "interests": profile.interests or [],
        }

    dialogue = req.dialogue + [{"role": "user", "content": req.message}]

    state = {
        "student_id": req.student_id,
        "dialogue": dialogue,
        "current_profile": current_profile,
        "updated_profile": {},
        "round": req.round,
        "max_rounds": 5,
        "done": False,
    }

    async def _stream_and_persist():
        final_state: dict = {}
        async for mode, chunk in astream_via_thread(profile_app, state, ["custom", "values"]):
            if mode == "custom" and isinstance(chunk, dict):
                yield sse_format(chunk.get("event", "message"), chunk)
            elif mode == "values":
                final_state = chunk

        updated = final_state.get("updated_profile") or final_state.get("current_profile") or {}
        if updated:
            if profile is None:
                profile_new = Profile(
                    student_id=req.student_id,
                    knowledge_level=updated.get("knowledge_level", {}),
                    cognitive_style=updated.get("cognitive_style", {}),
                    goals=updated.get("goals", {}),
                    error_profile=updated.get("error_profile", {}),
                    pace=updated.get("pace", {}),
                    interests=updated.get("interests", []),
                    dialogue_history=json.dumps(dialogue, ensure_ascii=False),
                )
                db.add(profile_new)
            else:
                profile.knowledge_level = updated.get("knowledge_level", profile.knowledge_level)
                profile.cognitive_style = updated.get("cognitive_style", profile.cognitive_style)
                profile.goals = updated.get("goals", profile.goals)
                profile.error_profile = updated.get("error_profile", profile.error_profile)
                profile.pace = updated.get("pace", profile.pace)
                profile.interests = updated.get("interests", profile.interests)
                profile.dialogue_history = json.dumps(dialogue, ensure_ascii=False)

            await db.commit()

        yield sse_format("done", {
            "profile": updated,
            "done": final_state.get("done", False),
            "round": final_state.get("round", 0),
        })

    return StreamingResponse(
        _stream_and_persist(),
        media_type="text/event-stream",
    )
