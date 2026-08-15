"""Optional OpenAI Responses API adapter.

The adapter exposes only public reasoning summaries. Raw model reasoning tokens
and encrypted reasoning content are provider-private state and must not be sent
to the frontend trace stream.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ResponsesGeneration:
    """Visible output plus provider state returned by a Responses request."""

    text: str
    reasoning_summary: str = ""
    response_id: str = ""
    usage: dict[str, Any] = field(default_factory=dict)


def provider_supports_responses_reasoning(provider: str, model: str) -> bool:
    """Return whether this provider/model should try Responses reasoning summaries."""

    if provider != "openai":
        return False
    normalized = model.lower()
    return normalized.startswith(("gpt-5", "o1", "o3", "o4"))


def extract_reasoning_summary(response: Any) -> str:
    """Extract public reasoning summary text from a Responses API response."""

    summaries: list[str] = []
    for item in _items(_get(response, "output", [])):
        if _get(item, "type") != "reasoning":
            continue
        for summary in _items(_get(item, "summary", [])):
            text = _get(summary, "text", "")
            if text:
                summaries.append(str(text).strip())
    return "\n".join(s for s in summaries if s)


def extract_output_text(response: Any) -> str:
    """Extract visible text output from a Responses API response."""

    direct = _get(response, "output_text", "")
    if direct:
        return str(direct)

    parts: list[str] = []
    for item in _items(_get(response, "output", [])):
        if _get(item, "type") != "message":
            continue
        for content in _items(_get(item, "content", [])):
            if _get(content, "type") == "output_text":
                text = _get(content, "text", "")
                if text:
                    parts.append(str(text))
    return "".join(parts)


async def generate_with_responses(
    *,
    client: Any,
    model: str,
    input_items: list[dict[str, Any]],
    reasoning_effort: str = "medium",
    previous_response_id: str | None = None,
    max_output_tokens: int | None = None,
) -> ResponsesGeneration:
    """Generate visible text with OpenAI Responses reasoning summaries enabled."""

    kwargs: dict[str, Any] = {
        "model": model,
        "input": input_items,
        "reasoning": {"effort": reasoning_effort, "summary": "auto"},
    }
    if previous_response_id:
        kwargs["previous_response_id"] = previous_response_id
    if max_output_tokens:
        kwargs["max_output_tokens"] = max_output_tokens

    response = await client.responses.create(**kwargs)
    usage = _get(response, "usage", {}) or {}
    if hasattr(usage, "model_dump"):
        usage = usage.model_dump()

    return ResponsesGeneration(
        text=extract_output_text(response),
        reasoning_summary=extract_reasoning_summary(response),
        response_id=str(_get(response, "id", "") or ""),
        usage=usage if isinstance(usage, dict) else {},
    )


def _get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _items(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return list(value) if isinstance(value, tuple) else []
