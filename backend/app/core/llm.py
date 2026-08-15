"""多 Provider LLM 注册表 + build_llm + JSON 解析工具。"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.services.llm_provider_settings import (
    get_llm_provider_config_sync,
    public_legacy_providers,
)

# ── Provider 注册表 ──

_PROVIDERS: dict[str, dict[str, str]] = {
    "spark": {
        "api_key": settings.SPARK_API_KEY,
        "base_url": settings.SPARK_BASE_URL,
        "default_model": settings.SPARK_MODEL,
    },
    "deepseek": {
        "api_key": settings.DEEPSEEK_API_KEY,
        "base_url": settings.DEEPSEEK_BASE_URL,
        "default_model": "deepseek-chat",
    },
}


def build_llm(
    temperature: float = 0.7,
    provider: str | None = None,
    model: str | None = None,
    *,
    streaming: bool = True,
    response_format: dict[str, Any] | None = None,
    max_tokens: int | None = None,
) -> BaseChatModel:
    """根据 provider 构建 LLM 实例；未指定时读取 SQLite 中的当前选择。"""
    cfg = get_llm_provider_config_sync(provider)

    model_kwargs: dict[str, Any] = {}
    if response_format:
        model_kwargs["response_format"] = response_format
    return ChatOpenAI(
        model=model or cfg["model"],
        api_key=cfg["api_key"],
        base_url=cfg["base_url"],
        temperature=temperature,
        streaming=streaming,
        model_kwargs=model_kwargs,
        max_tokens=max_tokens,
        timeout=settings.LLM_REQUEST_TIMEOUT_SECONDS,
        max_retries=settings.LLM_MAX_RETRIES,
    )


def provider_openai_config(provider: str | None = None) -> tuple[str, str, str]:
    """返回某 provider 的 (api_key, base_url, default_model)，供直接用 openai SDK
    （AsyncOpenAI）做原生工具调用的 agent harness 使用。默认读取 SQLite 当前选择。"""
    cfg = get_llm_provider_config_sync(provider)
    return cfg["api_key"], cfg["base_url"], cfg["model"]


def list_providers() -> list[dict[str, Any]]:
    """Compatibility view of the first-run presets."""
    return [
        {
            "name": item["id"],
            "default_model": item["model"],
            "configured": item["configured"],
        }
        for item in public_legacy_providers()
    ]


def test_provider(provider: str) -> dict[str, Any]:
    """一键连通测试：发一条简单消息，返回成功/失败。"""
    return test_provider_config(get_llm_provider_config_sync(provider))


def test_provider_config(config: dict[str, str]) -> dict[str, Any]:
    """Test a resolved provider without ever exposing its API key."""
    try:
        llm = ChatOpenAI(
            model=config["model"],
            api_key=config["api_key"],
            base_url=config["base_url"],
            temperature=0,
            streaming=False,
            timeout=30,
            max_retries=0,
            max_tokens=1,
        )
        resp = llm.invoke("Reply with OK.")
        return {
            "provider": config["id"],
            "status": "ok",
            "reply": str(resp.content)[:40],
        }
    except Exception as e:
        return {
            "provider": config["id"],
            "status": "error",
            "error": str(e)[:200],
        }


# ── JSON 解析工具 ──

def parse_json_response(text: str) -> dict[str, Any]:
    """从 LLM 回复中稳健提取 JSON。

    处理：
    1. ```json ... ``` 代码块包裹
    2. 纯 JSON 字符串
    3. JSON 嵌在自然语言文本中
    """
    # 尝试提取代码块
    # Strip only the outer JSON fence. Generated JSON strings can themselves
    # contain fenced Markdown examples such as ```python. A non-greedy search
    # stops at that inner fence and turns valid resources into raw fallbacks.
    stripped = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*)\s*```", stripped, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()

    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试找到第一个 { 到最后一个 }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    # 尝试找到第一个 [ 到最后一个 ]
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"无法从 LLM 回复中提取 JSON: {text[:200]}...")
