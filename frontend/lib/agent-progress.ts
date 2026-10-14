import type { AgentMessageProgress, AgentTraceStep } from "./types";

const STEP_LABELS: Record<string, string> = {
  think: "理解问题", tutor: "智能教师", rag_retrieve: "检索知识库",
  read_profile: "读取学情", answer: "组织回答", tool: "调用工具",
  generate_learning_material: "生成学习资料", search_knowledge_base: "检索知识库",
  orchestrator: "协调生成任务", supervisor: "协调生成任务", planner: "规划资料",
  explainer: "生成讲义", quiz: "生成练习", code: "生成代码示例",
  reviewer: "审核资料", integrator: "整合资料", voice_tutor: "语音教师",
};

export function normalizeAgentProgress(
  data: Record<string, unknown>,
  receivedAt = Date.now(),
): AgentMessageProgress | undefined {
  const agent = typeof data.agent === "string" ? data.agent.trim() : "";
  const detail = typeof data.detail === "string" ? data.detail.trim().slice(0, 500) : "";
  if (!agent && !detail) return undefined;
  const status = String(data.status ?? "running");
  return {
    title: STEP_LABELS[agent] || "处理学习任务",
    detail,
    status: ["completed", "done", "success"].includes(status) ? "completed"
      : ["failed", "error"].includes(status) ? "failed"
        : status === "cancelled" ? "cancelled" : status === "blocked" ? "blocked"
          : ["pending", "queued"].includes(status) ? "pending" : "running",
    receivedAt,
  };
}

export function tracePublicSummary(step: AgentTraceStep): string | undefined {
  return step.event_type === "reasoning"
    ? step.reasoning_text || step.decision_summary || step.detail || step.observation_summary || step.input_summary
    : step.observation_summary || step.detail || step.decision_summary || step.input_summary;
}

export function visibleTraceEvents(trace: AgentTraceStep[]): AgentTraceStep[] {
  const publicEvents = trace.filter(step => step.visibility !== "verbose");
  const detailed = publicEvents.filter(step => !["run", "runtime", "orchestration"].includes(step.action_type));
  return detailed.length ? detailed : publicEvents;
}

export function currentAgentActivity(trace: AgentTraceStep[], progress?: AgentMessageProgress): string {
  const events = visibleTraceEvents(trace);
  const current = events.findLast(step => step.status === "running" || step.status === "pending") || events.at(-1);
  const latestTraceTime = Math.max(0, ...events.map(step => Date.parse(step.ended_at || step.started_at || "") || 0));
  if (progress && (!current || progress.receivedAt >= latestTraceTime)) return progress.detail || progress.title;
  return current?.title || (current ? tracePublicSummary(current) : undefined) || "请求已发送，等待服务响应";
}
