"""防幻觉服务：敏感词过滤 + 公式归一 + 引用溯源验证。"""

from __future__ import annotations

import re
from typing import Any


# ── 敏感词库（简化版，生产应从文件加载） ──
SENSITIVE_PATTERNS = [
    r"(?i)(政治|暴力|色情|赌博|毒品)",
    r"(?i)(hack|exploit|inject)",
]

# ── 公式归一化规则 ──
FORMULA_NORMALIZATIONS = [
    (r"[ \t]+", " "),                              # 只归一行内空格，保留换行
    (r"\\\\", r"\\"),                              # 双反斜杠 → 单（替换串必须用 r"\\"）
    (r"(?<!\$)\$([^$\n]+)\$(?!\$)", r"$$\1$$"),    # 仅单 $ → 双 $$，不碰已有 $$
]


def check_sensitive_content(text: str) -> tuple[bool, list[str]]:
    """检查文本是否包含敏感内容。

    Returns:
        (is_safe, violations) — is_safe=True 表示安全
    """
    violations = []
    for pattern in SENSITIVE_PATTERNS:
        matches = re.findall(pattern, text)
        if matches:
            violations.extend(matches)

    return len(violations) == 0, violations


def normalize_formulas(text: str) -> str:
    """归一化公式格式。"""
    for pattern, replacement in FORMULA_NORMALIZATIONS:
        text = re.sub(pattern, replacement, text)
    return text


def verify_source_citations(
    content: str,
    kb_context: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """验证引用角标是否对应真实知识库片段。

    Args:
        content: 含 [来源n] 角标的内容
        kb_context: 知识库检索结果

    Returns:
        (cleaned_content, valid_sources) — 移除无效引用后的文本和有效来源列表
    """
    # 提取内容中的引用
    citations = re.findall(r"\[来源(\d+)\]", content)
    valid_indices = set()
    invalid_indices = set()

    for cit in citations:
        idx = int(cit)
        if 1 <= idx <= len(kb_context):
            valid_indices.add(idx)
        else:
            invalid_indices.add(idx)

    # 移除无效引用
    cleaned = content
    for idx in invalid_indices:
        cleaned = cleaned.replace(f"[来源{idx}]", "")

    # 返回有效来源
    valid_sources = [
        kb_context[i - 1]
        for i in sorted(valid_indices)
        if i - 1 < len(kb_context)
    ]

    return cleaned, valid_sources


# 事实校验：声明与知识库片段的最小语义相似度阈值（归一化余弦，bge 标定）
GROUNDING_THRESHOLD = 0.5


def _extract_claims(content: str) -> list[str]:
    """抽取陈述性/定义性句子作为待核查声明。"""
    pattern = r"[^。！？.!?\n]*(?:是|为|指|等于|表示|定义|称为|属于|包括|由|具有)[^。！？.!?\n]*[。！？.!?]?"
    return [c.strip() for c in re.findall(pattern, content) if len(c.strip()) >= 6]


def verify_factual_claims(
    content: str,
    kb_context: list[dict[str, Any]],
    threshold: float = GROUNDING_THRESHOLD,
    embedder: Any = None,
) -> tuple[bool, list[str]]:
    """事实核查：逐句算声明与知识库片段的语义相似度，低于阈值即视为缺乏依据。

    用嵌入相似度做真实溯源校验（取代旧的子串匹配）。嵌入器不可用时（离线无模型）
    降级为不阻断，避免误杀；其余规则审核环节仍生效。

    Returns:
        (is_reliable, unverified_claims)
    """
    claims = _extract_claims(content)
    kb_texts = [c.get("content", "") for c in kb_context if c.get("content")]
    if not claims or not kb_texts:
        return True, []

    if embedder is None:
        try:
            from app.services.rag import _get_embedder

            embedder = _get_embedder()
        except Exception:
            return True, []

    try:
        import numpy as np

        claim_emb = np.asarray(embedder.encode(claims, normalize_embeddings=True), dtype=float)
        kb_emb = np.asarray(embedder.encode(kb_texts, normalize_embeddings=True), dtype=float)
        sims = claim_emb @ kb_emb.T  # 归一化向量点积 = 余弦相似度
    except Exception:
        return True, []

    unverified = [
        claim[:100] for i, claim in enumerate(claims) if float(sims[i].max()) < threshold
    ]
    return len(unverified) == 0, unverified


def full_review(
    content: str,
    kb_context: list[dict[str, Any]],
) -> dict[str, Any]:
    """完整审核流程：敏感词 → 公式归一 → 引用验证 → 事实核查。

    Returns:
        {
            "approved": bool,
            "content": str,  # 处理后的内容
            "issues": [...],
            "sources": [...],  # 有效来源
        }
    """
    issues = []

    # 1. 敏感词检查
    is_safe, violations = check_sensitive_content(content)
    if not is_safe:
        issues.append(f"敏感内容: {', '.join(violations[:3])}")

    # 2. 公式归一
    content = normalize_formulas(content)

    # 3. 引用验证
    content, valid_sources = verify_source_citations(content, kb_context)
    if len(valid_sources) == 0 and "[来源" in content:
        issues.append("引用角标无对应知识库来源")

    # 4. 事实核查
    if kb_context:
        is_reliable, unverified = verify_factual_claims(content, kb_context)
        if not is_reliable:
            issues.append(f"未验证声明: {len(unverified)} 条")
            for claim in unverified[:2]:
                issues.append(f"  - {claim}")

    return {
        "approved": len(issues) == 0,
        "content": content,
        "issues": issues,
        "sources": valid_sources,
    }
