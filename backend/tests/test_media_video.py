from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_ffmpeg_uses_a_worker_thread_when_async_subprocesses_are_unsupported(
    monkeypatch,
):
    from app.services.media import ffmpeg

    captured: dict[str, object] = {}

    async def unavailable_subprocess(*_args, **_kwargs):
        raise NotImplementedError

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["cwd"] = kwargs.get("cwd")
        captured["creationflags"] = kwargs.get("creationflags")
        return SimpleNamespace(returncode=0, stdout=b"ok", stderr=b"")

    monkeypatch.setattr(ffmpeg.asyncio, "create_subprocess_exec", unavailable_subprocess)
    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)
    monkeypatch.setattr(ffmpeg, "resolve_ffmpeg_binary", lambda _name="ffmpeg": "ffmpeg.exe")

    await ffmpeg._run_ffmpeg(["-version"], cwd="render-dir")

    assert captured["command"] == [
        "ffmpeg.exe",
        "-threads",
        str(ffmpeg.FFMPEG_THREAD_COUNT),
        "-version",
    ]
    assert captured["cwd"] == "render-dir"
    assert captured["creationflags"] == ffmpeg.WINDOWS_CREATION_FLAGS


@pytest.mark.asyncio
async def test_video_render_completes_silently_when_tts_is_unconfigured(
    tmp_path,
    monkeypatch,
):
    from app.services.iflytek import tts
    from app.services.media import ffmpeg, storyboard_render
    from app.services.media.task import MediaTaskManager
    from app.services.media import task as task_module

    silent_video = tmp_path / "silent.mp4"
    silent_video.write_bytes(b"mp4")

    durable_video = tmp_path / "video_tasks" / "video-1" / "final.mp4"
    captured: dict[str, object] = {}

    async def fake_render(script, task_id, on_progress=None):
        captured["render_orientation"] = script["render_config"]["orientation"]
        if on_progress:
            on_progress(1.0, "已渲染 1/1 个分镜")
        return silent_video

    async def fake_generate_ass(_narration, output, *, orientation, position):
        captured["caption_orientation"] = orientation
        captured["caption_position"] = position
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("ass", encoding="utf-8")
        return output

    async def fake_subtitles(_video, _srt, output):
        Path(output).write_bytes(b"captioned mp4")
        return Path(output)

    monkeypatch.setattr(storyboard_render, "render_storyboard_video", fake_render)
    monkeypatch.setattr(ffmpeg, "generate_ass", fake_generate_ass)
    monkeypatch.setattr(ffmpeg, "add_subtitles", fake_subtitles)
    monkeypatch.setattr(tts, "is_configured", lambda: False)
    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))

    manager = MediaTaskManager()
    manager._progress["video-1"] = {
        "id": "video-1",
        "status": "pending",
        "progress": 0.0,
        "file_path": None,
        "error": None,
        "audio_status": "pending",
        "audio_message": None,
    }
    await manager._render_video(
        "video-1",
        {
            "template": "concept_card",
            "params": {},
            "narration": [{"text": "这段旁白暂不合成"}],
            "render_config": {"orientation": "portrait", "caption_position": "center"},
        },
    )

    progress = manager.get_progress("video-1")
    assert progress is not None
    assert progress["status"] == "completed"
    assert Path(progress["file_path"]) == durable_video
    assert durable_video.read_bytes() == b"captioned mp4"
    assert progress["file_size_bytes"] == len(b"captioned mp4")
    assert progress["completed_at"]
    assert progress["audio_status"] == "not_configured"
    assert "字幕成片" in progress["audio_message"]
    assert progress["subtitle_status"] == "completed"
    assert captured == {
        "render_orientation": "landscape",
        "caption_orientation": "landscape",
        "caption_position": "center",
    }


@pytest.mark.asyncio
async def test_video_task_never_marks_a_png_fallback_as_completed(tmp_path, monkeypatch):
    from app.services.media import manim_render, storyboard_render
    from app.services.media.task import MediaTaskManager

    png = tmp_path / "not-a-video.png"
    png.write_bytes(b"png")

    async def fake_render(*args, **kwargs):
        return png

    monkeypatch.setattr(storyboard_render, "render_storyboard_video", fake_render)
    monkeypatch.setattr(manim_render, "fallback_slideshow", fake_render)

    manager = MediaTaskManager()
    manager._progress["video-2"] = {
        "id": "video-2",
        "status": "pending",
        "progress": 0.0,
        "file_path": None,
        "error": None,
        "audio_status": "pending",
        "audio_message": None,
    }
    await manager._render_video("video-2", {"template": "concept_card", "params": {}})

    progress = manager.get_progress("video-2")
    assert progress is not None
    assert progress["status"] == "failed"
    assert progress["file_path"] is None
    assert "有效 MP4" in progress["error"]


