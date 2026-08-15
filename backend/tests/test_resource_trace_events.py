"""Regression tests for public, run-scoped agent trace instrumentation."""

from __future__ import annotations

from pathlib import Path


def test_planned_resource_runtime_emits_trace_events_for_major_stages() -> None:
    graph_source = Path("app/graph/planned_resource_graph.py").read_text(
        encoding="utf-8"
    )
    adapter_source = Path("app/services/planned_resource_pipeline.py").read_text(
        encoding="utf-8"
    )
    trace_source = Path("app/core/agent_trace.py").read_text(encoding="utf-8")
    source = graph_source + adapter_source

    for marker in (
        'kind="plan"',
        'kind="generation"',
        'kind="review"',
        'kind="integration"',
    ):
        assert marker in source

    assert "trace_event(" in source
    assert "phase_trace_event(" in graph_source
    assert '"event": "trace"' not in source
    assert "decisionSummary" in trace_source
    assert "chainOfThought" not in trace_source


def test_chat_runner_leaves_reasoning_and_tool_selection_to_the_model_loop() -> None:
    runner = Path("app/agent/runner.py").read_text(encoding="utf-8")
    harness = Path("app/agent/harness.py").read_text(encoding="utf-8")

    assert "start_trace_run(" in runner
    assert "finish_trace_run(" in runner
    assert "check_knowledge_gate" not in runner
    assert 'kind="retrieval"' not in runner
    assert 'kind="generation"' not in runner
    assert "trace_run_id" in runner
    assert "trace_run_id" in harness
    assert 'kind="reasoning_summary"' in harness
    assert 'kind="tool"' in harness


def test_resource_entry_uses_the_run_scoped_planned_adapter() -> None:
    state_source = Path("app/graph/state.py").read_text(encoding="utf-8")
    router_source = Path("app/routers/agents.py").read_text(encoding="utf-8")

    assert "trace_run_id" in state_source
    assert "stream_planned_resource_pipeline" in router_source
    assert "app.graph.resource_graph" not in router_source
    assert "planned_resource_app" not in router_source


def test_resource_graph_does_not_generate_a_posthoc_reasoning_summary() -> None:
    legacy_source = Path("app/graph/resource_graph.py").read_text(encoding="utf-8")
    adapter_source = Path("app/services/planned_resource_pipeline.py").read_text(
        encoding="utf-8"
    )

    assert "generate_public_reasoning_summary" not in legacy_source
    assert "planned_resource_app" in adapter_source
    assert "start_trace_run(" in adapter_source
    assert "finish_trace_run(" in adapter_source


def test_resource_generation_builds_outline_before_agent_fill() -> None:
    graph_source = Path("app/graph/planned_resource_graph.py").read_text(
        encoding="utf-8"
    )
    builder_source = Path("app/services/resource_plan_builder.py").read_text(
        encoding="utf-8"
    )
    common_source = Path("app/agents/common.py").read_text(encoding="utf-8")

    assert "PlanDraft" in builder_source
    assert "PlannedResourceTask" in builder_source
    assert '"resource_outline"' in graph_source
    assert "resource_outline" in common_source
