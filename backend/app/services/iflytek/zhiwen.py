"""讯飞智文 AIPPT 客户端 —— 真·设计 PPT 生成（模板库 + 生成 + 进度轮询）。

对接参考国一作品同款能力：科大讯飞「智能PPT生成 / 智文」。生成的是带版式/配图/封面的
成品 .pptx（托管在智文 CDN，返回 pptUrl），而非 python-pptx 的纯文字铺色。

鉴权：HTTP 头 appId/timestamp/signature；
      signature = base64(HMAC-SHA1(md5(appId + timestamp), apiSecret))。
接口：v2/template/list（模板库，带缩略图）、v2/create（multipart，按 query+templateId 生成）、
      v2/progress?sid=（building/done/build_failed + pptUrl）。
凭证取自 settings.IFLYTEK_APPID / IFLYTEK_API_SECRET。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from app.core.config import settings

_BASE = "https://zwapi.xfyun.cn/api/ppt/v2"


def is_configured() -> bool:
    return bool(settings.IFLYTEK_APPID and settings.IFLYTEK_API_SECRET)


def _headers() -> dict[str, str]:
    appid = settings.IFLYTEK_APPID
    ts = int(time.time())
    auth = hashlib.md5(f"{appid}{ts}".encode("utf-8")).hexdigest()
    sig = base64.b64encode(
        hmac.new(settings.IFLYTEK_API_SECRET.encode("utf-8"), auth.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8")
    return {"appId": appid, "timestamp": str(ts), "signature": sig}


def _thumbnail(rec: dict[str, Any]) -> str:
    """模板缩略图在 detailImage（JSON 字符串）里，挑第一个可用封面。"""
    di = rec.get("detailImage")
    if isinstance(di, str):
        try:
            di = json.loads(di)
        except Exception:
            di = {}
    if isinstance(di, dict):
        for k in ("titleCoverImageLarge", "titleCoverImage", "contentCoverImage", "titleCoverImageSmall"):
            if di.get(k):
                return str(di[k])
    return ""


def list_templates(
    *, page: int = 1, size: int = 24, style: str | None = None,
    color: str | None = None, industry: str | None = None,
) -> dict[str, Any]:
    """模板库（带缩略图），用于前端图片模板墙。"""
    payload: dict[str, Any] = {"pageNum": page, "pageSize": size}
    if style:
        payload["style"] = style
    if color:
        payload["color"] = color
    if industry:
        payload["industry"] = industry
    with httpx.Client(timeout=30) as c:
        r = c.post(f"{_BASE}/template/list", headers=_headers(), json=payload)
    data = (r.json() or {}).get("data") or {}
    recs = data.get("records") or []
    templates = [
        {
            "key": x.get("templateIndexId"),
            "thumbnail": _thumbnail(x),
            "style": x.get("style") or "",
            "color": x.get("color") or "",
            "industry": x.get("industry") or "",
            "pageCount": x.get("pageCount") or 0,
        }
        for x in recs
        if x.get("templateIndexId")
    ]
    return {"total": data.get("total") or len(templates), "templates": templates}


def create(
    query: str, template_id: str, *,
    author: str = "学枢", is_figure: bool = True, ai_image: str = "normal",
) -> dict[str, Any]:
    """提交生成任务，返回 sid（+封面/标题）。query 为生成要求（≤8000 字）。"""
    files = {
        "query": (None, (query or "")[:8000]),
        "templateId": (None, template_id or ""),
        "author": (None, author),
        "isFigure": (None, "true" if is_figure else "false"),
        "aiImage": (None, ai_image),
    }
    with httpx.Client(timeout=60) as c:
        r = c.post(f"{_BASE}/create", headers=_headers(), files=files)
    j = r.json() or {}
    if j.get("code") != 0:
        raise RuntimeError(j.get("desc") or j.get("message") or f"智文创建失败 code={j.get('code')}")
    d = j.get("data") or {}
    return {"sid": d.get("sid"), "cover": d.get("coverImgSrc"), "title": d.get("title")}


def progress(sid: str) -> dict[str, Any]:
    """查询进度。status: building / done / build_failed。"""
    with httpx.Client(timeout=30) as c:
        r = c.get(f"{_BASE}/progress", headers=_headers(), params={"sid": sid})
    d = (r.json() or {}).get("data") or {}
    return {
        "status": d.get("pptStatus"),
        "ppt_url": d.get("pptUrl"),
        "total": d.get("totalPages") or 0,
        "done": d.get("donePages") or 0,
    }
