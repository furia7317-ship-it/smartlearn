"""公式推导步骤模板。"""

from __future__ import annotations

from manim import *


class FormulaStepScene(Scene):
    """公式推导逐步展示。"""

    def __init__(
        self,
        formula: str = "E = mc^2",
        steps: list[str] | None = None,
        title: str = "公式推导",
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.formula = formula
        self.steps = steps or [formula]
        self.title_text = title

    def construct(self):
        title = Text(self.title_text, font_size=40, color=BLUE).to_edge(UP)
        self.play(Write(title))

        prev_step = None
        for i, step in enumerate(self.steps):
            step_mob = MathTex(step, font_size=36, color=WHITE)

            if prev_step is None:
                step_mob.move_to(ORIGIN)
                self.play(Write(step_mob))
            else:
                step_mob.move_to(ORIGIN)
                self.play(Transform(prev_step, step_mob))
                step_mob = prev_step

            # 步骤编号
            step_label = Text(f"Step {i + 1}", font_size=20, color=GRAY)
            step_label.next_to(step_mob, LEFT, buff=0.5)
            self.play(FadeIn(step_label))

            self.wait(1.5)
            prev_step = step_mob

        self.wait(2)
