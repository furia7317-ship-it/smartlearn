"""联网搜索（博查 Bocha，国内可达）+ 网页正文抓取，支撑「搜索教材 → 导入知识库」。

设计：网络来的内容写入独立的 web_kb 集合并带 origin=web 标注，不进课程精编库，
防幻觉裁判仍以精编库为准。
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

import httpx

from app.core.config import settings
from app.services.safe_web_fetch import fetch_public_text

def bocha_search(query: str, count: int = 8) -> list[dict[str, Any]]:
    """调用博查 Web Search，返回规整后的结果列表。"""
    if not settings.BOCHA_API_KEY:
        raise RuntimeError("未配置 BOCHA_API_KEY")

    resp = httpx.post(
        settings.BOCHA_SEARCH_URL,
        headers={"Authorization": f"Bearer {settings.BOCHA_API_KEY}"},
        json={"query": query, "summary": True, "count": max(1, min(count, 20))},
        timeout=20,
    )
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data") or {}
    pages = ((data.get("webPages") or {}).get("value")) or []

    results = []
    for p in pages:
        url = p.get("url", "")
        if not url:
            continue
        results.append({
            "id": hashlib.md5(url.encode("utf-8")).hexdigest()[:10],
            "title": p.get("name", "") or url,
            "url": url,
            "snippet": p.get("snippet", ""),
            "summary": p.get("summary") or p.get("snippet", ""),
            "site": p.get("siteName", ""),
            "site_icon": p.get("siteIcon", ""),
            "date": (p.get("datePublished") or p.get("dateLastCrawled") or "")[:10],
        })
    return results


def fetch_readable_text(url: str, max_chars: int = 12000) -> str:
    """抓取网页并提取可读正文（去脚本/样式/导航等）。"""
    from bs4 import BeautifulSoup

    raw_text, ctype = fetch_public_text(url)
    if "html" not in ctype and "text" not in ctype and "<html" not in raw_text[:500].lower():
        raise RuntimeError(f"暂不支持的内容类型（{ctype or '未知'}），目前只抓网页正文")

    soup = BeautifulSoup(raw_text, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "noscript", "form", "iframe"]):
        tag.decompose()

    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = main.get_text("\n", strip=True)

    # 合并为段落：连续非空短行拼接，空行分段
    paras: list[str] = []
    buf: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            if buf:
                paras.append(" ".join(buf))
                buf = []
        else:
            buf.append(line)
    if buf:
        paras.append(" ".join(buf))

    cleaned = "\n\n".join(p for p in paras if len(p) > 2)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned[:max_chars]


def chunk_plain_text(text: str, source: str, size: int = 700) -> list[dict[str, Any]]:
    """把纯文本按段落聚合成 ~size 字的块（供向量化）。超长段落硬切，避免整页变一个巨块。"""
    paras = [p.strip() for p in re.split(r"\n{2,}", text) if len(p.strip()) > 20]

    # 先把超长段落硬切成 size 大小的单元
    units: list[str] = []
    for p in paras:
        if len(p) <= int(size * 1.4):
            units.append(p)
        else:
            units.extend(p[i : i + size] for i in range(0, len(p), size))

    chunks: list[str] = []
    buf = ""
    for u in units:
        if buf and len(buf) + len(u) > size:
            chunks.append(buf)
            buf = u
        else:
            buf = f"{buf}\n{u}" if buf else u
    if buf:
        chunks.append(buf)

    return [
        {
            "content": chunk,
            "metadata": {
                "source": source,
                "title": source,
                "document_title": source,
                "section_title": source,
                "sequence_index": index,
                "char_count": len(chunk),
            },
        }
        for index, chunk in enumerate(chunks)
    ]
