"""Cooperative cancellation for synchronous graph workers.

The graph executes in a worker thread, so cancelling the async SSE consumer
cannot interrupt an in-flight provider request. These checkpoints guarantee
that cancellation prevents every *subsequent* model call, retry wait, review,
and persistence action.
"""

from __future__ import annotations

import threading


class RunCancelled(RuntimeError):
    """Raised at a safe checkpoint after cancellation was requested."""


class RunBudgetExceeded(RuntimeError):
    """Raised before a new model call would exceed the run-scoped budget."""

    retryable = False

    def __init__(
        self,
        message: str,
        *,
        error_code: str = "run_budget_exhausted",
    ) -> None:
        super().__init__(message)
        self.error_code = error_code


_RUN_EVENTS: dict[str, threading.Event] = {}
_ACK_EVENTS: dict[str, threading.Event] = {}
_RUN_CHILDREN: dict[str, set[str]] = {}
_RUN_PARENT: dict[str, str] = {}
_RUN_MODEL_CALL_LIMITS: dict[str, int] = {}
_RUN_MODEL_CALLS_USED: dict[str, int] = {}
_RUN_OWNERS: dict[str, str] = {}
_LOCK = threading.RLock()


def register_run(
    run_id: str,
    *,
    parent_run_id: str | None = None,
    model_call_limit: int | None = None,
    owner_id: str | None = None,
) -> None:
    """Register a run and, when applicable, link it to its caller.

    Resource generation launched from a chat tool has its own trace/run ID, but
    cancelling the chat must also stop every subsequent child-plan model call.
    The relationship stays process-local just like the cooperative cancel
    events themselves and is removed at the child lifecycle boundary.
    """

    with _LOCK:
        is_new = run_id not in _RUN_EVENTS
        _RUN_EVENTS.setdefault(run_id, threading.Event())
        _ACK_EVENTS.setdefault(run_id, threading.Event())
        if is_new:
            _RUN_MODEL_CALLS_USED[run_id] = 0
        if model_call_limit is not None:
            normalized_limit = max(0, int(model_call_limit))
            existing_limit = _RUN_MODEL_CALL_LIMITS.get(run_id)
            _RUN_MODEL_CALL_LIMITS[run_id] = (
                normalized_limit
                if existing_limit is None
                else min(existing_limit, normalized_limit)
            )
        old_parent = _RUN_PARENT.pop(run_id, None)
        if old_parent:
            _RUN_CHILDREN.get(old_parent, set()).discard(run_id)
        if parent_run_id and parent_run_id != run_id:
            _RUN_PARENT[run_id] = parent_run_id
            _RUN_CHILDREN.setdefault(parent_run_id, set()).add(run_id)
            parent_event = _RUN_EVENTS.get(parent_run_id)
            if parent_event is not None and parent_event.is_set():
                _RUN_EVENTS[run_id].set()
            if owner_id is None:
                owner_id = _RUN_OWNERS.get(parent_run_id)
        normalized_owner = str(owner_id or "").strip()
        existing_owner = _RUN_OWNERS.get(run_id)
        if existing_owner and normalized_owner and existing_owner != normalized_owner:
            raise ValueError(f"run {run_id} is already owned by another account")
        if normalized_owner:
            _RUN_OWNERS[run_id] = normalized_owner


def request_run_cancel(run_id: str) -> None:
    if not run_id:
        return
    with _LOCK:
        event = _RUN_EVENTS.setdefault(run_id, threading.Event())
        event.set()
        descendants: list[str] = list(_RUN_CHILDREN.get(run_id, set()))
        while descendants:
            child_id = descendants.pop()
            _RUN_EVENTS.setdefault(child_id, threading.Event()).set()
            descendants.extend(_RUN_CHILDREN.get(child_id, set()))


def run_is_registered(run_id: str) -> bool:
    with _LOCK:
        return run_id in _RUN_EVENTS


def run_owner(run_id: str) -> str:
    with _LOCK:
        return str(_RUN_OWNERS.get(run_id) or "")


def acknowledge_run_cancel(run_id: str) -> None:
    with _LOCK:
        event = _ACK_EVENTS.setdefault(run_id, threading.Event())
        event.set()


def wait_for_cancel_ack(run_id: str, timeout: float = 2.0) -> bool:
    with _LOCK:
        event = _ACK_EVENTS.get(run_id)
    return bool(event and event.wait(timeout=max(0.0, timeout)))


def is_run_cancelled(run_id: str) -> bool:
    with _LOCK:
        event = _RUN_EVENTS.get(run_id)
    return bool(event and event.is_set())


def cancellation_checkpoint(run_id: str) -> None:
    if is_run_cancelled(run_id):
        raise RunCancelled(f"run {run_id} was cancelled")


def reserve_model_calls(run_id: str, count: int = 1) -> int:
    """Atomically reserve real provider calls before they are created.

    Runs without a registered limit remain backwards-compatible. Production
    planned-resource runs always register a finite limit at their lifecycle
    boundary, so parallel task workers cannot race past the shared budget.
    """

    requested = max(0, int(count))
    with _LOCK:
        event = _RUN_EVENTS.get(run_id)
        if event is not None and event.is_set():
            raise RunCancelled(f"run {run_id} was cancelled")
        limit = _RUN_MODEL_CALL_LIMITS.get(run_id)
        used = int(_RUN_MODEL_CALLS_USED.get(run_id, 0))
        if limit is None or requested == 0:
            return used
        if used + requested > limit:
            raise RunBudgetExceeded(
                f"run {run_id} model-call budget exhausted ({used}/{limit})",
                error_code="model_call_budget_exhausted",
            )
        used += requested
        _RUN_MODEL_CALLS_USED[run_id] = used
        return used


def model_calls_used(run_id: str) -> int:
    with _LOCK:
        return int(_RUN_MODEL_CALLS_USED.get(run_id, 0))


def wait_or_cancel(run_id: str, delay_seconds: float) -> None:
    if delay_seconds <= 0:
        cancellation_checkpoint(run_id)
        return
    with _LOCK:
        event = _RUN_EVENTS.setdefault(run_id, threading.Event())
    if event.wait(timeout=delay_seconds):
        raise RunCancelled(f"run {run_id} was cancelled during retry backoff")


def release_run(run_id: str) -> None:
    with _LOCK:
        _RUN_EVENTS.pop(run_id, None)
        _ACK_EVENTS.pop(run_id, None)
        _RUN_MODEL_CALL_LIMITS.pop(run_id, None)
        _RUN_MODEL_CALLS_USED.pop(run_id, None)
        _RUN_OWNERS.pop(run_id, None)
        parent_id = _RUN_PARENT.pop(run_id, None)
        if parent_id:
            children = _RUN_CHILDREN.get(parent_id)
            if children is not None:
                children.discard(run_id)
                if not children:
                    _RUN_CHILDREN.pop(parent_id, None)
        children = _RUN_CHILDREN.pop(run_id, set())
        for child_id in children:
            _RUN_PARENT.pop(child_id, None)
