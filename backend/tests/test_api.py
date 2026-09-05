"""API 端点集成测试。"""

import pytest
from unittest.mock import patch, MagicMock


class TestAPIEndpoints:
    """API 端点测试（不启动真实服务器，直接调用路由函数）。"""

    def test_root_endpoint(self):
        """测试根端点。"""
        from app.main import app
        from starlette.testclient import TestClient

        # 简单验证 app 创建成功
        assert app.title == "学枢"

    def test_root_endpoint_real_request(self, monkeypatch, tmp_path):
        """真正发一次 HTTP 请求并校验响应体（跑通 lifespan）。"""
        import app.core.config as cfg

        # 跳过 DEBUG 下的播种/导库；媒体目录指向临时目录避免污染
        monkeypatch.setattr(cfg.settings, "DEBUG", False)
        monkeypatch.setattr(cfg.settings, "MEDIA_OUTPUT_DIR", str(tmp_path / "media"))

        from starlette.testclient import TestClient

        from app.main import app

        with TestClient(app) as client:
            resp = client.get("/")
            assert resp.status_code == 200
            body = resp.json()
            assert body["status"] == "running"
            assert body["name"]

    @pytest.mark.parametrize(
        "origin",
        ["http://127.0.0.1:3000", "http://127.0.0.1:5173"],
    )
    def test_local_ip_origins_are_allowed_by_cors(self, origin):
        """本地浏览器用 127.0.0.1 打开时也能访问后端。"""
        from app.main import app
        from starlette.testclient import TestClient

        client = TestClient(app)
        response = client.options(
            "/api/profile/test_student_001",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin

    def test_scoring_integration(self):
        """测试评分流程集成。"""
        from app.services.scoring import (
            grade_mcq_questions,
            calculate_overall,
            calculate_mastery,
            should_enter_wrongbook,
        )

        questions = [
            {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
            {"id": "q2", "type": "mcq", "answer": "B", "score": 10, "knowledge_point": "搜索"},
            {"id": "q3", "type": "short", "answer": "答案", "score": 20, "knowledge_point": "排序"},
        ]
        answers = {"q1": "A", "q2": "C", "q3": "部分正确答案"}

        # 选择题评分
        mcq_results = grade_mcq_questions(questions, answers)
        assert len(mcq_results) == 2
        assert mcq_results[0]["correct"] is True
        assert mcq_results[1]["correct"] is False

        # 加入主观题结果
        all_results = mcq_results + [
            {"score": 12, "max_score": 20, "knowledge_point": "排序", "correct": False}
        ]

        # 总分计算
        overall = calculate_overall(all_results)
        assert 0 <= overall <= 100

        # 掌握度
        mastery = calculate_mastery(all_results, questions)
        assert "排序" in mastery
        assert "搜索" in mastery

        # 错题本判断
        assert should_enter_wrongbook(5, 10) is True
        assert should_enter_wrongbook(8, 10) is False

    def test_graph_compilation(self):
        """测试所有图编译成功。"""
        from app.graph.resource_graph import resource_app
        from app.graph.exam_graph import exam_app
        from app.graph.grade_graph import grade_app
        from app.graph.tutor_graph import tutor_app
        from app.graph.profile_graph import profile_app

        for name, graph_app in [
            ("resource", resource_app),
            ("exam", exam_app),
            ("grade", grade_app),
            ("tutor", tutor_app),
            ("profile", profile_app),
        ]:
            g = graph_app.get_graph()
            nodes = list(g.nodes.keys())
            assert len(nodes) > 0, f"{name} graph has no nodes"
            assert "__start__" in [n.lower() for n in nodes], f"{name} graph missing START, got: {nodes}"

    def test_llm_providers(self):
        """测试 LLM provider 注册。"""
        from app.core.llm import list_providers

        providers = list_providers()
        assert len(providers) == 2
        names = [p["name"] for p in providers]
        assert names == ["spark", "deepseek"]
        assert "deepseek" in names
        assert "spark" in names

    def test_anti_hallucination_pipeline(self):
        """测试防幻觉完整流程。"""
        from app.services.anti_hallucination import full_review

        # 正常内容
        result = full_review(
            "冒泡排序[来源1]是基础排序算法",
            [{"content": "冒泡排序是最基础的排序算法"}],
        )
        assert result["approved"] is True

        # 有问题的内容
        result = full_review(
            "涉及赌博和毒品的内容[来源99]",
            [{"content": "正常知识库内容"}],
        )
        assert result["approved"] is False
        assert len(result["issues"]) > 0

    def test_behavior_service(self):
        """测试行为埋点服务。"""
        from app.services.behavior import record_event, get_dashboard_data
        # 只验证函数签名正确（实际调用需要数据库）
        import inspect
        sig = inspect.signature(record_event)
        assert "db" in sig.parameters
        assert "student_id" in sig.parameters
        assert "event_type" in sig.parameters

    def test_smart_chunk_markdown(self):
        """测试知识库智能分块。"""
        from app.routers.kb import _smart_chunk_markdown

        content = """# 第1章 概述

这是概述内容。

## 1.1 基本概念

这是基本概念的详细说明，包含很多内容。

## 1.2 另一个主题

这是另一个主题的内容。

```python
def hello():
    print("hello")
```

这是代码后面的内容。"""

        chunks = _smart_chunk_markdown(content, "test.md")
        assert len(chunks) > 0
        # 每个 chunk 都应该有 id 和 metadata
        for chunk in chunks:
            assert "id" in chunk
            assert "content" in chunk
            assert "metadata" in chunk
            assert "source" in chunk["metadata"]
            assert "document_title" in chunk["metadata"]
            assert "section_title" in chunk["metadata"]
            assert isinstance(chunk["metadata"]["sequence_index"], int)
            assert chunk["metadata"]["start_offset"] < chunk["metadata"]["end_offset"]
