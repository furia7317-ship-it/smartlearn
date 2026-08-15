"""SQLite-backed user-managed OpenAI-compatible LLM providers."""

from __future__ import annotations

from collections.abc import Mapping
import re
from urllib.parse import urlsplit
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings, sync_session
from app.models.learning import LLMProviderConfig, RuntimeAppSetting


ACTIVE_LLM_PROVIDER_KEY = "active_llm_provider"
LLM_PROVIDERS_INITIALIZED_KEY = "llm_providers_initialized_v1"
LLM_PROVIDER_ENDPOINTS_NORMALIZED_KEY = "llm_provider_endpoints_normalized_v1"
LLM_PROVIDER_PRESETS_RECONCILED_KEY = "llm_provider_presets_reconciled_v1"
DEPRECATED_PRESET_PROVIDER_IDS = {"qwen", "openai"}


def _normalize_openai_base_url(value: str) -> str:
    """Accept either an SDK base URL or a copied chat-completions endpoint."""
    normalized = value.strip().rstrip("/")
    suffix = "/chat/completions"
    if normalized.casefold().endswith(suffix):
        normalized = normalized[: -len(suffix)].rstrip("/")
    return normalized


def _normalize_provider_model(provider: str, base_url: str, model: str) -> str:
    """Map common Spark X display names to the API model identifier."""
    normalized = model.strip()
    hostname = (urlsplit(base_url).hostname or "").casefold()
    if provider == "spark" or hostname == "spark-api-open.xf-yun.com":
        alias = re.sub(r"[^a-z0-9]+", "", normalized.casefold())
        if alias in {"sparkx", "sparkx2", "sparkx15", "x2", "x15"}:
            return "spark-x"
    return normalized


def _normalize_provider_fields(provider: str, base_url: str, model: str) -> tuple[str, str]:
    normalized_url = _normalize_openai_base_url(base_url)
    return normalized_url, _normalize_provider_model(provider, normalized_url, model)


def _legacy_provider_configs() -> list[dict[str, str]]:
    """Editable first-run presets, including values from the existing .env."""
    return [
        {
            "id": "spark",
            "name": "讯飞星火",
            "base_url": settings.SPARK_BASE_URL,
            "api_key": settings.SPARK_API_KEY,
            "model": settings.SPARK_MODEL,
        },
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "base_url": settings.DEEPSEEK_BASE_URL,
            "api_key": settings.DEEPSEEK_API_KEY,
            "model": "deepseek-chat",
        },
    ]


def _is_configured(config: Mapping[str, str]) -> bool:
    return bool(
        str(config.get("api_key", "")).strip()
        and str(config.get("base_url", "")).strip()
        and str(config.get("model", "")).strip()
    )


def _row_config(row: LLMProviderConfig) -> dict[str, str]:
    base_url, model = _normalize_provider_fields(row.id, row.base_url, row.model)
    return {
        "id": row.id,
        "name": row.name,
        "base_url": base_url,
        "api_key": row.api_key,
        "model": model,
    }


def _public_config(config: Mapping[str, str]) -> dict[str, object]:
    api_key = str(config.get("api_key", "")).strip()
    return {
        "id": str(config["id"]),
        "name": str(config["name"]),
        "base_url": str(config["base_url"]),
        "model": str(config["model"]),
        "configured": _is_configured(config),
        "api_key_hint": f"••••{api_key[-4:]}" if api_key else "",
    }


def _legacy_fallback_config(provider: str | None = None) -> dict[str, str]:
    presets = _legacy_provider_configs()
    requested = str(provider or settings.DEFAULT_LLM_PROVIDER).strip().lower()
    by_id = {item["id"]: item for item in presets}
    if requested in by_id and (provider is not None or _is_configured(by_id[requested])):
        return by_id[requested]
    configured = next((item for item in presets if _is_configured(item)), None)
    return configured or by_id.get(requested) or presets[0]


