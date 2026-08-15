from __future__ import annotations

import asyncio
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.deps import get_llm
from app.core.llm import parse_json_response
from app.services.web_search import bocha_search

BVID_RE = re.compile(r"(BV[0-9A-Za-z]{10})")
BILIBILI_SEARCH_URL = "https://search.bilibili.com/video"
BILIBILI_VIEW_URL = "https://api.bilibili.com/x/web-interface/view"
BILIBILI_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com/",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


@dataclass(slots=True)
class BilibiliVideoResult:
    bvid: str
    title: str
    url: str
    embed_url: str
    author: str = ""
    cover: str = ""
    duration: str = ""
    summary: str = ""
    published_at: str = ""

    def model_dump(self) -> dict[str, Any]:
        return asdict(self)


def extract_bvid(value: str) -> str | None:
    match = BVID_RE.search(value or "")
    return match.group(1) if match else None


def bilibili_video_url(bvid: str) -> str:
    return f"https://www.bilibili.com/video/{bvid}/"


def bilibili_embed_url(bvid: str) -> str:
    return f"https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0"


def _clean_title(title: str) -> str:
    cleaned = re.sub(r"<[^>]+>", "", title or "")
    cleaned = re.sub(r"\s*[-_]\s*哔哩哔哩.*$", "", cleaned)
    cleaned = cleaned.replace("_哔哩哔哩_bilibili", "")
    return cleaned.strip() or "B站学习视频"


def _result_from_web(item: dict[str, Any]) -> BilibiliVideoResult | None:
    # BV 号可能只出现在 url、标题或摘要里，逐字段兜底提取，提高命中率
    haystack = " ".join(
        str(item.get(key) or "") for key in ("url", "title", "snippet", "summary")
    )
    bvid = extract_bvid(haystack)
    if not bvid:
        return None
    summary = str(item.get("summary") or item.get("snippet") or "")
    return BilibiliVideoResult(
        bvid=bvid,
        title=_clean_title(str(item.get("title") or "")),
        url=bilibili_video_url(bvid),
        embed_url=bilibili_embed_url(bvid),
        author=str(item.get("site") or "哔哩哔哩"),
        cover=str(item.get("cover") or item.get("site_icon") or ""),
        duration=str(item.get("duration") or ""),
        summary=summary,
        published_at=str(item.get("date") or ""),
    )


def _duration_label(seconds: Any) -> str:
    try:
        total = max(0, int(seconds or 0))
    except (TypeError, ValueError):
        return ""
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _result_from_view(payload: Any) -> BilibiliVideoResult | None:
    if not isinstance(payload, dict) or payload.get("code") != 0:
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    bvid = extract_bvid(str(data.get("bvid") or ""))
    title = _clean_title(str(data.get("title") or ""))
    if not bvid or not title:
        return None
    owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
    published_at = ""
    try:
        published_at = datetime.fromtimestamp(
            int(data.get("pubdate") or 0),
            tz=timezone.utc,
        ).date().isoformat()
    except (OSError, OverflowError, TypeError, ValueError):
        pass
    cover = str(data.get("pic") or "")
    if cover.startswith("http://"):
        cover = f"https://{cover.removeprefix('http://')}"
    return BilibiliVideoResult(
        bvid=bvid,
        title=title,
        url=bilibili_video_url(bvid),
        embed_url=bilibili_embed_url(bvid),
        author=str(owner.get("name") or "哔哩哔哩"),
        cover=cover,
        duration=_duration_label(data.get("duration")),
        summary=str(data.get("desc") or ""),
        published_at=published_at,
    )


def _search_relevance(keyword: str, video: BilibiliVideoResult) -> int:
    haystack = f"{video.title} {video.summary} {video.author}".lower()
    terms = [
        item.lower()
        for item in re.findall(r"[A-Za-z0-9+#]{2,}|[\u4e00-\u9fff]{2,}", keyword)
    ]
    score = sum(5 for term in terms if term in haystack)
    chinese = "".join(re.findall(r"[\u4e00-\u9fff]", keyword))
    bigrams = {chinese[index:index + 2] for index in range(max(0, len(chinese) - 1))}
    score += sum(1 for item in bigrams if item in haystack)
    return score


