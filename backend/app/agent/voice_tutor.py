"""Low-latency, speech-first tutor used only by realtime voice calls."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

VOICE_REPLY_MAX_CHARS = 180
SPECIAL_CONTENT_MARKER = "【按要求展示】"

_VOICE_SYSTEM_BASE = """你是「学枢」的语音通话专用教师。你的职责是像真人教师当面交流一样，快速、自然地回应学生。

回答规则：
- 直接回应学生刚说的话，不复述问题，不写思考过程、开场白或总结套话。
- 通常回答一到两句，只讲当前最重要的结论和必要解释；除非学生明确要求展开，否则不超过一百八十字。
- 使用自然口语，但保持完整、规范的句子。可以使用“对”“这里关键是”“你可以这样理解”等自然衔接，不要机械使用“首先、其次、综上所述”。
- 一次最多追问一个真正必要的问题。能够直接回答时不要追问。
- 只输出纯文本和常规标点。禁止表情符号、颜文字、Markdown、标题、项目符号、表格、代码围栏和链接。
- 不虚构事实；页面上下文和历史信息不足时，简短说明还需要哪一项信息。
"""

_VOICE_STYLE = {
    "alligator": "语气直接利落，先说结论；指出错误时清楚但不刻薄。",
    "raccoon": "语气亲切耐心，解释清楚但不过度铺陈。",
}


def explicitly_requests_special_content(question: str) -> bool:
    """Allow decorative/structured output only when the current turn asks for it."""

    text = str(question or "").strip().lower()
    if not text:
        return False
    subject = re.search(
        r"表情|emoji|颜文字|markdown|代码块|项目符号|特殊符号|链接|表格|列表",
        text,
        flags=re.IGNORECASE,
    )
    request = re.search(r"请|用|使用|加|加入|带上|显示|输出|写成|包含|保留", text)
    return bool(subject and request)


def build_voice_system_prompt(
    teacher_persona: str = "raccoon",
    *,
    allow_special_content: bool = False,
) -> str:
    """Return the dedicated, server-controlled voice-agent policy."""

    style = _VOICE_STYLE.get(teacher_persona, _VOICE_STYLE["raccoon"])
    permission = (
        f"\n学生在当前这一轮明确要求特殊格式或表情，可以只按该要求输出；这段内容必须以{SPECIAL_CONTENT_MARKER}开头。"
        if allow_special_content
        else ""
    )
    return f"{_VOICE_SYSTEM_BASE}\n当前教师语气：{style}{permission}"


def sanitize_voice_reply(
    value: str,
    *,
    max_chars: int = VOICE_REPLY_MAX_CHARS,
    allow_special_content: bool = False,
) -> str:
    """Reduce model output to short plain sentences that are safe to display/speak."""

    text = unicodedata.normalize("NFC", str(value or ""))
    text = re.sub(r"<think\b[^>]*>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"<(?:reasoning|public_reasoning)\b[^>]*>[\s\S]*?</(?:reasoning|public_reasoning)>",
        "",
        text,
        flags=re.IGNORECASE,
    )
    if allow_special_content:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            text = "我没有听清楚，请再说一遍。"
        text = text.removeprefix(SPECIAL_CONTENT_MARKER).strip()
        available = max(1, max_chars - len(SPECIAL_CONTENT_MARKER))
        text = text[:available].rstrip()
        return f"{SPECIAL_CONTENT_MARKER}{text}"

    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_~#]+", "", text)
    text = re.sub(r"^[\s>*#_~\-•·]+", "", text, flags=re.MULTILINE)
    text = text.replace("\r", " ").replace("\n", " ")

    # Letters, numbers, punctuation and spacing are enough for standard spoken
    # sentences. This drops emoji, pictographs, dingbats, variation selectors,
    # zero-width joiners and other decorative symbols even if the model ignores
    # the system prompt.
    text = "".join(char for char in text if char.isspace() or unicodedata.category(char)[0] in {"L", "N", "P"})
    text = re.sub(r"\s+", " ", text).strip(" \t-—•·")
    text = re.sub(r"([。！？!?])\1+", r"\1", text)

    if not text:
        return "我没有听清楚，请再说一遍。"
    if len(text) > max_chars:
        bounded = text[:max_chars]
        sentence_end = max(bounded.rfind(mark) for mark in "。！？!?")
        if sentence_end >= 60:
            text = bounded[: sentence_end + 1]
        else:
            text = bounded.rstrip("，、;；:： ")[: max_chars - 1] + "。"
    elif text[-1] not in "。！？!?":
        text += "。"
    return text


class VoiceTutorAgent:
    """A separate no-tool agent optimized for one short conversational turn."""

    def __init__(self, client: Any, model: str, *, provider_id: str = "") -> None:
        self.client = client
        self.model = model
        self.provider_id = provider_id

    async def run(
        self,
        messages: list[dict[str, Any]],
        *,
        allow_special_content: bool = False,
    ) -> str:
        request: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.55,
            "max_tokens": 140,
            "stream": False,
        }
        if self.provider_id.strip().lower() == "mimo" or "mimo" in self.model.lower():
            request["extra_body"] = {"thinking": {"type": "disabled"}}
        response = await self.client.chat.completions.create(
            **request,
        )
        choices = getattr(response, "choices", None) or []
        if not choices:
            return sanitize_voice_reply("")
        content = getattr(getattr(choices[0], "message", None), "content", "")
        if isinstance(content, list):
            content = "".join(str(item.get("text") or "") if isinstance(item, dict) else str(item) for item in content)
        return sanitize_voice_reply(
            str(content or ""),
            allow_special_content=allow_special_content,
        )
