"""Profiler agent — 对话建档 + 画像读写。"""

from __future__ import annotations

import json
from typing import Any

from app.core.llm import build_llm, parse_json_response

GUIDE_SYSTEM_PROMPT = """你是学习画像建档专家，通过自然对话了解学生。

六维画像维度：
1. 知识水平（专业、基础如何）
2. 认知风格（视觉型/文字型/实践型）
3. 学习目标（想达到什么程度、期限）
4. 易错点（常犯什么类型的错误）
5. 学习节奏（每天学多久、频率、题量偏好）
6. 兴趣方向（对哪些主题感兴趣）

当前是第 {round} 轮对话。根据已有信息，问一个自然的引导问题。
如果信息已经足够，返回 "COMPLETE"。"""

EXTRACT_SYSTEM_PROMPT = """从用户回答中提取画像信息。

当前画像：__PROFILE__

输出 JSON：
```json
{
  "updates": {
    "knowledge_level": {},
    "cognitive_style": {},
    "goals": {},
    "pace": {},
    "interests": []
  },
  "complete": true/false,
  "evidence": "这轮对话提供的证据摘要"
}
```
只更新有新信息的维度。"""

_DEFAULT_PROFILE = {
    "knowledge_level": {},
    "cognitive_style": {"visual": 0.33, "verbal": 0.33, "practical": 0.34},
    "goals": {},
    "error_profile": {},
    "pace": {"preferred_duration_min": 30, "frequency": "daily", "question_count": 5},
    "interests": [],
}


def generate_guide_question(
    dialogue: list[dict[str, str]],
    current_profile: dict[str, Any],
    round_num: int,
) -> str:
    """生成下一轮引导问题。"""
    llm = build_llm(temperature=0.7)

    messages = [
        {"role": "system", "content": GUIDE_SYSTEM_PROMPT.format(round=round_num + 1)},
    ]
    for msg in dialogue[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    resp = llm.invoke(messages)
    return resp.content


def extract_profile_info(
    user_input: str,
    current_profile: dict[str, Any],
    round_num: int,
) -> tuple[dict[str, Any], bool]:
    """从用户回答中提取画像信息，返回 (更新后的画像, 是否完成)。"""
    llm = build_llm(temperature=0)

    prompt = f"用户回答：{user_input}\n\n当前画像：{json.dumps(current_profile, ensure_ascii=False)}"

    resp = llm.invoke([
        {"role": "system", "content": EXTRACT_SYSTEM_PROMPT.replace("__PROFILE__", json.dumps(current_profile, ensure_ascii=False))},
        {"role": "user", "content": prompt},
    ])

    try:
        result = parse_json_response(resp.content)
        updates = result.get("updates", {})
        complete = result.get("complete", False)

        updated = dict(current_profile)
        for key, value in updates.items():
            if value and key in ("knowledge_level", "cognitive_style", "goals", "error_profile", "pace", "interests"):
                if isinstance(updated.get(key), dict) and isinstance(value, dict):
                    updated[key] = {**updated[key], **value}
                else:
                    updated[key] = value

        return updated, complete or round_num >= 4

    except Exception:
        return current_profile, round_num >= 4


def save_profile(student_id: str, profile: dict[str, Any]) -> None:
    """持久化由 profile router 完成（async session），此函数保留接口兼容。"""
    pass


def get_profile(student_id: str) -> dict[str, Any]:
    """读取学生画像（无记录时返回默认画像）。"""
    from sqlalchemy import select

    from app.core.config import sync_session
    from app.models.profile import Profile

    with sync_session() as s:
        p = s.execute(select(Profile).where(Profile.student_id == student_id)).scalar_one_or_none()
    if p is None:
        return dict(_DEFAULT_PROFILE)
    return {
        "knowledge_level": p.knowledge_level or {},
        "cognitive_style": p.cognitive_style or _DEFAULT_PROFILE["cognitive_style"],
        "goals": p.goals or {},
        "error_profile": p.error_profile or {},
        "pace": p.pace or _DEFAULT_PROFILE["pace"],
        "interests": p.interests or [],
    }


def update_from_exam(student_id: str, mastery: dict[str, Any], results: list[dict[str, Any]]) -> None:
    """根据测评结果增量更新画像（知识水平 + 易错点）。"""
    from sqlalchemy import select

    from app.core.config import sync_session
    from app.models.profile import Profile

    with sync_session() as s:
        p = s.execute(select(Profile).where(Profile.student_id == student_id)).scalar_one_or_none()
        if p is None:
            p = Profile(student_id=student_id, **_DEFAULT_PROFILE)
            s.add(p)

        kl = dict(p.knowledge_level or {})
        for kp, info in mastery.items():
            kl[kp] = {"score": info.get("score", 0), "level": info.get("level", "")}
        p.knowledge_level = kl

        ep = dict(p.error_profile or {})
        for r in results:
            if not r.get("correct"):
                et = r.get("error_type") or "unknown"
                cur = dict(ep.get(et) or {"count": 0})
                cur["count"] = cur.get("count", 0) + 1
                ep[et] = cur
        p.error_profile = ep
        s.commit()
