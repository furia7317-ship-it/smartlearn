"""Tests for public multi-agent trace SSE payloads."""

from __future__ import annotations

import json


def test_make_trace_payload_builds_public_trace_step() -> None:
    from app.core.agent_trace import make_trace_payload

    payload = make_trace_payload(
        run_id="run-1",
        agent="quiz",
        kind="generation",
        title="Generate quiz",
        status="running",
        detail="Build practice questions from chapter objectives",
        chapter_id="c1",
        source_count=3,
    )

    expected = {
        "run_id": "run-1",
        "agent": "quiz",
        "kind": "generation",
        "title": "Generate quiz",
        "status": "running",
        "detail": "Build practice questions from chapter objectives",
        "chapter_id": "c1",
        "source_count": 3,
    }
    for key, value in expected.items():
        assert payload[key] == value
    assert payload["narrative"]
    assert payload["activity"]
    assert payload["phase"] == "generation"
    assert payload["action"]
    assert payload["observation"]
    assert payload["decisionSummary"]
    assert payload["startedAt"]
    assert payload["endedAt"] is None
    assert payload["schema_version"] == "2.0"
    assert payload["event_type"] == "operation"
    assert payload["event_id"].startswith("evt_")
    assert payload["span_id"].startswith("span_")
    assert payload["sequence"] >= 1
    assert payload["agent_id"] == "quiz"
    assert payload["action_type"] == "generation"
    assert payload["ended_at"] is None
    assert "chainOfThought" not in payload


def test_make_trace_payload_accepts_codex_like_audit_fields() -> None:
    from app.core.agent_trace import make_trace_payload

    payload = make_trace_payload(
        run_id="run-1",
        step=2,
        agent="PlannerAgent",
        kind="plan",
        phase="planning",
        title="Plan material",
        status="completed",
        input_summary="student wants a beginner dynamic programming path",
        action="split the request into chapters",
        observation="planned 5 chapters",
        decision_summary="organize concepts before exercises",
        started_at="2026-07-08T10:00:00Z",
        ended_at="2026-07-08T10:00:03Z",
    )

    assert payload["step"] == 2
    assert payload["phase"] == "planning"
    assert payload["inputSummary"] == "student wants a beginner dynamic programming path"
    assert payload["action"] == "split the request into chapters"
    assert payload["observation"] == "planned 5 chapters"
    assert payload["decisionSummary"] == "organize concepts before exercises"
    assert payload["startedAt"] == "2026-07-08T10:00:00Z"
    assert payload["endedAt"] == "2026-07-08T10:00:03Z"
    assert "chainOfThought" not in payload


def test_make_trace_payload_exposes_public_process_copy() -> None:
    from app.core.agent_trace import make_trace_payload

    payload = make_trace_payload(
        run_id="run-1",
        agent="supervisor",
        kind="plan",
        title="Plan resources",
        status="completed",
        narrative="我会先把学习目标拆成章节，再决定哪些资源真正需要生成。",
        activity="已拆出 5 个章节，排入 10 个生成任务",
    )

    assert payload["narrative"] == "我会先把学习目标拆成章节，再决定哪些资源真正需要生成。"
    assert payload["activity"] == "已拆出 5 个章节，排入 10 个生成任务"


def test_make_trace_payload_adds_safe_fallback_process_copy() -> None:
    from app.core.agent_trace import make_trace_payload

    payload = make_trace_payload(
        run_id="run-1",
        agent="reviewer",
        kind="review",
        title="Review generated resources",
        status="running",
        detail="根据知识库上下文进行事实校验和反幻觉审核",
        source_count=4,
    )

    assert "narrative" in payload
    assert "activity" in payload
    assert "知识库" in payload["narrative"]
    assert payload["activity"]


def test_trace_event_wraps_payload_for_langgraph_writer() -> None:
    from app.core.agent_trace import trace_event

    event = trace_event(
        run_id="run-1",
        agent="reviewer",
        kind="review",
        title="Review resources",
        status="completed",
    )

    assert event["event"] == "trace"
    assert event["agent"] == "reviewer"
    assert event["kind"] == "review"
    assert event["status"] == "completed"


def test_phase_trace_event_has_one_stable_id_per_public_phase() -> None:
    from app.core.agent_trace import phase_trace_event

    running = phase_trace_event(
        run_id="plan-run",
        phase="review",
        status="running",
        detail="正在审核 10 份资料",
        progress=40,
    )
    completed = phase_trace_event(
        run_id="plan-run",
        phase="review",
        status="completed",
        detail="审核完成",
        progress=100,
    )

    assert running["id"] == completed["id"] == "plan-run:phase:review"
    assert running["event"] == "trace"
    assert running["phase"] == "review"
    assert running["progress"] == 40
    assert "chainOfThought" not in running