async def ensure_default_llm_providers(db: AsyncSession) -> None:
    """Import legacy .env entries once so existing installs keep working."""
    marker = await db.get(RuntimeAppSetting, LLM_PROVIDERS_INITIALIZED_KEY)
    changed = False
    if marker is None:
        existing = (await db.execute(select(LLMProviderConfig.id).limit(1))).scalar_one_or_none()
        if existing is None:
            for config in _legacy_provider_configs():
                db.add(LLMProviderConfig(**config))

        active = await db.get(RuntimeAppSetting, ACTIVE_LLM_PROVIDER_KEY)
        if active is None:
            fallback = _legacy_fallback_config()["id"]
            db.add(RuntimeAppSetting(key=ACTIVE_LLM_PROVIDER_KEY, value=fallback))
        db.add(RuntimeAppSetting(key=LLM_PROVIDERS_INITIALIZED_KEY, value="1"))
        changed = True

    if marker is None:
        await db.flush()

    preset_marker = await db.get(
        RuntimeAppSetting,
        LLM_PROVIDER_PRESETS_RECONCILED_KEY,
    )
    if preset_marker is None:
        rows = (await db.execute(select(LLMProviderConfig))).scalars().all()
        by_id = {row.id: row for row in rows}
        for config in _legacy_provider_configs():
            if config["id"] not in by_id:
                db.add(LLMProviderConfig(**config))
        for provider_id in DEPRECATED_PRESET_PROVIDER_IDS:
            deprecated = by_id.get(provider_id)
            if deprecated is not None:
                await db.delete(deprecated)
        active = await db.get(RuntimeAppSetting, ACTIVE_LLM_PROVIDER_KEY)
        if active is not None and active.value in DEPRECATED_PRESET_PROVIDER_IDS:
            active.value = settings.DEFAULT_LLM_PROVIDER
        db.add(RuntimeAppSetting(key=LLM_PROVIDER_PRESETS_RECONCILED_KEY, value="1"))
        changed = True

    normalization_marker = await db.get(
        RuntimeAppSetting,
        LLM_PROVIDER_ENDPOINTS_NORMALIZED_KEY,
    )
    if normalization_marker is None:
        rows = (await db.execute(select(LLMProviderConfig))).scalars().all()
        for row in rows:
            base_url, model = _normalize_provider_fields(row.id, row.base_url, row.model)
            if row.base_url != base_url:
                row.base_url = base_url
            if row.model != model:
                row.model = model
        db.add(RuntimeAppSetting(key=LLM_PROVIDER_ENDPOINTS_NORMALIZED_KEY, value="1"))
        changed = True

    if changed:
        await db.commit()


async def list_llm_providers(db: AsyncSession) -> list[dict[str, object]]:
    await ensure_default_llm_providers(db)
    rows = (await db.execute(select(LLMProviderConfig))).scalars().all()
    preset_order = {item["id"]: index for index, item in enumerate(_legacy_provider_configs())}
    ordered = sorted(rows, key=lambda row: (preset_order.get(row.id, 100), row.name.casefold()))
    return [_public_config(_row_config(row)) for row in ordered]


async def get_llm_provider(db: AsyncSession, provider: str) -> dict[str, str]:
    await ensure_default_llm_providers(db)
    row = await db.get(LLMProviderConfig, str(provider).strip())
    if row is None:
        raise ValueError("模型供应商不存在或已被删除")
    return _row_config(row)


async def create_llm_provider(
    db: AsyncSession,
    *,
    name: str,
    base_url: str,
    api_key: str,
    model: str,
) -> str:
    await ensure_default_llm_providers(db)
    provider_id = f"custom_{uuid4().hex}"
    normalized_url, normalized_model = _normalize_provider_fields(provider_id, base_url, model)
    db.add(
        LLMProviderConfig(
            id=provider_id,
            name=name.strip(),
            base_url=normalized_url,
            api_key=api_key.strip(),
            model=normalized_model,
        )
    )
    await db.commit()
    return provider_id