def test_tts_stays_disabled_until_the_explicit_feature_switch_is_enabled(monkeypatch):
    from app.services.iflytek import tts

    monkeypatch.setattr(tts.settings, "IFLYTEK_APPID", "app")
    monkeypatch.setattr(tts.settings, "IFLYTEK_API_KEY", "key")
    monkeypatch.setattr(tts.settings, "IFLYTEK_API_SECRET", "secret")
    monkeypatch.setattr(tts.settings, "IFLYTEK_TTS_ENABLED", False)

    assert tts.is_configured() is False


@pytest.mark.asyncio
async def test_configured_tts_drives_scene_and_caption_timing(tmp_path, monkeypatch):
    from app.services.iflytek import tts
    from app.services.media import ffmpeg, storyboard_render
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    captured: dict[str, object] = {}

    async def fake_synthesize(_text, output):
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"mp3")
        return output

    async def fake_probe(path):
        return 2.5 if "section-01" in str(path) else 3.5

    async def fake_concat(_paths, output):
        output = Path(output)
        output.write_bytes(b"joined audio")
        return output

    async def fake_storyboard(script, _task_id, on_progress=None):
        captured["durations"] = [scene["duration"] for scene in script["scenes"]]
        output = tmp_path / "storyboard.mp4"
        output.write_bytes(b"mp4")
        if on_progress:
            on_progress(1.0, "已渲染 2/2 个分镜")
        return output

    async def fake_subtitles(_video, _srt, output):
        captured["captions"] = True
        output = Path(output)
        output.write_bytes(b"captioned")
        return output

    async def fake_merge(_video, _audio, output):
        output = Path(output)
        output.write_bytes(b"final")
        return output

    monkeypatch.setattr(tts, "is_configured", lambda: True)
    monkeypatch.setattr(tts, "synthesize", fake_synthesize)
    monkeypatch.setattr(ffmpeg, "probe_media_duration", fake_probe)
    monkeypatch.setattr(ffmpeg, "concat_audio_files", fake_concat)
    monkeypatch.setattr(ffmpeg, "add_subtitles", fake_subtitles)
    monkeypatch.setattr(ffmpeg, "merge_audio_video", fake_merge)
    monkeypatch.setattr(storyboard_render, "render_storyboard_video", fake_storyboard)
    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))

    manager = MediaTaskManager()
    manager._progress["video-tts"] = {
        "id": "video-tts", "status": "pending", "progress": 0.0,
        "file_path": None, "error": None, "audio_status": "pending",
        "audio_message": None, "subtitle_status": "pending", "render_stage": "queued",
    }
    await manager._render_video(
        "video-tts",
        {
            "scenes": [
                {"title": "第一镜", "narration": "第一段", "duration": 20},
                {"title": "第二镜", "narration": "第二段", "duration": 20},
            ],
            "narration": [
                {"text": "第一段", "duration": 20},
                {"text": "第二段", "duration": 20},
            ],
        },
    )

    progress = manager.get_progress("video-tts")
    assert captured["durations"] == [2.5, 3.5]
    assert captured["captions"] is True
    assert progress is not None and progress["status"] == "completed"
    assert progress["audio_status"] == "completed"
    assert Path(progress["file_path"]).read_bytes() == b"final"


def test_video_progress_restores_a_completed_mp4_after_restart(tmp_path, monkeypatch):
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    task_id = "restored-done"
    task_dir = tmp_path / "video_tasks" / task_id
    task_dir.mkdir(parents=True)
    output = tmp_path / f"{task_id}_captioned.mp4"
    output.write_bytes(b"captioned")
    (task_dir / "script.json").write_text(
        json.dumps({"title": "恢复测试", "narration": [{"text": "内容"}]}),
        encoding="utf-8",
    )
    (task_dir / "progress.json").write_text(
        json.dumps({
            "id": task_id,
            "kind": "video",
            "status": "completed",
            "progress": 1.0,
            "file_path": str(output),
        }),
        encoding="utf-8",
    )

    manager = MediaTaskManager()
    progress = manager.get_progress(task_id)

    assert progress is not None
    assert progress["status"] == "completed"
    assert progress["progress"] == 1.0
    durable_output = task_dir / "final.mp4"
    assert Path(progress["file_path"]) == durable_output
    assert durable_output.read_bytes() == b"captioned"


