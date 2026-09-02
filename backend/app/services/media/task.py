"""异步媒体任务管理器。"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings

VIDEO_WORKFLOW_VERSION = "remotion-whiteboard-mimo-v5"
logger = logging.getLogger(__name__)


class MediaTaskManager:
    """管理异步媒体渲染任务。"""

    _TASK_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._progress: dict[str, dict[str, Any]] = {}
        self._persistent_video_tasks: set[str] = set()
        # Video encoding is CPU intensive. Keep one desktop render active at a
        # time so restoring or generating multiple resources cannot saturate
        # the machine and starve Electron/audio processing.
        self._video_slots = asyncio.Semaphore(1)

    def _task_dir(self, task_id: str) -> Path:
        return Path(settings.MEDIA_OUTPUT_DIR) / "video_tasks" / task_id

    def _progress_path(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "progress.json"

    def _script_path(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "script.json"

    def _durable_video_path(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "final.mp4"

    def _archive_completed_video(self, task_id: str, source: Path) -> Path:
        """Copy a completed render into the task-owned persistent directory."""

        source = source.resolve()
        if not source.is_file() or source.suffix.lower() != ".mp4":
            raise RuntimeError("视频渲染完成，但成片文件无效")
        target = self._durable_video_path(task_id).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        if source != target:
            temporary = target.with_suffix(".mp4.tmp")
            shutil.copy2(source, temporary)
            temporary.replace(target)
        if not target.is_file() or target.stat().st_size <= 0:
            raise RuntimeError("视频成片持久化失败")
        return target

    @staticmethod
    def _initial_progress(
        task_id: str,
        *,
        student_id: str = "",
        kind: str = "video",
        topic: str = "讲解视频",
    ) -> dict[str, Any]:
        return {
            "id": task_id,
            "student_id": student_id,
            "kind": kind,
            "topic": topic,
            "status": "pending",
            "progress": 0.0,
            "file_path": None,
            "error": None,
            "audio_status": "pending",
            "audio_message": None,
            "subtitle_status": "pending",
            "render_stage": "queued",
            "render_engine": None,
            "workflow_version": VIDEO_WORKFLOW_VERSION,
            "tts_provider": None,
            "file_size_bytes": None,
            "completed_at": None,
        }

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        temporary.replace(path)

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any] | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _persist_script(self, task_id: str, script: dict[str, Any]) -> None:
        self._write_json(self._script_path(task_id), script)

    def _persist_progress(self, task_id: str) -> None:
        if task_id not in self._persistent_video_tasks:
            return
        progress = self._progress.get(task_id)
        if progress is not None:
            self._write_json(self._progress_path(task_id), progress)

    def _update_progress(self, task_id: str, **changes: Any) -> None:
        self._progress[task_id].update(changes)
        self._persist_progress(task_id)

    def _completed_video_path(
        self,
        task_id: str,
        progress: dict[str, Any] | None = None,
    ) -> Path | None:
        output_dir = Path(settings.MEDIA_OUTPUT_DIR).resolve()
        candidates: list[Path] = [self._durable_video_path(task_id).resolve()]
        file_path = (progress or {}).get("file_path")
        if isinstance(file_path, str) and file_path:
            persisted = Path(file_path)
            candidates.append(persisted if persisted.is_absolute() else persisted.resolve())
            candidates.append(output_dir / persisted.name)
        candidates.extend(
            [
                output_dir / f"{task_id}_final.mp4",
                output_dir / f"{task_id}_captioned.mp4",
                output_dir / f"{task_id}.mp4",
            ]
        )
        for candidate in candidates:
            if candidate.suffix.lower() == ".mp4" and candidate.is_file():
                return candidate
        return None

    def _restore_video_progress(self, task_id: str) -> dict[str, Any] | None:
        script_exists = self._script_path(task_id).is_file()
        progress = self._read_json(self._progress_path(task_id))
        completed_path = self._completed_video_path(task_id, progress)
        if progress is None and not script_exists and completed_path is None:
            return None

        restored = self._initial_progress(task_id)
        if progress is not None:
            restored.update(progress)
        restored["id"] = task_id
        restored["kind"] = "video"

        if completed_path is not None and (
            restored.get("status") == "completed"
            or completed_path == self._durable_video_path(task_id).resolve()
            or completed_path.name in {
                f"{task_id}_final.mp4",
                f"{task_id}_captioned.mp4",
                f"{task_id}.mp4",
            }
        ):
            try:
                completed_path = self._archive_completed_video(task_id, completed_path)
            except (OSError, RuntimeError):
                # Keep a readable legacy output available even if migration is blocked.
                pass
            restored.update(
                status="completed",
                progress=1.0,
                file_path=str(completed_path),
                file_size_bytes=completed_path.stat().st_size,
                error=None,
                render_stage="completed",
            )
        elif restored.get("status") == "completed":
            if script_exists:
                restored.update(
                    status="pending",
                    progress=0.0,
                    file_path=None,
                    error=None,
                    render_stage="正在恢复视频任务",
                )
            else:
                restored.update(
                    status="failed",
                    file_path=None,
                    error="已完成的视频文件不存在，且任务脚本无法恢复",
                    render_stage="failed",
                )

        self._progress[task_id] = restored
        self._persistent_video_tasks.add(task_id)
        self._persist_progress(task_id)
        return restored

    def _track_task(self, task_id: str, task: asyncio.Task) -> None:
        self._tasks[task_id] = task

        def forget(completed: asyncio.Task) -> None:
            if self._tasks.get(task_id) is completed:
                self._tasks.pop(task_id, None)

        task.add_done_callback(forget)

    def _resume_restored_video(self, task_id: str) -> None:
        progress = self._progress[task_id]
        if progress.get("status") in {"completed", "failed"}:
            return
        active = self._tasks.get(task_id)
        if active is not None and not active.done():
            return

        script = self._read_json(self._script_path(task_id))
        if script is None:
            self._update_progress(
                task_id,
                status="failed",
                error="视频任务脚本不存在，无法在服务重启后恢复",
                render_stage="failed",
            )
            return
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return

        self._update_progress(
            task_id,
            status="pending",
            error=None,
            render_stage="正在恢复视频任务",
        )
        self._track_task(
            task_id,
            asyncio.create_task(self._render_video_queued(task_id, script)),
        )

    def create_task(
        self,
        student_id: str,
        kind: str,
        topic: str,
        script: dict[str, Any],
    ) -> str:
        """创建异步渲染任务，返回 task_id。"""
        if kind not in {"video", "ppt"}:
            raise ValueError(f"不支持的媒体类型: {kind}")
        task_id = str(uuid.uuid4())[:12]

        self._progress[task_id] = self._initial_progress(
            task_id,
            student_id=student_id,
            kind=kind,
            topic=topic,
        )

        if kind == "video":
            self._persistent_video_tasks.add(task_id)
            self._persist_script(task_id, script)
            self._persist_progress(task_id)
            task = asyncio.create_task(self._render_video_queued(task_id, script))
        else:
            task = asyncio.create_task(self._render_ppt(task_id, script))

        self._track_task(task_id, task)
        return task_id

    def get_progress(
        self,
        task_id: str,
        *,
        resume: bool = True,
    ) -> dict[str, Any] | None:
        """获取任务进度。"""
        if self._TASK_ID_PATTERN.fullmatch(task_id) is None:
            return None
        progress = self._progress.get(task_id)
        if progress is not None:
            return progress
        progress = self._restore_video_progress(task_id)
        if progress is not None and resume:
            self._resume_restored_video(task_id)
        return progress

    def peek_progress(self, task_id: str) -> dict[str, Any] | None:
        """Read persisted progress without restarting an interrupted render."""

        return self.get_progress(task_id, resume=False)

    def is_active(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        return task is not None and not task.done()

    def resume_video(self, task_id: str) -> dict[str, Any] | None:
        """Resume an interrupted render only after an explicit user action."""

        progress = self.get_progress(task_id, resume=False)
        if progress is None:
            return None
        if progress.get("status") not in {"completed", "failed"}:
            self._resume_restored_video(task_id)
        return self._progress.get(task_id)

    async def _render_video_queued(self, task_id: str, script: dict[str, Any]):
        async with self._video_slots:
            await self._render_video(task_id, script)

    async def _render_video(self, task_id: str, script: dict[str, Any]):
        """Render storyboard -> captions -> optional TTS -> final MP4."""
        defaults = self._initial_progress(task_id)
        progress = self._progress.setdefault(task_id, defaults)
        for key, value in defaults.items():
            progress.setdefault(key, value)
        try:
            self._update_progress(
                task_id,
                status="rendering",
                progress=0.03,
                error=None,
                render_stage="正在准备章节内容",
            )

            narration = [
                dict(item)
                for item in (
                    script.get("narration") or [
                        {
                            "text": scene.get("narration") or scene.get("text") or "",
                            "duration": scene.get("duration") or 20,
                        }
                        for scene in script.get("scenes") or []
                        if isinstance(scene, dict)
                    ]
                )
                if isinstance(item, dict)
            ]
            render_script = copy.deepcopy(script)
            render_script["narration"] = narration
            scenes = [
                dict(scene)
                for scene in render_script.get("scenes") or []
                if isinstance(scene, dict)
            ]
            render_script["scenes"] = scenes
            render_config = (
                dict(render_script.get("render_config"))
                if isinstance(render_script.get("render_config"), dict)
                else {}
            )
            # 学枢视频统一使用稳定的 16:9 画布进行创作和导出。
            # stage. This also upgrades previously stored portrait scripts.
            render_config["orientation"] = "landscape"
            render_script["render_config"] = render_config

            # The scene-first workflow derives video and caption timing from
            # speech. MiMo is preferred; providers without native timestamps
            # use deterministic cue timing corrected against detected silence.
            from app.services.media.ffmpeg import concat_audio_files
            from app.services.media.narration import (
                is_configured as narration_is_configured,
                preferred_audio_suffix,
                synthesize_scene,
            )
            from app.services.media.pronunciation import collect_pronunciation_hints

            tts_configured = bool(narration) and narration_is_configured()
            audio_path: Path | None = None
            audio_providers: list[str] = []
            if tts_configured:
                planned_narration_durations = [segment.get("duration") for segment in narration]
                planned_scene_durations = [scene.get("duration") for scene in scenes]
                try:
                    scene_audio: list[Path] = []
                    for index, segment in enumerate(narration):
                        segment_text = str(segment.get("text") or segment.get("narration") or "")
                        self._update_progress(
                            task_id,
                            render_stage=(
                                f"正在校正发音并生成第 {index + 1}/{len(narration)} 个章节内容配音"
                            ),
                            progress=0.03 + 0.17 * (index + 1) / len(narration),
                        )
                        segment_path = (
                            Path(settings.MEDIA_OUTPUT_DIR)
                            / "video_tasks"
                            / task_id
                            / "audio"
                            / f"section-{index + 1:02d}{preferred_audio_suffix()}"
                        )
                        hints = collect_pronunciation_hints(render_script, segment_text)
                        result = await synthesize_scene(segment_text, segment_path, hints)
                        duration = max(1.0, result.duration)
                        segment["duration"] = round(duration, 2)
                        segment["caption_cues"] = result.cues
                        segment["tts_provider"] = result.provider
                        segment["pronunciation_hints"] = [
                            {"term": hint.term, "spoken": hint.spoken, "source": hint.source}
                            for hint in hints
                        ]
                        if index < len(scenes):
                            scenes[index]["duration"] = round(duration, 2)
                            scenes[index]["caption_cues"] = result.cues
                        scene_audio.append(segment_path)
                        audio_providers.append(result.provider)
                    audio_path = Path(settings.MEDIA_OUTPUT_DIR) / f"{task_id}_audio.mp3"
                    await concat_audio_files(scene_audio, audio_path)
                    self._persist_script(task_id, render_script)
                    provider_label = " + ".join(dict.fromkeys(audio_providers))
                    self._update_progress(
                        task_id,
                        audio_status="generated",
                        tts_provider=provider_label,
                        audio_message=f"{provider_label} 配音已生成，字幕时间轴已按静音区间校正",
                    )
                except Exception as exc:
                    for segment, planned_duration in zip(
                        narration, planned_narration_durations, strict=False
                    ):
                        segment["duration"] = planned_duration
                        segment.pop("caption_cues", None)
                        segment.pop("tts_provider", None)
                        segment.pop("pronunciation_hints", None)
                    for scene, planned_duration in zip(scenes, planned_scene_durations, strict=False):
                        scene["duration"] = planned_duration
                        scene.pop("caption_cues", None)
                    audio_path = None
                    self._update_progress(
                        task_id,
                        audio_status="failed",
                        audio_message=f"配音暂未合成，继续生成完整字幕成片：{type(exc).__name__}",
                    )
            else:
                self._update_progress(
                    task_id,
                    audio_status="not_configured" if narration else "not_requested",
                )

            def update_visual_progress(value: float, detail: str) -> None:
                self._update_progress(
                    task_id,
                    progress=0.23 + value * 0.42,
                    render_stage=detail,
                )

            # 1. New scripts use the bundled Remotion runtime for scene-first
            # whiteboard motion. Existing scripts and unavailable runtimes keep
            # the original renderer as a safe compatibility path.
            requested_engine = str(render_config.get("animation_engine") or "").lower()
            mp4_path: Path | None = None
            if requested_engine == "remotion":
                try:
                    from app.services.media.remotion_render import (
                        is_available as remotion_is_available,
                        render_remotion_video,
                    )

                    if await asyncio.to_thread(remotion_is_available):
                        self._update_progress(task_id, render_engine="remotion")
                        mp4_path = await render_remotion_video(
                            render_script,
                            task_id,
                            on_progress=update_visual_progress,
                        )
                except Exception:
                    # A valid video is more useful than surfacing a renderer
                    # installation detail to the learner. The progress UI only
                    # reports that a compatible rendering mode is being used.
                    logger.exception(
                        "Remotion render failed for media task %s; falling back to storyboard",
                        task_id,
                    )
                    mp4_path = None

            if mp4_path is None:
                from app.services.media.storyboard_render import render_storyboard_video

                self._update_progress(
                    task_id,
                    render_engine="compatibility",
                    render_stage="正在使用兼容模式生成章节动画",
                )
                mp4_path = await render_storyboard_video(
                    render_script,
                    task_id,
                    on_progress=update_visual_progress,
                )
            if not mp4_path.is_file() or mp4_path.suffix.lower() != ".mp4":
                raise RuntimeError("视频章节内容渲染器未产出有效 MP4")

            # 2. Captions are part of the deliverable, not an optional preview
            # overlay.  They are burned into the MP4 so exported files match
            # what the learner reviewed in the app.
            from app.services.media.ffmpeg import add_subtitles, generate_ass

            captioned_path = mp4_path
            captions_enabled = bool(render_config.get("captions", True))
            if narration and captions_enabled:
                self._update_progress(
                    task_id,
                    progress=0.72,
                    render_stage="正在生成高亮字幕并烧录",
                )
                ass_path = Path(settings.MEDIA_OUTPUT_DIR) / "video_tasks" / task_id / f"{task_id}.ass"
                await generate_ass(
                    narration,
                    ass_path,
                    orientation=str(render_config.get("orientation") or "landscape"),
                    position=str(render_config.get("caption_position") or "bottom"),
                )
                subtitle_output = Path(settings.MEDIA_OUTPUT_DIR) / f"{task_id}_captioned.mp4"
                await add_subtitles(mp4_path, ass_path, subtitle_output)
                captioned_path = subtitle_output
                self._update_progress(task_id, subtitle_status="completed")
            else:
                self._update_progress(task_id, subtitle_status="not_requested")

            # 3. Merge the per-scene speech track.  Until credentials are
            # supplied, the complete captioned MP4 still ships successfully.
            final_path = captioned_path
            if audio_path is not None:
                try:
                    self._update_progress(
                        task_id,
                        progress=0.88,
                        render_stage="正在混合配音与背景音乐",
                    )

                    from app.services.media.ffmpeg import merge_audio_video
                    from app.services.media.music import select_background_music

                    output_path = Path(settings.MEDIA_OUTPUT_DIR) / f"{task_id}_final.mp4"
                    music_path = select_background_music(render_script)
                    try:
                        music_volume = float(render_config.get("music_volume") or 0.08)
                    except (TypeError, ValueError):
                        music_volume = 0.08
                    if music_path is not None:
                        await merge_audio_video(
                            captioned_path,
                            audio_path,
                            output_path,
                            music_path=music_path,
                            music_volume=music_volume,
                        )
                    else:
                        await merge_audio_video(captioned_path, audio_path, output_path)
                    final_path = output_path
                    self._update_progress(
                        task_id,
                        audio_status="completed",
                        audio_message=(
                            "旁白、原生时间轴字幕与背景音乐已完成混合"
                            if music_path is not None
                            else "旁白已合成，字幕时间轴已对齐"
                        ),
                    )
                except Exception as exc:  # TTS must never discard a valid MP4.
                    self._update_progress(
                        task_id,
                        audio_status="failed",
                        audio_message=f"配音暂未合成，已保留完整字幕成片：{type(exc).__name__}",
                    )
            elif not self._progress[task_id].get("audio_message"):
                self._update_progress(
                    task_id,
                    audio_message=(
                        "TTS 密钥尚未配置，已生成完整字幕成片；配置密钥后可直接补配音"
                        if narration
                        else "该视频脚本没有旁白，已生成无声视频"
                    ),
                )

            durable_path = await asyncio.to_thread(
                self._archive_completed_video,
                task_id,
                final_path,
            )
            self._update_progress(
                task_id,
                status="completed",
                progress=1.0,
                file_path=str(durable_path),
                file_size_bytes=durable_path.stat().st_size,
                completed_at=datetime.now(timezone.utc).isoformat(),
                error=None,
                render_stage="completed",
            )

        except Exception as e:
            # Last-resort legacy renderer.  A scene/content problem falls back
            # automatically; only a missing local video runtime is surfaced.
            try:
                from app.services.media.manim_render import fallback_slideshow

                fallback_path = await fallback_slideshow(script, task_id)
                if not fallback_path.is_file() or fallback_path.suffix.lower() != ".mp4":
                    raise RuntimeError("视频兜底渲染未产出有效 MP4")
                durable_path = await asyncio.to_thread(
                    self._archive_completed_video,
                    task_id,
                    fallback_path,
                )
                self._update_progress(
                    task_id,
                    status="completed",
                    progress=1.0,
                    file_path=str(durable_path),
                    file_size_bytes=durable_path.stat().st_size,
                    completed_at=datetime.now(timezone.utc).isoformat(),
                    error=None,
                    render_stage="fallback_completed",
                    audio_message="已自动切换兼容渲染器完成成片",
                )
            except Exception as fallback_error:
                primary_detail = str(e).strip() or type(e).__name__
                fallback_detail = str(fallback_error).strip() or type(fallback_error).__name__
                self._update_progress(
                    task_id,
                    status="failed",
                    file_path=None,
                    error=f"{primary_detail}；兼容渲染失败：{fallback_detail}",
                    render_stage="failed",
                )

    async def _render_ppt(self, task_id: str, script: dict[str, Any]):
        """异步渲染 PPT。"""
        try:
            self._progress[task_id]["status"] = "rendering"

            from app.services.media.ppt import create_ppt

            output_path = Path(settings.MEDIA_OUTPUT_DIR) / f"{task_id}.pptx"
            await create_ppt(script, output_path)
            self._progress[task_id]["status"] = "completed"
            self._progress[task_id]["progress"] = 1.0
            self._progress[task_id]["file_path"] = str(output_path)

        except Exception as e:
            self._progress[task_id]["status"] = "failed"
            self._progress[task_id]["error"] = str(e)


# 全局单例
media_task_manager = MediaTaskManager()


def ensure_video_render_tasks(
    resources: list[dict[str, Any]],
    *,
    student_id: str,
) -> list[dict[str, Any]]:
    """Start missing video renders and annotate resources with their task id."""

    for resource in resources:
        if str(resource.get("type") or "") != "video":
            continue
        existing = str(resource.get("media_task_id") or "")
        if existing:
            progress = media_task_manager.get_progress(existing)
            if progress is not None and progress.get("workflow_version") == VIDEO_WORKFLOW_VERSION:
                continue
        task_id = media_task_manager.create_task(
            student_id=student_id,
            kind="video",
            topic=str(resource.get("title") or "讲解视频"),
            script=resource,
        )
        resource["media_task_id"] = task_id
        resource["media_status"] = "rendering"
    return resources