def _search_bilibili_public(keyword: str, count: int) -> list[BilibiliVideoResult]:
    """Search Bilibili without a third-party key and hydrate public video metadata."""

    with httpx.Client(
        headers=BILIBILI_HEADERS,
        follow_redirects=True,
        timeout=httpx.Timeout(20.0, connect=10.0),
    ) as client:
        response: httpx.Response | None = None
        for attempt in range(3):
            try:
                response = client.get(BILIBILI_SEARCH_URL, params={"keyword": keyword})
                response.raise_for_status()
                break
            except (httpx.HTTPStatusError, httpx.TransportError):
                if attempt == 2:
                    raise
                time.sleep(0.35 * (attempt + 1))
        if response is None:
            return []
        bvids = list(dict.fromkeys(BVID_RE.findall(response.text)))
        bvids = bvids[:max(16, min(30, count * 3))]

        def hydrate(bvid: str) -> BilibiliVideoResult | None:
            try:
                metadata = client.get(
                    BILIBILI_VIEW_URL,
                    params={"bvid": bvid},
                    timeout=6.0,
                )
                metadata.raise_for_status()
                return _result_from_view(metadata.json())
            except (httpx.HTTPError, ValueError):
                return None

        with ThreadPoolExecutor(max_workers=min(8, len(bvids) or 1)) as executor:
            hydrated = list(executor.map(hydrate, bvids))

    ranked = [
        (index, video, _search_relevance(keyword, video))
        for index, video in enumerate(hydrated)
        if video is not None
    ]
    relevant = [item for item in ranked if item[2] > 0]
    relevant.sort(key=lambda item: (-item[2], item[0]))
    return [video for _, video, _ in relevant[:count]]


def search_bilibili_videos(query: str, count: int = 8) -> list[BilibiliVideoResult]:
    keyword = (query or "").strip()
    if not keyword:
        return []

    direct_bvid = extract_bvid(keyword)
    if direct_bvid:
        return [
            BilibiliVideoResult(
                bvid=direct_bvid,
                title=f"视频 {direct_bvid}",
                url=bilibili_video_url(direct_bvid),
                embed_url=bilibili_embed_url(direct_bvid),
                author="哔哩哔哩",
            )
        ]

    # 多组查询兜底：site: 限定较严时常返回空，再退到更宽松的关键词搜索。
    # 仅在前一组结果不足时才追加下一组，控制时延。
    queries = [
        f"site:bilibili.com/video {keyword}",
        f"哔哩哔哩 {keyword} 教程",
        f"bilibili {keyword}",
    ]
    seen: set[str] = set()
    videos: list[BilibiliVideoResult] = []
    for q in queries:
        if len(videos) >= 4:
            break
        try:
            raw_results = bocha_search(q, count=count)
        except Exception:
            continue
        for item in raw_results:
            video = _result_from_web(item)
            if video is None or video.bvid in seen:
                continue
            seen.add(video.bvid)
            videos.append(video)
            if len(videos) >= count:
                return videos
    if videos:
        return videos
    try:
        return _search_bilibili_public(keyword, count)
    except Exception:
        return []


def _fallback_analysis(video: BilibiliVideoResult, note: str) -> dict[str, Any]:
    topic = video.title or "视频内容"
    base = video.summary or note or f"围绕「{topic}」进行学习复盘。"
    return {
        "summary": base,
        "key_points": [topic, "视频要点复盘", "结合课程知识库继续练习"],
        "questions": [
            {
                "id": "q1",
                "type": "mcq",
                "stem": f"观看「{topic}」后，最应该先整理什么？",
                "options": ["A. 视频标题", "B. 核心概念、例题步骤和易错点", "C. 弹幕数量", "D. 发布时间"],
                "answer": "B",
                "explanation": "学习型视频复盘应聚焦概念、步骤和易错点，方便后续练习。",
            }
        ],
    }


