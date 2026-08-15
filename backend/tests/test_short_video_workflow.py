from __future__ import annotations

import json

import pytest
from PIL import Image


def test_pronunciation_pipeline_keeps_caption_copy_and_overrides_persistent_hint(
    tmp_path,
    monkeypatch,
):
    from app.services.media import pronunciation

    lexicon = tmp_path / "pronunciation.json"
    lexicon.write_text(
        json.dumps({"API": "旧读法", "缓存": "还存"}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        pronunciation.settings,
        "MEDIA_PRONUNCIATION_LEXICON_PATH",
        str(lexicon),
    )
    original = "API 会先读取缓存。"
    hints = pronunciation.collect_pronunciation_hints(
        {"pronunciation_hints": [{"term": "API", "spoken": "A P I"}]},
        original,
    )

    spoken = pronunciation.apply_pronunciation_hints(original, hints)

    assert original == "API 会先读取缓存。"
    assert spoken == "A P I 会先读取还存。"
    assert next(hint for hint in hints if hint.term == "API").source == "script"


def test_persistent_pronunciation_dictionary_accepts_natural_language_rules(
    tmp_path,
    monkeypatch,
):
    from app.services.media import pronunciation

    lexicon = tmp_path / "pronunciation.txt"
    lexicon.write_text("# 用户词典\nAPI 读作 A P I\n缓存 -> 还存\n", encoding="utf-8")
    monkeypatch.setattr(
        pronunciation.settings,
        "MEDIA_PRONUNCIATION_LEXICON_PATH",
        str(lexicon),
    )

    hints = pronunciation.collect_pronunciation_hints({}, "API 会读取缓存")

    assert pronunciation.apply_pronunciation_hints("API 会读取缓存", hints) == "A P I 会读取还存"


def test_minimax_native_subtitle_parser_converts_milliseconds():
    from app.services.media.minimax_tts import parse_subtitle_payload

    cues = parse_subtitle_payload({
        "subtitles": [
            {"text": "第一句", "begin_time": 120, "end_time": 960},
            {"text": "第二句", "begin_time": 1100, "end_time": 2380},
        ]
    })

    assert cues == [
        {"text": "第一句", "start": 0.12, "end": 0.96},
        {"text": "第二句", "start": 1.1, "end": 2.38},
    ]


def test_mimo_tts_uses_assistant_text_and_configured_voice(monkeypatch):
    from app.services.media import mimo_tts

    monkeypatch.setattr(mimo_tts.settings, "MIMO_TTS_MODEL", "mimo-v2.5-tts")
    monkeypatch.setattr(mimo_tts.settings, "MIMO_TTS_VOICE", "茉莉")
    monkeypatch.setattr(mimo_tts.settings, "MIMO_TTS_STYLE", "自然清晰，语速适中")

    payload = mimo_tts.build_request_payload("今天学习二分查找。")

    assert payload == {
        "model": "mimo-v2.5-tts",
        "messages": [
            {"role": "user", "content": "自然清晰，语速适中"},
            {"role": "assistant", "content": "今天学习二分查找。"},
        ],
        "audio": {"format": "wav", "voice": "茉莉"},
    }


def test_mimo_tts_decodes_chat_completion_audio():
    import base64

    from app.services.media.mimo_tts import decode_audio_payload

    audio = b"RIFF-test-wave"
    payload = {
        "choices": [{
            "message": {
                "audio": {"data": base64.b64encode(audio).decode("ascii")},
            }
        }]
    }

    assert decode_audio_payload(payload) == audio


@pytest.mark.asyncio
async def test_mimo_tts_retries_temporary_upstream_failures(tmp_path, monkeypatch):
    import base64

    import httpx

    from app.services.media import mimo_tts

    attempts = 0
    audio = b"RIFF-retried-wave"

    async def fake_post(self, *args, **kwargs):
        nonlocal attempts
        attempts += 1
        request = httpx.Request("POST", "https://api.xiaomimimo.com/v1/chat/completions")
        if attempts < 3:
            return httpx.Response(503, request=request)
        return httpx.Response(
            200,
            request=request,
            json={
                "choices": [{
                    "message": {
                        "audio": {"data": base64.b64encode(audio).decode("ascii")},
                    }
                }]
            },
        )

    async def no_wait(_delay):
        return None

    monkeypatch.setattr(mimo_tts.settings, "MIMO_TTS_ENABLED", True)
    monkeypatch.setattr(mimo_tts.settings, "MIMO_API_KEY", "test-key")
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(mimo_tts.asyncio, "sleep", no_wait)

    output = tmp_path / "voice.wav"
    await mimo_tts.synthesize("重试后成功。", output)

    assert attempts == 3
    assert output.read_bytes() == audio


def test_caption_boundaries_snap_to_detected_silence():
    from app.services.media.ffmpeg import adjust_cues_to_silence

    adjusted = adjust_cues_to_silence(
        [
            {"text": "前半句", "start": 0.0, "end": 1.0},
            {"text": "后半句", "start": 1.0, "end": 2.0},
        ],
        [(0.88, 1.14)],
        duration=2.0,
    )

    assert adjusted[0]["end"] == pytest.approx(0.88)
    assert adjusted[1]["start"] == pytest.approx(1.14)


@pytest.mark.asyncio
async def test_ass_captions_use_portrait_canvas_and_karaoke_highlighting(tmp_path):
    from app.services.media.ffmpeg import generate_ass

    output = await generate_ass(
        [
            {
                "text": "原始字幕",
                "duration": 2.0,
                "caption_cues": [{"text": "原始字幕", "start": 0.1, "end": 1.8}],
            }
        ],
        tmp_path / "captions.ass",
        orientation="portrait",
        position="center",
    )
    content = output.read_text(encoding="utf-8-sig")

    assert "PlayResX: 720" in content
    assert "PlayResY: 1280" in content
    assert "Style: Active" in content
    assert r"{\kf" in content
    assert "原始" in content and "字幕" in content


@pytest.mark.asyncio
async def test_portrait_ass_repages_long_cues_to_safe_line_lengths(tmp_path):
    from app.services.media.ffmpeg import generate_ass

    output = await generate_ass(
        [{"text": "这是一个需要在竖屏画面里自动拆成两个字幕页面的长句子", "duration": 4.0}],
        tmp_path / "long.ass",
        orientation="portrait",
    )
    dialogue_lines = [
        line for line in output.read_text(encoding="utf-8-sig").splitlines()
        if line.startswith("Dialogue:")
    ]

    assert len(dialogue_lines) >= 2


def test_storyboard_has_a_native_portrait_frame(tmp_path):
    from app.services.media.storyboard_render import _render_scene_frame

    output = tmp_path / "portrait.png"
    _render_scene_frame(
        {
            "title": "为什么需要二分查找",
            "purpose": "hook",
            "narration": "从一百万条数据里快速找到目标，关键是每次排除一半。",
            "duration": 8,
            "visual_template": "concept_card",
            "visual_params": {"items": ["有序", "折半", "对数复杂度"]},
            "focus_terms": ["有序数组", "时间复杂度"],
        },
        video_title="二分查找",
        index=0,
        total=6,
        output_path=output,
        orientation="portrait",
    )

    with Image.open(output) as image:
        assert image.size == (720, 1280)


def test_garden_landscape_compositions_are_distinct_16_by_9_frames(tmp_path):
    from app.services.media.storyboard_render import _render_scene_frame

    pixels: set[bytes] = set()
    for index, composition in enumerate(("hero", "split", "process", "comparison", "recap")):
        output = tmp_path / f"{composition}.png"
        _render_scene_frame(
            {
                "title": f"第 {index + 1} 个视觉节拍",
                "purpose": "concept",
                "narration": "保留同一对象，再逐步展示条件、过程和结果。",
                "duration": 8,
                "composition": composition,
                "chapter_id": "02-model",
                "chapter_title": "建立核心理解",
                "beat_index": index + 1,
                "beat_total": 5,
                "visual_anchor": "有序数组",
                "carry_over": "查找范围",
                "relation_to_previous": "progressive",
                "visual_params": {
                    "items": ["左边界", "中间值", "右边界"],
                    "steps": ["读取", "比较", "缩小范围", "命中"],
                    "columns": ["线性查找", "二分查找"],
                    "rows": [["逐个检查", "每次折半"], ["较慢", "对数级"]],
                },
                "focus_terms": ["有序", "折半"],
            },
            video_title="二分查找",
            index=index,
            total=5,
            output_path=output,
            orientation="landscape",
        )

        with Image.open(output) as image:
            assert image.size == (1280, 720)
            pixels.add(image.tobytes())

    assert len(pixels) == 5


def test_legacy_scenes_gain_chapter_anchors_and_carry_over():
    from app.services.media.video_continuity import prepare_scene_continuity

    scenes = prepare_scene_continuity([
        {"title": "定义", "purpose": "concept", "focus_terms": ["有序数组"]},
        {"title": "缩小范围", "purpose": "concept", "focus_terms": ["折半"]},
        {"title": "完整演示", "purpose": "example", "focus_terms": ["目标值"]},
    ])

    assert scenes[0]["relation_to_previous"] == "new_chapter"
    assert scenes[1]["relation_to_previous"] == "progressive"
    assert scenes[0]["visual_anchor"] == scenes[1]["visual_anchor"] == "有序数组"
    assert scenes[1]["carry_over"] == "有序数组"
    assert scenes[1]["transition"] == "dissolve"
    assert all(scene["motion"] == "fixed" for scene in scenes)
    assert scenes[2]["relation_to_previous"] == "new_chapter"
    assert scenes[2]["carry_over"] == "缩小范围"


def test_legacy_placeholder_titles_become_chapter_section_titles():
    from app.services.media.video_continuity import prepare_scene_continuity

    scenes = prepare_scene_continuity([
        {
            "title": "分镜 1",
            "purpose": "concept",
            "chapter_title": "建立核心理解",
            "reveal_sequence": ["连续存储", "随机访问"],
        },
        {
            "title": "建立核心理解",
            "purpose": "concept",
            "chapter_title": "建立核心理解",
            "focus_terms": ["链式存储"],
        },
    ])

    assert [scene["title"] for scene in scenes] == ["连续存储", "链式存储"]
    assert all(scene["title"] != scene["chapter_title"] for scene in scenes)
    assert all(scene["visual_anchor"] != scene["chapter_title"] for scene in scenes)


@pytest.mark.asyncio
async def test_storyboard_composer_uses_semantic_xfade_transitions(tmp_path, monkeypatch):
    from app.services.media import storyboard_render

    captured: list[list[str]] = []

    async def fake_run(args, **_kwargs):
        captured.append(args)

    monkeypatch.setattr(storyboard_render, "_run_ffmpeg", fake_run)
    clips = [tmp_path / f"scene-{index}.mp4" for index in range(3)]
    scenes = [
        {"transition": "fade"},
        {"transition": "smoothleft"},
        {"transition": "wipeleft"},
    ]

    await storyboard_render._compose_storyboard(
        clips,
        scenes,
        [8.0, 9.0, 10.0],
        tmp_path / "storyboard.mp4",
    )

    filter_complex = captured[0][captured[0].index("-filter_complex") + 1]
    assert "xfade=transition=smoothleft:duration=0.450:offset=8.000" in filter_complex
    assert "xfade=transition=wipeleft:duration=0.450:offset=17.000" in filter_complex


def test_scene_reveal_plan_follows_visual_content_order():
    from app.services.media.storyboard_render import _scene_reveal_plan

    plan = _scene_reveal_plan(
        {
            "visual_template": "compare_table",
            "visual_params": {
                "rows": [
                    ["存储方式", "连续", "离散"],
                    ["随机访问", "O(1)", "O(n)"],
                    ["插入删除", "O(n)", "O(1)"],
                ],
            },
        },
        9.0,
    )

    assert [phase["label"] for phase in plan] == ["存储方式", "随机访问", "插入删除"]
    assert [phase["index"] for phase in plan] == [1, 2, 3]
    assert sum(float(phase["duration"]) for phase in plan) == pytest.approx(9.0)


def test_fixed_scene_filter_never_moves_the_whole_canvas():
    from app.services.media.storyboard_render import _static_motion_filter

    filter_value = _static_motion_filter(
        {"motion": "pan_left"},
        duration=8.0,
        width=1280,
        height=720,
        fade_in=False,
        fade_out=False,
    )

    assert "zoompan" not in filter_value
    assert "scale=1280:720,fps=24" in filter_value


def test_progressive_table_frame_only_adds_rows_without_reflow(tmp_path):
    from app.services.media.storyboard_render import _render_scene_frame

    base_scene = {
        "title": "顺序表与单链表",
        "purpose": "concept",
        "composition": "split",
        "chapter_id": "02-model",
        "chapter_title": "建立核心理解",
        "beat_index": 1,
        "beat_total": 3,
        "visual_anchor": "线性表",
        "visual_template": "compare_table",
        "visual_params": {
            "columns": ["特性", "顺序表", "单链表"],
            "rows": [
                ["存储方式", "连续存储", "离散存储"],
                ["随机访问", "O(1)", "O(n)"],
                ["插入删除", "O(n)", "O(1)"],
            ],
        },
        "reveal_sequence": ["存储方式", "随机访问", "插入删除"],
    }
    first = tmp_path / "first.png"
    final = tmp_path / "final.png"
    _render_scene_frame(
        {**base_scene, "_reveal_index": 1},
        video_title="线性表",
        index=0,
        total=3,
        output_path=first,
    )
    _render_scene_frame(
        {**base_scene, "_reveal_index": 3},
        video_title="线性表",
        index=0,
        total=3,
        output_path=final,
    )

    with Image.open(first) as first_image, Image.open(final) as final_image:
        assert first_image.size == final_image.size == (1280, 720)
        assert first_image.crop((0, 0, 1280, 190)).tobytes() == final_image.crop((0, 0, 1280, 190)).tobytes()
        assert first_image.crop((700, 350, 1212, 560)).tobytes() != final_image.crop((700, 350, 1212, 560)).tobytes()


@pytest.mark.asyncio
async def test_progressive_scene_clip_dissolves_reveals_on_a_fixed_stage(tmp_path, monkeypatch):
    from app.services.media import storyboard_render

    captured: list[str] = []

    async def fake_run(args, **_kwargs):
        captured.extend(args)

    monkeypatch.setattr(storyboard_render, "_run_ffmpeg", fake_run)
    await storyboard_render._render_progressive_scene_clip(
        [tmp_path / "one.png", tmp_path / "two.png", tmp_path / "three.png"],
        [3.0, 3.0, 3.0],
        tmp_path / "scene.mp4",
    )

    filter_complex = captured[captured.index("-filter_complex") + 1]
    assert "xfade=transition=dissolve:duration=0.220:offset=3.000" in filter_complex
    assert "xfade=transition=dissolve:duration=0.220:offset=6.000" in filter_complex
    assert "zoompan" not in filter_complex


def test_stock_video_file_selection_matches_render_orientation():
    from app.services.media.stock_video import _best_video_file

    video = {
        "video_files": [
            {"file_type": "video/mp4", "link": "https://cdn/landscape.mp4", "width": 1280, "height": 720},
            {"file_type": "video/mp4", "link": "https://cdn/portrait.mp4", "width": 720, "height": 1280},
        ]
    }

    assert _best_video_file(video, orientation="portrait")["link"].endswith("portrait.mp4")
    assert _best_video_file(video, orientation="landscape")["link"].endswith("landscape.mp4")


def test_music_selection_prefers_the_requested_mood(tmp_path, monkeypatch):
    from app.services.media import music

    (tmp_path / "calm-study.mp3").write_bytes(b"music")
    (tmp_path / "upbeat-intro.mp3").write_bytes(b"music")
    monkeypatch.setattr(music.settings, "MEDIA_MUSIC_DIR", str(tmp_path))

    selected = music.select_background_music({
        "title": "测试视频",
        "render_config": {"music_mood": "upbeat"},
    })

    assert selected is not None
    assert selected.name == "upbeat-intro.mp3"
