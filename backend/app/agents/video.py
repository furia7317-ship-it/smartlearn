"""Video agent — scene based educational video production plan."""

from __future__ import annotations

import re
from typing import Any

from app.agents.video_skills import GARDEN_SKILL_ID, load_garden_video_skill
from app.core.llm import build_llm, parse_json_response

# 预置模板列表
TEMPLATES = [
    "concept_card",       # 概念卡片
    "array_sort",         # 数组排序动画
    "tree_graph_traverse", # 树/图遍历动画
    "formula_step",       # 公式推导步骤
    "compare_table",      # 对比表格
]

SYSTEM_PROMPT = """你是视频脚本专家。根据主题生成视频脚本 JSON。

输出格式：
```json
{
  "title": "视频标题",
  "hook": "前 5 秒提出的核心问题",
  "key_takeaways": ["看完必须记住的重点"],
  "scenes": [{
    "title": "章节内小节标题，不得写成分镜 1",
    "purpose": "hook|concept|example|pitfall|application|recap",
    "narration": "60-120 字、可以直接配音的口语旁白",
    "duration": 25,
    "visual_template": "模板名",
    "visual_params": {"title": "画面标题", "items": ["画面要点"]},
    "focus_terms": ["本段强调词"],
    "visual_search_terms": ["可选的相关素材检索词"],
    "chapter_id": "02-foundation",
    "chapter_title": "建立核心理解",
    "composition": "hero|split|process|comparison|recap",
    "visual_anchor": "本章持续出现的视觉对象",
    "carry_over": "从上一镜保留的元素",
    "relation_to_previous": "new_chapter|progressive|detail|contrast|transfer|return",
    "reveal_sequence": ["旁白推进时第 1 个出现的短内容", "第 2 个出现的短内容"]
  }]
}
```

可用模板：
- concept_card: 概念卡片展示（params: title, items[]）
- array_sort: 数组排序动画（params: array[], algorithm）
- tree_graph_traverse: 树遍历（params: tree结构, order）
- formula_step: 公式推导（params: formula, steps[]）
- compare_table: 对比表格（params: columns[], rows[][]）

规则：
1. 生成 12-18 个连续视觉节拍，总时长控制在 150-240 秒，每镜 7-18 秒
2. 按 4 个章节组织，每章包含 2-4 个递进内容部分；叙事顺序是问题钩子 → 概念拆解 →
   具体例子 → 易错点 → 应用 → 总结自测
3. 每个章节内容部分只讲一个重点；title 必须概括该部分内容，禁止使用“分镜 N”“场景 N”等占位标题
4. focus_terms 必须能在本段旁白中找到，所有大纲必讲点要分散到合适的章节内容部分
5. visual_params 只放屏幕上真正需要出现的短语，字幕使用完整旁白
6. 直接返回 JSON，不要 Markdown 代码块或额外解释"""

SYSTEM_PROMPT += """
7. 根级 pronunciation_hints 输出需要纠正读音的词，格式为
   [{"term":"屏幕原文","spoken":"送入配音服务的读法"}]；没有则输出空数组。
8. 根级 render_config 的 orientation 必须是 landscape；同时输出 caption_position
   （top、center 或 bottom）、music_mood 和 music_volume。
9. visual_search_terms 使用具体、可检索的中英文视觉名词，避免“知识、内容、学习”等空泛词。
10. 根级 visual_system 输出 theme、recurring_motif；同一章节必须复用视觉锚点，
    相邻内容必须有 carry_over 和 relation_to_previous，禁止互不相干的卡片拼接。
11. 每段输出 2-4 个 reveal_sequence，顺序必须与旁白讲述顺序一致；画面初始只显示
    第一个内容，后续内容随旁白逐个出现，不得在第一帧展示完整表格或全部步骤。
12. chapter_title 是章节名，只能作为左上角章节标识；不得再用作 title、visual_anchor
    或 reveal_sequence 内容。根级 chapters 每个章节只输出一次。
13. narration 直接讲本段知识，不要朗读 chapter_title，避免章节名再次进入字幕。
14. 画面按白板手绘动画设计：reveal_sequence 只放适合逐笔画出或逐卡出现的短语；
    composition 必须体现本段的空间关系，不得只把旁白平铺成一页文字。
"""


