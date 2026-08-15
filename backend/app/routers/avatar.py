"""数字人公共元数据与短期鉴权。

浏览器只获得带时间戳的讯飞 WebSocket 签名 URL；长期 APISecret 始终留在
后端。签名 URL 由讯飞限制为约 5 分钟有效，不能用来生成新的签名。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import urlencode

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()

_AVATAR_HOST = "avatar.cn-huadong-1.xf-yun.com"
_AVATAR_PATH = "/v1/interact"


def _avatar_is_configured() -> bool:
    return bool(
        settings.IFLYTEK_AVATAR_APPID.strip()
        and settings.IFLYTEK_AVATAR_API_KEY.strip()
        and settings.IFLYTEK_AVATAR_API_SECRET.strip()
        and settings.IFLYTEK_AVATAR_ID.strip()
    )


def _signed_avatar_url() -> tuple[str, str]:
    """生成讯飞实时数字人 WebSocket 的短期签名 URL。"""
    date = format_datetime(datetime.now(timezone.utc), usegmt=True)
    signature_origin = (
        f"host: {_AVATAR_HOST}\n"
        f"date: {date}\n"
        f"GET {_AVATAR_PATH} HTTP/1.1"
    )
    digest = hmac.new(
        settings.IFLYTEK_AVATAR_API_SECRET.encode("utf-8"),
        signature_origin.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    signature = base64.b64encode(digest).decode("ascii")
    authorization_origin = (
        f'api_key="{settings.IFLYTEK_AVATAR_API_KEY}", '
        'algorithm="hmac-sha256", headers="host date request-line", '
        f'signature="{signature}"'
    )
    query = urlencode(
        {
            "authorization": base64.b64encode(
                authorization_origin.encode("utf-8")
            ).decode("ascii"),
            "date": date,
            "host": _AVATAR_HOST,
        }
    )
    return f"wss://{_AVATAR_HOST}{_AVATAR_PATH}?{query}", date


@router.get("/config")
async def avatar_config():
    """返回公共元数据和短期签名 URL，不序列化 API Key 或 Secret。"""
    configured = _avatar_is_configured()
    signed_url = ""
    signed_at = ""
    if configured:
        signed_url, signed_at = _signed_avatar_url()
    return {
        "configured": configured,
        "appId": settings.IFLYTEK_AVATAR_APPID if configured else "",
        "avatarId": settings.IFLYTEK_AVATAR_ID,
        "sceneId": settings.IFLYTEK_AVATAR_SCENE_ID,
        "vcn": settings.IFLYTEK_AVATAR_VCN,
        "signedUrl": signed_url,
        "signedAt": signed_at,
    }