def test_make_trace_event_formats_sse() -> None:
    from app.core.sse import make_trace_event

    event_text = make_trace_event(
        {
            "run_id": "run-1",
            "agent": "planner",
            "kind": "schedule",
            "title": "Plan path",
            "status": "completed",
        }
    )

    assert event_text.startswith("event: trace\n")
    parsed = json.loads(event_text.split("data: ", 1)[1].split("\n", 1)[0])
    assert parsed["agent"] == "planner"
    assert parsed["kind"] == "schedule"


def test_repeated_same_name_tools_have_distinct_spans_and_monotonic_sequence() -> None:
    from app.core.agent_trace import (
        finish_trace_run,
        new_trace_span,
        root_span_id,
        start_trace_run,
        trace_event,
    )

    run_id = "run-tools-three"
    events = [start_trace_run(run_id, agent="tutor")]
    span_ids: list[str] = []
    for query in ("stack", "queue", "tree"):
        span_id = new_trace_span(run_id, prefix="tool")
        span_ids.append(span_id)
        events.append(
            trace_event(
                run_id=run_id,
                agent="tutor",
                kind="tool",
                title="search_knowledge_base",
                status="running",
                span_id=span_id,
                parent_span_id=root_span_id(run_id),
                input_summary=query,
            )
        )
        events.append(
            trace_event(
                run_id=run_id,
                agent="tutor",
                kind="tool",
                title="search_knowledge_base",
                status="completed",
                span_id=span_id,
                parent_span_id=root_span_id(run_id),
                observation="命中 1 条课程资料",
            )
        )
    events.extend(finish_trace_run(run_id, status="completed"))

    assert len(set(span_ids)) == 3
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    for span_id in span_ids:
        statuses = [event["status"] for event in events if event["span_id"] == span_id]
        assert statuses == ["running", "completed"]


def test_finish_trace_run_terminalizes_every_open_span() -> None:
    from app.core.agent_trace import (
        TERMINAL_STATUSES,
        finish_trace_run,
        new_trace_span,
        start_trace_run,
        trace_event,
    )

    run_id = "run-close-open-spans"
    start_trace_run(run_id)
    child_span = new_trace_span(run_id, prefix="review")
    trace_event(
        run_id=run_id,
        agent="reviewer",
        kind="review",
        title="事实审核",
        status="running",
        span_id=child_span,
    )

    closed = finish_trace_run(
        run_id,
        status="cancelled",
        observation="用户取消本次运行",
        error_code="cancelled_by_user",
        retryable=False,
    )

    assert {event["span_id"] for event in closed} >= {child_span}
    assert all(event["status"] in TERMINAL_STATUSES for event in closed)
    assert all(event["ended_at"] for event in closed)
    assert closed[-1]["parent_span_id"] is None


def test_new_run_does_not_inherit_sequence_or_open_spans() -> None:
    from app.core.agent_trace import finish_trace_run, start_trace_run

    first = start_trace_run("isolated-run-one", agent="quiz")
    finish_trace_run("isolated-run-one", status="failed")
    second = start_trace_run("isolated-run-two", agent="reviewer")
    terminal = finish_trace_run("isolated-run-two", status="completed")

    assert first["sequence"] == 1
    assert second["sequence"] == 1
    assert {event["agent_id"] for event in [second, *terminal]} == {"reviewer"}


def test_trace_summarizes_raw_json_and_redacts_sensitive_values() -> None:
    from app.core.agent_trace import make_trace_payload

    payload = make_trace_payload(
        run_id="redaction-run",
        agent="tutor",
        kind="tool",
        title="检索",
        status="completed",
        input_summary="authorization: Bearer very-secret-token",
        observation='{"api_key":"sk-should-not-leak","content":"private source body","count":3}',
        decision_summary="password=supersecret; keep only a public summary",
    )

    serialized = json.dumps(payload, ensure_ascii=False)
    assert "very-secret-token" not in serialized
    assert "sk-should-not-leak" not in serialized
    assert "supersecret" not in serialized
    assert "private source body" not in serialized
    assert "原始" not in payload["observation_summary"]
    assert "字段" in payload["observation_summary"]


def test_reasoning_event_exposes_only_sanitized_public_summary() -> None:
    from app.core.agent_trace import make_trace_payload
    from app.schemas.agent_run import AgentTraceEvent

    payload = make_trace_payload(
        run_id="reasoning-run",
        agent="tutor",
        kind="reasoning_summary",
        action_type="reasoning",
        title="核对课程依据",
        status="running",
        reasoning_delta="先检索课程资料。api_key=do-not-show",
        reasoning_source="provider_summary",
        segment_index=0,
    )
    validated = AgentTraceEvent.model_validate(payload)

    assert validated.event_type == "reasoning"
    assert validated.reasoning_source == "provider_summary"
    assert validated.reasoning_delta == "先检索课程资料。api_key=[REDACTED]"
    assert "do-not-show" not in json.dumps(payload, ensure_ascii=False)
