from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.core import llm as llm_module
from app.routers import chat
from app.schemas.chat import ClarificationRequest, ClarificationResponse


def test_partial_json_string_decodes_streamed_public_reasoning() -> None:
    partial = '{"public_reasoning":"已确认目标，正在核对\\n学习时长'
    text, complete = chat._partial_json_string(partial, "public_reasoning")
    assert text == "已确认目标，正在核对\n学习时长"
    assert complete is False

    text, complete = chat._partial_json_string(
        partial + '。","decision":"execute"}',
        "public_reasoning",
    )
    assert text == "已确认目标，正在核对\n学习时长。"
    assert complete is True


def test_explicit_answers_are_validated_before_becoming_inferred_facts() -> None:
    inferred: dict[str, object] = {}
    chat._merge_explicit_answers(
        inferred,
        {
            "baseline_level": "basic",
            "goal": "project",
            "days": 7,
            "daily_minutes": 999,
            "material_types": ["code", "unknown"],
            "preferred_examples": "图算法代码",
        },
        contract_keys={
            "baseline_level",
            "goal",
            "days",
            "daily_minutes",
            "material_types",
            "preferred_examples",
        },
    )
    assert inferred == {
        "baseline_level": "basic",
        "goal": "project",
        "days": 7,
        "material_types": ["code"],
        "preferred_examples": "图算法代码",
    }


def test_fallback_clarification_summary_reflects_known_and_missing_fields() -> None:
    questions = [
        SimpleNamespace(field="baseline_level"),
        SimpleNamespace(field="goal"),
    ]
    summary = chat._fallback_clarification_summary(
        ClarificationRequest(
            student_id="student_test",
            request="生成 3 天图论学习路径",
        ),
        {"days": 3, "daily_minutes": 40},
        questions,
    )

    assert "学习周期、每日投入" in summary
    assert "当前基础、学习目标" in summary


@pytest.mark.asyncio
async def test_separate_narrator_streams_model_authored_task_summary(monkeypatch) -> None:
    class FakeNarrator:
        async def astream(self, messages):
            assert "本轮用户回答" in messages[-1]["content"]
            yield SimpleNamespace(content="用户要生成图论学习路径，")
            yield SimpleNamespace(content="当前需要确认会影响规划的约束。")

    monkeypatch.setattr(llm_module, "build_llm", lambda **_kwargs: FakeNarrator())
    deltas: list[str] = []

    async def collect(text: str, reset: bool) -> None:
        assert reset is False
        deltas.append(text)

    summary = await chat._stream_public_task_summary(
        ClarificationRequest(
            student_id="student_test",
            request="生成图论学习路径",
        ),
        collect,
    )

    assert "".join(deltas) == summary
    assert summary == "用户要生成图论学习路径，当前需要确认会影响规划的约束。"


@pytest.mark.asyncio
async def test_clarification_sse_emits_reasoning_before_result(monkeypatch) -> None:
    async def fake_evaluate(req, db, *, on_reasoning_delta=None):
        assert req.phase == "confirmed"
        assert req.answers["goal"] == "project"
        assert on_reasoning_delta is not None
        await on_reasoning_delta("回答已经明确目标，", False)
        await on_reasoning_delta("可以进入规划。", False)
        return ClarificationResponse(
            summary="回答已经明确目标，可以进入规划。",
            inferred={"goal": "project"},
            decision="execute",
        )

    monkeypatch.setattr(chat, "_evaluate_clarification", fake_evaluate)
    request = ClarificationRequest(
        student_id="student_test",
        request="生成图论学习路径",
        phase="confirmed",
        answers={"goal": "project"},
    )

    chunks = [
        chunk
        async for chunk in chat._clarification_sse(request, object())
    ]
    event_names = [
        line.removeprefix("event: ")
        for chunk in chunks
        for line in chunk.splitlines()
        if line.startswith("event: ")
    ]
    assert event_names == ["reasoning_delta", "reasoning_delta", "result"]
    result_payload = json.loads(
        next(
            line.removeprefix("data: ")
            for line in chunks[-1].splitlines()
            if line.startswith("data: ")
        )
    )
    assert result_payload["decision"] == "execute"
