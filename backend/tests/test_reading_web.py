from __future__ import annotations


class _Response:
    content = (
        '{"title":"扩展阅读","content":"正文","key_terms":[],"references":[],"discussion_questions":[]}'
    )


class _LLM:
    def invoke(self, messages):
        return _Response()


def test_reading_agent_uses_optional_web_sources_without_replacing_course_evidence(monkeypatch):
    from app.agents import reading
    from app.services import web_search

    queries: list[str] = []

    def fake_search(query: str, count: int):
        queries.append(query)
        return [{
            "title": "课外算法史",
            "url": "https://example.com/history",
            "summary": "数据结构发展史",
            "site": "示例站点",
        }]

    monkeypatch.setattr(reading.settings, "BOCHA_API_KEY", "configured")
    monkeypatch.setattr(reading, "build_llm", lambda **kwargs: _LLM())
    monkeypatch.setattr(web_search, "bocha_search", fake_search)

    result = reading.generate({
        "topic": "数据结构",
        "kb_context": [{"id": "kb-1", "content": "线性表与树"}],
    })

    assert queries == ["数据结构 延伸阅读"]
    assert result["web_search_status"] == "used"
    assert result["web_sources"][0]["url"] == "https://example.com/history"
    assert any("课外算法史" in item for item in result["references"])


def test_approved_output_is_split_into_incremental_sse_chunks():
    from app.services.planned_resource_pipeline import _approved_output_chunks

    chunks = _approved_output_chunks({"type": "explainer", "content": "内容" * 200}, size=60)

    assert len(chunks) > 1
    assert "内容" in "".join(chunks)
