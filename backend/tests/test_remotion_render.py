from __future__ import annotations

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
        bundle.writestr("node_modules/@remotion/renderer/package.json", "{}")

    media_output = tmp_path / "user-data" / "media" / "output"
    monkeypatch.setenv("REMOTION_RUNTIME_DIR", str(source))
    monkeypatch.setattr(remotion_render.settings, "MEDIA_OUTPUT_DIR", str(media_output))

    assert not (source / "node_modules").exists()
    ready = remotion_render.prepare_runtime_dir()
    assert ready != source
    assert (ready / "render.mjs").is_file()
    assert (ready / "node_modules" / "@remotion" / "renderer").is_dir()


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
