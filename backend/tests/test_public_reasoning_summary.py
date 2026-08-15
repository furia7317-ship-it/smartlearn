"""Public reasoning summary generation tests."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any


class FakeLLM:
    def __init__(self, content: str = "我基于章节目标和资料大纲，选择先讲概念再安排练习。") -> None:
        self.content = content
        self.messages: list[dict[str, str]] = []

    def invoke(self, messages: list[dict[str, str]]) -> SimpleNamespace:
        self.messages = messages
        return SimpleNamespace(content=self.content)


def test_public_reasoning_summary_is_generated_by_model_from_real_inputs() -> None:
    from app.agents.public_reasoning import generate_public_reasoning_summary

    llm = FakeLLM()
    summary = generate_public_reasoning_summary(
        state={
            "topic": "数据结构",
            "requirements": "7 天考前冲刺",
            "kb_context": [{"content": "栈、队列、树和图是核心结构。"}],
        },
        agent="explainer",
        material_outline={
            "objective": "建立数据结构基础框架",
            "sections": [{"title": "先给结论", "goal": "说明核心概念"}],
        },
        result={
            "title": "数据结构基础定位",
            "overview": "数据结构是组织数据和设计算法的基础。",
            "key_points": ["线性结构", "树结构"],
        },
        llm=llm,
    )

    assert summary == "我基于章节目标和资料大纲，选择先讲概念再安排练习。"
    prompt = "\n".join(message["content"] for message in llm.messages)
    assert "不要输出原始思考链" in prompt
    assert "资料大纲" in prompt
    assert "最终资源内容" in prompt
    assert "栈、队列、树和图是核心结构" in prompt


def test_public_reasoning_summary_strips_empty_model_output() -> None:
    from app.agents.public_reasoning import generate_public_reasoning_summary

    summary = generate_public_reasoning_summary(
        state={"topic": "数据结构", "kb_context": []},
        agent="quiz",
        material_outline={"sections": []},
        result={"title": "测验", "questions": []},
        llm=FakeLLM(" \n "),
    )

    assert summary == ""
