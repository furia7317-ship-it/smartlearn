"""Isolated worker for executing the validated educational Python subset."""

from __future__ import annotations

import ast
import builtins
import io
import json
import sys
import time
from types import FunctionType
from typing import Any

FILENAME = "<student-code>"
MAX_LINE_EVENTS = 15000
MAX_TRACE_STEPS = 240
MAX_OUTPUT_CHARS = 12000

_ALLOWED_IMPORTS = {
    "collections": {"defaultdict", "deque"},
    "heapq": {"heapify", "heappop", "heappush", "heappushpop", "heapreplace"},
}


def _serialize(value: Any, depth: int = 0) -> Any:
    if depth > 3:
        return "<层级过深>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:500] + ("..." if len(value) > 500 else "")
    if isinstance(value, (list, tuple)):
        items = [_serialize(item, depth + 1) for item in value[:40]]
        if len(value) > 40:
            items.append("<其余元素已省略>")
        return items
    if isinstance(value, set):
        items = sorted((_serialize(item, depth + 1) for item in value), key=str)
        return {"type": "set", "items": items[:40]}
    if isinstance(value, dict):
        items = list(value.items())[:40]
        return {str(key)[:120]: _serialize(item, depth + 1) for key, item in items}
    if isinstance(value, FunctionType):
        return {"type": "function", "name": value.__name__}
    attributes = getattr(value, "__dict__", None)
    if isinstance(attributes, dict):
        return {
            "type": type(value).__name__,
            "attributes": {
                str(key)[:120]: _serialize(item, depth + 1)
                for key, item in list(attributes.items())[:40]
                if not str(key).startswith("__")
            },
        }
    return {"type": type(value).__name__}


def _user_stack(frame: Any) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == FILENAME:
            frames.append({
                "function": current.f_code.co_name,
                "line": current.f_lineno,
                "locals": {
                    key: _serialize(value)
                    for key, value in current.f_locals.items()
                    if not key.startswith("__")
                },
            })
        current = current.f_back
    return list(reversed(frames))


