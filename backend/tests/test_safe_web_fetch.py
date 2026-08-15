"""SSRF regression tests for readable-page downloads."""

from __future__ import annotations

import socket

import httpx
import pytest

from app.services.safe_web_fetch import (
    UnsafeUrlError,
    fetch_public_text,
    validate_public_http_url,
)


def public_resolver(host: str, port: int, type: int = 0):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]


def private_resolver(host: str, port: int, type: int = 0):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.20", port))]


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://127.0.0.1:8000/docs",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.8/",
        "http://user:pass@example.com/",
    ],
)
def test_rejects_non_public_targets(url: str):
    with pytest.raises(UnsafeUrlError):
        validate_public_http_url(url, resolver=public_resolver)


def test_rejects_hostname_resolving_to_private_address():
    with pytest.raises(UnsafeUrlError, match="私网"):
        validate_public_http_url("https://internal.example/", resolver=private_resolver)


def test_accepts_public_https_target():
    assert (
        validate_public_http_url("https://example.com/guide", resolver=public_resolver)
        == "https://example.com/guide"
    )


def test_revalidates_redirect_targets():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            302,
            headers={"location": "http://127.0.0.1/private"},
            request=request,
        )
    )

    with pytest.raises(UnsafeUrlError, match="私网"):
        fetch_public_text(
            "https://example.com/start",
            resolver=public_resolver,
            transport=transport,
        )


def test_rejects_response_above_size_limit():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            content=b"x" * 33,
            headers={"content-type": "text/plain; charset=utf-8"},
            request=request,
        )
    )

    with pytest.raises(UnsafeUrlError, match="大小"):
        fetch_public_text(
            "https://example.com/large",
            max_bytes=32,
            resolver=public_resolver,
            transport=transport,
        )


def test_returns_bounded_text_and_content_type():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            content="公开正文".encode(),
            headers={"content-type": "text/html; charset=utf-8"},
            request=request,
        )
    )

    text, content_type = fetch_public_text(
        "https://example.com/article",
        resolver=public_resolver,
        transport=transport,
    )

    assert text == "公开正文"
    assert content_type == "text/html; charset=utf-8"
