"""概念卡片模板 — 展示概念标题和要点。"""

from __future__ import annotations

from typing import Any

from manim import *


class ConceptCardScene(Scene):
    """概念卡片：标题 + 要点列表动画。"""

    def __init__(self, title: str = "概念", items: list[str] | None = None, **kwargs):
        super().__init__(**kwargs)
        self.title_text = title
        self.items = items or ["要点1", "要点2", "要点3"]

    def construct(self):
        # 标题
        title = Text(self.title_text, font_size=48, color=BLUE).to_edge(UP)
        self.play(Write(title))
        self.wait(0.5)

        # 要点列表
        bullets = VGroup()
        for i, item in enumerate(self.items):
            bullet = Text(f"• {item}", font_size=32, color=WHITE)
            bullets.add(bullet)

        bullets.arrange(DOWN, aligned_edge=LEFT, buff=0.4)
        bullets.next_to(title, DOWN, buff=0.8)

        for bullet in bullets:
            self.play(FadeIn(bullet, shift=RIGHT * 0.3))
            self.wait(0.3)

        self.wait(2)
