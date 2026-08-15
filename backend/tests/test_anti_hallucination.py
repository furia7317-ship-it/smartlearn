"""防幻觉服务测试。"""

import pytest
from app.services.anti_hallucination import (
    check_sensitive_content,
    normalize_formulas,
    verify_source_citations,
    verify_factual_claims,
    full_review,
)


class TestCheckSensitiveContent:
    def test_safe_content(self):
        is_safe, violations = check_sensitive_content("快速排序是一种高效的排序算法")
        assert is_safe is True
        assert violations == []

    def test_sensitive_content(self):
        is_safe, violations = check_sensitive_content("这是一个涉及赌博的内容")
        assert is_safe is False
        assert len(violations) > 0

    def test_english_sensitive(self):
        is_safe, violations = check_sensitive_content("How to hack the system")
        assert is_safe is False


class TestNormalizeFormulas:
    def test_multi_space(self):
        result = normalize_formulas("a  =  b  +  c")
        assert "  " not in result

    def test_dollar_sign(self):
        result = normalize_formulas("$E=mc^2$")
        assert "$$" in result


class TestVerifySourceCitations:
    def test_valid_citations(self):
        content = "排序算法[来源1]包括冒泡排序[来源2]"
        kb = [
            {"content": "排序算法是..."},
            {"content": "冒泡排序是..."},
        ]
        cleaned, sources = verify_source_citations(content, kb)
        assert len(sources) == 2
        assert "[来源1]" in cleaned

    def test_invalid_citations(self):
        content = "排序算法[来源99]是重要的"
        kb = [{"content": "排序算法是..."}]
        cleaned, sources = verify_source_citations(content, kb)
        assert len(sources) == 0
        assert "[来源99]" not in cleaned

    def test_mixed_citations(self):
        content = "内容[来源1]和[来源99]"
        kb = [{"content": "知识库内容"}]
        cleaned, sources = verify_source_citations(content, kb)
        assert len(sources) == 1
        assert "[来源1]" in cleaned
        assert "[来源99]" not in cleaned


class _FakeEmbedder:
    """确定性假嵌入器：按主题给正交向量，单测 grounding 逻辑而不依赖真实模型。"""

    def encode(self, texts, normalize_embeddings=False):
        import numpy as np

        vecs = []
        for t in texts:
            if "快速排序" in t or "排序算法" in t:
                vecs.append([1.0, 0.0])
            elif "量子" in t:
                vecs.append([0.0, 1.0])
            else:
                vecs.append([0.7, 0.7])
        arr = np.asarray(vecs, dtype=float)
        if normalize_embeddings:
            arr = arr / np.linalg.norm(arr, axis=1, keepdims=True)
        return arr


class TestVerifyFactualClaims:
    def test_verified_claim(self):
        content = "快速排序是一种高效的排序算法"
        kb = [{"content": "快速排序是常用的排序算法，平均时间复杂度为O(n log n)"}]
        is_reliable, unverified = verify_factual_claims(content, kb, embedder=_FakeEmbedder())
        # 声明与知识库语义对齐 → 有依据
        assert is_reliable is True

    def test_unverified_claim(self):
        content = "量子计算是一种基于量子力学的计算方式"
        kb = [{"content": "快速排序是常用的排序算法"}]
        is_reliable, unverified = verify_factual_claims(content, kb, embedder=_FakeEmbedder())
        # 声明与知识库语义无关 → 标记缺乏依据
        assert is_reliable is False
        assert len(unverified) == 1


class TestFullReview:
    def test_clean_content(self):
        content = "冒泡排序[来源1]是一种简单的排序算法"
        kb = [{"content": "冒泡排序是最基础的排序算法"}]
        result = full_review(content, kb)
        assert result["approved"] is True
        assert len(result["sources"]) == 1

    def test_content_with_issues(self):
        content = "这是涉及赌博的内容[来源99]"
        kb = [{"content": "正常内容"}]
        result = full_review(content, kb)
        assert result["approved"] is False
        assert len(result["issues"]) > 0
