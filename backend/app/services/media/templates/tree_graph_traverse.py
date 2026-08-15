"""树/图遍历动画模板。"""

from __future__ import annotations

from manim import *


class TreeGraphTraverseScene(Scene):
    """二叉树遍历可视化。"""

    def __init__(
        self,
        tree: list | None = None,
        order: str = "inorder",
        title: str = "树遍历",
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.tree_data = tree or [1, 2, 3, 4, 5, 6, 7]
        self.order = order
        self.title_text = title

    def construct(self):
        title = Text(self.title_text, font_size=40, color=BLUE).to_edge(UP)
        self.play(Write(title))

        # 构建树
        nodes, edges = self._build_tree()
        self.play(*[Create(e) for e in edges])
        self.play(*[Create(n) for n in nodes])
        self.wait(0.5)

        # 遍历动画
        traverse_order = self._get_traverse_order()
        result_text = Text("遍历结果: ", font_size=28, color=YELLOW).to_edge(DOWN)
        self.play(Write(result_text))

        result_values = []
        for idx in traverse_order:
            if idx < len(nodes):
                self.play(nodes[idx].set_color, RED, run_time=0.5)
                result_values.append(str(self.tree_data[idx]))
                result_text.become(
                    Text(
                        f"遍历结果: {', '.join(result_values)}",
                        font_size=28,
                        color=YELLOW,
                    ).to_edge(DOWN)
                )
                self.wait(0.3)
                self.play(nodes[idx].set_color, WHITE, run_time=0.3)

        self.wait(2)

    def _build_tree(self) -> tuple[VGroup, VGroup]:
        nodes = VGroup()
        edges = VGroup()

        positions = [
            UP * 2,                          # root
            UP * 0.5 + LEFT * 2,             # left
            UP * 0.5 + RIGHT * 2,            # right
            DOWN * 1 + LEFT * 3,             # left-left
            DOWN * 1 + LEFT * 1,             # left-right
            DOWN * 1 + RIGHT * 1,            # right-left
            DOWN * 1 + RIGHT * 3,            # right-right
        ]

        for i, (val, pos) in enumerate(zip(self.tree_data, positions)):
            circle = Circle(radius=0.4, color=WHITE, fill_opacity=0.2)
            circle.move_to(pos)
            label = Text(str(val), font_size=24, color=WHITE)
            label.move_to(pos)
            nodes.add(VGroup(circle, label))

        # 边
        edge_pairs = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (2, 6)]
        for parent, child in edge_pairs:
            if parent < len(nodes) and child < len(nodes):
                line = Line(
                    nodes[parent].get_center(),
                    nodes[child].get_center(),
                    color=GRAY,
                )
                edges.add(line)

        return nodes, edges

    def _get_traverse_order(self) -> list[int]:
        """返回遍历顺序的索引。"""
        if self.order == "inorder":
            return [3, 1, 4, 0, 5, 2, 6]
        elif self.order == "preorder":
            return [0, 1, 3, 4, 2, 5, 6]
        elif self.order == "postorder":
            return [3, 4, 1, 5, 6, 2, 0]
        elif self.order == "bfs":
            return [0, 1, 2, 3, 4, 5, 6]
        return list(range(len(self.tree_data)))
