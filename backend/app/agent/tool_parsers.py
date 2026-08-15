"""Hermes 工具调用兜底解析。

移植自 Hermes agent 的 `environments/tool_call_parsers/hermes_parser.py`
（基于 vLLM 的 Hermes2ProToolParser）。当模型没有走原生 OpenAI `tool_calls`、
而是把调用写进正文 `<tool_call>{"name":..,"arguments":..}</tool_call>` 时，从文本里
还原成结构化调用。

返回 dict 形态的调用（与 harness 内部表示一致）：
    {"id": str, "name": str, "arguments": str(JSON)}
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Optional

# 同时匹配闭合与未闭合（生成被截断）的 <tool_call> 标签
_PATTERN = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>|<tool_call>\s*(.*)", re.DOTALL)


def parse_hermes_tool_calls(text: str) -> tuple[Optional[str], list[dict]]:
    """从文本中提取 Hermes 风格工具调用。

    Returns:
        (content, tool_calls)
        - content：剥掉工具标签后的正文（首个 <tool_call> 之前的部分），无正文则 None
        - tool_calls：[{id, name, arguments(JSON 字符串)}]，未命中则空列表
    """
    if "<tool_call>" not in text:
        return text, []

    try:
        matches = _PATTERN.findall(text)
        if not matches:
            return text, []

        tool_calls: list[dict] = []
        for closed, unclosed in matches:
            raw_json = closed if closed else unclosed
            if not raw_json.strip():
                continue
            try:
                data = json.loads(raw_json)
            except json.JSONDecodeError:
                continue
            if "name" not in data:
                continue
            tool_calls.append(
                {
                    "id": f"call_{uuid.uuid4().hex[:8]}",
                    "name": data["name"],
                    "arguments": json.dumps(data.get("arguments", {}), ensure_ascii=False),
                }
            )

        if not tool_calls:
            return text, []

        content = text[: text.find("<tool_call>")].strip()
        return (content or None), tool_calls
    except Exception:
        return text, []
