from __future__ import annotations

import logging
from pathlib import Path
import zipfile

import pytest


def test_remotion_props_preserve_scene_timing_and_whiteboard_structure():
    from app.services.media.remotion_render import build_input_props

    props = build_input_props(
        {
            "title": "栈与队列",
            "scenes": [
                {
                    "title": "后进先出",
                    "duration": 9.5,
                    "composition": "process",
                    "reveal_sequence": ["压栈", "栈顶", "出栈"],
                }
            ],
            "visual_system": {"surface": "warm-grid-whiteboard"},
        }
    )

    assert props["title"] == "栈与队列"
    assert props["scenes"][0]["duration"] == 9.5
    assert props["scenes"][0]["reveal_sequence"] == ["压栈", "栈顶", "出栈"]
    assert props["visual_system"]["surface"] == "warm-grid-whiteboard"


def test_packaged_remotion_dependencies_are_extracted_only_when_requested(
    tmp_path, monkeypatch
):
    from app.services.media import remotion_render

    source = tmp_path / "packaged-remotion"
    source.mkdir()
    archive = source / "runtime.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("render.mjs", "// runtime")
        bundle.writestr("src/index.ts", "// entry")
        bundle.writestr("node_modules/@remotion/bundler/package.json", "{}")
        bundle.writestr("node_modules/@remotion/renderer/package.json", "{}")

    media_output = tmp_path / "user-data" / "media" / "output"
    monkeypatch.setenv("REMOTION_RUNTIME_DIR", str(source))
    monkeypatch.setattr(remotion_render.settings, "MEDIA_OUTPUT_DIR", str(media_output))

    assert not (source / "node_modules").exists()
    ready = remotion_render.prepare_runtime_dir()
    assert ready != source
    assert (ready / "render.mjs").is_file()
    assert (ready / "node_modules" / "@remotion" / "bundler").is_dir()
    assert (ready / "node_modules" / "@remotion" / "renderer").is_dir()


def test_packaged_remotion_runtime_reuses_hash_and_only_cleans_hash_caches(
    tmp_path, monkeypatch
):
    from app.services.media import remotion_render

    source = tmp_path / "packaged-remotion"
    source.mkdir()
    archive = source / "runtime.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("render.mjs", "// runtime")
        bundle.writestr("src/index.ts", "// entry")
        bundle.writestr("node_modules/@remotion/bundler/package.json", "{}")
        bundle.writestr("node_modules/@remotion/renderer/package.json", "{}")

    cache_root = tmp_path / "user-data" / "media"
    stale = cache_root / "remotion-runtime-aaaaaaaaaaaa"
    unrelated = cache_root / "remotion-runtime-user-notes"
    stale.mkdir(parents=True)
    unrelated.mkdir()
    media_output = cache_root / "output"
    monkeypatch.setenv("REMOTION_RUNTIME_DIR", str(source))
    monkeypatch.setattr(remotion_render.settings, "MEDIA_OUTPUT_DIR", str(media_output))

    digest_calls = 0
    calculate_digest = remotion_render._calculate_archive_digest

    def counted_digest(path):
        nonlocal digest_calls
        digest_calls += 1
        return calculate_digest(path)

    remotion_render._PREPARED_RUNTIME_CACHE.clear()
    remotion_render._cached_archive_digest.cache_clear()
    monkeypatch.setattr(remotion_render, "_calculate_archive_digest", counted_digest)

    first = remotion_render.prepare_runtime_dir()
    second = remotion_render.prepare_runtime_dir()

    assert first == second
    assert first.is_dir()
    assert digest_calls == 1
    assert not stale.exists()
    assert unrelated.is_dir()


@pytest.mark.asyncio
async def test_video_task_logs_remotion_failure_before_compatibility_fallback(
    tmp_path, monkeypatch, caplog
):
    from app.services.media import narration, remotion_render, storyboard_render
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    rendered = tmp_path / "storyboard.mp4"
    rendered.write_bytes(b"storyboard-video")

    async def failing_remotion(*_args, **_kwargs):
        raise RuntimeError("test renderer failure")

    async def fake_storyboard(*_args, **_kwargs):
        return rendered

    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(remotion_render, "is_available", lambda: True)
    monkeypatch.setattr(remotion_render, "render_remotion_video", failing_remotion)
    monkeypatch.setattr(storyboard_render, "render_storyboard_video", fake_storyboard)
    monkeypatch.setattr(narration, "is_configured", lambda: False)

    manager = MediaTaskManager()
    with caplog.at_level(logging.ERROR, logger=task_module.__name__):
        await manager._render_video(
            "remotion-fallback-task",
            {
                "title": "栈与队列",
                "scenes": [{"title": "后进先出", "duration": 3}],
                "render_config": {
                    "animation_engine": "remotion",
                    "captions": False,
                },
            },
        )

    progress = manager.get_progress("remotion-fallback-task", resume=False)
    assert progress is not None and progress["status"] == "completed"
    assert progress["render_engine"] == "compatibility"
    assert "test renderer failure" in caplog.text


@pytest.mark.asyncio
async def test_video_task_uses_remotion_when_the_script_requests_it(tmp_path, monkeypatch):
    from app.services.media import narration, remotion_render, storyboard_render
    from app.services.media import task as task_module
    from app.services.media.task import MediaTaskManager

    rendered = tmp_path / "remotion.mp4"
    rendered.write_bytes(b"remotion-video")
    captured: dict[str, object] = {}

    async def fake_remotion(script, task_id, on_progress=None):
        captured["task_id"] = task_id
        captured["engine"] = script["render_config"]["animation_engine"]
        if on_progress:
            on_progress(1.0, "Remotion 白板动画已完成")
        return rendered

    async def forbidden_storyboard(*_args, **_kwargs):
        raise AssertionError("compatibility renderer should not run")

    monkeypatch.setattr(task_module.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(remotion_render, "is_available", lambda: True)
    monkeypatch.setattr(remotion_render, "render_remotion_video", fake_remotion)
    monkeypatch.setattr(storyboard_render, "render_storyboard_video", forbidden_storyboard)
    monkeypatch.setattr(narration, "is_configured", lambda: False)

    manager = MediaTaskManager()
    await manager._render_video(
        "remotion-task",
        {
            "title": "栈与队列",
            "scenes": [{"title": "后进先出", "duration": 3}],
            "render_config": {
                "animation_engine": "remotion",
                "captions": False,
            },
        },
    )

    progress = manager.get_progress("remotion-task", resume=False)
    assert captured == {"task_id": "remotion-task", "engine": "remotion"}
    assert progress is not None and progress["status"] == "completed"
    assert progress["render_engine"] == "remotion"
    assert Path(progress["file_path"]).read_bytes() == b"remotion-video"
