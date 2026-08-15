"""Diagnostic agent — 摸底分析：学生自评 + AI 学情判断。"""

from __future__ import annotations

import json
from typing import Any

from app.core.llm import build_llm, parse_json_response

LEVEL_HINT = {
    "基础": "学生自评为基础水平，多数核心概念尚未建立，需从直觉与最小前置知识讲起。",
    "进阶": "学生自评为进阶水平，掌握了主干概念但在综合应用、易混点上仍有缺口。",
    "完全掌握": "学生自评为完全掌握，应聚焦查漏补缺、拔高与典型陷阱，避免重复基础内容。",
}

SYSTEM_PROMPT = """你是学情诊断专家。学生给出要学习的【科目】和自评【掌握度】，请据此分析学情并给出可执行建议。

可用的资料类型（用于 suggested_modules，从中选 2-4 个最合适的）：
explainer(概念讲义) mindmap(思维导图) quiz(练习题库) reading(拓展阅读) code(代码示例) video(讲解视频) courseware(课件PPT) interactive(交互演示)

只输出 JSON：
```json
{
  "summary": "一句话学情判断",
  "narrative": "150-300 字的 Markdown 分析正文：当前水平、可能的薄弱环节、学习建议",
  "strengths": ["优势/已具备的基础", "..."],
  "gaps": ["薄弱点/易错环节", "..."],
  "recommended_focus": ["接下来应重点突破的知识点", "..."],
  "knowledge_seed": {"知识点名称": 0.4, "另一个知识点": 0.7},
  "suggested_modules": ["explainer", "quiz"]
}
```
要求：knowledge_seed 的分值为 0-1 的掌握度估计（基础偏低、完全掌握偏高）；内容贴合科目，勿空泛。"""


def _fallback(subject: str, self_level: str) -> dict[str, Any]:
    base = {"基础": 0.3, "进阶": 0.6, "完全掌握": 0.85}.get(self_level, 0.5)
    return {
        "summary": f"{subject}·自评{self_level}：已生成基础学情画像，建议从核心概念稳步推进。",
        "narrative": (
            f"你将学习 **{subject}**，自评掌握度为 **{self_level}**。"
            f"{LEVEL_HINT.get(self_level, '')}\n\n"
            "建议先梳理整体知识结构，再围绕薄弱环节做针对性练习，边学边测以校准掌握度。"
        ),
        "strengths": [f"有明确的学习科目（{subject}）", "已对自身水平有基本判断"],
        "gaps": ["薄弱点尚需通过练习进一步定位"],
        "recommended_focus": [f"{subject}核心概念", f"{subject}典型题型"],
        "knowledge_seed": {f"{subject}基础": round(base, 2)},
        "suggested_modules": ["explainer", "quiz"] if base < 0.7 else ["quiz", "reading"],
    }


def analyze(subject: str, self_level: str, profile: dict[str, Any] | None = None) -> dict[str, Any]:
    """运行摸底分析，返回结构化结果（失败时回退到规则化兜底）。"""
    try:
        llm = build_llm(temperature=0.4)
        profile_text = ""
        if profile:
            profile_text = f"\n\n已知画像（参考）：{json.dumps(profile, ensure_ascii=False)[:500]}"
        prompt = (
            f"科目：{subject}\n自评掌握度：{self_level}\n"
            f"（{LEVEL_HINT.get(self_level, '')}）{profile_text}\n\n请给出学情诊断 JSON。"
        )
        resp = llm.invoke([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        result = parse_json_response(resp.content)
        if not isinstance(result, dict) or not result.get("narrative"):
            return _fallback(subject, self_level)
        # 兜底字段
        result.setdefault("summary", f"{subject}·{self_level} 学情分析")
        for key in ("strengths", "gaps", "recommended_focus", "suggested_modules"):
            if not isinstance(result.get(key), list):
                result[key] = []
        if not isinstance(result.get("knowledge_seed"), dict):
            result["knowledge_seed"] = {}
        return result
    except Exception:
        return _fallback(subject, self_level)
