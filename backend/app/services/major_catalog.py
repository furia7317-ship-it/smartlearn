"""教育部本科与研究生学科专业目录检索。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypedDict


MajorLevel = Literal["undergraduate", "graduate"]


class MajorEntry(TypedDict):
    code: str
    name: str
    domain: str
    category: str
    level: MajorLevel


_CATALOG_PATH = Path(__file__).resolve().parent.parent / "catalogs" / "moe_major_catalog.json"


@lru_cache(maxsize=1)
def load_major_catalog() -> tuple[MajorEntry, ...]:
    payload = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return tuple(payload["entries"])


@lru_cache(maxsize=4)
def major_index(level: MajorLevel) -> dict[str, MajorEntry]:
    return {entry["code"]: entry for entry in load_major_catalog() if entry["level"] == level}


def get_major(code: str, level: MajorLevel) -> MajorEntry | None:
    return major_index(level).get(code.strip().upper())


def search_majors(query: str, level: MajorLevel, limit: int = 30) -> list[MajorEntry]:
    normalized = query.strip().casefold()
    if not normalized:
        return []

    def rank(entry: MajorEntry) -> tuple[int, int, str]:
        code = entry["code"].casefold()
        name = entry["name"].casefold()
        if normalized == code or normalized == name:
            priority = 0
        elif code.startswith(normalized) or name.startswith(normalized):
            priority = 1
        elif normalized in name:
            priority = 2
        else:
            priority = 3
        return priority, len(entry["name"]), entry["code"]

    matches = [
        entry
        for entry in load_major_catalog()
        if entry["level"] == level
        and normalized in " ".join(
            (entry["code"], entry["name"], entry["domain"], entry["category"])
        ).casefold()
    ]
    matches.sort(key=rank)
    return matches[:limit]
