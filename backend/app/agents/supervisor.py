"""Supervisor agent — 分诊：决定生成哪些资源模块。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

ALL_MODULES = [
    "explainer", "mindmap", "quiz", "solution", "reading", "code", "video", "courseware", "interactive"
]

SYSTEM_PROMPT = """你是一个学习资源分诊专家。根据学生的学习主题和知识库内容，决定应该生成哪些类型的学习资源。

可选模块：
- explainer: 概念讲解（文字解释+类比）
- mindmap: 思维导图（知识结构可视化）
- quiz: 即时测验（巩固练习题）
- solution: 题目解析（题目、答案与逐题讲解一体化资料）
- reading: 延伸阅读（拓展材料）
- code: 代码示例（编程相关主题）
- video: 讲解短片（动画视频）
- courseware: 课件PPT
- interactive: 交互演示（沙箱内可操作的三维模型、公式渲染或算法动画）

输出 JSON 格式：
```json
{
  "selected": ["explainer", "mindmap", "quiz"],
  "reason": "选择原因说明"
}
```

规则：
1. 每个主题至少选 2 个模块
2. 编程相关主题必须包含 code
3. 概念性主题优先 explainer + mindmap
4. 所有主题都应包含 quiz 用于巩固
5. 视觉型学生优先 mindmap/video；实践型优先 code/quiz；文字型优先 explainer/reading；薄弱点多时必须包含 quiz
6. 三维几何、空间结构、公式推导、算法执行过程这类"看一眼就懂"的主题优先加 interactive"""


def classify_modules(topic: str, kb_context: list[dict[str, Any]], profile: dict | None = None) -> tuple[list[str], str]:
    """分诊：返回 (选中的模块列表, 选择原因)。"""
    llm = build_llm(temperature=0)

    context_text = ""
    if kb_context:
        from app.agents.common import format_untrusted_knowledge_context

        context_text = "\n\n知识库相关片段：\n" + format_untrusted_knowledge_context(
            kb_context, max_sources=5, max_content_chars=200
        )

    profile_text = ""
    if profile:
        style = profile.get("cognitive_style") or {}
        dominant = max(style, key=style.get) if style else ""
        weak = [
            kp for kp, v in (profile.get("knowledge_level") or {}).items()
            if isinstance(v, dict) and v.get("score", 1) < 0.6
        ]
        profile_text = f"\n\n学生画像：认知风格偏 {dominant}；薄弱知识点：{weak or '无'}"

    prompt = f"学习主题：{topic}{context_text}{profile_text}\n\n请决定需要生成哪些资源模块。"

    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    try:
        result = parse_json_response(resp.content)
        selected = result.get("selected", ["explainer", "quiz"])
        reason = result.get("reason", "默认选择")
        selected = [m for m in selected if m in ALL_MODULES]
        if not selected:
            selected = ["explainer", "quiz"]
        return selected, reason
    except Exception:
        return ["explainer", "quiz"], "分诊解析失败，使用默认组合"
