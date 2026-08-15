"""Validated, bounded Python execution for local educational tooling."""

from __future__ import annotations

import ast
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

MAX_SOURCE_CHARS = 10000
MAX_AST_NODES = 2000
MAX_SOURCE_LINES = 300
EXECUTION_TIMEOUT_SECONDS = 3.0

_ALLOWED_IMPORTS = {
    "collections": {"defaultdict", "deque"},
    "heapq": {"heapify", "heappop", "heappush", "heappushpop", "heapreplace"},
}
_ALLOWED_DUNDER_METHODS = {
    "__eq__",
    "__ge__",
    "__gt__",
    "__init__",
    "__le__",
    "__lt__",
    "__repr__",
    "__str__",
}


def count_executable_source_lines(code: str) -> int:
    """Ignore blank and full-line comments when applying the visualization limit."""
    return sum(
        1
        for line in code.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )

_DENIED_NODES = (
    ast.AsyncFunctionDef,
    ast.Await,
    ast.Global,
    ast.Nonlocal,
    ast.With,
    ast.AsyncWith,
)
_DENIED_NAMES = {
    "breakpoint", "compile", "delattr", "dir", "eval", "exec", "exit",
    "getattr", "globals", "help", "input", "locals", "memoryview", "open",
    "quit", "setattr", "type", "vars", "__builtins__", "__import__",
}
_DENIED_ATTRIBUTES = {
    "chdir", "connect", "fork", "kill", "mkdir", "open", "popen", "read",
    "recv", "rename", "request", "rmdir", "send", "socket", "system",
    "unlink", "urlopen", "walk", "write",
}


class CodeValidationError(ValueError):
    def __init__(self, message: str, line: int | None = None):
        super().__init__(message)
        self.line = line


class _SafetyValidator(ast.NodeVisitor):
    def __init__(self) -> None:
        self.node_count = 0

    def generic_visit(self, node: ast.AST) -> None:
        self.node_count += 1
        if self.node_count > MAX_AST_NODES:
            raise CodeValidationError(
                "代码结构过于复杂，请拆成更小的示例",
                getattr(node, "lineno", None),
            )
        if isinstance(node, _DENIED_NODES):
            raise CodeValidationError(
                f"学习编译器暂不允许 {type(node).__name__} 语法",
                getattr(node, "lineno", None),
            )
        super().generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        private_name = node.id.startswith("__") and node.id != "__name__"
        if node.id in _DENIED_NAMES or private_name:
            raise CodeValidationError(f"不允许访问 {node.id}", node.lineno)
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        local_private_attribute = (
            node.attr.startswith("_")
            and not node.attr.startswith("__")
            and isinstance(node.value, ast.Name)
            and node.value.id in {"self", "cls"}
        )
        if (
            (node.attr.startswith("_") and not local_private_attribute)
            or node.attr in _DENIED_ATTRIBUTES
        ):
            raise CodeValidationError(f"不允许访问属性 {node.attr}", node.lineno)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        if node.bases or node.keywords or node.decorator_list:
            raise CodeValidationError("学习演示中的类暂不支持继承、元类或装饰器", node.lineno)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        if node.name.startswith("__") and node.name not in _ALLOWED_DUNDER_METHODS:
            raise CodeValidationError(f"不允许定义特殊方法 {node.name}", node.lineno)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name not in _ALLOWED_IMPORTS:
                raise CodeValidationError(f"不允许导入模块 {alias.name}", node.lineno)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        allowed_names = _ALLOWED_IMPORTS.get(module)
        if node.level or allowed_names is None:
            raise CodeValidationError(f"不允许从模块 {module or '相对路径'} 导入", node.lineno)
        for alias in node.names:
            if alias.name == "*" or alias.name not in allowed_names:
                raise CodeValidationError(
                    f"不允许从模块 {module} 导入 {alias.name}",
                    node.lineno,
                )
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, str) and len(node.value) > 2000:
            raise CodeValidationError("单个字符串不能超过 2000 字符", node.lineno)
        if isinstance(node.value, int) and abs(node.value) > 10**12:
            raise CodeValidationError("整数常量过大", node.lineno)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in _DENIED_NAMES:
            raise CodeValidationError(f"不允许调用 {node.func.id}", node.lineno)
        if isinstance(node.func, ast.Name) and node.func.id == "range":
            for argument in node.args:
                if isinstance(argument, ast.Constant) and isinstance(argument.value, int):
                    if abs(argument.value) > 10000:
                        raise CodeValidationError("range 参数不能超过 10000", node.lineno)
        self.generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        if isinstance(node.op, ast.Pow) and isinstance(node.right, ast.Constant):
            if isinstance(node.right.value, int) and abs(node.right.value) > 20:
                raise CodeValidationError("幂运算指数不能超过 20", node.lineno)
        if isinstance(node.op, ast.Mult):
            operands = (node.left, node.right)
            repeated = any(
                isinstance(value, (ast.List, ast.Tuple))
                or (isinstance(value, ast.Constant) and isinstance(value.value, (str, bytes)))
                for value in operands
            )
            multiplier = next(
                (
                    value.value
                    for value in operands
                    if isinstance(value, ast.Constant) and isinstance(value.value, int)
                ),
                None,
            )
            if repeated and multiplier is not None and abs(multiplier) > 10000:
                raise CodeValidationError("序列重复次数必须是 10000 以内的整数常量", node.lineno)
        self.generic_visit(node)

    def visit_List(self, node: ast.List) -> None:
        if len(node.elts) > 200:
            raise CodeValidationError("列表字面量不能超过 200 项", node.lineno)
        self.generic_visit(node)

    def visit_Dict(self, node: ast.Dict) -> None:
        if len(node.keys) > 200:
            raise CodeValidationError("字典字面量不能超过 200 项", node.lineno)
        self.generic_visit(node)