def _changes(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for name in sorted(set(before) | set(after)):
        old = before.get(name, "<未定义>")
        new = after.get(name, "<已删除>")
        if old == new:
            continue
        kind = "array.update" if isinstance(new, list) else "variable.update"
        changes.append({"name": name, "before": old, "after": new, "kind": kind})
    return changes[:20]


def _safe_range(*args: int) -> range:
    value = range(*args)
    if len(value) > 10000:
        raise RuntimeError("range 迭代次数不能超过 10000")
    return value


def _safe_import(
    name: str,
    globals_dict: dict[str, Any] | None = None,
    locals_dict: dict[str, Any] | None = None,
    fromlist: tuple[str, ...] = (),
    level: int = 0,
):
    allowed_names = _ALLOWED_IMPORTS.get(name)
    if level or allowed_names is None:
        raise ImportError(f"不允许导入模块 {name}")
    if fromlist and any(item == "*" or item not in allowed_names for item in fromlist):
        raise ImportError(f"模块 {name} 包含未授权的导入项")
    return builtins.__import__(name, globals_dict, locals_dict, fromlist, 0)


def _safe_multiply(left: Any, right: Any) -> Any:
    sequence_types = (bytes, list, str, tuple)
    sequence = None
    multiplier = None
    if isinstance(left, sequence_types) and isinstance(right, int):
        sequence, multiplier = left, right
    elif isinstance(right, sequence_types) and isinstance(left, int):
        sequence, multiplier = right, left
    if sequence is not None and multiplier is not None:
        result_length = len(sequence) * max(multiplier, 0)
        if abs(multiplier) > 10000 or result_length > 10000:
            raise RuntimeError("序列重复结果不能超过 10000 项")
    return left * right


class _BoundedMultiplyTransformer(ast.NodeTransformer):
    def visit_BinOp(self, node: ast.BinOp):  # noqa: N802 - ast visitor API
        node = self.generic_visit(node)
        if not isinstance(node.op, ast.Mult):
            return node
        return ast.copy_location(
            ast.Call(
                func=ast.Name(id="__smartlearn_multiply__", ctx=ast.Load()),
                args=[node.left, node.right],
                keywords=[],
            ),
            node,
        )


def _compile_user_code(code: str):
    tree = ast.parse(code, filename=FILENAME, mode="exec")
    transformed = _BoundedMultiplyTransformer().visit(tree)
    ast.fix_missing_locations(transformed)
    return compile(transformed, FILENAME, "exec")


def _run(code: str) -> dict[str, Any]:
    output = io.StringIO()
    trace: list[dict[str, Any]] = []
    previous_locals: dict[int, dict[str, Any]] = {}
    previous_output = ""
    line_events = 0
    trace_truncated = False
    started = time.perf_counter()

    def safe_print(*values: Any, sep: str = " ", end: str = "\n") -> None:
        rendered = sep.join(str(value) for value in values) + end
        if output.tell() + len(rendered) > MAX_OUTPUT_CHARS:
            raise RuntimeError("程序输出超过 12000 字符限制")
        output.write(rendered)

    safe_builtins = {
        "__build_class__": builtins.__build_class__,
        "__import__": _safe_import,
        "abs": abs,
        "all": all,
        "any": any,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "Exception": Exception,
        "filter": filter,
        "float": float,
        "int": int,
        "IndexError": IndexError,
        "isinstance": isinstance,
        "hash": hash,
        "len": len,
        "list": list,
        "map": map,
        "max": max,
        "min": min,
        "print": safe_print,
        "range": _safe_range,
        "reversed": reversed,
        "round": round,
        "set": set,
        "slice": slice,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "TypeError": TypeError,
        "ValueError": ValueError,
        "zip": zip,
    }

    def tracer(frame: Any, event: str, arg: Any):
        nonlocal line_events, previous_output, trace_truncated
        if frame.f_code.co_filename != FILENAME:
            return tracer
        if event == "line":
            line_events += 1
            if line_events > MAX_LINE_EVENTS:
                raise RuntimeError("执行步骤超过 15000 步限制")
        if event not in {"line", "call", "return", "exception"}:
            return tracer
        function = frame.f_code.co_name
        at_capacity = len(trace) >= MAX_TRACE_STEPS
        terminal_module_event = function == "<module>" and event in {"return", "exception"}
        if at_capacity and not terminal_module_event:
            trace_truncated = True
            return tracer

        frame_key = id(frame)
        local_snapshot = {
            key: _serialize(value)
            for key, value in frame.f_locals.items()
            if not key.startswith("__")
        }
        current_output = output.getvalue()
        step = {
            "index": len(trace) - 1 if at_capacity else len(trace),
            "line": frame.f_lineno,
            "event": event,
            "function": function,
            "variables": local_snapshot,
            "changes": _changes(previous_locals.get(frame_key, {}), local_snapshot),
            "stack": _user_stack(frame),
            "stdout": current_output,
            "stdout_delta": current_output[len(previous_output):],
        }
        if at_capacity:
            trace_truncated = True
            trace[-1] = step
        else:
            trace.append(step)
        previous_locals[frame_key] = local_snapshot
        previous_output = current_output
        return tracer

    globals_dict: dict[str, Any] = {
        "__builtins__": safe_builtins,
        "__name__": "__main__",
        "__smartlearn_multiply__": _safe_multiply,
    }
    error: dict[str, Any] | None = None
    try:
        compiled = _compile_user_code(code)
        sys.settrace(tracer)
        exec(compiled, globals_dict, globals_dict)
    except BaseException as exc:  # noqa: BLE001 - serialize user-code failures
        line = getattr(exc, "lineno", None)
        current = exc.__traceback__
        while current is not None:
            if current.tb_frame.f_code.co_filename == FILENAME:
                line = current.tb_lineno
            current = current.tb_next
        error = {
            "type": type(exc).__name__,
            "message": str(exc)[:1000] or type(exc).__name__,
            "line": line,
        }
    finally:
        sys.settrace(None)

    return {
        "language": "python",
        "stdout": output.getvalue(),
        "error": error,
        "trace": trace,
        "trace_truncated": trace_truncated,
        "execution_time_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def main() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        request = json.loads(sys.stdin.read())
        code = str(request.get("code") or "")
        response = _run(code)
    except BaseException as exc:  # noqa: BLE001 - keep the worker protocol valid
        response = {
            "language": "python",
            "stdout": "",
            "error": {"type": "RunnerError", "message": str(exc)[:1000], "line": None},
            "trace": [],
            "trace_truncated": False,
            "execution_time_ms": 0.0,
        }
    sys.stdout.write(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
