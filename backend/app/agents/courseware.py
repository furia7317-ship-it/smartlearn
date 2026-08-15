"""Courseware agent — 课件PPT大纲生成。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是课件设计专家。根据主题生成 PPT 大纲，并挑选一套合适的视觉模板。

可选视觉模板（template）：
- academic 学术简约：白底深蓝，正式清爽，适合课堂讲义
- tech 科技蓝：深蓝底亮青，科技感，适合前沿/工程主题
- warm 暖阳：米色暖调，亲和，适合入门/科普
- chalk 板书：墨绿黑板风，适合公式推导/演算
- business 商务红：浅灰底酒红，稳重正式，适合答辩/汇报
- fresh 清新绿：浅绿底墨绿，轻松明快，适合通识/兴趣课

输出 JSON：
```json
{
  "title": "课件标题",
  "template": "academic",
  "slides": [
    {
      "slide_num": 1,
      "title": "幻灯片标题",
      "content": ["要点1", "要点2"],
      "layout": "title|content|two_column|image"
    }
  ],
  "total_slides": 10
}
```

规则：
1. 8-15 页
2. 第一页为标题页
3. 最后一页为总结页
4. 每页 3-5 个要点
5. 适当使用 two_column 布局
6. template 必须从上面六个键里选一个，按主题气质匹配（如算法推导选 chalk，工程/AI 选 tech）"""


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成课件大纲（实际渲染由 media 服务处理）。"""
    llm = build_llm(temperature=0.5)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    prompt = f"主题：{state['topic']}\n\n知识库参考：{kb_text}{prompt_extras(state)}\n\n请生成课件大纲。"

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    from app.services.media.ppt import DEFAULT_TEMPLATE, THEMES

    try:
        result = parse_json_response(resp.content)
        result["type"] = "courseware"
        result["id"] = f"courseware_{state['topic'][:20]}"
        # 校验模板键，非法则回落默认主题
        if result.get("template") not in THEMES:
            result["template"] = DEFAULT_TEMPLATE
        return result
    except Exception:
        return {
            "type": "courseware",
            "id": f"courseware_{state['topic'][:20]}",
            "title": f"{state['topic']} - 课件",
            "template": DEFAULT_TEMPLATE,
            "slides": [],
            "total_slides": 0,
        }
