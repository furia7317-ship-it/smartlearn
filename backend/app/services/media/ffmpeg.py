"""FFmpeg 音视频合成服务。"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _bounded_thread_count() -> int:
    try:
        requested = int(os.getenv("SMARTLEARN_FFMPEG_THREADS", "2"))
    except ValueError:
        requested = 2
    return max(1, min(4, requested))


FFMPEG_THREAD_COUNT = _bounded_thread_count()
WINDOWS_CREATION_FLAGS = (
    getattr(subprocess, "CREATE_NO_WINDOW", 0)
    | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
    if os.name == "nt"
    else 0
)


def _limit_ffmpeg_args(args: list[str]) -> list[str]:
    """Bound encoder/filter parallelism without changing the output target."""

    if not args:
        return args
    limited = list(args)
    if "-filter_complex" in limited and "-filter_complex_threads" not in limited:
        limited = ["-filter_complex_threads", "1", *limited]
    if any(flag in limited for flag in ("-vf", "-af")) and "-filter_threads" not in limited:
        limited = ["-filter_threads", "1", *limited]
    if "-threads" not in limited:
        limited[-1:-1] = ["-threads", str(FFMPEG_THREAD_COUNT)]
    return limited


def resolve_ffmpeg_binary(name: str = "ffmpeg") -> str:
    """Resolve FFmpeg on developer machines where it is not on ``PATH``."""

    executable = f"{name}.exe" if not name.lower().endswith(".exe") else name
    discovered = shutil.which(name) or shutil.which(executable)
    if discovered:
        return discovered
    for candidate in (
        Path("D:/ffmpeg/bin") / executable,
        Path("C:/ffmpeg/bin") / executable,
        Path.home() / "ffmpeg" / "bin" / executable,
    ):
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError(f"未找到 {name}，请安装 FFmpeg 或将其加入 PATH")


async def _run_ffmpeg(
    args: list[str],
    *,
    cwd: str | Path | None = None,
    error_label: str = "FFmpeg 处理",
) -> None:
    returncode, _stdout, stderr = await _run_process(
        resolve_ffmpeg_binary(),
        _limit_ffmpeg_args(args),
        cwd=cwd,
    )
    if returncode != 0:
        detail = stderr.decode(errors="replace")[-1200:]
        raise RuntimeError(f"{error_label}失败: {detail}")


async def _run_process(
    executable: str,
    args: list[str],
    *,
    cwd: str | Path | None = None,
) -> tuple[int, bytes, bytes]:
    """Run a child process on Windows even under a selector event loop."""

    working_dir = str(cwd) if cwd else None
    try:
        proc = await asyncio.create_subprocess_exec(
            executable,
            *args,
            cwd=working_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=WINDOWS_CREATION_FLAGS,
        )
        stdout, stderr = await proc.communicate()
        return proc.returncode or 0, stdout, stderr
    except NotImplementedError:
        # Uvicorn may use a Windows selector loop without subprocess support.
        # Keep the API async while moving the blocking wait off the event loop.
        completed = await asyncio.to_thread(
            subprocess.run,
            [executable, *args],
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            creationflags=WINDOWS_CREATION_FLAGS,
        )
        return completed.returncode, completed.stdout, completed.stderr


async def merge_audio_video(
    video_path: str | Path,
    audio_path: str | Path,
    output_path: str | Path,
    *,
    music_path: str | Path | None = None,
    music_volume: float = 0.08,
) -> Path:
    """Merge narration and optional looping background music into a video."""
    video_path = Path(video_path)
    audio_path = Path(audio_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    music = Path(music_path) if music_path else None
    if music is not None and music.is_file():
        volume = max(0.0, min(0.5, float(music_volume)))
        args = [
            "-y", "-i", str(video_path), "-i", str(audio_path),
            "-stream_loop", "-1", "-i", str(music),
            "-filter_complex",
            f"[1:a]apad[narration];[2:a]volume={volume:.3f}[music];"
            "[narration][music]amix=inputs=2:duration=first:dropout_transition=2[mixed]",
            "-map", "0:v:0", "-map", "[mixed]", "-c:v", "copy", "-c:a", "aac",
            "-shortest", "-movflags", "+faststart", str(output_path),
        ]
    else:
        args = [
            "-y", "-i", str(video_path), "-i", str(audio_path),
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
            # Padding makes ``-shortest`` stop at the video end rather than at
            # an encoder rounding difference in the narration track.
            "-af", "apad", "-shortest", "-movflags", "+faststart", str(output_path),
        ]

    await _run_ffmpeg(args, error_label="FFmpeg 音视频合成")

    return output_path


async def add_subtitles(
    video_path: str | Path,
    subtitle_path: str | Path,
    output_path: str | Path,
) -> Path:
    """Burn SRT or styled ASS subtitles into a video."""
    video_path = Path(video_path)
    subtitle_path = Path(subtitle_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    video_path = video_path.resolve()
    subtitle_path = subtitle_path.resolve()
    output_path = output_path.resolve()

    # Run beside the subtitle so the filter never parses a Windows drive
    # colon/backslash sequence.  The generated task ids are filename-safe.
    if subtitle_path.suffix.lower() == ".ass":
        subtitle_filter = f"ass='{subtitle_path.name}'"
    else:
        subtitle_filter = (
            f"subtitles='{subtitle_path.name}':"
            "force_style='FontName=Microsoft YaHei,FontSize=20,"
            "PrimaryColour=&H00FFFFFF,OutlineColour=&H00251A10,"
            "BorderStyle=1,Outline=2,Shadow=1,MarginV=34,Alignment=2'"
        )
    args = [
        "-y",
        "-i", str(video_path),
        "-vf", subtitle_filter,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(output_path),
    ]

    await _run_ffmpeg(
        args,
        cwd=subtitle_path.parent,
        error_label="FFmpeg 字幕烧录",
    )

    return output_path


async def generate_srt(
    narration: list[dict[str, Any]],
    output_path: str | Path,
) -> Path:
    """根据配音段落生成 SRT 字幕文件。"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    cue_index = 1
    for cue in timeline_caption_cues(narration):
        lines.extend([
            str(cue_index),
            f"{_format_srt_time(cue['start'])} --> {_format_srt_time(cue['end'])}",
            str(cue["text"]),
            "",
        ])
        cue_index += 1

    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


