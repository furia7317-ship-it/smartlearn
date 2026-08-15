"""MiniMax speech synthesis with provider-native subtitle timestamps."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings
from app.services.media.pronunciation import PronunciationHint, minimax_tone_entries


@dataclass(frozen=True)
class MiniMaxSynthesis:
    path: Path
    cues: list[dict[str, Any]]


def is_configured() -> bool:
    return settings.MINIMAX_TTS_ENABLED and bool(settings.MINIMAX_API_KEY.strip())


def _time_seconds(value: Any, field: str = "") -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    lowered = field.lower()
    if (
        "ms" in lowered
        or "millisecond" in lowered
        or lowered in {"start_time", "begin_time", "end_time", "finish_time"}
        or number > 100
    ):
        return number / 1000.0
    return number


def _parse_srt(payload: str) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    pattern = re.compile(
        r"(?:^|\n)\s*\d+\s*\n"
        r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*"
        r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*\n"
        r"(.*?)(?=\n\s*\n|\Z)",
        re.DOTALL,
    )
    for match in pattern.finditer(payload.replace("\r\n", "\n")):
        values = [int(value) for value in match.groups()[:8]]
        start = values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000
        end = values[4] * 3600 + values[5] * 60 + values[6] + values[7] / 1000
        text = re.sub(r"\s+", " ", match.group(9)).strip()
        if text and end > start:
            cues.append({"text": text, "start": start, "end": end})
    return cues


def parse_subtitle_payload(payload: Any) -> list[dict[str, Any]]:
    """Normalize MiniMax subtitle JSON/SRT variants into seconds."""

    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", errors="replace")
    if isinstance(payload, str):
        stripped = payload.strip()
        if "-->" in stripped:
            return _parse_srt(stripped)
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return []
    if isinstance(payload, dict):
        for key in ("subtitles", "subtitle", "sentences", "segments", "data"):
            candidate = payload.get(key)
            if isinstance(candidate, (list, dict)):
                payload = candidate
                break
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return []

    cues: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        text = str(
            item.get("text")
            or item.get("subtitle")
            or item.get("sentence")
            or item.get("content")
            or ""
        ).strip()
        start_key = next(
            (key for key in ("start_time", "begin_time", "start_ms", "start", "begin") if key in item),
            "start",
        )
        end_key = next(
            (key for key in ("end_time", "end_ms", "end", "finish_time") if key in item),
            "end",
        )
        start = _time_seconds(item.get(start_key), start_key)
        end = _time_seconds(item.get(end_key), end_key)
        if text and end > start:
            cues.append({"text": text, "start": start, "end": end})
    return sorted(cues, key=lambda cue: (float(cue["start"]), float(cue["end"])))


async def synthesize(
    text: str,
    output_path: str | Path,
    *,
    pronunciation_hints: list[PronunciationHint] | None = None,
) -> MiniMaxSynthesis:
    if not is_configured():
        raise RuntimeError("MiniMax TTS 尚未配置")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    request_payload: dict[str, Any] = {
        "model": settings.MINIMAX_TTS_MODEL,
        "text": text,
        "stream": False,
        "subtitle_enable": True,
        "output_format": "hex",
        "voice_setting": {
            "voice_id": settings.MINIMAX_TTS_VOICE_ID,
            "speed": max(0.5, min(2.0, settings.MINIMAX_TTS_SPEED)),
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }
    tone_entries = minimax_tone_entries(pronunciation_hints or [])
    if tone_entries:
        request_payload["pronunciation_dict"] = {"tone": tone_entries}

    params = {"GroupId": settings.MINIMAX_GROUP_ID} if settings.MINIMAX_GROUP_ID.strip() else None
    headers = {
        "Authorization": f"Bearer {settings.MINIMAX_API_KEY.strip()}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
        response = await client.post(
            settings.MINIMAX_TTS_URL,
            headers=headers,
            params=params,
            json=request_payload,
        )
        response.raise_for_status()
        payload = response.json()
        base_resp = payload.get("base_resp") if isinstance(payload, dict) else None
        if isinstance(base_resp, dict) and int(base_resp.get("status_code") or 0) != 0:
            raise RuntimeError(str(base_resp.get("status_msg") or "MiniMax TTS 返回错误"))
        data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else payload
        if not isinstance(data, dict):
            raise RuntimeError("MiniMax TTS 返回格式无效")
        encoded_audio = str(data.get("audio") or payload.get("audio") or "")
        if not encoded_audio:
            raise RuntimeError("MiniMax TTS 未返回音频")
        try:
            audio = bytes.fromhex(encoded_audio)
        except ValueError:
            try:
                audio = base64.b64decode(encoded_audio, validate=True)
            except (ValueError, TypeError) as exc:
                raise RuntimeError("MiniMax TTS 音频编码无效") from exc
        output_path.write_bytes(audio)

        extra_info = payload.get("extra_info") if isinstance(payload.get("extra_info"), dict) else {}
        subtitle_url = str(
            data.get("subtitle_file")
            or payload.get("subtitle_file")
            or extra_info.get("subtitle_file")
            or ""
        )
        cues: list[dict[str, Any]] = []
        if subtitle_url.startswith("https://"):
            # subtitle_file is commonly a pre-signed object-storage URL. Do
            # not forward the MiniMax bearer token to a different host.
            subtitle_response = await client.get(subtitle_url)
            subtitle_response.raise_for_status()
            cues = parse_subtitle_payload(subtitle_response.content)
        elif data.get("subtitle") or data.get("subtitles"):
            cues = parse_subtitle_payload(data.get("subtitle") or data.get("subtitles"))

    return MiniMaxSynthesis(path=output_path, cues=cues)
