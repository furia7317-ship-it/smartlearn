"""Resolve optional, locally licensed background music."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from app.core.config import settings


def select_background_music(script: dict[str, Any]) -> Path | None:
    directory = settings.MEDIA_MUSIC_DIR.strip()
    if not directory:
        return None
    root = Path(directory).expanduser().resolve()
    if not root.is_dir():
        return None
    tracks = sorted(
        path for path in root.iterdir()
        if path.is_file() and path.suffix.lower() in {".mp3", ".wav", ".m4a", ".aac"}
    )
    if not tracks:
        return None
    config = script.get("render_config") if isinstance(script.get("render_config"), dict) else {}
    mood = str(config.get("music_mood") or script.get("music_mood") or "").casefold()
    matching = [track for track in tracks if mood and mood in track.stem.casefold()]
    pool = matching or tracks
    seed = str(script.get("title") or script.get("id") or "smartlearn")
    index = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16) % len(pool)
    return pool[index]
