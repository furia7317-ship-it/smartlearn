"""通用 Schema。"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


class ErrorResponse(BaseModel):
    """错误响应。"""
    detail: str
    code: str = "error"


class SuccessResponse(BaseModel):
    """通用成功响应。"""
    message: str = "ok"
    data: Any = None


class LLMConfigResponse(BaseModel):
    """LLM 配置响应。"""
    providers: list[dict[str, Any]]
    current: str
    dependencies: list[dict[str, Any]] = Field(default_factory=list)
    features: list[dict[str, Any]] = Field(default_factory=list)


class ActiveLLMProviderRequest(BaseModel):
    """Choose which configured provider powers default AI flows."""

    provider: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


def _validate_openai_base_url(value: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL 必须是有效的 http(s) 地址")
    if parsed.query or parsed.fragment:
        raise ValueError("Base URL 不能包含查询参数或锚点")
    return candidate


class LLMProviderCreateRequest(BaseModel):
    """Create one locally persisted OpenAI-compatible provider."""

    name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=160)
    api_key: str = Field(default="", max_length=4096)

    @field_validator("name", "model", "api_key")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return _validate_openai_base_url(value)


class LLMProviderUpdateRequest(BaseModel):
    """Edit an OpenAI-compatible provider without returning its stored key."""

    name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=160)
    api_key: str | None = Field(default=None, max_length=4096)
    clear_api_key: bool = False

    @field_validator("name", "model")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("api_key")
    @classmethod
    def strip_optional_key(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return _validate_openai_base_url(value)
