"""Sandbox contract for the ``interactive`` resource type.

The demo runs inside an opaque-origin iframe with ``default-src 'none'``, so
anything that reaches for the network or smuggles script into markup must be
rejected deterministically, before a model reviewer is ever consulted.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services.html_sandbox import (
    MAX_HTML_CHARS,
    MAX_JS_CHARS,
    strip_html_tags,
    validate_interactive_payload,
)


def valid_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "summary": "用一个可旋转的立方体演示三维向量在空间中的方向与长度。",
        "html": (
            '<section class="sl-demo">\n'
            "  <h2>三维向量</h2>\n"
            '  <div id="stage" aria-label="三维视图"></div>\n'
            '  <button id="toggle" type="button">暂停旋转</button>\n'
            "</section>"
        ),
        "css": "#stage{width:100%;min-height:240px;color:var(--sl-fg,#111)}",
        "js": (
            "const host = document.getElementById('stage');\n"
            "host.textContent = String(THREE.REVISION);\n"
            "document.getElementById('toggle').addEventListener('click', () => {});\n"
        ),
        "runtime": ["three"],
        "interactions": [
            "点击「暂停旋转」按钮：立方体停在当前角度，方便观察某一个面。",
            "拖动窗口改变宽度：画布随容器自适应，比例保持不变。",
        ],
    }
    payload.update(overrides)
    return payload


def test_complete_legal_payload_passes():
    assert validate_interactive_payload(valid_payload()) == []


@pytest.mark.parametrize(
    ("label", "payload", "expected_marker"),
    [
        (
            "script-tag",
            valid_payload(html='<div id="stage"></div><script>alert(1)</script>'),
            "<script>",
        ),
        (
            "iframe-tag",
            valid_payload(html='<iframe src="about:blank"></iframe>'),
            "<iframe>",
        ),
        (
            "object-tag",
            valid_payload(html='<object data="x.swf"></object>'),
            "<object>",
        ),
        (
            "embed-tag",
            valid_payload(html='<embed type="video/mp4" />'),
            "<embed>",
        ),
        (
            "form-tag",
            valid_payload(html='<form action="/submit"><input name="a" /></form>'),
            "<form>",
        ),
        (
            "inline-event",
            valid_payload(html='<img alt="x" src="data:image/gif;base64,R0lGOD" onerror="fetch(1)" />'),
            "on* 内联事件属性",
        ),
        (
            "javascript-url",
            valid_payload(html='<a href="javascript:alert(1)">点我</a>'),
            "javascript: URL",
        ),
        (
            "external-html-url",
            valid_payload(html='<div id="stage"></div><img alt="c" src="https://cdn.example.com/a.png" />'),
            "外链",
        ),
        (
            "external-css-url",
            valid_payload(css="body{background:url(http://example.com/bg.png)}"),
            "外部资源引用",
        ),
        (
            "external-js-url",
            valid_payload(js="await fetch('https://api.example.com/data.json');"),
            "外链",
        ),
        (
            "protocol-relative-cdn",
            valid_payload(js="import * as x from '//cdn.example.com/three.js';"),
            "//cdn",
        ),
        (
            "illegal-runtime",
            valid_payload(runtime=["three", "d3"]),
            "不支持的运行时",
        ),
        (
            "runtime-not-a-list",
            valid_payload(runtime="three"),
            "runtime 必须是数组",
        ),
        (
            "oversized-html",
            valid_payload(html="<p>x</p>" * (MAX_HTML_CHARS // 4)),
            "超出上限",
        ),
        (
            "oversized-js",
            valid_payload(js="// padding\n" * (MAX_JS_CHARS // 5)),
            "超出上限",
        ),
        (
            "missing-summary",
            valid_payload(summary="   "),
            "缺少 summary",
        ),
        (
            "missing-html",
            valid_payload(html=""),
            "缺少 html",
        ),
        (
            "interactions-not-a-list",
            valid_payload(interactions="点一下"),
            "interactions 必须是字符串数组",
        ),
        (
            "interactions-empty-item",
            valid_payload(interactions=["拖动滑块观察变化", "   "]),
            "空项或非字符串项",
        ),
        (
            "interactions-too-few",
            valid_payload(interactions=["拖动滑块观察变化"]),
            "interactions 至少需要",
        ),
    ],
)
def test_malicious_or_malformed_payloads_are_rejected(
    label: str,
    payload: dict[str, Any],
    expected_marker: str,
) -> None:
    issues = validate_interactive_payload(payload)

    assert issues, f"{label} 应当被拒绝"
    assert any(expected_marker in issue for issue in issues), (label, issues)


def test_empty_or_non_dict_payload_is_rejected():
    assert validate_interactive_payload({}) == validate_interactive_payload(None)
    assert validate_interactive_payload("<div></div>")


def test_data_and_blob_urls_stay_allowed():
    payload = valid_payload(
        html='<div id="stage"></div><img alt="点阵" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />',
        js="const url = URL.createObjectURL(new Blob(['x'])); const p = 'blob:' + url;",
    )

    assert validate_interactive_payload(payload) == []


def test_total_size_cap_rejects_individually_legal_fields():
    payload = valid_payload(
        html="<p>a</p>" * (MAX_HTML_CHARS // 8),
        css="/*c*/" * 3000,
        js="// j\n" * (MAX_JS_CHARS // 6),
    )

    issues = validate_interactive_payload(payload)

    assert any("合计" in issue for issue in issues)


def test_strip_html_tags_keeps_prose_only():
    text = strip_html_tags('<section><h2>三维向量</h2><style>h2{color:red}</style><p>长度与方向</p></section>')

    assert "三维向量" in text
    assert "长度与方向" in text
    assert "<" not in text
    assert "color:red" not in text


def _interactive_task() -> dict[str, Any]:
    return {
        "type": "interactive",
        "title": "三维向量 · 交互演示",
        "outline": {
            "objective": "用可操作的三维视图讲清向量的方向与长度",
            "sections": [
                {
                    "title": "核心内容",
                    "goal": "让学生直观看到三维向量",
                    "must_cover": ["三维向量"],
                    "target_words": 300,
                }
            ],
        },
        "quality_criteria": ["必须说明演示展示的核心概念与操作方式"],
    }


def test_review_resource_blocks_interactive_with_script_tag():
    from app.services.resource_quality import review_resource

    resource = {"type": "interactive", **valid_payload(html='<div id="stage"></div><script>x()</script>')}

    review = review_resource(resource, _interactive_task())

    assert review.approved is False
    assert review.blocking_issues
    assert any("<script>" in issue for issue in review.blocking_issues)
    assert review.repair_instructions[0].target_field == "html"


def test_review_resource_approves_legal_interactive_payload():
    from app.services.resource_quality import review_resource

    review = review_resource({"type": "interactive", **valid_payload()}, _interactive_task())

    assert review.blocking_issues == []
    assert review.approved is True


def test_material_approval_reuses_the_same_sandbox_gate():
    from app.services.material_approval import _structure_issues

    clean = _structure_issues(
        {"type": "interactive", "title": "三维向量 · 交互演示", "data": valid_payload()}
    )
    dirty = _structure_issues(
        {
            "type": "interactive",
            "title": "三维向量 · 交互演示",
            "data": valid_payload(html='<div onclick="steal()">点我</div>'),
        }
    )

    assert clean == []
    assert any("on* 内联事件属性" in issue for issue in dirty)


@pytest.mark.parametrize(
    "field, value",
    [
        ("html", '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5"/></svg>'),
        ("html", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#gear"/></svg>'),
        ("html", '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>'),
        ("js", 'const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");'),
        (
            "html",
            "<img alt=\"\" src=\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27%3E%3C/svg%3E\">",
        ),
    ],
)
def test_w3c_namespace_uris_are_not_external_links(field, value):
    """命名空间标识符不产生网络请求，且 SVG 正是提示词推荐的绘图手段。

    不豁免的话，模型照着 SYSTEM_PROMPT 用 SVG 写完必被驳回，
    而返工只会重复撞上同一条问题，直到 run 级预算耗尽。
    """

    assert validate_interactive_payload(valid_payload(**{field: value})) == []


@pytest.mark.parametrize(
    "url",
    [
        "http://www.w3.org/2000/svg.evil.example/x.png",
        "http://www.w3.org/2000/svgevil.example/x.png",
        "http://www.w3.org/2000/svg/../../evil.example/x",
        "http://www.w3.org/1999/xlink.evil.example/x.png",
    ],
)
def test_namespace_exemption_is_anchored_and_cannot_be_used_as_a_prefix(url):
    """豁免必须锚在标识符末尾，否则拿命名空间当前缀就能夹带真实外链。"""

    issues = validate_interactive_payload(valid_payload(html=f'<img alt="" src="{url}">'))

    assert any("http/https 外链" in issue for issue in issues)