def _normalize_analysis(raw: Any, video: BilibiliVideoResult, note: str) -> dict[str, Any]:
    fallback = _fallback_analysis(video, note)
    if not isinstance(raw, dict):
        return fallback
    summary = str(raw.get("summary") or fallback["summary"])
    key_points = raw.get("key_points")
    if not isinstance(key_points, list) or not key_points:
        key_points = fallback["key_points"]
    questions = raw.get("questions")
    if not isinstance(questions, list) or not questions:
        questions = fallback["questions"]

    normalized_questions: list[dict[str, Any]] = []
    for index, question in enumerate(questions[:8], start=1):
        if not isinstance(question, dict) or not question.get("stem"):
            continue
        normalized_questions.append(
            {
                "id": str(question.get("id") or f"q{index}"),
                "type": str(question.get("type") or "mcq"),
                "stem": str(question.get("stem")),
                "options": question.get("options") if isinstance(question.get("options"), list) else [],
                "answer": str(question.get("answer") or ""),
                "explanation": str(question.get("explanation") or ""),
            }
        )
    if not normalized_questions:
        normalized_questions = fallback["questions"]

    return {
        "summary": summary,
        "key_points": [str(item) for item in key_points[:8]],
        "questions": normalized_questions,
    }


async def build_video_learning_payload(
    video: BilibiliVideoResult,
    *,
    watched_seconds: int = 0,
    note: str = "",
) -> dict[str, Any]:
    watched_label = "已看完" if watched_seconds > 0 else "未记录"
    prompt = f"""
你是学习视频复盘智能体。请根据 B站视频信息和学生观看记录，生成可保存到资源中心的学习总结和练习题。

视频标题：{video.title}
BV号：{video.bvid}
视频链接：{video.url}
搜索摘要：{video.summary or "无"}
观看进度：{watched_label}，已观看 {watched_seconds} 秒
学生备注：{note or "无"}

请只输出 JSON：
{{
  "summary": "一段 120 字以内的学习总结",
  "key_points": ["要点1", "要点2", "要点3"],
  "questions": [
    {{
      "id": "q1",
      "type": "mcq",
      "stem": "题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "解析"
    }}
  ]
}}
"""
    try:
        llm = get_llm(temperature=0.2)
        response = await llm.ainvoke(prompt)
        parsed = parse_json_response(str(response.content))
    except Exception:
        parsed = _fallback_analysis(video, note)

    analysis = _normalize_analysis(parsed, video, note)
    source = {
        "title": video.title,
        "url": video.url,
        "bvid": video.bvid,
        "summary": video.summary,
    }
    watched_meta = f"已观看 {watched_seconds} 秒" if watched_seconds > 0 else "观看记录"

    summary_resource = {
        "type": "reading",
        "title": f"{video.title}｜视频学习总结",
        "subtitle": analysis["summary"],
        "meta": ["B站视频", watched_meta],
        "sources": 1,
        "knowledge_points": video.title,
        "data": {
            "title": f"{video.title}｜视频学习总结",
            "content": analysis["summary"],
            "key_points": analysis["key_points"],
            "references": [video.url],
            "sources": [source],
            "video": video.model_dump(),
            "watched_seconds": watched_seconds,
            "note": note,
        },
        "source": "video",
    }
    quiz_resource = {
        "type": "quiz",
        "title": f"{video.title}｜视频复盘题",
        "subtitle": "基于本次观看记录自动生成",
        "meta": [f"{len(analysis['questions'])} 题", "B站视频"],
        "sources": 1,
        "knowledge_points": video.title,
        "data": {
            "title": f"{video.title}｜视频复盘题",
            "questions": analysis["questions"],
            "sources": [source],
            "video": video.model_dump(),
            "watched_seconds": watched_seconds,
        },
        "source": "video",
    }
    path_attachment = {
        "type": "video",
        "title": video.title,
        "url": video.url,
        "bvid": video.bvid,
        "embed_url": video.embed_url,
        "summary": analysis["summary"],
        "watched_seconds": watched_seconds,
    }
    return {
        "video": video.model_dump(),
        "analysis": analysis,
        "summary_resource": summary_resource,
        "quiz_resource": quiz_resource,
        "path_attachment": path_attachment,
    }


async def search_bilibili_videos_async(query: str, count: int = 8) -> list[BilibiliVideoResult]:
    return await asyncio.to_thread(search_bilibili_videos, query, count)
