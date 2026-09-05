"""Agent harness —— 多轮工具调用循环（流式）。

参考 Hermes agent 的 `environments/agent_loop.py::HermesAgentLoop`：用标准 OpenAI
工具调用驱动模型——
  1. 带 tools= 调用模型；
  2. 若返回 tool_calls → 逐个派发执行，把结果以 role:"tool" 回灌对话，继续下一轮；
  3. 若没有 tool_calls → 这就是最终回答，结束。
并保留 Hermes 的 `<tool_call>` 文本兜底解析（模型未走原生 tool_calls 时）。

与 Hermes 不同点：这里每一轮用**流式**请求，正文 token 通过 `emit("delta")` 实时吐给
前端（保持答疑的逐字流式体验），同时累计流式分片里的 tool_calls。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.agent.tool_parsers import parse_hermes_tool_calls
from app.agent.tools import tool_policy
from app.core.agent_trace import (
    new_trace_span,
    root_span_id,
    trace_event,
    trace_span_id,
)
from app.core.config import settings
from app.core.responses_runner import provider_supports_responses_reasoning

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]
DispatchFn = Callable[..., Awaitable[str]]
CancelCheckFn = Callable[[], bool]
PUBLIC_REASONING_OPEN = "<public_reasoning>"
PUBLIC_REASONING_CLOSE = "</public_reasoning>"
PUBLIC_REASONING_RENDER_CHUNK_SIZE = 6
PUBLIC_REASONING_RENDER_INTERVAL_SECONDS = 0.04
EXTERNAL_INPUT_REASONING_REMINDER = """
你刚收到了一次新的外部输入。继续采取任何行动前，必须先输出一段基于这次新信息的公开判断摘要：
<public_reasoning>说明你如何理解这次输入、它是否改变当前判断，以及接下来选择什么行动</public_reasoning>
随后再调用工具、委派任务或输出面向学生的回答。不要重复上一段摘要，也不要输出隐藏思维链。
""".strip()

# 工具名 → 进度文案
_TOOL_LABELS = {
    "generate_learning_material": "生成学习资料",
    "search_knowledge_base": "检索知识库",
}


@dataclass
class AgentResult:
    """循环结果（对应 Hermes 的 AgentResult）。"""

    messages: list[dict[str, Any]]
    answer: str = ""
    turns_used: int = 0
    finished_naturally: bool = False
    tool_calls_made: list[str] = field(default_factory=list)


class AgentHarness:
    """OpenAI 规范的工具调用循环；逐轮流式。"""

    def __init__(
        self,
        client: Any,
        model: str,
        tool_schemas: list[dict[str, Any]],
        valid_tool_names: set[str],
        *,
        emit: EmitFn,
        dispatch: DispatchFn,
        student_id: str,
        provider_id: str = "",
        trace_run_id: str | None = None,
        max_turns: int = 6,
        temperature: float = 0.6,
        is_cancelled: CancelCheckFn | None = None,
    ) -> None:
        self.client = client
        self.model = model
        self.tool_schemas = tool_schemas
        self.valid_tool_names = valid_tool_names
        self.emit = emit
        self.dispatch = dispatch
        self.student_id = student_id
        self.provider_id = provider_id
        self.trace_run_id = trace_run_id or f"chat_{uuid.uuid4().hex[:12]}"
        self.max_turns = max_turns
        self.temperature = temperature
        self.is_cancelled = is_cancelled or (lambda: False)
        self.use_responses_reasoning = provider_supports_responses_reasoning(
            provider_id,
            model,
        )
        self._reasoning_buffers: dict[str, str] = {}
        self._reasoning_emitted_lengths: dict[str, int] = {}
        self._public_reasoning_turns: set[int] = set()

    def _check_cancelled(self) -> None:
        if self.is_cancelled():
            raise asyncio.CancelledError("agent run cancelled before starting a new action")

    async def _emit_trace(self, **kwargs: Any) -> None:
        payload = trace_event(run_id=self.trace_run_id, **kwargs)
        payload.pop("event", None)
        await self.emit("trace", payload)

    async def run(self, messages: list[dict[str, Any]]) -> AgentResult:
        """执行多轮循环。messages 会被就地追加。"""
        tool_calls_made: list[str] = []
        last_content = ""
        previous_response_id: str | None = None
        response_input: list[dict[str, Any]] = list(messages)

        for turn in range(self.max_turns):
            self._check_cancelled()
            if self.use_responses_reasoning:
                try:
                    content, tool_calls, response_id = await self._stream_responses_turn(
                        response_input,
                        previous_response_id=previous_response_id,
                        turn=turn,
                    )
                    previous_response_id = response_id or previous_response_id
                except Exception as exc:  # noqa: BLE001
                    if turn != 0 or not _responses_api_unavailable(exc):
                        raise
                    logger.info("Responses API unavailable; using compatible chat loop: %s", exc)
                    self.use_responses_reasoning = False
                    content, tool_calls = await self._stream_turn(messages, turn=turn)
            else:
                content, tool_calls = await self._stream_turn(messages, turn=turn)
            last_content = content

            # 兜底：模型把调用写进了正文 <tool_call>…</tool_call>
            if not tool_calls and content and "<tool_call>" in content:
                parsed_content, parsed = parse_hermes_tool_calls(content)
                if parsed:
                    tool_calls = parsed
                    content = parsed_content or ""

            if not tool_calls:
                # 没有工具调用 = 最终回答（正文已在 _stream_turn 里流式吐出）
                messages.append({"role": "assistant", "content": content})
                await self.emit("content", {"agent": "tutor", "type": "answer", "data": content})
                return AgentResult(
                    messages=messages,
                    answer=content,
                    turns_used=turn + 1,
                    finished_naturally=True,
                    tool_calls_made=tool_calls_made,
                )

            if turn not in self._public_reasoning_turns:
                await self._emit_model_narration(content, tool_calls, turn=turn)
            if content:
                # Providers may put a public action note in visible output
                # before a tool call. It has already streamed briefly; move it
                # into the timeline before any tool side effect begins.
                await self.emit("answer_reset", {"agent": "tutor"})

            # 有工具调用：先把 assistant（含 tool_calls）入历史
            messages.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": [_to_openai_tc(tc) for tc in tool_calls],
                }
            )

            # 逐个执行工具，结果以 role:"tool" 回灌
            response_outputs: list[dict[str, Any]] = []
            for tc in tool_calls:
                self._check_cancelled()
                name = tc["name"]
                raw_args = tc["arguments"]
                label = _TOOL_LABELS.get(name, name)
                tool_calls_made.append(name)
                tool_span_id = new_trace_span(self.trace_run_id, prefix="tool")
                await self._emit_trace(
                    agent="tutor",
                    kind="tool",
                    phase="tool",
                    title=label,
                    status="running",
                    input_summary=name,
                    action=f"调用工具 {name}",
                    observation="已收到模型工具调用请求",
                    decision_summary="工具调用只记录输入摘要、动作和结果，不展示模型私有推理。",
                    span_id=tool_span_id,
                    parent_span_id=root_span_id(self.trace_run_id),
                    task_id=str(tc.get("id") or ""),
                    attempt=turn + 1,
                    action_type="tool_call",
                    tool_policy=tool_policy(name),
                )
                await self.emit(
                    "progress",
                    {"agent": "tool", "status": "started", "detail": label},
                )

                if name not in self.valid_tool_names:
                    result = json.dumps(
                        {"error": f"未知工具 '{name}'，可用：{sorted(self.valid_tool_names)}"},
                        ensure_ascii=False,
                    )
                else:
                    try:
                        parsed_args = json.loads(raw_args) if raw_args else {}
                    except json.JSONDecodeError as e:
                        parsed_args = None
                        result = json.dumps(
                            {"error": f"工具参数 JSON 无效：{e}，请用合法 JSON 重试"},
                            ensure_ascii=False,
                        )

                    if parsed_args is not None:
                        try:
                            self._check_cancelled()
                            result = await self.dispatch(
                                name,
                                parsed_args,
                                student_id=self.student_id,
                                emit=self.emit,
                                run_id=self.trace_run_id,
                                parent_span_id=tool_span_id,
                            )
                        except Exception as e:  # noqa: BLE001 —— 工具异常不应中断循环
                            logger.exception("工具 %s 执行失败", name)
                            result = json.dumps(
                                {"error": f"工具执行失败：{type(e).__name__}: {e}"},
                                ensure_ascii=False,
                            )

                status = "failed" if _tool_result_failed(result) else "completed"
                await self._emit_trace(
                    agent="tutor",
                    kind="tool",
                    phase="tool",
                    title=label,
                    status=status,
                    input_summary=name,
                    action=f"完成工具 {name}",
                    # Pass the complete tool envelope to the trace sanitizer.
                    # Truncating JSON first can make it invalid and bypass the
                    # structured-summary path, leaking a raw data prefix.
                    observation=result,
                    decision_summary=(
                        "工具返回异常，结果已写回对话供模型修正。"
                        if status == "failed"
                        else "工具结果已写回对话，下一轮回答会基于该结果继续组织。"
                    ),
                    span_id=tool_span_id,
                    parent_span_id=root_span_id(self.trace_run_id),
                    task_id=str(tc.get("id") or ""),
                    attempt=turn + 1,
                    action_type="tool_call",
                    error_code="tool_execution_failed" if status == "failed" else None,
                    retryable=status == "failed",
                    tool_policy=tool_policy(name),
                )
                messages.append(
                    {"role": "tool", "tool_call_id": tc["id"], "content": result}
                )
                response_outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": tc["id"],
                        "output": result,
                    }
                )

            # 继续下一轮：让模型基于工具结果作答或继续调用
            if self.use_responses_reasoning:
                response_input = response_outputs
            else:
                # 工具/子流程返回属于一次新的外部输入。部分兼容服务只
                # 遵守首轮协议，因此在该输入边界后再次明确提醒。
                messages.append(
                    {
                        "role": "system",
                        "content": EXTERNAL_INPUT_REASONING_REMINDER,
                    }
                )

        # 达到最大轮次仍未自然结束
        logger.info("agent 达到最大轮次 %d 仍未结束", self.max_turns)
        fallback = last_content or "（已达到最大工具调用轮次，请补充说明或重试。）"
        await self.emit("content", {"agent": "tutor", "type": "answer", "data": fallback})
        return AgentResult(
            messages=messages,
            answer=fallback,
            turns_used=self.max_turns,
            finished_naturally=False,
            tool_calls_made=tool_calls_made,
        )

    async def _stream_turn(
        self,
        messages: list[dict[str, Any]],
        *,
        turn: int = 0,
    ) -> tuple[str, list[dict]]:
        """单轮流式请求：实时吐正文 delta，并累计流式分片中的 tool_calls。

        Returns (content, tool_calls)，tool_calls 为 [{id, name, arguments(str)}]。
        """
        self._check_cancelled()
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "stream": True,
            "max_tokens": settings.CHAT_RESPONSE_TOKEN_RESERVE,
        }
        if self.tool_schemas:
            kwargs["tools"] = self.tool_schemas
        if self.provider_id == "mimo":
            # MiMo thinking output must be replayed on later tool turns. The harness
            # intentionally does not retain private reasoning, so disable it and keep
            # the tool loop stateless and protocol-compliant.
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

        stream = await self.client.chat.completions.create(**kwargs)

        raw_content = ""
        content = ""
        prefix_buffer = ""
        reasoning_streamed_length = 0
        public_reasoning_complete = False
        suppress_delta = False  # 一旦正文里出现 <tool_call> 就停止外吐，交给兜底解析
        acc: dict[int, dict] = {}

        async for chunk in stream:
            self._check_cancelled()
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            text = getattr(delta, "content", None)
            if text:
                raw_content += text
                if "<tool_call>" in raw_content:
                    suppress_delta = True
                if public_reasoning_complete:
                    content += text
                    if not suppress_delta:
                        await self.emit("delta", {"agent": "tutor", "text": text})
                else:
                    prefix_buffer += text
                    stripped = prefix_buffer.lstrip()
                    if stripped.startswith(PUBLIC_REASONING_OPEN):
                        close_index = stripped.find(PUBLIC_REASONING_CLOSE)
                        if close_index >= 0:
                            reasoning_raw = stripped[
                                len(PUBLIC_REASONING_OPEN):close_index
                            ]
                            if len(reasoning_raw) > reasoning_streamed_length:
                                await self._emit_reasoning_delta(
                                    f"compat:{turn}",
                                    reasoning_raw[reasoning_streamed_length:],
                                    turn=turn,
                                    segment_index=0,
                                    source="model_narration",
                                )
                                reasoning_streamed_length = len(reasoning_raw)
                            reasoning = reasoning_raw.strip()
                            visible = stripped[
                                close_index + len(PUBLIC_REASONING_CLOSE):
                            ]
                            public_reasoning_complete = True
                            self._public_reasoning_turns.add(turn)
                            if reasoning:
                                await self._complete_reasoning(
                                    f"compat:{turn}",
                                    text=reasoning,
                                    turn=turn,
                                    segment_index=0,
                                    source="model_narration",
                                )
                            if visible:
                                content += visible
                                if not suppress_delta:
                                    await self.emit(
                                        "delta",
                                        {"agent": "tutor", "text": visible},
                                    )
                        else:
                            reasoning_raw = stripped[len(PUBLIC_REASONING_OPEN):]
                            safe_reasoning = _without_partial_closing_tag(
                                reasoning_raw,
                                PUBLIC_REASONING_CLOSE,
                            )
                            if len(safe_reasoning) > reasoning_streamed_length:
                                await self._emit_reasoning_delta(
                                    f"compat:{turn}",
                                    safe_reasoning[reasoning_streamed_length:],
                                    turn=turn,
                                    segment_index=0,
                                    source="model_narration",
                                )
                                reasoning_streamed_length = len(safe_reasoning)
                    elif not PUBLIC_REASONING_OPEN.startswith(stripped):
                        # The provider ignored the optional envelope. Preserve
                        # normal streaming. First make sure the newly received
                        # external input has a public judgment event.
                        await self._ensure_external_input_reasoning(
                            messages,
                            turn=turn,
                        )
                        public_reasoning_complete = True
                        content += prefix_buffer
                        if not suppress_delta:
                            await self.emit(
                                "delta",
                                {"agent": "tutor", "text": prefix_buffer},
                            )
                    elif len(prefix_buffer) > len(PUBLIC_REASONING_OPEN) + 12_000:
                        public_reasoning_complete = True
                        content += prefix_buffer
                        if not suppress_delta:
                            await self.emit(
                                "delta",
                                {"agent": "tutor", "text": prefix_buffer},
                            )

            for tc in getattr(delta, "tool_calls", None) or []:
                idx = getattr(tc, "index", 0) or 0
                slot = acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if getattr(tc, "id", None):
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn:
                    if getattr(fn, "name", None):
                        slot["name"] = fn.name
                    if getattr(fn, "arguments", None):
                        slot["arguments"] += fn.arguments

        self._check_cancelled()
        if not public_reasoning_complete and prefix_buffer:
            # Incomplete/malformed envelopes remain visible rather than being
            # silently discarded.
            content += prefix_buffer
            if not suppress_delta:
                await self.emit("delta", {"agent": "tutor", "text": prefix_buffer})
        tool_calls = [acc[i] for i in sorted(acc) if acc[i].get("name")]
        for c in tool_calls:
            if not c["id"]:
                c["id"] = f"call_{uuid.uuid4().hex[:8]}"

        return content, tool_calls

    async def _stream_responses_turn(
        self,
        input_items: list[dict[str, Any]],
        *,
        previous_response_id: str | None,
        turn: int,
    ) -> tuple[str, list[dict], str]:
        """Stream OpenAI public reasoning summaries and first-class tool items."""

        kwargs: dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "reasoning": {"effort": "medium", "summary": "auto"},
            "max_output_tokens": settings.CHAT_RESPONSE_TOKEN_RESERVE,
            "parallel_tool_calls": True,
        }
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        if self.tool_schemas:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "name": str(schema["function"]["name"]),
                    "description": str(schema["function"].get("description") or ""),
                    "parameters": schema["function"].get("parameters") or {
                        "type": "object",
                        "properties": {},
                    },
                }
                for schema in self.tool_schemas
            ]

        content = ""
        tool_calls: list[dict[str, str]] = []
        response_id = ""
        open_reasoning: set[str] = set()

        async with self.client.responses.stream(**kwargs) as stream:
            async for event in stream:
                self._check_cancelled()
                event_type = str(getattr(event, "type", "") or "")
                if event_type == "response.reasoning_summary_text.delta":
                    item_id = str(getattr(event, "item_id", "") or f"turn-{turn}")
                    summary_index = int(getattr(event, "summary_index", 0) or 0)
                    key = f"{turn}:{item_id}:{summary_index}"
                    open_reasoning.add(key)
                    await self._emit_reasoning_delta(
                        key,
                        str(getattr(event, "delta", "") or ""),
                        turn=turn,
                        segment_index=summary_index,
                        source="provider_summary",
                    )
                elif event_type == "response.reasoning_summary_text.done":
                    item_id = str(getattr(event, "item_id", "") or f"turn-{turn}")
                    summary_index = int(getattr(event, "summary_index", 0) or 0)
                    key = f"{turn}:{item_id}:{summary_index}"
                    await self._complete_reasoning(
                        key,
                        text=str(getattr(event, "text", "") or ""),
                        turn=turn,
                        segment_index=summary_index,
                        source="provider_summary",
                    )
                    open_reasoning.discard(key)
                elif event_type == "response.output_text.delta":
                    text = str(getattr(event, "delta", "") or "")
                    if text:
                        await self._ensure_external_input_reasoning(
                            input_items,
                            turn=turn,
                        )
                        content += text
                        await self.emit("delta", {"agent": "tutor", "text": text})
                elif event_type == "response.output_item.done":
                    item = getattr(event, "item", None)
                    if str(getattr(item, "type", "") or "") == "function_call":
                        tool_calls.append(
                            {
                                "id": str(
                                    getattr(item, "call_id", "")
                                    or getattr(item, "id", "")
                                    or f"call_{uuid.uuid4().hex[:8]}"
                                ),
                                "name": str(getattr(item, "name", "") or ""),
                                "arguments": str(getattr(item, "arguments", "") or "{}"),
                            }
                        )
                elif event_type == "response.completed":
                    response = getattr(event, "response", None)
                    response_id = str(getattr(response, "id", "") or "")

        for key in list(open_reasoning):
            _, _, raw_index = key.rpartition(":")
            await self._complete_reasoning(
                key,
                turn=turn,
                segment_index=int(raw_index or 0),
                source="provider_summary",
            )
        return content, [call for call in tool_calls if call.get("name")], response_id

    async def _emit_reasoning_delta(
        self,
        key: str,
        delta: str,
        *,
        turn: int,
        segment_index: int,
        source: str,
        flush: bool = False,
    ) -> None:
        if not delta and key not in self._reasoning_buffers:
            return
        self._public_reasoning_turns.add(turn)
        text = f"{self._reasoning_buffers.get(key, '')}{delta}"
        self._reasoning_buffers[key] = text[:12000]
        emitted_length = self._reasoning_emitted_lengths.get(key, 0)
        pending = text[emitted_length:]
        if (
            not flush
            and len(pending) < PUBLIC_REASONING_RENDER_CHUNK_SIZE
            and not pending.endswith(("。", "！", "？", "；", "\n"))
        ):
            return
        span_id = trace_span_id(self.trace_run_id, f"reasoning:{key}")
        emit_length = len(pending) if flush or pending.endswith(
            ("。", "！", "？", "；", "\n")
        ) else (
            len(pending)
            - len(pending) % PUBLIC_REASONING_RENDER_CHUNK_SIZE
        )
        emitted_from_pending = 0
        while emitted_from_pending < emit_length:
            piece = pending[
                emitted_from_pending:
                min(
                    emitted_from_pending + PUBLIC_REASONING_RENDER_CHUNK_SIZE,
                    emit_length,
                )
            ]
            emitted_from_pending += len(piece)
            current_length = emitted_length + emitted_from_pending
            self._reasoning_emitted_lengths[key] = current_length
            visible_text = text[:current_length]
            await self._emit_trace(
                agent="tutor",
                kind="reasoning_summary",
                event_type="reasoning",
                phase="reasoning",
                title=_reasoning_title(visible_text),
                status="running",
                action_type="reasoning",
                decision_summary=visible_text[-500:],
                reasoning_delta=piece,
                reasoning_source=source,
                segment_index=segment_index,
                span_id=span_id,
                parent_span_id=root_span_id(self.trace_run_id),
                attempt=turn + 1,
                visibility="normal",
            )
            if emitted_from_pending < emit_length:
                await asyncio.sleep(PUBLIC_REASONING_RENDER_INTERVAL_SECONDS)

    async def _complete_reasoning(
        self,
        key: str,
        *,
        text: str = "",
        turn: int,
        segment_index: int,
        source: str,
    ) -> None:
        buffered = self._reasoning_buffers.get(key, "")
        if text and text.startswith(buffered):
            await self._emit_reasoning_delta(
                key,
                text[len(buffered):],
                turn=turn,
                segment_index=segment_index,
                source=source,
                flush=True,
            )
        elif buffered:
            await self._emit_reasoning_delta(
                key,
                "",
                turn=turn,
                segment_index=segment_index,
                source=source,
                flush=True,
            )
        complete = (text or self._reasoning_buffers.get(key, "")).strip()
        self._reasoning_buffers.pop(key, None)
        self._reasoning_emitted_lengths.pop(key, None)
        if not complete:
            return
        self._public_reasoning_turns.add(turn)
        await self._emit_trace(
            agent="tutor",
            kind="reasoning_summary",
            event_type="reasoning",
            phase="reasoning",
            title=_reasoning_title(complete),
            status="completed",
            action_type="reasoning",
            decision_summary=complete[-500:],
            reasoning_text=complete,
            reasoning_source=source,
            segment_index=segment_index,
            span_id=trace_span_id(self.trace_run_id, f"reasoning:{key}"),
            parent_span_id=root_span_id(self.trace_run_id),
            attempt=turn + 1,
            visibility="normal",
        )

    async def _emit_model_narration(
        self,
        content: str,
        tool_calls: list[dict[str, Any]],
        *,
        turn: int,
    ) -> None:
        narration = content.strip()
        if not narration:
            narration = _tool_decision_narrative(tool_calls)
        if not narration:
            return
        key = f"narration:{turn}:{uuid.uuid4().hex[:8]}"
        await self._stream_reasoning_fallback(
            key,
            text=narration,
            turn=turn,
            segment_index=0,
            source="model_narration",
        )

    async def _ensure_external_input_reasoning(
        self,
        input_items: list[dict[str, Any]],
        *,
        turn: int,
    ) -> None:
        """Guarantee one public judgment after each new external input."""

        if turn in self._public_reasoning_turns:
            return
        narration = _external_input_narrative(input_items)
        if not narration:
            return
        key = f"external-input:{turn}"
        await self._stream_reasoning_fallback(
            key,
            text=narration,
            turn=turn,
            segment_index=0,
            source="runtime",
        )

    async def _stream_reasoning_fallback(
        self,
        key: str,
        *,
        text: str,
        turn: int,
        segment_index: int,
        source: str,
    ) -> None:
        """Stream a public fallback when the provider omitted its own summary."""

        await self._emit_reasoning_delta(
            key,
            text,
            turn=turn,
            segment_index=segment_index,
            source=source,
            flush=True,
        )
        await self._complete_reasoning(
            key,
            text=text,
            turn=turn,
            segment_index=segment_index,
            source=source,
        )


def _to_openai_tc(tc: dict) -> dict:
    """内部 dict → OpenAI assistant.tool_calls 项。"""
    return {
        "id": tc["id"],
        "type": "function",
        "function": {"name": tc["name"], "arguments": tc.get("arguments") or "{}"},
    }


def _tool_result_failed(result: str) -> bool:
    """Read the tool result contract instead of substring-matching arbitrary text."""

    try:
        payload = json.loads(result)
    except (TypeError, ValueError, json.JSONDecodeError):
        return False
    return isinstance(payload, dict) and bool(payload.get("error"))


def _without_partial_closing_tag(text: str, closing_tag: str) -> str:
    """Hold back a streamed suffix that may be the beginning of a closing tag."""

    max_prefix = min(len(text), len(closing_tag) - 1)
    for size in range(max_prefix, 0, -1):
        if text.endswith(closing_tag[:size]):
            return text[:-size]
    return text


def _reasoning_title(text: str) -> str:
    compact = " ".join(text.replace("**", "").split())
    if not compact:
        return "正在思考"
    sentence = compact
    for separator in ("。", "！", "？", "\n"):
        if separator in sentence:
            sentence = sentence.split(separator, 1)[0]
            break
    return sentence[:42] + ("…" if len(sentence) > 42 else "")


def _tool_decision_narrative(tool_calls: list[dict[str, Any]]) -> str:
    if not tool_calls:
        return ""
    first = tool_calls[0]
    name = str(first.get("name") or "")
    try:
        arguments = json.loads(str(first.get("arguments") or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        arguments = {}
    if name == "search_knowledge_base":
        query = str(arguments.get("query") or "").strip()
        return (
            f"这个问题需要课程内的可靠依据。我先检索“{query[:80]}”，"
            "再根据实际命中的内容继续判断。"
        )
    if name == "generate_learning_material":
        topic = str(arguments.get("topic") or "").strip()
        return (
            f"当前需求需要产出可直接学习的资料。我准备围绕“{topic[:80]}”"
            "启动生成与质检流程，再根据审核结果组织回复。"
        )
    return f"现有信息还不足以可靠回答，我准备调用 {name or '必要工具'} 获取证据后继续。"


def _external_input_narrative(input_items: list[dict[str, Any]]) -> str:
    """Build a truthful fallback summary from the latest external input."""

    for item in reversed(input_items):
        source_label = "外部能力"
        if item.get("role") == "tool":
            raw_result = item.get("content")
            source_label = "工具"
        elif item.get("type") == "function_call_output":
            raw_result = item.get("output")
            source_label = "工具"
        elif item.get("type") in {"subagent_result", "delegate_result"}:
            raw_result = item.get("output") or item.get("content")
            source_label = "子智能体"
        elif item.get("type") == "runtime_result":
            raw_result = item.get("output") or item.get("content")
            source_label = "运行时"
        elif item.get("role") == "user":
            raw_user = item.get("content")
            if isinstance(raw_user, str):
                compact = " ".join(raw_user.split())
            elif isinstance(raw_user, list):
                compact = " ".join(
                    str(part.get("text") or "").strip()
                    for part in raw_user
                    if isinstance(part, dict) and part.get("type") == "text"
                ).strip()
            else:
                compact = ""
            if compact:
                return (
                    f"当前收到的问题聚焦于“{compact[:100]}”。"
                    "我会先判断所需证据和回答范围，再选择直接解释或调用合适的能力。"
                )
            continue
        else:
            continue

        try:
            payload = json.loads(str(raw_result or ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            payload = None

        if isinstance(payload, dict):
            if payload.get("error"):
                return (
                    f"{source_label}返回了异常信息，现有证据不足以直接下结论。"
                    "我会在最终回答中说明限制，并给出可继续验证的方向。"
                )
            query = str(payload.get("query") or "").strip()
            count = payload.get("count")
            snippets = payload.get("snippets")
            if not isinstance(count, int) and isinstance(snippets, list):
                count = len(snippets)
            if query and isinstance(count, int):
                return (
                    f"知识库已返回“{query[:80]}”的 {count} 条相关内容。"
                    "这些证据足以支撑回答，我会据此提炼核心定义、关键性质和例子。"
                )
            keys = [
                str(key)
                for key in payload.keys()
                if str(key) not in {"error", "status"}
            ][:4]
            if keys:
                return (
                    f"{source_label}已返回可用的结构化结果，关键信息包括"
                    f"{'、'.join(keys)}。我会筛选与问题直接相关的证据，再组织最终回答。"
                )
        return "新的外部结果已经返回。我会核对其中与问题直接相关的信息，再据此选择下一步行动。"
    return ""


def _responses_api_unavailable(exc: Exception) -> bool:
    detail = str(exc).lower()
    return any(
        marker in detail
        for marker in (
            "404",
            "not found",
            "unsupported parameter",
            "unknown url",
            "responses is not",
        )
    )
