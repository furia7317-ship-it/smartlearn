"""Reading agent — 延伸阅读材料。"""

from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是学习资源推荐专家。根据主题生成延伸阅读材料。

输出 JSON：
```json
{
  "title": "延伸阅读标题",
  "content": "阅读材料正文（Markdown 格式，500-800字）",
  "key_terms": [{"term": "术语", "definition": "定义"}],
  "references": ["参考来源1", "参考来源2"],
  "discussion_questions": ["思考题1", "思考题2"]
}
```"""


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成延伸阅读。"""
    llm = build_llm(temperature=0.7)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )
    web_results: list[dict[str, Any]] = []
    if settings.BOCHA_API_KEY:
        try:
            from app.services.web_search import bocha_search

            web_results = bocha_search(f"{state['topic']} 延伸阅读", count=5)
        except Exception:
            # 联网来源是增强项。网络波动或未授权时继续使用课程知识库，
            # 不让整份阅读资料因为搜索服务失败而中断。
            web_results = []
    web_text = "\n".join(
        f"- {item.get('title')}: {item.get('summary') or item.get('snippet')} ({item.get('url')})"
        for item in web_results
    )

    prompt = (
        f"主题：{state['topic']}\n\n知识库参考：{kb_text}"
        f"\n\n课外联网来源：{web_text or '本次未启用联网来源'}"
        f"{prompt_extras(state)}\n\n请生成扩展阅读材料，并明确区分课程内知识与课外延伸。"
    )

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        result = parse_json_response(resp.content)
        result["type"] = "reading"
        result["id"] = f"reading_{state['topic'][:20]}"
        result["web_search_status"] = "used" if web_results else "unavailable"
        result["web_sources"] = [
            {"title": item.get("title"), "url": item.get("url"), "site": item.get("site")}
            for item in web_results
        ]
        if web_results:
            result["references"] = list(dict.fromkeys([
                *list(result.get("references") or []),
                *[f"{item.get('title')} - {item.get('url')}" for item in web_results],
            ]))
        return result
    except Exception:
        return {
            "type": "reading",
            "id": f"reading_{state['topic'][:20]}",
            "title": f"{state['topic']} - 延伸阅读",
            "content": resp.content,
            "key_terms": [],
            "references": [],
            "discussion_questions": [],
            "web_search_status": "used" if web_results else "unavailable",
            "web_sources": [
                {"title": item.get("title"), "url": item.get("url"), "site": item.get("site")}
                for item in web_results
            ],
        }
