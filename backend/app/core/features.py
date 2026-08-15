"""Central feature registry exposed through the capability handshake."""

from __future__ import annotations

from typing import Literal, TypedDict

from app.core.responses_runner import provider_supports_responses_reasoning

FeatureStage = Literal[
    "under_development",
    "experimental",
    "stable",
    "deprecated",
    "removed",
]


class FeatureRecord(TypedDict):
    id: str
    display_name: str
    stage: FeatureStage
    enabled: bool
    available: bool
    unavailable_reason: str


def runtime_features(*, provider: str, model: str) -> list[FeatureRecord]:
    native_reasoning = provider_supports_responses_reasoning(provider, model)
    return [
        {
            "id": "agent_run_replay",
            "display_name": "智能体运行回放",
            "stage": "stable",
            "enabled": True,
            "available": True,
            "unavailable_reason": "",
        },
        {
            "id": "public_reasoning_stream",
            "display_name": "公开思考摘要流",
            "stage": "experimental",
            "enabled": True,
            "available": True,
            "unavailable_reason": (
                "" if native_reasoning else "当前模型将使用动态公开说明兼容模式"
            ),
        },
        {
            "id": "native_reasoning_summary",
            "display_name": "模型原生推理摘要",
            "stage": "experimental",
            "enabled": native_reasoning,
            "available": native_reasoning,
            "unavailable_reason": (
                "" if native_reasoning else "当前 Provider/模型不支持 Responses 推理摘要"
            ),
        },
        {
            "id": "tool_risk_policy",
            "display_name": "工具风险策略",
            "stage": "stable",
            "enabled": True,
            "available": True,
            "unavailable_reason": "",
        },
        {
            "id": "agent_trace_observability",
            "display_name": "Agent 结构化可观测性",
            "stage": "experimental",
            "enabled": True,
            "available": True,
            "unavailable_reason": "",
        },
    ]
