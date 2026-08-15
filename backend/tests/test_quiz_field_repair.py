import json
from types import SimpleNamespace

import pytest


def _question(index: int, explanation: str) -> dict:
    return {
        "id": f"q{index}",
        "type": "mcq",
        "stem": f"题目 {index}",
        "options": ["A. 正确", "B. 错误", "C. 其他", "D. 无关"],
        "answer": "A",
        "explanation": explanation,
    }


class FakeQuizLLM:
    def __init__(self, outputs: list[list[dict]]):
        self.outputs = outputs
        self.prompts: list[str] = []

    def invoke(self, messages):
        self.prompts.append(str(messages[-1]["content"]))
        output = self.outputs[min(len(self.prompts) - 1, len(self.outputs) - 1)]
        return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))


def _repair_state() -> dict:
    previous = [_question(index, f"原解析 {index}") for index in range(1, 6)]
    return {
        "topic": "数据结构综合测验",
        "quiz_config": {"choice": 5},
        "kb_context": [],
        "repair_instructions": [
            {
                "target_field": "questions[].explanation",
                "required_terms": ["排序算法原理", "查找算法过程"],
                "required_evidence": ["排序算法原理", "查找算法过程"],
                "action": "只修订缺失题目",
                "acceptance_check": "解析包含两个短语",
                "escalated": True,
            }
        ],
        "repair_context": {
            "previous_resource": {
                "title": "上一版综合测验",
                "content_excerpt": "上一版题目摘要",
                "questions": previous,
            }
        },
    }


def test_quiz_repairs_missing_required_terms_inside_one_generation(monkeypatch):
    from app.agents import quiz

    first = [_question(index, f"通用解析 {index}") for index in range(1, 6)]
    repaired = [*first[:3]]
    repaired.extend(
        [
            _question(4, "排序算法原理：通过比较和交换使序列逐步有序。"),
            _question(5, "查找算法过程：不断缩小候选范围直到命中目标。"),
        ]
    )
    llm = FakeQuizLLM([first, repaired])
    monkeypatch.setattr(quiz, "build_llm", lambda **_kwargs: llm)

    result = quiz.generate(_repair_state())

    assert len(llm.prompts) == 2
    assert "上一版完整 questions JSON" in llm.prompts[0]
    assert "缺失短语：排序算法原理、查找算法过程" in llm.prompts[1]
    assert result["questions"][:3] == first[:3]
    explanations = "\n".join(item["explanation"] for item in result["questions"])
    assert "排序算法原理" in explanations
    assert "查找算法过程" in explanations


def test_quiz_rejects_candidate_when_local_repairs_still_miss_terms(monkeypatch):
    from app.agents import quiz

    missing = [_question(index, f"仍未覆盖 {index}") for index in range(1, 6)]
    llm = FakeQuizLLM([missing, missing, missing])
    monkeypatch.setattr(quiz, "build_llm", lambda **_kwargs: llm)

    with pytest.raises(ValueError, match="field-level self-check failed"):
        quiz.generate(_repair_state())

    assert len(llm.prompts) == 3


def test_quiz_repairs_term_success_that_changes_the_required_question_count(monkeypatch):
    from app.agents import quiz

    first = [_question(index, f"通用解析 {index}") for index in range(1, 6)]
    six_questions = [*first[:4]]
    six_questions.extend(
        [
            _question(5, "排序算法原理：比较并交换。"),
            _question(6, "查找算法过程：逐步缩小范围。"),
        ]
    )
    corrected = [*first[:3]]
    corrected.extend(
        [
            _question(4, "排序算法原理：比较并交换。"),
            _question(5, "查找算法过程：逐步缩小范围。"),
        ]
    )
    llm = FakeQuizLLM([first, six_questions, corrected])
    monkeypatch.setattr(quiz, "build_llm", lambda **_kwargs: llm)

    result = quiz.generate(_repair_state())

    assert len(llm.prompts) == 3
    assert "题型数量不匹配" in llm.prompts[2]
    assert len(result["questions"]) == 5
