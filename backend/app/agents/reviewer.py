"""Reviewer agent — 审核智能体：敏感词过滤 + 公式归一 + 防幻觉自检。

集成 anti_hallucination 服务进行规则审核，再用 LLM 做内容质量审核。
"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是内容审核专家。检查以下学习资源的质量：
1. 内容是否准确、完整
2. 解释是否清晰易懂
3. 代码是否可运行
4. 是否有误导性描述

输出 JSON：
```json
{
  "approved": true/false,
  "issues": ["问题1", "问题2"],
  "fixes": {"resource_id": "修正建议"}
}
```"""


def review_resources(
    resources: list[dict[str, Any]],
    kb_context: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """审核资源列表，返回修订后的资源。

    审核流程：
    1. anti_hallucination 规则审核（敏感词/公式归一/引用验证/事实核查）
    2. LLM 内容质量审核（准确性/完整性/可读性）
    """
    if not resources:
        return resources

    from app.services.anti_hallucination import full_review

    # ── 第一步：规则审核 ──
    for r in resources:
        content_text = _extract_content_text(r)
        rule_result = full_review(content_text, kb_context)

        r["reviewed"] = True
        r["review_approved"] = rule_result["approved"]
        r["review_issues"] = rule_result["issues"]
        r["review_sources"] = rule_result["sources"]

        # 如果规则审核发现问题，记录但不阻塞
        if not rule_result["approved"]:
            r.setdefault("review_notes", []).extend(rule_result["issues"])

    # ── 第二步：LLM 质量审核 ──
    try:
        llm = build_llm(temperature=0)

        resources_text = ""
        for r in resources:
            content_preview = _extract_content_text(r)[:500]
            resources_text += f"- {r.get('type', 'unknown')} ({r.get('id', '?')}): {content_preview}\n"

        from app.agents.common import format_untrusted_knowledge_context

        sources_text = format_untrusted_knowledge_context(
            kb_context, max_sources=10, max_content_chars=300
        )

        prompt = f"知识库来源：\n{sources_text}\n\n待审核资源：\n{resources_text}"

        resp = llm.invoke([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        result = parse_json_response(resp.content)
        approved = result.get("approved")
        if not isinstance(approved, bool):
            raise ValueError("reviewer returned no explicit boolean verdict")

        # 应用 LLM 审核修正（不覆盖结构化内容，只记录建议）
        fixes = result.get("fixes", {})
        if fixes:
            for r in resources:
                rid = r.get("id", "")
                if rid in fixes:
                    r.setdefault("review_notes", []).append(f"修正建议: {fixes[rid]}")

        # 合并 LLM 审核结果
        if approved is False:
            for r in resources:
                r["review_approved"] = False
                r["review_status"] = "rejected"
                r.setdefault("review_notes", []).extend(result.get("issues", []))
        else:
            for r in resources:
                r["review_status"] = (
                    "approved" if r.get("review_approved") else "rejected"
                )

    except Exception as exc:  # noqa: BLE001
        # Infrastructure failure is distinct from content rejection and must
        # never publish a rule-only candidate as fully reviewed.
        for r in resources:
            r["review_approved"] = False
            r["review_status"] = "review_unavailable"
            r["review_error_code"] = "review_unavailable"
            r["review_retryable"] = True
            r.setdefault("review_notes", []).append(
                f"审核基础设施不可用：{type(exc).__name__}"
            )

    return resources


def _extract_content_text(resource: dict[str, Any]) -> str:
    """从资源中提取文本内容用于审核。"""
    from app.services.resource_quality import extract_resource_text

    return extract_resource_text(resource)
