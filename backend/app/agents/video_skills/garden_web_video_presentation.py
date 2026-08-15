"""Adapter for ConardLi/garden-skills web-video-presentation.

Source: https://github.com/ConardLi/garden-skills
Pinned reference commit: aaf9a82f5efd73e87cc0998edc398e75bfc35901
License: MIT

The upstream skill builds interactive React stages. 学枢 uses a native
FFmpeg renderer, so this adapter retains the content and visual-craft contract
while mapping it onto the local storyboard schema.
"""

from __future__ import annotations

GARDEN_SKILL_ID = "garden/web-video-presentation@aaf9a82"

_SKILL_PROMPT = """
<loaded_skill id="garden/web-video-presentation" mode="smartlearn-adapter">
你必须按 Garden Web Video Presentation 的方法规划画面：

1. 固定 16:9 横屏舞台。不得生成 portrait，也不得把竖屏构图裁成横屏。
2. 口播节拍驱动画面：一个 scene 只承载一个可说完的 idea；每镜 7-18 秒。
3. 章节化连续叙事：每章 2-4 个 scene，共享一个 visual_anchor；后一镜必须
   说明与前一镜的关系，不能像互不相关的 PPT 页面。
4. 逐步揭示：清单、过程、对比必须拆成连续 scene。前一镜的关键元素灰化
   或缩小后保留，当前元素成为视觉焦点。
5. 每镜只把 1-3 个重点放到屏幕；旁白负责线性解释，画面负责演示关系、
   数据、流程和变化。禁止把完整旁白复制成大段正文。
6. 每章至少包含 1-2 个真正的视觉演示：过程节点点亮、关系连线、对照切换、
   数字变化、结构展开或案例推进。整章纯文字不合格。
7. 构图由内容关系决定：hook 用 hero，定义/关系用 split，步骤用 process，
   正误/差异用 comparison，回顾用 recap。不要全片重复同一种卡片布局。
8. 画面信息密度要高于口播：优先使用具体数字、案例、条件、输入输出和限制；
   不得编造事实、假数据或无关素材。
9. 口播采用自然 B 站表达：短句、3 秒内钩子、具体例子、自然过渡；清理
   “首先/其次/最后”“本质上”“颠覆认知”等模板化 AI 腔。
10. 输出关系语义，不指定 CSS/FFmpeg 动画实现。用 relation_to_previous 表达
    new_chapter/progressive/detail/contrast/transfer/return，由渲染器选择转场。

每个 scene 必须补充：chapter_id、chapter_title、composition、visual_anchor、
carry_over、relation_to_previous。visual_anchor 是本章持续出现的对象；
carry_over 是从上一章节内容保留到当前内容的元素或结论。
每镜还必须输出按旁白顺序排列的 reveal_sequence；固定画布，只让对应元素
逐项淡入、点亮或连线，禁止对整页做持续平移或缩放。
</loaded_skill>
""".strip()


def load_garden_video_skill() -> str:
    """Return the pinned Garden workflow prompt loaded by the video agent."""

    return _SKILL_PROMPT
