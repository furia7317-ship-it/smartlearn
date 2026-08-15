"""LLM 工具函数测试。"""

import pytest

from app.core.llm import parse_json_response


class TestParseJsonResponse:
    """JSON 解析测试。"""

    def test_pure_json(self):
        result = parse_json_response('{"key": "value"}')
        assert result == {"key": "value"}

    def test_json_array(self):
        result = parse_json_response('[1, 2, 3]')
        assert result == [1, 2, 3]

    def test_json_in_code_block(self):
        text = '```json\n{"key": "value"}\n```'
        result = parse_json_response(text)
        assert result == {"key": "value"}

    def test_json_in_text(self):
        text = '这是分析结果：\n{"key": "value"}\n以上。'
        result = parse_json_response(text)
        assert result == {"key": "value"}

    def test_invalid_json(self):
        with pytest.raises(ValueError):
            parse_json_response("这不是JSON也不是代码块")

    def test_nested_json(self):
        text = '{"a": {"b": [1, 2]}, "c": "d"}'
        result = parse_json_response(text)
        assert result["a"]["b"] == [1, 2]

    def test_outer_json_fence_can_contain_markdown_code_fence(self):
        text = '''```json
{"title":"讲义","explanation":"先看代码：\\n```python\\nprint(1)\\n```"}
```'''
        result = parse_json_response(text)
        assert result["title"] == "讲义"
        assert "```python" in result["explanation"]
