"""Tutor agent — 辅导答疑（风格化作答 + 引用角标 + 逐 token 流式）。"""

from __future__ import annotations

from typing import Any, Callable

from app.core.llm import build_llm

SYSTEM_PROMPT = """你是耐心的学习辅导老师。根据学生的认知风格和知识水平，用合适的方式回答问题。

要求：
1. 根据学生认知风格调整回答方式（视觉型多用图表描述，文字型多用逻辑推演，实践型多用例子）
2. 如果知识库参考非空，回答必须优先依据参考内容，并在相关结论后标注 [来源n]
3. 不要引用未出现在知识库参考中的来源编号
4. 如果不确定，坦诚说明而非编造
5. 鼓励学生思考，不直接给答案
6. 回答简洁但完整"""


def _source_label(index: int, ctx: dict[str, Any], sources: list[dict[str, Any]]) -> str:
    metadata = ctx.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    source_meta: dict[str, Any] = {}
    if index - 1 < len(sources):
        raw_meta = sources[index - 1].get("metadata") or {}
        if isinstance(raw_meta, dict):
            source_meta = raw_meta

    title = metadata.get("title") or source_meta.get("title") or ""
    source = metadata.get("source") or source_meta.get("source") or ""
    if title and source and title != source:
        return f"[来源{index}: {title} / {source}]"
    if title or source:
        return f"[来源{index}: {title or source}]"
    return f"[来源{index}]"


def generate_answer(
    question: str,
    history: list[dict[str, str]],
    kb_context: list[dict[str, Any]],
    profile: dict[str, Any],
    sources: list[dict[str, Any]],
    on_delta: Callable[[str], None] | None = None,
) -> str:
    """生成辅导回答，支持逐 token 流式回调。"""
    llm = build_llm(temperature=0.7)

    kb_parts: list[str] = []
    for i, ctx in enumerate(kb_context[:5], 1):
        content = str(ctx.get("content", "")).strip()
        if not content:
            continue
        kb_parts.append(f"{_source_label(i, ctx, sources)}\n{content[:700]}")
    kb_text = "\n\n".join(kb_parts) or "（未检索到相关知识库片段；如使用通用知识，请明确说明未命中课程知识库。）"

    style = profile.get("cognitive_style", {})
    style_hint = ""
    if style.get("visual", 0) > 0.5:
        style_hint = "（学生偏视觉型，多用图表和类比）"
    elif style.get("verbal", 0) > 0.5:
        style_hint = "（学生偏文字型，注重逻辑推理）"
    elif style.get("practical", 0) > 0.5:
        style_hint = "（学生偏实践型，多用实际例子）"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for message in history[-10:]:
        role = message.get("role")
        content = message.get("content", "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append(
        {
            "role": "user",
            "content": (
                f"学生提问：{question}{style_hint}\n\n"
                "知识库参考如下。请先判断片段是否相关；如果相关，必须在相关结论后标注 [来源n]，"
                "不要只在文末集中列来源。\n\n"
                f"{kb_text}"
            ),
        }
    )

    if on_delta:
        parts: list[str] = []
        for chunk in llm.stream(messages):
            text = chunk.content or ""
            if text:
                parts.append(text)
                on_delta(text)
        return "".join(parts)
    else:
        resp = llm.invoke(messages)
        return resp.content
