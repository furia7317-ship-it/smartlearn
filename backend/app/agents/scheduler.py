"""Daily learning schedule agent."""

from __future__ import annotations

from typing import Any


# 阅读型资料统一挂到“学习/讲义”区；测验和代码挑战独立派发，
# 由真实提交结果完成任务，复盘继续进入独立工作台。
STUDY_RESOURCE_TYPES = {
    "explainer", "mindmap", "solution", "reading", "courseware", "video", "interactive"
}
PRACTICE_RESOURCE_TYPES = {"quiz"}
CODE_RESOURCE_TYPES = {"code"}


def _chunk_chapters(chapters: list[dict[str, Any]], days: int) -> list[list[dict[str, Any]]]:
    buckets: list[list[dict[str, Any]]] = [[] for _ in range(days)]
    for index, chapter in enumerate(chapters):
        buckets[min(days - 1, index * days // max(1, len(chapters)))].append(chapter)
    return buckets


def _resources_by_chapter(integrated: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    by_chapter: dict[str, list[dict[str, Any]]] = {}
    for chapter in integrated.get("chapters") or []:
        chapter_id = str(chapter.get("id") or "")
        if not chapter_id:
            continue
        by_chapter[chapter_id] = [
            {
                "id": item.get("id"),
                "type": item.get("type"),
                "title": item.get("title"),
            }
            for item in (chapter.get("resources") or [])
            if item.get("id") and item.get("type")
        ]
    return by_chapter


def _pick_resources(
    resources: list[dict[str, Any]],
    allowed_types: set[str],
) -> list[dict[str, Any]]:
    return [
        {
            "id": resource.get("id"),
            "type": resource.get("type"),
            "title": resource.get("title"),
        }
        for resource in resources
        if resource.get("type") in allowed_types
    ]


def build_daily_schedule(state: dict[str, Any]) -> list[dict[str, Any]]:
    outline = state.get("outline") or {}
    integrated = state.get("integrated") or {}
    constraints = outline.get("constraints") or {}
    days = max(1, int(constraints.get("days") or 7))
    daily_minutes = max(30, int(constraints.get("daily_minutes") or 90))
    chapters = list(outline.get("chapters") or integrated.get("chapters") or [])
    chapter_resources = _resources_by_chapter(integrated)
    buckets = _chunk_chapters(chapters, days)

    schedule: list[dict[str, Any]] = []
    for index in range(days):
        day = f"D{index + 1}"
        chapters_today = buckets[index]
        if chapters_today:
            title = " / ".join(str(ch.get("title") or "章节学习") for ch in chapters_today)[:28]
            types = sorted({module for ch in chapters_today for module in (ch.get("modules") or ch.get("types") or [])})
            objective = "；".join(str(ch.get("goal") or ch.get("title") or "完成章节学习") for ch in chapters_today)
            steps = []
            for chapter in chapters_today:
                chapter_title = str(chapter.get("title") or "本章节")
                modules = list(chapter.get("modules") or chapter.get("types") or [])
                resources = chapter_resources.get(str(chapter.get("id") or ""), [])
                study_types = [m for m in modules if m in STUDY_RESOURCE_TYPES]
                code_types = [m for m in modules if m in CODE_RESOURCE_TYPES]
                practice_types = [m for m in modules if m in PRACTICE_RESOURCE_TYPES]
                if study_types:
                    steps.append(
                        {
                            "title": f"学习：{chapter_title}",
                            "detail": "在同一讲义区完成概念、导图、阅读、代码、视频和课件学习。",
                            "minutes": max(15, daily_minutes // max(3, len(chapters_today) * 3)),
                            "resource_types": study_types,
                            "resources": _pick_resources(resources, STUDY_RESOURCE_TYPES),
                        }
                    )
                if code_types:
                    steps.append(
                        {
                            "title": f"代码挑战：{chapter_title}",
                            "detail": "根据本章知识编写并运行代码，通过隐藏测试后完成路径任务。",
                            "minutes": max(15, daily_minutes // max(3, len(chapters_today) * 3)),
                            "resource_types": code_types,
                            "resources": _pick_resources(resources, CODE_RESOURCE_TYPES),
                            "kind": "practice",
                            "completion_kind": "written_response",
                        }
                    )
                if practice_types:
                    steps.append(
                        {
                            "title": f"练习：{chapter_title}",
                            "detail": "完成配套题目或代码任务，把知识点转成可操作步骤。",
                            "minutes": max(15, daily_minutes // max(3, len(chapters_today) * 3)),
                            "resource_types": practice_types,
                            "resources": _pick_resources(resources, PRACTICE_RESOURCE_TYPES),
                        }
                    )
            steps.append(
                {
                    "title": "复盘输出",
                    "detail": "写下今天最不稳的 1 个点和明天要追问的问题。",
                    "minutes": max(10, daily_minutes // 6),
                    "resource_types": [],
                }
            )
        else:
            title = "复盘巩固"
            types = ["quiz"]
            objective = "复盘前面章节，补齐错题和薄弱点。"
            steps = [
                {
                    "title": "错题回看",
                    "detail": "重做上一阶段错题，标记仍然不会的题。",
                    "minutes": max(20, daily_minutes // 3),
                    "resource_types": ["quiz"],
                },
                {
                    "title": "综合串联",
                    "detail": "用导图或讲义把本轮知识点串成一张结构图。",
                    "minutes": max(20, daily_minutes // 3),
                    "resource_types": ["mindmap", "explainer"],
                },
            ]

        schedule.append(
            {
                "day": day,
                "title": title,
                "desc": objective,
                "objective": objective,
                "types": types,
                "minutes": daily_minutes,
                "steps": steps,
                "state": "current" if index == 0 else "todo",
            }
        )

    return schedule
