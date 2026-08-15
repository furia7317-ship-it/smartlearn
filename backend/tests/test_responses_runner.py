"""Tests for the optional OpenAI Responses API adapter."""

from __future__ import annotations


def test_provider_supports_responses_reasoning_only_for_openai_reasoning_models() -> None:
    from app.core.responses_runner import provider_supports_responses_reasoning

    assert provider_supports_responses_reasoning("openai", "gpt-5.5") is True
    assert provider_supports_responses_reasoning("openai", "gpt-5.4-mini") is True
    assert provider_supports_responses_reasoning("openai", "o4-mini") is True
    assert provider_supports_responses_reasoning("deepseek", "deepseek-chat") is False
    assert provider_supports_responses_reasoning("openai", "gpt-4o-mini") is False


def test_extract_reasoning_summary_reads_public_summary_items() -> None:
    from app.core.responses_runner import extract_output_text, extract_reasoning_summary

    response = {
        "output": [
            {
                "type": "reasoning",
                "summary": [
                    {"type": "summary_text", "text": "First classify the request."},
                    {"type": "summary_text", "text": "Then generate chapter resources."},
                ],
            },
            {
                "type": "message",
                "content": [{"type": "output_text", "text": '{"title":"Result"}'}],
            },
        ]
    }

    assert extract_reasoning_summary(response) == (
        "First classify the request.\nThen generate chapter resources."
    )
    assert extract_output_text(response) == '{"title":"Result"}'


def test_extractors_accept_sdk_like_objects() -> None:
    from types import SimpleNamespace

    from app.core.responses_runner import extract_output_text, extract_reasoning_summary

    response = SimpleNamespace(
        output=[
            SimpleNamespace(
                type="reasoning",
                summary=[SimpleNamespace(type="summary_text", text="Public summary")],
            ),
            SimpleNamespace(
                type="message",
                content=[SimpleNamespace(type="output_text", text="Visible answer")],
            ),
        ],
        output_text="Visible answer",
    )

    assert extract_reasoning_summary(response) == "Public summary"
    assert extract_output_text(response) == "Visible answer"


def test_generation_dataclass_keeps_provider_state_private() -> None:
    from app.core.responses_runner import ResponsesGeneration

    generation = ResponsesGeneration(
        text="{}",
        reasoning_summary="Public summary",
        response_id="resp_123",
        usage={"output_tokens": 10},
    )

    assert generation.text == "{}"
    assert generation.reasoning_summary == "Public summary"
    assert generation.response_id == "resp_123"
    assert generation.usage == {"output_tokens": 10}
