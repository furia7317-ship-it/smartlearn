"""对比表格模板。"""

from __future__ import annotations

from manim import *


class CompareTableScene(Scene):
    """对比表格可视化。"""

    def __init__(
        self,
        columns: list[str] | None = None,
        rows: list[list[str]] | None = None,
        title: str = "对比分析",
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.columns = columns or ["特征", "方案A", "方案B"]
        self.rows = rows or [
            ["性能", "高", "中"],
            ["复杂度", "低", "高"],
            ["适用场景", "小规模", "大规模"],
        ]
        self.title_text = title

    def construct(self):
        title = Text(self.title_text, font_size=40, color=BLUE).to_edge(UP)
        self.play(Write(title))

        # 创建表格
        n_cols = len(self.columns)
        n_rows = len(self.rows) + 1  # +1 for header

        table = MobjectTable(
            [[Text(cell, font_size=20) for cell in row] for row in [self.columns] + self.rows],
            include_outer_lines=True,
            line_config={"color": WHITE},
        )

        table.scale(0.6)
        table.move_to(ORIGIN + DOWN * 0.3)

        # 逐行动画
        self.play(Create(table.get_horizontal_lines()))
        self.play(Create(table.get_vertical_lines()))

        for row in table.get_rows():
            self.play(*[FadeIn(cell) for cell in row], run_time=0.5)

        self.wait(2)
