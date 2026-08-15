"""SSE 封装：dict → data: {json}\\n\\n；graph 流 → 事件适配。

Python 3.10 下 astream + get_stream_writer 不可用（contextvar 传播限制），
改用线程桥接：在工作线程跑同步 stream()，通过 Queue 桥接为异步迭代。
"""

from __future__ import annotations

import asyncio
import json
import threading
from concurrent.futures import (
    CancelledError as FutureCancelledError,
)
from typing import Any, AsyncIterator, Callable

from app.core.config import settings


def sse_format(event: str, data: dict[str, Any] | str) -> str:
    """将事件格式化为 SSE 文本。"""
    if isinstance(data, str):
        payload = data
    else:
        payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


async def astream_via_thread(
    graph,
    state,
    stream_mode="custom",
    config=None,
    *,
    stop_when: Callable[[Any], bool] | None = None,
    stop_grace_seconds: float = 1.0,
):
    """py3.10 下 astream + sync 节点的 get_stream_writer 不可用，
    改在工作线程跑同步 stream，桥接为异步迭代。"""
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue(maxsize=max(1, settings.SSE_QUEUE_MAXSIZE))
    _DONE = object()
    _ERR = object()
    stop_requested = threading.Event()
    pending_lock = threading.Lock()
    pending_put: list[Any | None] = [None]

    def _request_stop() -> None:
        stop_requested.set()
        with pending_lock:
            pending = pending_put[0]
        if pending is not None:
            pending.cancel()

    def _enqueue(item: Any) -> bool:
        """Apply backpressure without blocking the event-loop thread."""
        if stop_requested.is_set():
            return False
        try:
            pending = asyncio.run_coroutine_threadsafe(q.put(item), loop)
        except RuntimeError:
            return False
        with pending_lock:
            if stop_requested.is_set():
                pending.cancel()
                return False
            pending_put[0] = pending
        try:
            pending.result()
            return True
        except FutureCancelledError:
            return False
        finally:
            with pending_lock:
                if pending_put[0] is pending:
                    pending_put[0] = None

    def _produce():
        try:
            for chunk in graph.stream(state, config=config, stream_mode=stream_mode):
                if stop_requested.is_set() or not _enqueue(chunk):
                    break
        except Exception as e:
            if not stop_requested.is_set():
                _enqueue((_ERR, e))
        finally:
            if not stop_requested.is_set():
                _enqueue(_DONE)

    fut = loop.run_in_executor(None, _produce)
    terminal_stop = False
    try:
        while True:
            item = await q.get()
            if item is _DONE:
                break
            if isinstance(item, tuple) and len(item) == 2 and item[0] is _ERR:
                await fut
                raise item[1]
            should_stop = bool(stop_when and stop_when(item))
            yield item
            if should_stop:
                terminal_stop = True
                # The terminal item was already dequeued, so the producer's
                # current put can finish safely. Do not cancel that completed
                # hand-off in the narrow cross-thread race window.
                stop_requested.set()
                break
        if terminal_stop:
            try:
                await asyncio.wait_for(
                    asyncio.shield(fut),
                    timeout=max(0.01, stop_grace_seconds),
                )
            except asyncio.TimeoutError:
                # A synchronous graph can occasionally leave its iterator open
                # after emitting a fully terminal state.  The caller may now
                # persist that authoritative snapshot instead of leaving its
                # SSE request and durable record stuck forever.
                pass
        else:
            await fut
    except asyncio.CancelledError:
        # Keep the plan in its running state until the synchronous graph has
        # observed cancellation and closed. This prevents a retry from racing
        # the previous worker and producing duplicate resources/cost.
        _request_stop()
        if isinstance(state, dict):
            from app.core.run_control import request_run_cancel

            request_run_cancel(str(state.get("trace_run_id") or ""))
        try:
            await asyncio.wait_for(
                asyncio.shield(fut),
                timeout=max(0.01, settings.SSE_CANCEL_GRACE_SECONDS),
            )
        except asyncio.TimeoutError:
            pass
        raise
    finally:
        if not fut.done():
            if terminal_stop:
                stop_requested.set()
            else:
                _request_stop()


async def graph_to_sse(graph_app, state, config=None) -> AsyncIterator[str]:
    """执行图并将输出适配为 SSE 事件流（使用线程桥接兼容 py3.10）。"""
    try:
        async for chunk in astream_via_thread(graph_app, state, config=config):
            if isinstance(chunk, dict):
                event_type = chunk.get("event", "message")
                yield sse_format(event_type, chunk)
            elif isinstance(chunk, str):
                yield sse_format("message", {"text": chunk})
    except Exception as e:
        yield sse_format("error", {"message": f"生成失败：{str(e)[:200]}"})


def make_plan_event(topic: str, modules: list[str]) -> str:
    return sse_format("plan", {"topic": topic, "modules": modules})


def make_progress_event(agent: str, status: str, detail: str = "") -> str:
    return sse_format("progress", {"agent": agent, "status": status, "detail": detail})


def make_content_event(agent: str, content_type: str, data: Any) -> str:
    return sse_format("content", {"agent": agent, "type": content_type, "data": data})


def make_trace_event(payload: dict[str, Any]) -> str:
    return sse_format("trace", payload)


def make_done_event(summary: dict[str, Any] | None = None) -> str:
    return sse_format("done", summary or {})


def make_stage_event(stage: str, detail: str = "") -> str:
    return sse_format("stage", {"stage": stage, "detail": detail})


def make_exam_event(exam_data: dict[str, Any]) -> str:
    return sse_format("exam", exam_data)


def make_graded_event(results: dict[str, Any]) -> str:
    return sse_format("graded", results)


def make_report_event(report: dict[str, Any]) -> str:
    return sse_format("report", report)