def validate_python_source(code: str) -> ast.Module:
    if not code.strip():
        raise CodeValidationError("代码不能为空")
    if len(code) > MAX_SOURCE_CHARS:
        raise CodeValidationError(f"代码不能超过 {MAX_SOURCE_CHARS} 字符")
    if count_executable_source_lines(code) > MAX_SOURCE_LINES:
        raise CodeValidationError(f"代码不能超过 {MAX_SOURCE_LINES} 行")
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise CodeValidationError(str(exc.msg), exc.lineno) from exc
    _SafetyValidator().visit(tree)
    return tree


def _error_result(error_type: str, message: str, line: int | None = None) -> dict[str, Any]:
    return {
        "language": "python",
        "stdout": "",
        "error": {"type": error_type, "message": message, "line": line},
        "trace": [],
        "trace_truncated": False,
        "execution_time_ms": 0.0,
    }


def execute_python(code: str) -> dict[str, Any]:
    """Execute validated source in an isolated child process and return a trace."""

    try:
        validate_python_source(code)
    except CodeValidationError as exc:
        return _error_result("ValidationError", str(exc), exc.line)

    worker = Path(__file__).with_name("code_runner_worker.py").resolve()
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    with tempfile.TemporaryDirectory(prefix="smartlearn-code-") as workdir:
        try:
            completed = subprocess.run(
                [sys.executable, "-I", "-S", str(worker)],
                input=json.dumps({"code": code}, ensure_ascii=False),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=workdir,
                timeout=EXECUTION_TIMEOUT_SECONDS,
                creationflags=creationflags,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return _error_result("TimeoutError", "代码运行超过 3 秒，已自动停止")

    if completed.returncode != 0:
        return _error_result("RunnerError", "受限执行器未能完成运行")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return _error_result("RunnerError", "受限执行器返回格式无效")
    if not isinstance(payload, dict):
        return _error_result("RunnerError", "受限执行器返回内容无效")
    return payload
