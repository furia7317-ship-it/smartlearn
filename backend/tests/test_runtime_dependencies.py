from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.models.base import Base
from app.models.learning import LLMProviderConfig, RuntimeAppSetting
from app.routers.config import runtime_dependencies
from app.schemas.common import ActiveLLMProviderRequest, LLMProviderCreateRequest
from app.services.llm_provider_settings import (
    create_llm_provider,
    delete_llm_provider,
    get_active_llm_provider,
    list_llm_providers,
    set_active_llm_provider,
    update_llm_provider,
)


def test_runtime_dependencies_match_user_facing_capabilities(monkeypatch) -> None:
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_APPID", "app-id")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_API_KEY", "api-key")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_API_SECRET", "api-secret")
    monkeypatch.setattr(settings, "IFLYTEK_AVATAR_ID", "avatar-id")
    dependencies = runtime_dependencies()
    by_id = {item["id"]: item for item in dependencies}

    assert list(by_id) == [
        "mimo",
        "spark_ppt",
        "spark_avatar",
        "spark_vision",
        "spark_pdf_ocr",
    ]
    assert by_id["mimo"]["display_name"] == "MiMo"
    assert by_id["spark_ppt"]["display_name"] == "星火 · PPT生成"
    assert by_id["spark_avatar"]["display_name"] == "星火 · 数字人"
    assert by_id["spark_vision"]["display_name"] == "星火 · 图片理解"
    assert by_id["spark_pdf_ocr"]["display_name"] == "星火 · PDF识别"
    assert all(not item["test_provider"] for item in dependencies)
    assert by_id["spark_avatar"]["available"] is True
    assert by_id["spark_vision"]["available"] is True
    assert by_id["spark_pdf_ocr"]["available"] is True


@pytest.fixture
async def settings_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_active_provider_is_persisted_in_sqlite(settings_db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "deepseek-key")
    monkeypatch.setattr(settings, "SPARK_API_KEY", "spark-key")

    assert await set_active_llm_provider(settings_db, "spark") == "spark"
    active = await settings_db.get(RuntimeAppSetting, "active_llm_provider")
    assert active is not None
    assert active.value == "spark"


@pytest.mark.asyncio
async def test_unconfigured_provider_cannot_be_enabled(settings_db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "SPARK_API_KEY", "")

    with pytest.raises(ValueError, match="尚未填写完整"):
        await set_active_llm_provider(settings_db, "spark")


