"""网页内容总结：把内置浏览器当前页正文 → 结构化学习笔记（知识点）+ 测验题。

与 services/bilibili.py 的视频复盘同构，产出可直接存资源中心的 reading + quiz 载荷。
正文信息有限（如 B站视频页只有标题/简介）时，提示模型结合该主题常识补全知识点。
"""

from __future__ import annotations

import re
from typing import Any

from app.core.deps import get_llm
from app.core.llm import parse_json_response

QUIZ_MAX = 10


def _sentences(content: str) -> list[str]:
    return [s.strip() for s in re.split(r"[。.!?！？\n]", content or "") if len(s.strip()) > 8]


def _fallback(title: str, content: str) -> dict[str, Any]:
    topic = title or "网页主题"
    sents = _sentences(content)[:6]
    body = "\n".join(f"- {s}" for s in sents) if sents else f"- 关于「{topic}」的核心内容梳理。"
    notes = f"## 核心知识点\n\n{body}\n\n> 提示：本页可提取的正文有限，建议结合课程知识库补全。"
    key_points = sents[:6] if sents else [topic, "核心概念", "易错点", "应用场景"]
    flat = " ".join((content or "").split())
    key_terms = [{"term": topic, "definition": (flat[:60] or "本页主题")}]
    questions = [
        {
            "id": "q1",
            "type": "mcq",
            "stem": f"关于「{topic}」，下列做法最合适的是？",
            "options": [
                "A. 略读跳过",
                "B. 抓住核心概念与易错点整理笔记",
                "C. 只看标题",
                "D. 只看图片",
            ],
            "answer": "B",
            "explanation": "学习应落到核心概念与易错点，方便后续练习复盘。",
        },
        {
            "id": "q2",
            "type": "tf",
            "stem": f"「{topic}」的学习只需记住结论，不必理解推导过程。",
            "options": ["A. 正确", "B. 错误"],
            "answer": "B",
            "explanation": "理解过程才能迁移到新题，死记结论容易失分。",
        },
        {
            "id": "q3",
            "type": "mcq",
            "stem": f"整理「{topic}」笔记时，最该优先记录的是？",
            "options": ["A. 排版样式", "B. 核心概念、关键步骤与易错点", "C. 页面广告", "D. 评论区"],
            "answer": "B",
            "explanation": "概念、步骤、易错点是复盘与做题的依据。",
        },
        {
            "id": "q4",
            "type": "short",
            "stem": f"用一句话概括你对「{topic}」的理解。",
            "options": [],
            "answer": "（开放题，结合笔记作答）",
            "explanation": "用自己的话复述能检验是否真正掌握。",
        },
    ]
    return {"summary": f"对《{topic}》的学习笔记。", "notes": notes, "key_points": key_points, "key_terms": key_terms, "questions": questions}


def _normalize(raw: Any, title: str, content: str) -> dict[str, Any]:
    fb = _fallback(title, content)
    if not isinstance(raw, dict):
        return fb
    summary = str(raw.get("summary") or fb["summary"])
    notes = str(raw.get("notes") or fb["notes"])

    key_points = raw.get("key_points")
    if not isinstance(key_points, list) or not key_points:
        key_points = fb["key_points"]

    key_terms_raw = raw.get("key_terms")
    key_terms: list[dict[str, str]] = []
    if isinstance(key_terms_raw, list):
        for kt in key_terms_raw[:8]:
            if isinstance(kt, dict) and kt.get("term"):
                key_terms.append(
                    {"term": str(kt["term"]), "definition": str(kt.get("definition") or "")}
                )
    if not key_terms:
        key_terms = fb["key_terms"]

    questions = raw.get("questions")
    if not isinstance(questions, list) or not questions:
        questions = fb["questions"]
    normalized: list[dict[str, Any]] = []
    for index, q in enumerate(questions[:QUIZ_MAX], start=1):
        if not isinstance(q, dict) or not q.get("stem"):
            continue
        normalized.append(
            {
                "id": str(q.get("id") or f"q{index}"),
                "type": str(q.get("type") or "mcq"),
                "stem": str(q.get("stem")),
                "options": q.get("options") if isinstance(q.get("options"), list) else [],
                "answer": str(q.get("answer") or ""),
                "explanation": str(q.get("explanation") or ""),
            }
        )
    if not normalized:
        normalized = fb["questions"]

    return {
        "summary": summary,
        "notes": notes,
        "key_points": [str(x) for x in key_points[:8]],
        "key_terms": key_terms,
        "questions": normalized,
    }


async def build_web_summary_payload(url: str, title: str, content: str) -> dict[str, Any]:
    text = " ".join((content or "").split())[:6000]
    prompt = f"""你是资深学习笔记助手。请把这个网页整理成一份**包含知识点**的学习笔记，并出一套测验题。

网页标题：{title or "（无）"}
网址：{url or "（无）"}
正文（节选，可能含导航/评论等噪声，请聚焦正文）：
{text or "（正文为空）"}

要求：
1. 笔记要落到**具体知识点**：分 3-6 个要点，每个用「## 小标题 + 2-4 句解释」，必要时给公式/步骤/例子。
2. 若正文信息不足（例如这是视频页只有标题简介），**结合该主题的学科常识补全知识点**，不要只复述页面文字。
3. 出 **8 道**测验题，覆盖不同知识点，类型混合（单选 mcq / 判断 tf / 简答 short），每题给 answer 和 explanation。

只输出 JSON：
{{
  "summary": "80 字内概览",
  "notes": "Markdown 学习笔记正文（## 小标题 + 解释）",
  "key_points": ["要点1", "要点2", "要点3", "要点4", "要点5"],
  "key_terms": [{{"term": "术语", "definition": "一句话定义"}}],
  "questions": [
    {{"id": "q1", "type": "mcq", "stem": "题干", "options": ["A. ..", "B. ..", "C. ..", "D. .."], "answer": "B", "explanation": "解析"}}
  ]
}}"""
    try:
        llm = get_llm(temperature=0.3)
        response = await llm.ainvoke(prompt)
        parsed = parse_json_response(str(response.content))
    except Exception:
        parsed = None

    analysis = _normalize(parsed, title, content)
    safe_title = (title or "网页笔记").strip()[:40] or "网页笔记"
    source = {"title": title or url or "网页", "url": url}

    summary_resource = {
        "type": "reading",
        "title": f"{safe_title}｜学习笔记",
        "subtitle": analysis["summary"],
        "meta": ["网页", f"{len(analysis['key_points'])} 个知识点", "AI 整理"],
        "sources": 1,
        "knowledge_points": "、".join(analysis["key_points"][:5]) or safe_title,
        "data": {
            "title": f"{safe_title}｜学习笔记",
            "overview": analysis["summary"],
            "content": analysis["notes"],
            "key_points": analysis["key_points"],
            "key_terms": analysis["key_terms"],
            "references": [url] if url else [],
            "sources": [source],
        },
        "source": "web",
    }
    quiz_resource = {
        "type": "quiz",
        "title": f"{safe_title}｜随堂测验",
        "subtitle": "基于本页知识点自动生成",
        "meta": [f"{len(analysis['questions'])} 题", "网页"],
        "sources": 1,
        "knowledge_points": "、".join(analysis["key_points"][:5]) or safe_title,
        "data": {
            "title": f"{safe_title}｜随堂测验",
            "questions": analysis["questions"],
            "sources": [source],
        },
        "source": "web",
    }
    return {
        "url": url,
        "title": title,
        "analysis": analysis,
        "summary_resource": summary_resource,
        "quiz_resource": quiz_resource,
    }
