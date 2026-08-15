"""LangGraph 图结构测试。"""

import pytest


class TestResourceGraph:
    """资源生成图测试。"""

    def test_graph_compiles(self):
        from app.graph.resource_graph import resource_app
        assert resource_app is not None

    def test_graph_has_required_nodes(self):
        from app.graph.resource_graph import resource_app
        graph = resource_app.get_graph()
        nodes = list(graph.nodes.keys())
        assert "supervisor" in nodes
        assert "reviewer" in nodes
        assert "explainer" in nodes
        assert "quiz" in nodes


class TestExamGraph:
    """出卷图测试。"""

    def test_graph_compiles(self):
        from app.graph.exam_graph import exam_app
        assert exam_app is not None

    def test_graph_has_required_nodes(self):
        from app.graph.exam_graph import exam_app
        graph = exam_app.get_graph()
        nodes = list(graph.nodes.keys())
        assert "classifier" in nodes
        assert "examiner" in nodes
        assert "persist" in nodes


class TestGradeGraph:
    """评分图测试。"""

    def test_graph_compiles(self):
        from app.graph.grade_graph import grade_app
        assert grade_app is not None

    def test_graph_has_required_nodes(self):
        from app.graph.grade_graph import grade_app
        graph = grade_app.get_graph()
        nodes = list(graph.nodes.keys())
        assert "rule_grade_mcq" in nodes
        assert "grader" in nodes
        assert "merge" in nodes
        assert "analyst" in nodes


class TestViz:
    """可视化导出测试。"""

    def test_get_all_graphs(self):
        from app.graph.viz import get_all_graphs

        graphs = get_all_graphs()
        assert "resource" in graphs
        assert "exam" in graphs
        assert "grade" in graphs
        assert "tutor" in graphs
        assert "profile" in graphs