async def update_llm_provider(
    db: AsyncSession,
    provider: str,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key: str | None,
    clear_api_key: bool,
) -> str:
    await ensure_default_llm_providers(db)
    row = await db.get(LLMProviderConfig, provider)
    if row is None:
        raise ValueError("模型供应商不存在或已被删除")
    normalized_url, normalized_model = _normalize_provider_fields(provider, base_url, model)
    row.name = name.strip()
    row.base_url = normalized_url
    row.model = normalized_model
    if clear_api_key:
        row.api_key = ""
    elif api_key:
        row.api_key = api_key.strip()
    await db.commit()
    return row.id


async def delete_llm_provider(db: AsyncSession, provider: str) -> None:
    await ensure_default_llm_providers(db)
    row = await db.get(LLMProviderConfig, provider)
    if row is None:
        raise ValueError("模型供应商不存在或已被删除")
    active = await db.get(RuntimeAppSetting, ACTIVE_LLM_PROVIDER_KEY)
    if active is not None and active.value == provider:
        raise ValueError("当前启用的供应商不能删除，请先切换到另一项")
    await db.delete(row)
    await db.commit()


async def get_active_llm_provider(db: AsyncSession) -> str:
    """Read the active provider id, falling back to another configured row."""
    try:
        await ensure_default_llm_providers(db)
        active = await db.get(RuntimeAppSetting, ACTIVE_LLM_PROVIDER_KEY)
        if active is not None:
            row = await db.get(LLMProviderConfig, active.value)
            if row is not None and _is_configured(_row_config(row)):
                return row.id
        rows = (await db.execute(select(LLMProviderConfig))).scalars().all()
        configured = next((row for row in rows if _is_configured(_row_config(row))), None)
        return configured.id if configured is not None else ""
    except OperationalError as exc:
        if "no such table" not in str(exc).lower():
            raise
        return _legacy_fallback_config()["id"]


async def set_active_llm_provider(db: AsyncSession, provider: str) -> str:
    """Persist one configured user-managed provider as the global default."""
    config = await get_llm_provider(db, provider)
    if not _is_configured(config):
        raise ValueError(f"{config['name']} 尚未填写完整的 Base URL、API Key 和模型名称")

    row = await db.get(RuntimeAppSetting, ACTIVE_LLM_PROVIDER_KEY)
    if row is None:
        db.add(RuntimeAppSetting(key=ACTIVE_LLM_PROVIDER_KEY, value=provider))
    else:
        row.value = provider
    await db.commit()
    return provider


def get_llm_provider_config_sync(provider: str | None = None) -> dict[str, str]:
    """Resolve the active provider for synchronous LangChain/SDK call paths."""
    try:
        with sync_session() as db:
            requested = str(provider or "").strip()
            if not requested:
                active = db.get(RuntimeAppSetting, ACTIVE_LLM_PROVIDER_KEY)
                requested = active.value if active is not None else ""

            if requested:
                row = db.get(LLMProviderConfig, requested)
                if row is not None and (provider is not None or _is_configured(_row_config(row))):
                    return _row_config(row)

            if provider is None:
                rows = db.scalars(select(LLMProviderConfig)).all()
                configured = next((row for row in rows if _is_configured(_row_config(row))), None)
                if configured is not None:
                    return _row_config(configured)
    except OperationalError as exc:
        if "no such table" not in str(exc).lower():
            raise

    legacy_ids = {item["id"] for item in _legacy_provider_configs()}
    if provider is not None and provider not in legacy_ids:
        raise ValueError(f"未知 LLM provider: {provider}")
    return _legacy_fallback_config(provider)


def get_active_llm_provider_sync() -> str:
    return get_llm_provider_config_sync()["id"]


def public_legacy_providers() -> list[dict[str, object]]:
    """Compatibility helper for code that inspects the original registry."""
    return [_public_config(config) for config in _legacy_provider_configs()]