MIN_VIDEO_SECONDS = 150.0
MAX_VIDEO_SECONDS = 300.0
TARGET_VIDEO_SECONDS = 180.0
MIN_SCENES = 12
MAX_SCENES = 18
MIN_SCENE_SECONDS = 7.0
MAX_SCENE_SECONDS = 18.0

COMPOSITIONS = {"hero", "split", "process", "comparison", "recap"}
SCENE_RELATIONS = {"new_chapter", "progressive", "detail", "contrast", "transfer", "return"}
VISUAL_THEMES = {"chalk-garden", "blueprint", "paper-press", "split-canvas"}

_SCENE_BLUEPRINTS: tuple[tuple[str, str, str], ...] = (
    ("先问为什么", "hook", "先用一个真实问题说明为什么要学{topic}，让学习者带着问题继续看。"),
    ("把冲突摆出来", "hook", "把旧方法的困难和{topic}能解决的问题放在一起比较，让问题变得具体。"),
    ("建立核心概念", "concept", "先给出{topic}的核心定义，再说明它解决的具体问题。"),
    ("拆开关键结构", "concept", "把{topic}最关键的组成和关系逐层拆开，并说明每一步的作用。"),
    ("看清运行过程", "concept", "沿着同一个例子推进一步，展示{topic}内部状态怎样发生变化。"),
    ("跟着例子走一遍", "example", "用一个小而完整的例子演示{topic}，边做边指出判断依据。"),
    ("把例子推进一步", "example", "保留上一镜的输入，继续展示下一步处理以及为什么这样选择。"),
    ("检查例子的结果", "example", "对照输入和结果，解释结果如何验证前面的判断。"),
    ("避开常见误区", "pitfall", "对比正确做法与常见错误，解释错误为什么会发生、如何检查。"),
    ("修正错误做法", "pitfall", "沿用上一镜的错误案例，逐步改成正确做法并给出检查信号。"),
    ("迁移到真实应用", "application", "把{topic}放进一个真实应用场景，说明什么时候应该使用它。"),
    ("一分钟收束", "recap", "串联本节重点，并留下一道可以立即自测的问题。"),
)

_GENERIC_SECTION_TITLE = re.compile(
    r"^(?:(?:分镜|场景|镜头|scene|shot)\s*[-_#：:]?\s*\d+|"
    r"第?\s*\d+\s*(?:镜|个?分镜|场景|镜头))$",
    re.IGNORECASE,
)


def _section_title(value: Any, fallback: str, *, chapter_title: str = "") -> str:
    title = str(value or "").strip()
    if not title or _GENERIC_SECTION_TITLE.fullmatch(title):
        return fallback
    if chapter_title and title == chapter_title.strip():
        return fallback
    return title


def _default_scene_structure(index: int, purpose: str) -> tuple[str, str, str, str]:
    """Return chapter id, title, composition, and previous-scene relation."""

    if purpose == "hook":
        return "01-discovery", "问题与反差", "hero", "new_chapter" if index == 0 else "contrast"
    if purpose == "concept":
        return "02-model", "建立核心理解", "split" if index % 2 == 0 else "process", (
            "new_chapter" if index <= 2 else "progressive"
        )
    if purpose == "example":
        return "03-demo", "跟着案例推进", "process", "new_chapter" if index <= 5 else "progressive"
    if purpose == "pitfall":
        return "04-practice", "修正并迁移", "comparison", "new_chapter" if index <= 8 else "contrast"
    if purpose == "application":
        return "04-practice", "修正并迁移", "split", "transfer"
    return "04-practice", "修正并迁移", "recap", "return"


