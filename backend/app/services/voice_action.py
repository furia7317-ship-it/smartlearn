"""Bounded AI action planning for text or spoken software-control requests."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Callable

from app.core.llm import build_llm, parse_json_response


RESOURCE_OBJECT_RE = (
    r"(?:资料|视频|讲义|题目|练习|导图|课件|代码|"
    r"资源中心(?:里|里面)?(?:的)?(?:东西|内容|文件|资源)?)"
)
OPEN_INTENT_RE = re.compile(
    rf"(?:打开|播放|看看|查看|调出|显示|阅读).{{0,24}}{RESOURCE_OBJECT_RE}"
    rf"|{RESOURCE_OBJECT_RE}.{{0,16}}(?:打开|播放|看看|查看|调出|显示|阅读)",
    re.IGNORECASE,
)
TYPE_TERMS = {
    "video": ("视频", "动画", "短片"),
    "explainer": ("讲义", "讲解", "文章"),
    "quiz": ("题目", "练习", "测验", "题库"),
    "solution": ("题目解析", "解析", "答案详解"),
    "mindmap": ("导图", "思维导图"),
    "courseware": ("课件", "PPT"),
    "code": ("代码", "示例"),
    "reading": ("阅读", "扩展资料"),
    "interactive": ("交互演示", "互动演示"),
}


def _safe_resources(resources: list[dict[str, Any]]) -> list[dict[str, str]]:
    safe: list[dict[str, str]] = []
    for item in resources[:100]:
        if not isinstance(item, dict) or str(item.get("status") or "") != "ready":
            continue
        resource_id = str(item.get("id") or "").strip()[:200]
        title = str(item.get("title") or "").strip()[:240]
        resource_type = str(item.get("type") or "").strip()[:40]
        if resource_id and title and resource_type in TYPE_TERMS:
            safe.append({"id": resource_id, "type": resource_type, "title": title})
    return safe


def _fallback_selection(utterance: str, resources: list[dict[str, str]]) -> dict[str, Any]:
    requested_type = next(
        (kind for kind, terms in TYPE_TERMS.items() if any(term in utterance for term in terms)),
        None,
    )
    candidates = [item for item in resources if requested_type is None or item["type"] == requested_type]
    if not candidates:
        return {"action": "none"}

    ignored = "请帮我打开播放看看查看进入学习一份一个这个那个资料视频讲义题目练习导图课件代码"
    keywords = [char for char in utterance if char not in ignored and not char.isspace()]
    ranked = sorted(
        enumerate(candidates),
        key=lambda pair: (
            sum(1 for char in keywords if char in pair[1]["title"]),
            -pair[0],
        ),
        reverse=True,
    )
    selected = ranked[0][1]
    return {
        "action": "open_resource",
        "resource_id": selected["id"],
        "label": f"打开《{selected['title']}》",
        "reply": f"好的，已经为你打开《{selected['title']}》。",
    }


async def plan_voice_action(
    utterance: str,
    resources: list[dict[str, Any]],
    *,
    llm_factory: Callable[..., Any] = build_llm,
) -> dict[str, Any]:
    """Resolve a clear open request against an allowlisted resource set."""
    text = utterance.strip()[:500]
    safe = _safe_resources(resources)
    if not text or not safe or not OPEN_INTENT_RE.search(text):
        return {"action": "none"}

    system = """你是学枢智能教师的界面操作规划器。用户会用文字或语音要求打开学习资料。
你只能返回 JSON，且只能选择给定候选列表中的真实 id。允许的动作只有：
1. open_resource：用户明确要求打开、播放、查看某份学习资料；
2. none：不是操作指令，或候选资料无法满足。
优先匹配资料类型和标题关键词；用户只说“打开一份视频资料”时，从候选视频中选择第一项。
不得生成资料、删除数据、访问外部地址、执行系统命令，也不得编造 id。
格式：{"action":"open_resource|none","resource_id":"候选 id 或空","reply":"执行成功后的简短口语反馈"}"""
    payload = {"utterance": text, "resources": safe}
    try:
        llm = llm_factory(
            temperature=0,
            streaming=False,
            response_format={"type": "json_object"},
            max_tokens=300,
        )
        response = await asyncio.to_thread(
            llm.invoke,
            [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        )
        parsed = parse_json_response(str(getattr(response, "content", "") or ""))
        resource_id = str(parsed.get("resource_id") or "")
        selected = next((item for item in safe if item["id"] == resource_id), None)
        if parsed.get("action") == "open_resource" and selected is not None:
            return {
                "action": "open_resource",
                "resource_id": selected["id"],
                "label": f"打开《{selected['title']}》",
                "reply": str(parsed.get("reply") or f"好的，已经为你打开《{selected['title']}》。")[:240],
            }
    except Exception:
        pass
    return _fallback_selection(text, safe)
