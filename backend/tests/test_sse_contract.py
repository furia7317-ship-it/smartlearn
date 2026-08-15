"""SSE 契约对拍测试：验证事件格式与规格一致。"""

import pytest
import json
from app.core.sse import (
    sse_format,
    make_plan_event,
    make_progress_event,
    make_content_event,
    make_done_event,
    make_stage_event,
    make_exam_event,
    make_graded_event,
    make_report_event,
)


class TestSSEFormat:
    """SSE 格式测试。"""

    def test_basic_format(self):
        result = sse_format("message", {"key": "value"})
        assert result.startswith("event: message\n")
        assert "data: " in result
        assert result.endswith("\n\n")

    def test_string_data(self):
        result = sse_format("test", "plain text")
        assert "data: plain text" in result

    def test_json_data(self):
        result = sse_format("test", {"nested": {"key": "value"}})
        data_line = [l for l in result.split("\n") if l.startswith("data: ")][0]
        data_str = data_line[6:]
        parsed = json.loads(data_str)
        assert parsed["nested"]["key"] == "value"


class TestSSEEvents:
    """SSE 事件格式测试（对齐规格文档）。"""

    def test_plan_event(self):
        result = make_plan_event("排序算法", ["explainer", "quiz"])
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["topic"] == "排序算法"
        assert "explainer" in parsed["modules"]

    def test_progress_event(self):
        result = make_progress_event("explainer", "started")
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["agent"] == "explainer"
        assert parsed["status"] == "started"

    def test_content_event(self):
        result = make_content_event("explainer", "explanation", {"text": "内容"})
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["agent"] == "explainer"
        assert parsed["type"] == "explanation"

    def test_done_event(self):
        result = make_done_event({"total": 3})
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["total"] == 3

    def test_stage_event(self):
        result = make_stage_event("classify", "分析知识点")
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["stage"] == "classify"
        assert parsed["detail"] == "分析知识点"

    def test_exam_event(self):
        result = make_exam_event({"questions": [{"id": "q1"}]})
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert "questions" in parsed

    def test_graded_event(self):
        result = make_graded_event({"overall": 85.5})
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["overall"] == 85.5

    def test_report_event(self):
        result = make_report_event({"summary": "分析报告"})
        parsed = json.loads(result.split("data: ")[1].split("\n")[0])
        assert parsed["summary"] == "分析报告"


class TestSSEContractAlignment:
    """SSE 契约对齐测试：验证与前端 parseSseEvents 的兼容性。"""

    def test_events_parseable(self):
        """所有事件类型都能被前端解析。"""
        events = [
            make_plan_event("topic", ["m1"]),
            make_progress_event("agent", "started"),
            make_content_event("agent", "type", {}),
            make_done_event(),
            make_stage_event("stage"),
            make_exam_event({"questions": []}),
            make_graded_event({"overall": 0}),
            make_report_event({"summary": ""}),
        ]

        for event_str in events:
            lines = event_str.strip().split("\n")
            event_line = [l for l in lines if l.startswith("event: ")]
            data_line = [l for l in lines if l.startswith("data: ")]

            assert len(event_line) == 1, f"Missing event line in: {event_str[:50]}"
            assert len(data_line) == 1, f"Missing data line in: {event_str[:50]}"

            # data 应该是合法 JSON
            data_str = data_line[0][6:]
            parsed = json.loads(data_str)
            assert isinstance(parsed, dict)
