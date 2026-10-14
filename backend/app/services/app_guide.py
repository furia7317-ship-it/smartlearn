"""Bundled product knowledge, available without course indexing or cloud retrieval."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

CATALOG = json.loads((Path(__file__).resolve().parents[1] / "catalogs" / "app_guide.json").read_text(encoding="utf-8"))
DESTINATIONS = {entry["id"]: entry for entry in CATALOG["entries"]}
EXPLAIN_ONLY = re.compile(r'怎么|如何|怎样|哪里|在哪|能否|是否|能不能|不要|别|不想|不能|无法|没有|打不开|如果|假如|比如|例如|假设|解释|说明|[「」“”"`]')


def _normalize(value: str) -> str:
    return re.sub(r"[\s，。！？!?、：:]", "", value).lower()


def navigation_requested(question: str) -> bool:
    # Only the current user turn can authorize a UI action, never an attachment.
    if parse_app_navigation(question):
        return True
    if re.search(r'不要|别|不想|不用|无需|不能|无法|打不开|如果|假如|例如|比如|假设|[「」“”"`]', question):
        return False
    return bool(re.search(r"^(?:(?:请|麻烦|帮我|给我|带我|我想|我要|现在|直接|你可以|你能|可以|能帮我|能给我))*(?:打开|进入|前往|切换到|跳转到|跳到|回到|返回|去|看一下|查看)", _normalize(question)))


def parse_app_navigation(question: str) -> dict[str, Any] | None:
    if len(question) > 100 or EXPLAIN_ONLY.search(question):
        return None
    text = re.sub(r"^(?:(?:请|麻烦|帮我|给我|带我|我想|我要|现在|直接|你可以|你能|可以|能帮我|能给我))+", "", _normalize(question))
    text = re.sub(r"(?:可以吗|好吗|行吗|一下|看看|吧|吗)+$", "", text)
    match = re.match(r"^(?:打开|进入|前往|切换到|跳转到|跳到|回到|返回|去|看一下|查看)(.+)$", text) or re.match(r"^(.+?)(?:给我|帮我)?(?:打开|调出来)$", text)
    if not match:
        return None
    target = re.sub(r"^一下", "", match[1])
    for value in (target, re.sub(r"(?:这个|的)?(?:页面|界面|功能|模块|页)$", "", target)):
        entry = next((entry for entry in DESTINATIONS.values() if value in [_normalize(name) for name in [entry["title"], *entry["aliases"]]]), None)
        if entry:
            return entry
    return None


def search_app_guide(query: str, limit: int = 4) -> list[dict[str, Any]]:
    text = _normalize(query)
    if not text:
        return []
    grams = {text[index:index + 2] for index in range(len(text) - 1)}
    def score(item):
        names = [item["title"], *item["aliases"]]
        exact = sum(20 + len(name) for name in names if _normalize(name) in text)
        exact += sum(40 for term in item.get("keywords", []) if _normalize(term) in text)
        body = _normalize(item["location"] + item["content"])
        return exact + sum(1 for gram in grams if gram in body)
    ranked = sorted(DESTINATIONS.values(), key=score, reverse=True)
    return [dict(item) for item in ranked if score(item) > 0][:limit]


def app_guide_prompt(question: str = "") -> str:
    index = "；".join(f"{key}={item['title']}" for key, item in DESTINATIONS.items())
    relevant = search_app_guide(question, 3) if question else []
    return (
        "你也负责学枢软件使用指导。" + CATALOG["notice"] + "\n"
        "用户问按钮位置和操作步骤时，使用 search_app_guide 检索内置说明，明确说明页面、按钮和步骤；不要检索课程概念来回答软件操作问题。"
        "用户明确要求打开页面/功能时调用 open_app_page，不要只说可以打开、不要把打开生成页改成生成任务。"
        "该工具只发送客户端界面操作，不代表数据生成或保存成功。用户只问怎么操作时解释步骤，不自动跳转。\n"
        f"可打开的目标：{index}\n"
        + ("相关内置使用说明：" + json.dumps(relevant, ensure_ascii=False) if relevant else "")
    )
