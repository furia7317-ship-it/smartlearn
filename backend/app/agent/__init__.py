"""学枢 Agent harness 层。

参考 Nous Research Hermes 的 agent harness（环境里 `environments/agent_loop.py` 的
`HermesAgentLoop`）实现：标准 OpenAI 工具调用循环（call → tool_calls → 执行 → 回灌
tool 结果 → 直到模型不再调用工具）。在此基础上内置「生成学习资料」等工具，供 /api/chat
的 agent 调用。

模块：
- `tool_parsers`：Hermes `<tool_call>` XML 兜底解析（模型未走原生 tool_calls 时）。
- `tools`：工具注册表（OpenAI function schema + 异步派发）。
- `harness`：多轮工具调用循环（流式）。
- `runner`：把循环接到 /api/chat，桥接为 SSE。
"""
