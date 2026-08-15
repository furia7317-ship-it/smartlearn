"""配置路由 — LLM provider 管理。"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.config import settings
from app.core.llm import test_provider_config
from app.core.features import runtime_features
from app.routers.auth import get_current_account
from app.schemas.common import (
    ActiveLLMProviderRequest,
    LLMConfigResponse,
    LLMProviderCreateRequest,
    LLMProviderUpdateRequest,
)
from app.services.iflytek.recognition import (
    image_understanding_is_configured,
    pdf_ocr_is_configured,
)
from app.services.llm_provider_settings import (
    create_llm_provider,
    delete_llm_provider,
    get_active_llm_provider,
    get_llm_provider,
    list_llm_providers,
    set_active_llm_provider,
    update_llm_provider,
)

router = APIRouter(dependencies=[Depends(get_current_account)])


def runtime_dependencies() -> list[dict[str, object]]:
    """Return user-facing runtime capabilities without exposing credentials."""
    mimo_configured = bool(
        settings.MIMO_TTS_ENABLED and settings.MIMO_API_KEY.strip()
    )
    spark_ppt_configured = bool(
        settings.IFLYTEK_APPID.strip() and settings.IFLYTEK_API_SECRET.strip()
    )
    spark_avatar_configured = bool(
        settings.IFLYTEK_AVATAR_APPID.strip()
        and settings.IFLYTEK_AVATAR_API_KEY.strip()
        and settings.IFLYTEK_AVATAR_API_SECRET.strip()
        and settings.IFLYTEK_AVATAR_ID.strip()
    )
    return [
        {
            "id": "mimo",
            "display_name": "MiMo",
            "capability": "视频旁白与 TTS 配音",
            "model": settings.MIMO_TTS_MODEL,
            "configured": mimo_configured,
            "available": mimo_configured,
            "config_hint": "MIMO_TTS_ENABLED、MIMO_API_KEY",
            "test_provider": "",
        },
        {
            "id": "spark_ppt",
            "display_name": "星火 · PPT生成",
            "capability": "讯飞智文 PPT 生成",
            "model": "讯飞智文 AIPPT",
            "configured": spark_ppt_configured,
            "available": spark_ppt_configured,
            "config_hint": "IFLYTEK_APPID、IFLYTEK_API_SECRET",
            "test_provider": "",
        },
        {
            "id": "spark_avatar",
            "display_name": "星火 · 数字人",
            "capability": "实时 2D 数字人讲解",
            "model": settings.IFLYTEK_AVATAR_VCN,
            "configured": spark_avatar_configured,
            "available": spark_avatar_configured,
            "config_hint": (
                "IFLYTEK_AVATAR_APPID、IFLYTEK_AVATAR_API_KEY、"
                "IFLYTEK_AVATAR_API_SECRET、IFLYTEK_AVATAR_ID"
            ),
            "test_provider": "",
        },
        {
            "id": "spark_vision",
            "display_name": "星火 · 图片理解",
            "capability": "智能教师图片、题目、图表与公式识别",
            "model": "imagev3",
            "configured": image_understanding_is_configured(),
            "available": image_understanding_is_configured(),
            "config_hint": "IFLYTEK_VISION_APPID、IFLYTEK_VISION_API_KEY、IFLYTEK_VISION_API_SECRET",
            "test_provider": "",
        },
        {
            "id": "spark_pdf_ocr",
            "display_name": "星火 · PDF识别",
            "capability": "扫描版 PDF、公式与版面 OCR",
            "model": "PDF OCR 大模型",
            "configured": pdf_ocr_is_configured(),
            "available": pdf_ocr_is_configured(),
            "config_hint": "IFLYTEK_PDF_OCR_APPID、IFLYTEK_PDF_OCR_API_SECRET",
            "test_provider": "",
        },
    ]


async def _llm_config_response(db: AsyncSession) -> LLMConfigResponse:
    providers = await list_llm_providers(db)
    current = await get_active_llm_provider(db)
    active = next((item for item in providers if item.get("id") == current), {})
    return LLMConfigResponse(
        providers=providers,
        current=current,
        dependencies=runtime_dependencies(),
        features=runtime_features(
            provider=current,
            model=str(active.get("model") or ""),
        ),
    )


@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(db: AsyncSession = Depends(get_db)):
    """获取 LLM 配置。"""
    return await _llm_config_response(db)


@router.post("/llm/providers", response_model=LLMConfigResponse)
async def create_openai_compatible_provider(
    payload: LLMProviderCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Add an arbitrary OpenAI-compatible endpoint to this machine."""
    await create_llm_provider(db, **payload.model_dump())
    return await _llm_config_response(db)


@router.put("/llm/providers/{provider_id}", response_model=LLMConfigResponse)
async def update_openai_compatible_provider(
    provider_id: str,
    payload: LLMProviderUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Edit a provider; an omitted/blank key keeps the stored secret."""
    try:
        await update_llm_provider(db, provider_id, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return await _llm_config_response(db)


@router.delete("/llm/providers/{provider_id}", response_model=LLMConfigResponse)
async def delete_openai_compatible_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete an inactive local provider configuration."""
    try:
        await delete_llm_provider(db, provider_id)
    except ValueError as exc:
        status_code = 409 if "当前启用" in str(exc) else 404
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return await _llm_config_response(db)


@router.put("/llm/active", response_model=LLMConfigResponse)
async def update_active_llm_provider(
    payload: ActiveLLMProviderRequest,
    db: AsyncSession = Depends(get_db),
):
    """切换所有默认 AI 流程使用的对话模型，并持久化到 SQLite。"""
    try:
        await set_active_llm_provider(db, payload.provider)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return await _llm_config_response(db)


@router.post("/llm/test")
async def test_llm_provider(provider: str, db: AsyncSession = Depends(get_db)):
    """测试 LLM provider 连通性。"""
    try:
        config = await get_llm_provider(db, provider)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not (config["api_key"] and config["base_url"] and config["model"]):
        raise HTTPException(status_code=409, detail="请先填写完整的 Base URL、API Key 和模型名称")
    return await asyncio.to_thread(test_provider_config, config)