def _default_visual_theme(topic: str) -> str:
    if any(term in topic.casefold() for term in ("api", "sdk", "系统", "架构", "算法", "代码", "网络")):
        return "blueprint"
    if any(term in topic for term in ("比较", "区别", "对比", "异同")):
        return "split-canvas"
    return "chalk-garden"


def _default_reveal_sequence(scene: dict[str, Any], visual_params: dict[str, Any]) -> list[str]:
    template = str(scene.get("visual_template") or scene.get("template") or "")
    values: list[str] = []
    if template == "compare_table":
        values.extend(
            str(row[0]).strip()
            for row in visual_params.get("rows") or []
            if isinstance(row, list) and row and str(row[0]).strip()
        )
    for key in ("steps", "items"):
        raw = visual_params.get(key)
        if isinstance(raw, list):
            values.extend(str(item).strip() for item in raw if str(item).strip())
    values.extend(str(item).strip() for item in scene.get("focus_terms") or [] if str(item).strip())
    if not values:
        values.append(str(scene.get("title") or "本段重点"))
    return list(dict.fromkeys(values))[:4]


def _required_video_terms(state: dict[str, Any]) -> list[str]:
    """Collect outline evidence that must be present in the actual script."""

    terms: list[str] = []
    outline = state.get("resource_outline") or {}
    for section in outline.get("sections") or [] if isinstance(outline, dict) else []:
        if not isinstance(section, dict):
            continue
        for value in section.get("must_cover") or []:
            term = str(value).strip()
            if term and term not in terms:
                terms.append(term)

    for instruction in state.get("repair_instructions") or []:
        if not isinstance(instruction, dict):
            continue
        target = str(instruction.get("target_field") or "")
        if not any(field in target for field in ("scene", "narration", "params")):
            continue
        for value in instruction.get("required_terms") or []:
            term = str(value).strip()
            if term and term not in terms:
                terms.append(term)
    return terms