def build_caption_cues(
    text: str,
    duration: float,
    *,
    start_offset: float = 0.0,
    max_chars: int = 28,
) -> list[dict[str, Any]]:
    """Build readable cue timings without using ASR text."""

    chunks = _subtitle_chunks(text, max_chars=max_chars)
    weights = [max(1, len(re.sub(r"\s+", "", chunk))) for chunk in chunks]
    total_weight = max(1, sum(weights))
    cues: list[dict[str, Any]] = []
    cursor = max(0.0, float(start_offset))
    end_at = cursor + max(0.5, float(duration))
    for index, (chunk, weight) in enumerate(zip(chunks, weights, strict=True)):
        cue_end = end_at if index == len(chunks) - 1 else cursor + duration * weight / total_weight
        cues.append({"text": chunk, "start": cursor, "end": cue_end})
        cursor = cue_end
    return cues


def timeline_caption_cues(narration: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Offset scene-local native cues onto the complete video timeline."""

    timeline: list[dict[str, Any]] = []
    scene_start = 0.0
    for segment in narration:
        text = str(segment.get("text") or segment.get("narration") or "").strip()
        try:
            duration = max(0.5, float(segment.get("duration") or 5))
        except (TypeError, ValueError):
            duration = 5.0
        explicit = segment.get("caption_cues")
        local_cues = explicit if isinstance(explicit, list) and explicit else build_caption_cues(text, duration)
        for cue in local_cues:
            if not isinstance(cue, dict):
                continue
            start = max(0.0, float(cue.get("start") or 0))
            end = min(duration, float(cue.get("end") or duration))
            cue_text = str(cue.get("text") or "").strip()
            if cue_text and end > start:
                timeline.append({"text": cue_text, "start": scene_start + start, "end": scene_start + end})
        scene_start += duration
    return timeline


def _ass_time(seconds: float) -> str:
    centiseconds = max(0, round(float(seconds) * 100))
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    secs, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{fraction:02d}"


def _karaoke_tokens(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9+#.\-]+|[\u4e00-\u9fff]{1,2}|[^\w\s]", text)
    return tokens or [text]


def _ass_escape(text: str) -> str:
    return text.replace("\\", r"\N").replace("{", "（").replace("}", "）")


def _karaoke_text(text: str, duration: float) -> str:
    tokens = _karaoke_tokens(text)
    weights = [max(1, len(re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]", "", token))) for token in tokens]
    total_cs = max(len(tokens), round(max(0.2, duration) * 100))
    remaining = total_cs
    markup: list[str] = []
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        tokens_left = len(tokens) - index - 1
        token_cs = (
            remaining
            if index == len(tokens) - 1
            else min(
                max(1, round(total_cs * weight / sum(weights))),
                max(1, remaining - tokens_left),
            )
        )
        remaining -= token_cs
        markup.append(r"{\kf" + str(max(1, token_cs)) + "}" + _ass_escape(token))
    return "".join(markup)


async def generate_ass(
    narration: list[dict[str, Any]],
    output_path: str | Path,
    *,
    orientation: str = "landscape",
    position: str = "bottom",
) -> Path:
    """Generate highlighted, phrase-level ASS subtitles."""

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    portrait = orientation == "portrait"
    width, height = (720, 1280) if portrait else (1280, 720)
    font_size = 42 if portrait else 36
    alignment = {"top": 8, "center": 5, "bottom": 2}.get(position, 2)
    margin_v = 150 if portrait and position == "bottom" else (70 if portrait else 44)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Active,Microsoft YaHei,{font_size},&H0000D7FF,&H00FFFFFF,&H00180F08,&H00000000,-1,0,0,0,100,100,0,0,1,5,1,{alignment},42,42,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    paged_cues: list[dict[str, Any]] = []
    for cue in timeline_caption_cues(narration):
        cue_duration = float(cue["end"]) - float(cue["start"])
        paged_cues.extend(
            build_caption_cues(
                str(cue["text"]),
                cue_duration,
                start_offset=float(cue["start"]),
                max_chars=16 if portrait else 26,
            )
        )
    events = [
        "Dialogue: 0,"
        f"{_ass_time(cue['start'])},{_ass_time(cue['end'])},Active,,0,0,0,,"
        f"{_karaoke_text(str(cue['text']), float(cue['end']) - float(cue['start']))}"
        for cue in paged_cues
    ]
    output_path.write_text(header + "\n".join(events) + "\n", encoding="utf-8-sig")
    return output_path


async def detect_silence_intervals(
    audio_path: str | Path,
    *,
    noise_db: float = -38.0,
    minimum_duration: float = 0.18,
) -> list[tuple[float, float]]:
    """Return silence intervals detected in a narration track."""

    returncode, _stdout, stderr = await _run_process(
        resolve_ffmpeg_binary(),
        [
            "-hide_banner", "-i", str(Path(audio_path)),
            "-af", f"silencedetect=noise={noise_db:g}dB:d={minimum_duration:g}",
            "-f", "null", "-",
        ],
    )
    if returncode != 0:
        raise RuntimeError(f"FFmpeg 静音检测失败: {stderr.decode(errors='replace')[-500:]}")
    log = stderr.decode(errors="replace")
    starts = [float(value) for value in re.findall(r"silence_start:\s*([0-9.]+)", log)]
    ends = [float(value) for value in re.findall(r"silence_end:\s*([0-9.]+)", log)]
    return [(start, end) for start, end in zip(starts, ends) if end > start]


def adjust_cues_to_silence(
    cues: list[dict[str, Any]],
    silence_intervals: list[tuple[float, float]],
    *,
    duration: float,
    tolerance: float = 0.45,
) -> list[dict[str, Any]]:
    """Snap adjacent caption boundaries to nearby detected pauses."""

    adjusted = [dict(cue) for cue in cues if isinstance(cue, dict)]
    for index in range(len(adjusted) - 1):
        left = adjusted[index]
        right = adjusted[index + 1]
        boundary = (float(left.get("end") or 0) + float(right.get("start") or 0)) / 2
        nearby = [
            interval for interval in silence_intervals
            if abs(((interval[0] + interval[1]) / 2) - boundary) <= tolerance
        ]
        if not nearby:
            continue
        silence_start, silence_end = min(
            nearby,
            key=lambda interval: abs(((interval[0] + interval[1]) / 2) - boundary),
        )
        left_start = float(left.get("start") or 0)
        right_end = float(right.get("end") or duration)
        left["end"] = max(left_start + 0.1, min(silence_start, right_end - 0.1))
        right["start"] = min(right_end - 0.1, max(silence_end, left_start + 0.1))
    for cue in adjusted:
        cue["start"] = max(0.0, min(float(cue.get("start") or 0), max(0.0, duration - 0.05)))
        cue["end"] = min(
            duration,
            max(cue["start"] + 0.05, min(float(cue.get("end") or duration), duration)),
        )
    return adjusted


def _subtitle_chunks(text: str, max_chars: int = 28) -> list[str]:
    """Split narration into readable subtitle cues without cutting words."""

    if not text:
        return [""]
    sentences = [
        part.strip()
        for part in re.split(r"(?<=[。！？!?；;])", text)
        if part.strip()
    ] or [text]
    chunks: list[str] = []
    for sentence in sentences:
        remaining = sentence
        while len(remaining) > max_chars:
            cut = max(
                remaining.rfind(marker, 0, max_chars + 1)
                for marker in ("，", "、", ",", " ")
            )
            if cut < max_chars // 2:
                cut = max_chars
            else:
                cut += 1
            chunks.append(remaining[:cut].strip())
            remaining = remaining[cut:].strip()
        if remaining:
            chunks.append(remaining)
    return chunks or [text]


async def probe_media_duration(path: str | Path) -> float:
    """Return media duration in seconds for render verification."""

    returncode, stdout, stderr = await _run_process(
        resolve_ffmpeg_binary("ffprobe"),
        [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(Path(path)),
        ],
    )
    if returncode != 0:
        raise RuntimeError(f"FFprobe 读取失败: {stderr.decode(errors='replace')[-500:]}")
    return float(stdout.decode().strip())


async def concat_audio_files(
    audio_paths: list[str | Path],
    output_path: str | Path,
) -> Path:
    """Concatenate per-scene narration into one stable MP3 track."""

    paths = [Path(path).resolve() for path in audio_paths if Path(path).is_file()]
    if not paths:
        raise RuntimeError("没有可合并的章节配音")
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = output_path.with_suffix(".txt")
    manifest.write_text(
        "\n".join(f"file '{path.as_posix()}'" for path in paths),
        encoding="utf-8",
    )
    await _run_ffmpeg(
        [
            "-y", "-f", "concat", "-safe", "0", "-i", str(manifest),
            "-c:a", "libmp3lame", "-b:a", "160k", str(output_path),
        ],
        error_label="章节配音合并",
    )
    return output_path


def _format_srt_time(seconds: float) -> str:
    """格式化 SRT 时间戳。"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
