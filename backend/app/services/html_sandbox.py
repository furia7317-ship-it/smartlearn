"""Deterministic safety gate for the ``interactive`` (交互演示) resource type.

The generated payload is rendered inside an opaque-origin iframe whose CSP is
``default-src 'none'``.  That sandbox has no network at all, so every external
reference is a guaranteed runtime failure rather than a style preference, and
every script-bearing tag is an escape attempt against the host page.

This module is intentionally pure (no IO, no model calls, standard library
only) so both the pipeline reviewer and the material-approval gate can reuse
exactly the same verdict, and so it stays cheap to unit test.
"""

from __future__ import annotations

import re
from typing import Any

ALLOWED_RUNTIMES: tuple[str, ...] = ("three", "katex")

MAX_HTML_CHARS = 40000
MAX_CSS_CHARS = 20000
MAX_JS_CHARS = 40000
MAX_TOTAL_CHARS = 80000

MIN_INTERACTIONS = 2

_FORBIDDEN_TAGS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"<\s*script", re.IGNORECASE), "<script> 标签"),
    (re.compile(r"<\s*iframe", re.IGNORECASE), "<iframe> 标签"),
    (re.compile(r"<\s*object", re.IGNORECASE), "<object> 标签"),
    (re.compile(r"<\s*embed", re.IGNORECASE), "<embed> 标签"),
    (re.compile(r"<\s*form", re.IGNORECASE), "<form> 标签"),
)

_INLINE_EVENT_RE = re.compile(r"""(?:^|[\s"'/])on\w+\s*=""", re.IGNORECASE)
_JAVASCRIPT_URL_RE = re.compile(r"javascript\s*:", re.IGNORECASE)

_EXTERNAL_URL_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"https?\s*:\s*//", re.IGNORECASE), "http/https 外链"),
    (re.compile(r"//cdn", re.IGNORECASE), "//cdn 协议相对外链"),
    (re.compile(r"url\(\s*['\"]?\s*http", re.IGNORECASE), "url(http…) 外部资源引用"),
)

# W3C 命名空间标识符长得像 URL，但浏览器只把它当字符串比对，不会发起任何请求。
# 而 SVG 恰恰是沙箱里推荐的绘图手段（提示词明确让模型用 canvas/SVG），
# `<svg xmlns="http://www.w3.org/2000/svg">` 与 `createElementNS(...)` 都绕不开它——
# 不豁免的话，模型照着提示词写完必被驳回，返工轮次会一直撞同一条问题直到预算耗尽。
_NAMESPACE_URIS: tuple[str, ...] = (
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/1998/Math/MathML",
)


# 豁免必须锚定在标识符末尾：否则 `http://www.w3.org/2000/svg.evil.com/x.png` 会因为
# 前缀被抹掉而整条放行。后随字符只要还属于 URL 组成字符，就说明这是个真实地址而非命名空间。
_NAMESPACE_URI_RE = re.compile(
    "(?:" + "|".join(re.escape(uri) for uri in _NAMESPACE_URIS) + r")(?![\w.\-/])",
    re.IGNORECASE,
)


def _without_namespace_uris(value: str) -> str:
    """Blank out W3C namespace identifiers so they never trip the external-link scan."""

    return _NAMESPACE_URI_RE.sub(" ", value)

_TAG_RE = re.compile(r"<[^>]*>")
_STYLE_BLOCK_RE = re.compile(r"<\s*style\b[^>]*>.*?<\s*/\s*style\s*>", re.IGNORECASE | re.DOTALL)
_WHITESPACE_RE = re.compile(r"[ \t\r\f\v]*\n\s*")

_FIELD_LABELS = {"html": "html", "css": "css", "js": "js"}


def strip_html_tags(value: str) -> str:
    """Return the human-readable text of a markup fragment, tags removed."""

    if not isinstance(value, str) or not value.strip():
        return ""
    without_style = _STYLE_BLOCK_RE.sub(" ", value)
    text = _TAG_RE.sub(" ", without_style)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return re.sub(r"\s{2,}", " ", _WHITESPACE_RE.sub("\n", text)).strip()


def interactive_plain_text(data: Any) -> str:
    """Flatten an interactive payload into reviewable prose (no markup, no code)."""

    if not isinstance(data, dict):
        return ""
    parts: list[str] = []
    summary = data.get("summary")
    if isinstance(summary, str) and summary.strip():
        parts.append(summary.strip())
    body = strip_html_tags(str(data.get("html") or ""))
    if body:
        parts.append(body)
    for item in data.get("interactions") or []:
        if isinstance(item, str) and item.strip():
            parts.append(item.strip())
    return "\n".join(parts)


