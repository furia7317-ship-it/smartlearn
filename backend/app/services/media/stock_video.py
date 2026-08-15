"""Optional Pexels B-roll lookup for storyboard scenes."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings


@dataclass(frozen=True)
class StockVideo:
    path: Path
    page_url: str
    creator: str
    query: str
    video_id: str


def is_configured() -> bool:
    return bool(settings.PEXELS_API_KEY.strip())


def _best_video_file(
    video: dict[str, Any],
    *,
    orientation: str = "landscape",
) -> dict[str, Any] | None:
    candidates = [
        item
        for item in video.get("video_files") or []
        if isinstance(item, dict)
        and str(item.get("file_type") or "").lower() == "video/mp4"
        and str(item.get("link") or "").startswith("http")
    ]
    if not candidates:
        return None
    target = (720, 1280) if orientation == "portrait" else (1280, 720)

    def score(item: dict[str, Any]) -> tuple[int, int]:
        width = int(item.get("width") or 0)
        height = int(item.get("height") or 0)
        matching = 1 if (width < height) == (orientation == "portrait") else 0
        target_penalty = abs(width - target[0]) + abs(height - target[1])
        return (matching, -target_penalty)

    return max(candidates, key=score)


async def fetch_scene_stock_video(
    search_terms: list[str],
    output_dir: str | Path,
    *,
    orientation: str = "landscape",
    excluded_video_ids: set[str] | None = None,
) -> StockVideo | None:
    """Fetch one relevant non-repeating clip, returning ``None`` on failure."""

    if not is_configured():
        return None
    orientation = "portrait" if orientation == "portrait" else "landscape"
    query = " ".join(str(term).strip() for term in search_terms if str(term).strip())[:120]
    query = query or "education learning"
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.sha256(f"{orientation}:{query.casefold()}".encode("utf-8")).hexdigest()[:16]
    cached = output_dir / f"pexels-{cache_key}.mp4"
    cache_metadata = cached.with_suffix(".json")
    if cached.is_file() and cached.stat().st_size > 1024:
        try:
            metadata = json.loads(cache_metadata.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        cached_id = str(metadata.get("video_id") or f"cache-{cache_key}")
        if cached_id not in (excluded_video_ids or set()):
            return StockVideo(
                cached,
                str(metadata.get("page_url") or "https://www.pexels.com"),
                str(metadata.get("creator") or "Pexels"),
                query,
                cached_id,
            )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=8.0)) as client:
            response = await client.get(
                "https://api.pexels.com/v1/videos/search",
                headers={"Authorization": settings.PEXELS_API_KEY.strip()},
                params={
                    "query": query,
                    "orientation": orientation,
                    "size": "medium",
                    "locale": "zh-CN",
                    "per_page": 10,
                },
            )
            response.raise_for_status()
            videos = [item for item in response.json().get("videos") or [] if isinstance(item, dict)]
            if not videos:
                return None
            excluded = excluded_video_ids or set()
            selected = next(
                (item for item in videos if str(item.get("id") or "") not in excluded),
                None,
            )
            if selected is None:
                return None
            video_file = _best_video_file(selected, orientation=orientation)
            if video_file is None:
                return None
            async with client.stream("GET", str(video_file["link"])) as download:
                download.raise_for_status()
                with cached.open("wb") as target:
                    size = 0
                    async for chunk in download.aiter_bytes():
                        size += len(chunk)
                        if size > 80 * 1024 * 1024:
                            raise RuntimeError("Pexels 素材超过 80MB 限制")
                        target.write(chunk)
            user = selected.get("user") if isinstance(selected.get("user"), dict) else {}
            stock = StockVideo(
                cached,
                str(selected.get("url") or "https://www.pexels.com"),
                str(user.get("name") or "Pexels"),
                query,
                str(selected.get("id") or cache_key),
            )
            cache_metadata.write_text(
                json.dumps({
                    "video_id": stock.video_id,
                    "page_url": stock.page_url,
                    "creator": stock.creator,
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return stock
    except (httpx.HTTPError, OSError, RuntimeError, ValueError):
        cached.unlink(missing_ok=True)
        cache_metadata.unlink(missing_ok=True)
        return None
