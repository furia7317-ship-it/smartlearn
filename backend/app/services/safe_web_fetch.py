"""SSRF-safe HTTP(S) text downloads for knowledge-base imports."""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}

Resolver = Callable[..., list[tuple[Any, ...]]]


class UnsafeUrlError(ValueError):
    """Raised when a URL can reach a non-public network target."""


def _resolved_addresses(hostname: str, port: int, resolver: Resolver) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return {ipaddress.ip_address(hostname)}
    except ValueError:
        pass

    try:
        results = resolver(hostname, port, type=socket.SOCK_STREAM)
        return {ipaddress.ip_address(item[4][0]) for item in results}
    except (OSError, ValueError, IndexError, TypeError) as exc:
        raise UnsafeUrlError("目标主机无法安全解析") from exc


def validate_public_http_url(url: str, resolver: Resolver = socket.getaddrinfo) -> str:
    """Return a normalized HTTP(S) URL only when every resolved address is public."""
    parsed = urlsplit((url or "").strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrlError("仅允许公开 HTTP(S) 地址")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeUrlError("URL 不允许包含用户名或密码")
    try:
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    except ValueError as exc:
        raise UnsafeUrlError("URL 端口无效") from exc

    addresses = _resolved_addresses(parsed.hostname, port, resolver)
    if not addresses or any(not address.is_global for address in addresses):
        raise UnsafeUrlError("禁止访问本机、私网或保留地址")
    return parsed.geturl()


def fetch_public_text(
    url: str,
    *,
    max_bytes: int = 2 * 1024 * 1024,
    max_redirects: int = 3,
    resolver: Resolver = socket.getaddrinfo,
    transport: httpx.BaseTransport | None = None,
) -> tuple[str, str]:
    """Download a bounded public response while revalidating every redirect."""
    current = validate_public_http_url(url, resolver)
    with httpx.Client(transport=transport, follow_redirects=False, timeout=20) as client:
        for redirect_count in range(max_redirects + 1):
            with client.stream("GET", current, headers={"User-Agent": _USER_AGENT}) as response:
                if response.status_code in _REDIRECT_STATUSES:
                    location = response.headers.get("location")
                    if not location or redirect_count == max_redirects:
                        raise UnsafeUrlError("网页重定向次数过多")
                    current = validate_public_http_url(urljoin(current, location), resolver)
                    continue

                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise UnsafeUrlError("网页正文超过大小限制")
                encoding = response.encoding or "utf-8"
                return body.decode(encoding, errors="replace"), content_type

    raise UnsafeUrlError("网页抓取失败")