def _source_fields(data: dict[str, Any]) -> list[tuple[str, str]]:
    fields: list[tuple[str, str]] = []
    for key, label in _FIELD_LABELS.items():
        value = data.get(key)
        if isinstance(value, str) and value:
            fields.append((label, value))
    return fields


def validate_interactive_payload(data: Any) -> list[str]:
    """Return actionable Chinese blocking issues; an empty list means it passes.

    The rules mirror the sandbox contract exactly: no script-bearing markup, no
    inline event handlers, no ``javascript:`` URLs, no network references of any
    kind (``data:`` and ``blob:`` stay allowed), only host-injected runtimes,
    and bounded payload sizes.
    """

    issues: list[str] = []

    def add(message: str) -> None:
        if message not in issues:
            issues.append(message)

    if not isinstance(data, dict) or not data:
        return ["交互演示内容为空：需要返回包含 summary/html/interactions 的完整对象"]

    summary = data.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        add("交互演示缺少 summary：用一句话说明这个演示到底展示了什么")

    html = data.get("html")
    if html is not None and not isinstance(html, str):
        add("交互演示的 html 必须是字符串（<body> 内的标记）")
        html = ""
    if not isinstance(html, str) or not html.strip():
        add("交互演示缺少 html：需要提供可直接渲染的 <body> 内标记")
        html = html if isinstance(html, str) else ""

    for key in ("css", "js"):
        value = data.get(key)
        if value is not None and not isinstance(value, str):
            add(f"交互演示的 {key} 必须是字符串，可以留空但不能是其他类型")

    for pattern, label in _FORBIDDEN_TAGS:
        if pattern.search(html):
            add(f"html 中禁止出现 {label}：脚本必须写在 js 字段里，由宿主以 ES module 执行")

    if _INLINE_EVENT_RE.search(html):
        add("html 中禁止使用 on* 内联事件属性：请在 js 字段里用 addEventListener 绑定交互")

    if _JAVASCRIPT_URL_RE.search(html):
        add("html 中禁止出现 javascript: URL：沙箱会直接拦截，请改用 js 字段绑定事件")

    for label, value in _source_fields(data):
        scannable = _without_namespace_uris(value)
        for pattern, reason in _EXTERNAL_URL_RULES:
            if pattern.search(scannable):
                add(
                    f"{label} 中禁止出现{reason}：沙箱 CSP 为 default-src 'none' 且完全没有网络，"
                    "图片请改用 data: URI 或用 canvas/SVG 程序化绘制"
                )

    runtime = data.get("runtime")
    if runtime is None:
        runtime = []
    if not isinstance(runtime, list):
        add('交互演示的 runtime 必须是数组，取值只能是 "three" 或 "katex"')
    else:
        for item in runtime:
            if not isinstance(item, str) or item not in ALLOWED_RUNTIMES:
                add(
                    f"runtime 声明了不支持的运行时「{item}」："
                    '宿主只注入 "three"（window.THREE）与 "katex"（window.katex）'
                )

    interactions = data.get("interactions")
    if not isinstance(interactions, list):
        add("交互演示的 interactions 必须是字符串数组，用 2-4 条说明可交互点")
    elif any(not isinstance(item, str) or not item.strip() for item in interactions):
        add("interactions 存在空项或非字符串项：每一条都要写清一个具体的可交互操作")
    elif len(interactions) < MIN_INTERACTIONS:
        add(f"interactions 至少需要 {MIN_INTERACTIONS} 条，用于告诉学生这个演示可以怎么操作")

    limits = (
        ("html", html, MAX_HTML_CHARS),
        ("css", data.get("css"), MAX_CSS_CHARS),
        ("js", data.get("js"), MAX_JS_CHARS),
    )
    total = 0
    for label, value, limit in limits:
        if not isinstance(value, str):
            continue
        total += len(value)
        if len(value) > limit:
            add(f"{label} 长度 {len(value)} 字符超出上限 {limit}：请精简演示，只保留讲清概念所需的最小实现")
    if total > MAX_TOTAL_CHARS:
        add(f"html/css/js 合计 {total} 字符超出上限 {MAX_TOTAL_CHARS}：请削减无关代码与样式")

    return issues
