"""Book preview/graph helpers stay deterministic and reject malformed agent output."""

from app.routers.kb import _BOOK_GRAPH_PROMPT, _clean_book_text, _normalize_book_graph


def test_clean_book_text_collapses_noise_and_limits_length():
    source = "第一章   导论\n\n\n\n核心概念\t 说明" * 100
    cleaned = _clean_book_text(source, 120)
    assert len(cleaned) <= 120
    assert "   " not in cleaned
    assert "\n\n\n" not in cleaned


def test_clean_book_text_stops_before_document_platform_boilerplate():
    source = "第一章 绪论\n1.1 基本概念\n1.2 算法复杂度\n" + ("正文说明 " * 30) + "\n您可能关注的文档\n广告.docx 资料.pdf 课件.pptx\n原创力文档 版权声明"
    cleaned = _clean_book_text(source, 6000)
    assert "算法复杂度" in cleaned
    assert "您可能关注的文档" not in cleaned
    assert "原创力文档" not in cleaned


def test_normalize_book_graph_drops_dangling_edges_and_bad_nodes():
    raw = {
        "title": "数据结构",
        "overview": "结构概览",
        "nodes": [
            {"id": "root", "label": "数据结构", "kind": "root", "importance": 8},
            {"id": "list", "label": "线性表", "kind": "chapter", "importance": 4},
            {"id": "list", "label": "重复 ID", "kind": "unknown", "importance": 0},
            {"id": "empty", "label": ""},
        ],
        "edges": [
            {"source": "root", "target": "list", "relation": "包含"},
            {"source": "root", "target": "missing", "relation": "无效"},
        ],
    }
    graph = _normalize_book_graph(raw, "回退书名")
    assert graph["title"] == "数据结构"
    assert len(graph["nodes"]) == 3
    assert len({node["id"] for node in graph["nodes"]}) == 3
    assert graph["nodes"][0]["importance"] == 5
    assert graph["nodes"][2]["kind"] == "concept"
    assert graph["edges"] == [{"source": "root", "target": "list", "relation": "包含"}]


def test_book_graph_prompt_requests_a_whole_book_hierarchy():
    assert "18-32 个节点" in _BOOK_GRAPH_PROMPT
    assert "全书主题 root → 章节 chapter → 核心概念 concept → 示例/应用 example" in _BOOK_GRAPH_PROMPT
    assert "跨章节" in _BOOK_GRAPH_PROMPT
