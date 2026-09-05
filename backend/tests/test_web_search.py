"""web_search 服务单测：纯文本分块（含超长硬切）+ 博查响应解析（mock httpx，不触网）。"""

from unittest.mock import MagicMock

import pytest

from app.services import web_search


class TestChunkPlainText:
    def test_splits_long_unbroken_block(self):
        # 3000 字、无空行的整块，绝不能只切成 1 块（曾经的 bug）
        text = "数据结构。" * 600
        chunks = web_search.chunk_plain_text(text, "x", size=700)
        assert len(chunks) >= 4
        assert all(c["metadata"]["char_count"] <= int(700 * 1.4) + 1 for c in chunks)

    def test_aggregates_short_paragraphs(self):
        # 每段 >20 字（短于此会被当作导航碎片过滤掉）
        para = "这是一段用于测试段落聚合逻辑的较长示例内容文字描述。"
        text = "\n\n".join([para] * 8)
        chunks = web_search.chunk_plain_text(text, "src", size=300)
        assert 1 <= len(chunks) < 8  # 短段被聚合，不是每段一块
        assert all(c["metadata"]["source"] == "src" for c in chunks)
        assert [c["metadata"]["sequence_index"] for c in chunks] == list(range(len(chunks)))

    def test_skips_tiny_fragments(self):
        text = "够长的一段正文内容用于测试分块逻辑是否正常工作。\n\n短"
        chunks = web_search.chunk_plain_text(text, "s")
        assert all(len(c["content"]) > 5 for c in chunks)


class TestBochaSearch:
    def test_parses_and_skips_urlless(self, monkeypatch):
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {
            "data": {
                "webPages": {
                    "value": [
                        {
                            "name": "红黑树原理",
                            "url": "https://a.com/x",
                            "snippet": "s",
                            "summary": "sum",
                            "siteName": "站点",
                            "datePublished": "2024-01-02T00:00:00Z",
                        },
                        {"name": "", "url": "", "snippet": "无 url 应被跳过"},
                    ]
                }
            }
        }
        monkeypatch.setattr(web_search.settings, "BOCHA_API_KEY", "test-key")
        monkeypatch.setattr(web_search.httpx, "post", lambda *a, **k: fake_resp)

        out = web_search.bocha_search("红黑树")
        assert len(out) == 1
        assert out[0]["title"] == "红黑树原理"
        assert out[0]["url"] == "https://a.com/x"
        assert out[0]["summary"] == "sum"
        assert out[0]["date"] == "2024-01-02"
        assert out[0]["id"]  # md5 短码

    def test_requires_key(self, monkeypatch):
        monkeypatch.setattr(web_search.settings, "BOCHA_API_KEY", "")
        with pytest.raises(RuntimeError):
            web_search.bocha_search("x")
