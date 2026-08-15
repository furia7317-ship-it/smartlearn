"""数组排序动画模板。"""

from __future__ import annotations

from typing import Any

from manim import *


class ArraySortScene(Scene):
    """数组排序可视化。"""

    def __init__(
        self,
        array: list[int] | None = None,
        algorithm: str = "bubble",
        title: str = "排序算法",
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.array = array or [5, 3, 8, 1, 9, 2, 7, 4]
        self.algorithm = algorithm
        self.title_text = title

    def construct(self):
        title = Text(self.title_text, font_size=40, color=BLUE).to_edge(UP)
        self.play(Write(title))

        # 创建柱状图
        bars = self._create_bars(self.array)
        self.play(Create(bars))
        self.wait(0.5)

        # 冒泡排序动画
        if self.algorithm == "bubble":
            self._bubble_sort(bars)

        self.wait(2)

    def _create_bars(self, arr: list[int]) -> VGroup:
        bars = VGroup()
        max_val = max(arr) if arr else 1
        bar_width = 0.8

        for i, val in enumerate(arr):
            height = val / max_val * 3
            bar = Rectangle(
                width=bar_width,
                height=height,
                fill_color=BLUE,
                fill_opacity=0.8,
                stroke_color=WHITE,
            )
            bar.move_to(LEFT * (len(arr) / 2 - i) * (bar_width + 0.1) + DOWN * 1)
            label = Text(str(val), font_size=20, color=WHITE)
            label.next_to(bar, UP, buff=0.1)
            bars.add(VGroup(bar, label))

        bars.move_to(ORIGIN + DOWN * 0.5)
        return bars

    def _bubble_sort(self, bars: VGroup):
        arr = list(self.array)
        n = len(arr)

        for i in range(n):
            for j in range(0, n - i - 1):
                if arr[j] > arr[j + 1]:
                    # 高亮比较的两个元素
                    self.play(
                        bars[j][0].animate.set_color(YELLOW),
                        bars[j + 1][0].animate.set_color(RED),
                        run_time=0.3,
                    )

                    # 交换位置
                    self.play(
                        bars[j].animate.shift(RIGHT * 0.9),
                        bars[j + 1].animate.shift(LEFT * 0.9),
                        run_time=0.3,
                    )

                    bars[j], bars[j + 1] = bars[j + 1], bars[j]
                    arr[j], arr[j + 1] = arr[j + 1], arr[j]

                    # 恢复颜色
                    self.play(
                        bars[j][0].animate.set_color(BLUE),
                        bars[j + 1][0].animate.set_color(BLUE),
                        run_time=0.2,
                    )

            # 标记已排序
            self.play(bars[n - i - 1][0].animate.set_color(GREEN), run_time=0.2)