@pytest.mark.asyncio
async def test_no_provider_is_reported_active_when_all_keys_are_empty(settings_db, monkeypatch) -> None:
    for setting_name in ("DEEPSEEK_API_KEY", "QWEN_API_KEY", "SPARK_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setattr(settings, setting_name, "")

    assert await get_active_llm_provider(settings_db) == ""


def test_default_llm_build_reads_runtime_provider(monkeypatch) -> None:
    from app.core import llm

    captured: dict[str, object] = {}

    def fake_chat_openai(**kwargs):
        captured.update(kwargs)
        return kwargs

    monkeypatch.setattr(
        llm,
        "get_llm_provider_config_sync",
        lambda provider=None: {
            "id": "custom-provider",
            "name": "Custom",
            "api_key": "secret",
            "base_url": "https://llm.example.com/v1",
            "model": "example-chat",
        },
    )
    monkeypatch.setattr(llm, "ChatOpenAI", fake_chat_openai)

    llm.build_llm()

    assert captured["model"] == "example-chat"
    assert captured["base_url"] == "https://llm.example.com/v1"
    assert captured["timeout"] == settings.LLM_REQUEST_TIMEOUT_SECONDS
    assert captured["max_retries"] == settings.LLM_MAX_RETRIES


def test_provider_connectivity_probe_uses_a_bounded_reply(monkeypatch) -> None:
    from app.core import llm

    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def invoke(self, prompt: str):
            captured["prompt"] = prompt
            return SimpleNamespace(content="OK")

    monkeypatch.setattr(llm, "ChatOpenAI", FakeChatOpenAI)

    result = llm.test_provider_config(
        {
            "id": "spark",
            "api_key": "secret",
            "base_url": "https://spark-api-open.xf-yun.com/x2",
            "model": "spark-x",
        }
    )

    assert result["status"] == "ok"
    assert captured["timeout"] == 30
    assert captured["max_tokens"] == 1
    assert captured["prompt"] == "Reply with OK."


def test_provider_request_accepts_custom_provider_ids() -> None:
    assert ActiveLLMProviderRequest(provider="custom_my-provider").provider == "custom_my-provider"


def test_provider_base_url_requires_plain_http_or_https_origin() -> None:
    with pytest.raises(ValidationError, match="Base URL"):
        LLMProviderCreateRequest(
            name="invalid",
            base_url="file:///tmp/model",
            model="test-chat",
            api_key="secret",
        )


@pytest.mark.asyncio
async def test_custom_provider_crud_masks_api_key(settings_db) -> None:
    provider_id = await create_llm_provider(
        settings_db,
        name="校内中转",
        base_url="https://llm.example.com/v1/",
        api_key="test-secret-1234",
        model="campus-chat",
    )

    providers = await list_llm_providers(settings_db)
    created = next(item for item in providers if item["id"] == provider_id)
    assert created["base_url"] == "https://llm.example.com/v1"
    assert created["api_key_hint"] == "••••1234"
    assert "test-secret" not in str(created)

    await update_llm_provider(
        settings_db,
        provider_id,
        name="校内模型",
        base_url="https://new.example.com/v1",
        model="campus-chat-v2",
        api_key=None,
        clear_api_key=False,
    )
    providers = await list_llm_providers(settings_db)
    updated = next(item for item in providers if item["id"] == provider_id)
    assert updated["name"] == "校内模型"
    assert updated["configured"] is True

    await delete_llm_provider(settings_db, provider_id)
    assert all(item["id"] != provider_id for item in await list_llm_providers(settings_db))


@pytest.mark.asyncio
async def test_full_chat_completions_url_and_spark_display_model_are_normalized(settings_db) -> None:
    provider_id = await create_llm_provider(
        settings_db,
        name="Spark X2",
        base_url="https://spark-api-open.xf-yun.com/x2/chat/completions/",
        api_key="test-password",
        model="Spark X2",
    )

    providers = await list_llm_providers(settings_db)
    created = next(item for item in providers if item["id"] == provider_id)
    assert created["base_url"] == "https://spark-api-open.xf-yun.com/x2"
    assert created["model"] == "spark-x"


@pytest.mark.asyncio
async def test_existing_spark_endpoint_is_migrated_before_use(settings_db) -> None:
    settings_db.add(
        LLMProviderConfig(
            id="spark",
            name="Spark X2",
            base_url="https://spark-api-open.xf-yun.com/x2/chat/completions",
            api_key="test-password",
            model="Spark X2",
        )
    )
    settings_db.add(RuntimeAppSetting(key="llm_providers_initialized_v1", value="1"))
    await settings_db.commit()

    providers = await list_llm_providers(settings_db)
    spark = next(item for item in providers if item["id"] == "spark")
    persisted = await settings_db.get(LLMProviderConfig, "spark")
    assert spark["base_url"] == "https://spark-api-open.xf-yun.com/x2"
    assert spark["model"] == "spark-x"
    assert persisted is not None
    assert persisted.base_url == "https://spark-api-open.xf-yun.com/x2"
    assert persisted.model == "spark-x"


@pytest.mark.asyncio
async def test_default_presets_are_only_spark_and_deepseek(settings_db) -> None:
    providers = await list_llm_providers(settings_db)
    assert [provider["id"] for provider in providers] == ["spark", "deepseek"]


@pytest.mark.asyncio
async def test_old_presets_are_removed_without_deleting_custom_providers(settings_db) -> None:
    settings_db.add_all(
        [
            LLMProviderConfig(
                id="qwen",
                name="Qwen",
                base_url="https://qwen.example/v1",
                api_key="qwen-key",
                model="qwen-plus",
            ),
            LLMProviderConfig(
                id="openai",
                name="OpenAI",
                base_url="https://openai.example/v1",
                api_key="openai-key",
                model="gpt-test",
            ),
            LLMProviderConfig(
                id="custom_school",
                name="School relay",
                base_url="https://school.example/v1",
                api_key="school-key",
                model="school-chat",
            ),
        ]
    )
    settings_db.add(RuntimeAppSetting(key="llm_providers_initialized_v1", value="1"))
    settings_db.add(RuntimeAppSetting(key="active_llm_provider", value="qwen"))
    await settings_db.commit()

    providers = await list_llm_providers(settings_db)
    ids = [provider["id"] for provider in providers]
    assert ids[:2] == ["spark", "deepseek"]
    assert "custom_school" in ids
    assert "qwen" not in ids
    assert "openai" not in ids
    active = await settings_db.get(RuntimeAppSetting, "active_llm_provider")
    assert active is not None
    assert active.value == "deepseek"


@pytest.mark.asyncio
async def test_active_provider_cannot_be_deleted(settings_db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "deepseek-key")
    await set_active_llm_provider(settings_db, "deepseek")

    with pytest.raises(ValueError, match="当前启用"):
        await delete_llm_provider(settings_db, "deepseek")
