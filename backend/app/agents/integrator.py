"""Integration agent for generated learning resources."""

from __future__ import annotations

from typing import Any


def integrate_resources(state: dict[str, Any]) -> dict[str, Any]:
    outline = state.get("outline") or {}
    seen: dict[str, dict[str, Any]] = {}
    for resource in state.get("resources", []):
        if isinstance(resource, dict):
            seen[str(resource.get("id") or id(resource))] = resource
    resources = list(seen.values())
    by_chapter: dict[str, list[dict[str, Any]]] = {}
    for resource in resources:
        by_chapter.setdefault(str(resource.get("chapter_id") or "general"), []).append(resource)

    chapters = []
    for chapter in outline.get("chapters", []):
        chapter_resources = by_chapter.get(str(chapter.get("id")), [])
        chapters.append(
            {
                "id": chapter.get("id"),
                "title": chapter.get("title"),
                "goal": chapter.get("goal"),
                "resource_count": len(chapter_resources),
                "types": sorted({str(item.get("type")) for item in chapter_resources if item.get("type")}),
                "resources": [
                    {
                        "id": item.get("id"),
                        "type": item.get("type"),
                        "title": item.get("title"),
                    }
                    for item in chapter_resources
                ],
            }
        )

    unassigned = by_chapter.get("general", [])
    return {
        "title": outline.get("title") or "学习资料整合包",
        "overview": f"已整合 {len(resources)} 项学习资源，按章节目标、资源类型和后续学习顺序统一归档。",
        "total_resources": len(resources),
        "chapters": chapters,
        "unassigned": [
            {"id": item.get("id"), "type": item.get("type"), "title": item.get("title")}
            for item in unassigned
        ],
    }