def test_video_progress_recovers_task_owned_final_when_manifest_is_missing(
    tmp_path,
    monkeypatch,
):
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    task_id = "manifest-lost"
    task_dir = tmp_path / "video_tasks" / task_id
    task_dir.mkdir(parents=True)
    (task_dir / "script.json").write_text("{}", encoding="utf-8")
    (task_dir / "final.mp4").write_bytes(b"durable-video")

    progress = MediaTaskManager().get_progress(task_id)

    assert progress is not None
    assert progress["status"] == "completed"
    assert progress["file_size_bytes"] == len(b"durable-video")
    assert Path(progress["file_path"]) == task_dir / "final.mp4"


def test_video_progress_rejects_a_path_like_task_id():
    from app.services.media.task import MediaTaskManager

    manager = MediaTaskManager()

    assert manager.get_progress("../outside") is None


def test_video_resources_replace_completed_tasks_from_an_older_workflow(monkeypatch):
    from app.services.media import task as task_module

    created: list[dict[str, object]] = []
    monkeypatch.setattr(
        task_module.media_task_manager,
        "get_progress",
        lambda task_id: {
            "status": "completed",
            "workflow_version": "scene-native-timeline-v2" if task_id == "old-task" else task_module.VIDEO_WORKFLOW_VERSION,
        },
    )

    def fake_create_task(**kwargs):
        created.append(kwargs)
        return "new-v3-task"

    monkeypatch.setattr(task_module.media_task_manager, "create_task", fake_create_task)
    resources = [
        {"type": "video", "title": "旧版", "media_task_id": "old-task"},
        {"type": "video", "title": "新版", "media_task_id": "current-task"},
    ]

    task_module.ensure_video_render_tasks(resources, student_id="student-1")

    assert resources[0]["media_task_id"] == "new-v3-task"
    assert resources[1]["media_task_id"] == "current-task"
    assert len(created) == 1


@pytest.mark.asyncio
async def test_video_progress_resumes_an_unfinished_script_after_restart(
    tmp_path,
    monkeypatch,
):
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    task_id = "restored-run"
    task_dir = tmp_path / "video_tasks" / task_id
    task_dir.mkdir(parents=True)
    script = {"title": "续跑测试", "narration": [{"text": "继续渲染"}]}
    (task_dir / "script.json").write_text(
        json.dumps(script, ensure_ascii=False),
        encoding="utf-8",
    )
    (task_dir / "progress.json").write_text(
        json.dumps({
            "id": task_id,
            "kind": "video",
            "status": "rendering",
            "progress": 0.4,
            "file_path": None,
        }),
        encoding="utf-8",
    )

    manager = MediaTaskManager()
    resumed = asyncio.Event()

    async def fake_resume(resumed_task_id, resumed_script):
        assert resumed_task_id == task_id
        assert resumed_script == script
        output = tmp_path / f"{task_id}_captioned.mp4"
        output.write_bytes(b"resumed")
        manager._update_progress(
            task_id,
            status="completed",
            progress=1.0,
            file_path=str(output),
            render_stage="completed",
        )
        resumed.set()

    monkeypatch.setattr(manager, "_render_video_queued", fake_resume)

    progress = manager.get_progress(task_id)
    assert progress is not None
    assert progress["render_stage"] == "正在恢复视频任务"
    await asyncio.wait_for(resumed.wait(), timeout=1)

    restored = manager.get_progress(task_id)
    assert restored is not None
    assert restored["status"] == "completed"
    assert Path(restored["file_path"]).read_bytes() == b"resumed"


@pytest.mark.asyncio
async def test_video_progress_snapshot_does_not_resume_until_explicit_request(
    tmp_path,
    monkeypatch,
):
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    task_id = "paused-render"
    task_dir = tmp_path / "video_tasks" / task_id
    task_dir.mkdir(parents=True)
    script = {"title": "暂停测试", "narration": [{"text": "等待用户继续"}]}
    (task_dir / "script.json").write_text(
        json.dumps(script, ensure_ascii=False),
        encoding="utf-8",
    )
    (task_dir / "progress.json").write_text(
        json.dumps({
            "id": task_id,
            "kind": "video",
            "status": "rendering",
            "progress": 0.4,
            "file_path": None,
        }),
        encoding="utf-8",
    )

    manager = MediaTaskManager()
    resumed = asyncio.Event()

    async def fake_resume(resumed_task_id, resumed_script):
        assert resumed_task_id == task_id
        assert resumed_script == script
        resumed.set()

    monkeypatch.setattr(manager, "_render_video_queued", fake_resume)

    snapshot = manager.peek_progress(task_id)
    await asyncio.sleep(0)
    assert snapshot is not None and snapshot["status"] == "rendering"
    assert manager.is_active(task_id) is False
    assert resumed.is_set() is False

    resumed_progress = manager.resume_video(task_id)
    assert resumed_progress is not None
    await asyncio.wait_for(resumed.wait(), timeout=1)