def _ensure_video_script_contract(
    result: dict[str, Any],
    *,
    topic: str,
    required_terms: list[str],
) -> dict[str, Any]:
    """Make outline coverage and a production-ready storyboard deterministic.

    The model supplies the teaching content.  This boundary normalizes legacy
    scripts, distributes required evidence across real scenes, and gives the
    renderer enough timing/visual metadata to always produce a useful MP4.
    """

    params = result.get("params") if isinstance(result.get("params"), dict) else {}
    params = dict(params)
    params.setdefault("title", str(result.get("title") or topic))

    raw_scenes = result.get("scenes")
    scenes: list[dict[str, Any]] = [
        dict(scene) for scene in raw_scenes if isinstance(scene, dict)
    ] if isinstance(raw_scenes, list) else []
    if not scenes:
        narration = result.get("narration")
        if isinstance(narration, list):
            for index, segment in enumerate(narration):
                if not isinstance(segment, dict):
                    continue
                blueprint = _SCENE_BLUEPRINTS[min(index, len(_SCENE_BLUEPRINTS) - 1)]
                scenes.append({
                    "title": _section_title(segment.get("title"), blueprint[0]),
                    "narration": str(segment.get("text") or segment.get("narration") or "").strip(),
                    "duration": segment.get("duration"),
                    "visual_template": result.get("template") or "concept_card",
                    "visual_params": params,
                })

    scenes = scenes[:MAX_SCENES]
    while len(scenes) < MIN_SCENES:
        title, purpose, narration_template = _SCENE_BLUEPRINTS[len(scenes)]
        scenes.append({
            "title": title,
            "purpose": purpose,
            "narration": narration_template.format(topic=topic),
            "duration": TARGET_VIDEO_SECONDS / MIN_SCENES,
            "visual_template": "concept_card",
            "visual_params": {"title": title, "items": []},
        })

    normalized_scenes: list[dict[str, Any]] = []
    for index, scene in enumerate(scenes):
        blueprint = _SCENE_BLUEPRINTS[min(index, len(_SCENE_BLUEPRINTS) - 1)]
        narration_text = str(scene.get("narration") or scene.get("text") or "").strip()
        if not narration_text:
            narration_text = blueprint[2].format(topic=topic)
        visual_template = str(
            scene.get("visual_template") or scene.get("template") or result.get("template") or "concept_card"
        )
        if visual_template not in TEMPLATES:
            visual_template = "concept_card"
        visual_params = scene.get("visual_params") or scene.get("params") or {}
        if not isinstance(visual_params, dict):
            visual_params = {}
        focus_terms = [
            str(term).strip()
            for term in scene.get("focus_terms") or []
            if str(term).strip()
        ]
        try:
            duration = float(scene.get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0
        purpose = str(scene.get("purpose") or blueprint[1])
        chapter_id, chapter_title, default_composition, default_relation = _default_scene_structure(
            index,
            purpose,
        )
        resolved_chapter_title = str(scene.get("chapter_title") or chapter_title)
        section_title = _section_title(
            scene.get("title"),
            "",
            chapter_title=resolved_chapter_title,
        ) or _section_title(
            dict(visual_params).get("title"),
            blueprint[0],
            chapter_title=resolved_chapter_title,
        )
        composition = str(scene.get("composition") or default_composition).lower()
        relation = str(scene.get("relation_to_previous") or default_relation).lower()
        reveal_sequence = [
            str(item.get("label") or item.get("text") or "").strip()
            if isinstance(item, dict)
            else str(item).strip()
            for item in scene.get("reveal_sequence") or []
        ]
        reveal_sequence = list(dict.fromkeys(
            item for item in reveal_sequence
            if item and item != resolved_chapter_title
        ))[:4]
        if not reveal_sequence:
            reveal_sequence = _default_reveal_sequence(
                {**scene, "title": section_title},
                dict(visual_params),
            )
        normalized_scenes.append({
            "id": str(scene.get("id") or f"scene-{index + 1}"),
            "title": section_title,
            "purpose": purpose,
            "narration": narration_text,
            "duration": max(MIN_SCENE_SECONDS, min(MAX_SCENE_SECONDS, duration or 14.0)),
            "visual_template": visual_template,
            "visual_params": {
                **dict(visual_params),
                "title": section_title,
            },
            "focus_terms": list(dict.fromkeys(focus_terms))[:4],
            "visual_search_terms": [
                str(term).strip()
                for term in scene.get("visual_search_terms") or []
                if str(term).strip()
            ][:4],
            "chapter_id": chapter_id,
            "chapter_title": resolved_chapter_title,
            "composition": composition if composition in COMPOSITIONS else default_composition,
            "relation_to_previous": relation if relation in SCENE_RELATIONS else default_relation,
            "visual_anchor": str(scene.get("visual_anchor") or "").strip(),
            "carry_over": str(scene.get("carry_over") or "").strip(),
            "reveal_sequence": reveal_sequence,
        })

    searchable = str(normalized_scenes)
    missing = [term for term in required_terms if term not in searchable]
    for index, term in enumerate(missing):
        # Keep the opening hook clean.  Required concepts are distributed over
        # the explanatory middle scenes instead of dumped into one paragraph.
        scene_index = 1 + (index % max(1, len(normalized_scenes) - 2))
        scene = normalized_scenes[scene_index]
        scene["focus_terms"] = list(dict.fromkeys([*scene["focus_terms"], term]))[:4]
        scene["narration"] = f"{scene['narration']} 本段重点讲清楚{term}，并说明它如何影响实际判断。"
        visual_items = scene["visual_params"].get("items")
        if not isinstance(visual_items, list):
            visual_items = []
        scene["visual_params"]["items"] = list(dict.fromkeys([*visual_items, term]))[:5]

    for scene in normalized_scenes:
        if not scene["visual_search_terms"]:
            scene["visual_search_terms"] = list(dict.fromkeys([
                topic,
                *scene["focus_terms"],
                str(scene["title"]),
            ]))[:3]

    chapter_anchors: dict[str, str] = {}
    previous_scene: dict[str, Any] | None = None
    for scene in normalized_scenes:
        chapter_id = str(scene["chapter_id"])
        proposed_anchor = str(scene.get("visual_anchor") or "").strip()
        if (
            proposed_anchor == str(scene.get("chapter_title") or "").strip()
            or _GENERIC_SECTION_TITLE.fullmatch(proposed_anchor)
        ):
            proposed_anchor = ""
        if chapter_id not in chapter_anchors:
            chapter_anchors[chapter_id] = (
                proposed_anchor
                or (scene["focus_terms"][0] if scene["focus_terms"] else "")
                or str(scene["title"])
            )
        scene["visual_anchor"] = chapter_anchors[chapter_id]
        same_chapter = previous_scene is not None and previous_scene["chapter_id"] == chapter_id
        if previous_scene is None or not same_chapter:
            scene["relation_to_previous"] = "new_chapter"
        if not scene["carry_over"] and previous_scene is not None:
            scene["carry_over"] = str(
                previous_scene.get("visual_anchor")
                if same_chapter
                else previous_scene.get("title")
            )
        previous_scene = scene

    chapter_totals: dict[str, int] = {}
    for scene in normalized_scenes:
        chapter_id = str(scene["chapter_id"])
        chapter_totals[chapter_id] = chapter_totals.get(chapter_id, 0) + 1
    chapter_offsets: dict[str, int] = {}
    for scene in normalized_scenes:
        chapter_id = str(scene["chapter_id"])
        beat_index = chapter_offsets.get(chapter_id, 0) + 1
        chapter_offsets[chapter_id] = beat_index
        scene["beat_index"] = beat_index
        scene["beat_total"] = chapter_totals[chapter_id]

    total_duration = sum(float(scene["duration"]) for scene in normalized_scenes)
    try:
        requested_duration = float(result.get("target_duration_seconds") or TARGET_VIDEO_SECONDS)
    except (TypeError, ValueError):
        requested_duration = TARGET_VIDEO_SECONDS
    target_duration = max(
        MIN_VIDEO_SECONDS,
        min(240.0, requested_duration if requested_duration >= MIN_VIDEO_SECONDS else TARGET_VIDEO_SECONDS),
    )
    if total_duration < MIN_VIDEO_SECONDS or total_duration > MAX_VIDEO_SECONDS:
        scale = target_duration / max(total_duration, 1.0)
        for scene in normalized_scenes:
            scene["duration"] = max(
                MIN_SCENE_SECONDS,
                min(MAX_SCENE_SECONDS, float(scene["duration"]) * scale),
            )
    # Rounding can leave a short script a fraction below the contract.
    total_duration = sum(float(scene["duration"]) for scene in normalized_scenes)
    if total_duration < MIN_VIDEO_SECONDS:
        normalized_scenes[-1]["duration"] += MIN_VIDEO_SECONDS - total_duration
    for scene in normalized_scenes:
        scene["duration"] = round(float(scene["duration"]), 1)

    chapters: list[dict[str, Any]] = []
    cursor = 0.0
    for scene in normalized_scenes:
        if not chapters or chapters[-1]["id"] != scene["chapter_id"]:
            chapters.append({
                "id": scene["chapter_id"],
                "title": scene["chapter_title"],
                "start": round(cursor, 1),
            })
        cursor += float(scene["duration"])

    result["title"] = str(result.get("title") or params.get("title") or topic)
    result["hook"] = str(result.get("hook") or normalized_scenes[0]["narration"])
    result["key_takeaways"] = list(dict.fromkeys([
        *required_terms,
        *[term for scene in normalized_scenes for term in scene["focus_terms"]],
    ]))[:8]
    result["scenes"] = normalized_scenes
    result["narration"] = [
        {
            "text": scene["narration"],
            "duration": scene["duration"],
            "title": scene["title"],
            "scene_id": scene["id"],
            "chapter_id": scene["chapter_id"],
            "beat_index": scene["beat_index"],
        }
        for scene in normalized_scenes
    ]
    result["chapters"] = chapters
    result["target_duration_seconds"] = round(cursor, 1)
    raw_render_config = result.get("render_config")
    render_config = dict(raw_render_config) if isinstance(raw_render_config, dict) else {}
    caption_position = str(render_config.get("caption_position") or "bottom").lower()
    try:
        music_volume = float(render_config.get("music_volume") or 0.08)
    except (TypeError, ValueError):
        music_volume = 0.08
    result["render_config"] = {
        **render_config,
        "orientation": "landscape",
        "captions": bool(render_config.get("captions", True)),
        "caption_position": (
            caption_position if caption_position in {"top", "center", "bottom"} else "bottom"
        ),
        "caption_style": "active_phrase",
        "visual_style": "whiteboard-remotion",
        "animation_engine": "remotion",
        "motion_style": "whiteboard-hand-drawn",
        "render_profile": "desktop-balanced",
        "music_mood": str(render_config.get("music_mood") or "calm"),
        "music_volume": max(0.0, min(0.5, music_volume)),
    }
    raw_visual_system = result.get("visual_system")
    visual_system = dict(raw_visual_system) if isinstance(raw_visual_system, dict) else {}
    theme = str(visual_system.get("theme") or _default_visual_theme(topic)).lower()
    result["visual_system"] = {
        **visual_system,
        "theme": theme if theme in VISUAL_THEMES else _default_visual_theme(topic),
        "stage": "16:9",
        "recurring_motif": str(visual_system.get("recurring_motif") or topic),
        "continuity": "chapter_anchor_and_carry_over",
        "surface": "warm-grid-whiteboard",
        "drawing_motion": "svg-stroke-and-hand",
        "scene_transition": "short-frame-driven-entrance",
        "skill": GARDEN_SKILL_ID,
    }
    raw_hints = result.get("pronunciation_hints")
    complete_narration = "".join(scene["narration"] for scene in normalized_scenes)
    result["pronunciation_hints"] = [
        {
            "term": str(item.get("term") or "").strip(),
            "spoken": str(item.get("spoken") or item.get("pronunciation") or "").strip(),
        }
        for item in raw_hints
        if isinstance(item, dict)
        and str(item.get("term") or "").strip()
        and str(item.get("spoken") or item.get("pronunciation") or "").strip()
        and str(item.get("term") or "").strip() in complete_narration
    ][:20] if isinstance(raw_hints, list) else []
    # Legacy fields remain for stored-resource viewers and Manim fallback.
    result["template"] = normalized_scenes[0]["visual_template"]
    result["params"] = normalized_scenes[0]["visual_params"]
    return result


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成视频脚本（不直接渲染，由 media 服务异步处理）。"""
    llm = build_llm(temperature=0.5)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    prompt = f"主题：{state['topic']}\n\n知识库参考：{kb_text}{prompt_extras(state)}\n\n请生成视频脚本。"

    resp = llm.invoke([
        {"role": "system", "content": f"{SYSTEM_PROMPT}\n\n{load_garden_video_skill()}"},
        {"role": "user", "content": prompt},
    ])

    required_terms = _required_video_terms(state)

    try:
        result = parse_json_response(resp.content)
        result["type"] = "video"
        result["id"] = f"video_{state['topic'][:20]}"
        # 确保 template 合法
        if result.get("template") not in TEMPLATES:
            result["template"] = "concept_card"
        return _ensure_video_script_contract(
            result,
            topic=str(state["topic"]),
            required_terms=required_terms,
        )
    except Exception:
        return _ensure_video_script_contract({
            "type": "video",
            "id": f"video_{state['topic'][:20]}",
            "template": "concept_card",
            "params": {"title": state["topic"], "items": required_terms},
            "narration": [],
        }, topic=str(state["topic"]), required_terms=required_terms)
