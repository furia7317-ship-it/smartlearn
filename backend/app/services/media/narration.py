"""Provider-neutral narration generation and caption alignment."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.services.media import ffmpeg
from app.services.media import mimo_tts, minimax_tts
from app.services.media.pronunciation import (
    PronunciationHint,
    apply_pronunciation_hints,
)


@dataclass(frozen=True)
class SceneNarration:
    path: Path
    duration: float
    cues: list[dict[str, Any]]
    provider: str
    spoken_text: str


def is_configured() -> bool:
    """Return whether at least one narration provider is available."""

    if mimo_tts.is_configured() or minimax_tts.is_configured():
        return True
    from app.services.iflytek import tts as iflytek_tts

    return iflytek_tts.is_configured()


def preferred_audio_suffix() -> str:
    """Use WAV for MiMo's official non-streaming output, MP3 otherwise."""

    return ".wav" if mimo_tts.is_configured() else ".mp3"


def _caption_text_on_native_timing(
    original_text: str,
    native_cues: list[dict[str, Any]],
    duration: float,
) -> list[dict[str, Any]]:
    """Keep original on-screen copy while using provider timing boundaries."""

    if not native_cues:
        return ffmpeg.build_caption_cues(original_text, duration)
    fallback = ffmpeg.build_caption_cues(original_text, duration)
    if len(fallback) == len(native_cues):
        return [
            {
                "text": fallback[index]["text"],
                "start": max(0.0, float(cue.get("start") or 0)),
                "end": min(duration, float(cue.get("end") or duration)),
            }
            for index, cue in enumerate(native_cues)
            if float(cue.get("end") or 0) > float(cue.get("start") or 0)
        ]
    native_start = max(0.0, float(native_cues[0].get("start") or 0))
    native_end = min(duration, float(native_cues[-1].get("end") or duration))
    return ffmpeg.build_caption_cues(
        original_text,
        max(0.5, native_end - native_start),
        start_offset=native_start,
    )


async def synthesize_scene(
    original_text: str,
    output_path: str | Path,
    pronunciation_hints: list[PronunciationHint],
) -> SceneNarration:
    """Synthesize one chapter section with provider fallback."""

    spoken_text = apply_pronunciation_hints(original_text, pronunciation_hints)
    output_path = Path(output_path)
    provider = ""
    native_cues: list[dict[str, Any]] = []
    errors: list[str] = []

    if mimo_tts.is_configured():
        try:
            await mimo_tts.synthesize(spoken_text, output_path)
            provider = "mimo"
        except Exception as exc:
            errors.append(f"MiMo: {type(exc).__name__}")

    if not provider and minimax_tts.is_configured():
        try:
            result = await minimax_tts.synthesize(
                spoken_text,
                output_path,
                pronunciation_hints=pronunciation_hints,
            )
            provider = "minimax"
            native_cues = result.cues
        except Exception as exc:
            errors.append(f"MiniMax: {type(exc).__name__}")

    if not provider:
        from app.services.iflytek import tts as iflytek_tts

        if iflytek_tts.is_configured():
            try:
                await iflytek_tts.synthesize(spoken_text, output_path)
                provider = "iflytek"
            except Exception as exc:
                errors.append(f"讯飞: {type(exc).__name__}")

    if not provider:
        raise RuntimeError("；".join(errors) if errors else "未配置可用的 TTS 服务")

    duration = max(0.5, await ffmpeg.probe_media_duration(output_path))
    cues = _caption_text_on_native_timing(original_text, native_cues, duration)
    try:
        silence_intervals = await ffmpeg.detect_silence_intervals(output_path)
    except Exception:
        silence_intervals = []
    cues = ffmpeg.adjust_cues_to_silence(cues, silence_intervals, duration=duration)
    return SceneNarration(
        path=output_path,
        duration=duration,
        cues=cues,
        provider=provider,
        spoken_text=spoken_text,
    )
