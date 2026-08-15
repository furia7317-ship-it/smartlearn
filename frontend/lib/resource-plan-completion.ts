import type { ResourcePlanRecord } from "./resource-plan.ts";
import type { ChatMessage } from "./types.ts";

const STALE_PLAN_FAILURE_PREFIXES = [
  "学习路径规划暂未完成：",
  "资料生成中断：",
];

const LEGACY_RESOURCE_DUMP_MARKERS = [
  "完整内容已生成，可在资料中继续阅读。",
  "内容已审核通过，并将插入当天讲义的对应知识点位置。",
  "视频脚本已审核通过，MP4 正在后台自动渲染。",
];

const TERMINAL_SUMMARY_PREFIXES = [
  "全部 ",
  "学习路径已交付 ",
  "学习路径生成未全部完成：",
];

interface FailureCause {
  reason: string;
  retryable: boolean;
}

function taskFailureCause(task: ResourcePlanRecord["plan"]["tasks"][number]): FailureCause {
  const review = task.review;
  const code = String(review?.error_code ?? "").toLowerCase();
  const issues = (review?.issues ?? []).join(" ");
  const searchable = `${code} ${issues}`;
  if (/run_time_budget_exhausted|wall-clock|运行.*时限|秒时限/i.test(searchable)) {
    return { reason: "本次运行时限已到，审核未执行，因此未发布", retryable: true };
  }
  if (/model_call_budget_exhausted|model-call budget|模型调用次数.*(用尽|上限)/i.test(searchable)) {
    return { reason: "本次运行的模型调用次数已达上限，审核未执行，因此未发布", retryable: true };
  }
  if (/insufficient balance|error code:\s*402|余额|额度不足/i.test(searchable)) {
    return { reason: "模型服务账户额度不足", retryable: false };
  }
  if (/review_unavailable|审核基础设施不可用|审核服务.*不可用/i.test(searchable)) {
    return { reason: "审核服务暂时不可用，候选资料未获放行", retryable: true };
  }
  if (/generation_unavailable|生成服务.*不可用/i.test(searchable)) {
    return { reason: "资料生成服务暂时异常", retryable: true };
  }
  if (review?.failure_kind === "quality" || review?.gate_status === "rejected") {
    return { reason: "一次定向返工后仍未通过质量审核", retryable: true };
  }
  return {
    reason: "资料生成或审核异常",
    retryable: review?.retryable !== false,
  };
}

function taskLabels(tasks: ResourcePlanRecord["plan"]["tasks"]): string {
  const visible = tasks.slice(0, 2).map((task) => `《${task.title}》`).join("、");
  return tasks.length > 2 ? `${visible}等 ${tasks.length} 份资料` : visible;
}

function isLegacyResourceDump(message: ChatMessage): boolean {
  if (message.role !== "assistant" || message.kind !== "text") return false;
  if (message.content.length < 1000) return false;
  const markerCount = LEGACY_RESOURCE_DUMP_MARKERS.reduce((count, marker) => {
    return count + message.content.split(marker).length - 1;
  }, 0);
  return markerCount >= 3;
}

function isPlanResultText(message: ChatMessage): boolean {
  if (message.role !== "assistant" || message.kind !== "text") return false;
  return (
    TERMINAL_SUMMARY_PREFIXES.some((prefix) => message.content.startsWith(prefix))
    || message.content.length >= 1000
  );
}

export function resourcePlanCompletionMessage(record: ResourcePlanRecord): string | null {
  if (record.plan.status !== "completed") return null;

  const total = record.plan.tasks.length;
  if (total === 0) return null;

  const ready = record.plan.tasks.filter((task) => task.status === "ready").length;
  if (ready !== total) return null;
  return `全部 ${ready} 份资料生成完成，已更新到学习路径和资源中心。`;
}

export function resourcePlanTerminalMessage(record: ResourcePlanRecord): string | null {
  const completed = resourcePlanCompletionMessage(record);
  if (completed) return completed;
  if (record.plan.status !== "failed" || record.plan.tasks.length === 0) return null;

  const total = record.plan.tasks.length;
  const ready = record.plan.tasks.filter((task) => task.status === "ready").length;
  const failedTasks = record.plan.tasks.filter((task) => task.status === "failed");
  const grouped = new Map<string, { tasks: typeof failedTasks; retryable: boolean }>();
  for (const task of failedTasks) {
    const cause = taskFailureCause(task);
    const current = grouped.get(cause.reason) ?? { tasks: [], retryable: false };
    current.tasks.push(task);
    current.retryable ||= cause.retryable;
    grouped.set(cause.reason, current);
  }
  const failureDetails = [...grouped.entries()].map(([reason, group]) =>
    `${taskLabels(group.tasks)}因${reason}`,
  );
  const canRetry = [...grouped.values()].some((group) => group.retryable);
  const delivery = ready > 0
    ? "已成功内容已更新到学习路径和资源中心。"
    : "本次没有候选资料被发布。";
  return [
    `学习路径生成未全部完成：已完成 ${ready}/${total} 份。`,
    `${failureDetails.join("；")}。`,
    delivery,
    canRetry ? "可重新运行失败项。" : "",
  ].join("");
}

/** Remove a persisted failure placeholder after its server plan later completes. */
export function reconcilePlanFailureMessages(
  messages: ChatMessage[],
  records: ResourcePlanRecord[],
): ChatMessage[] {
  const terminalRecordList = records.filter((record) =>
    record.plan.status === "completed" || record.plan.status === "failed",
  );
  const terminalRecords = new Map(
    terminalRecordList
      .map((record) => [record.plan.plan_id, record] as const),
  );
  if (terminalRecords.size === 0) return messages;
  const latestTerminalRecord = terminalRecordList.at(-1);

  return messages.flatMap((message) => {
    const isFailurePlaceholder =
      message.role === "assistant" &&
      message.kind === "text" &&
      STALE_PLAN_FAILURE_PREFIXES.some((prefix) => message.content.startsWith(prefix));
    if (isFailurePlaceholder) {
      if (message.planId) {
        const terminal = terminalRecords.get(message.planId);
        const summary = terminal ? resourcePlanTerminalMessage(terminal) : null;
        return summary ? [{ ...message, content: summary, streaming: false }] : [message];
      }
      // Legacy placeholders did not persist planId and cannot be reconciled
      // precisely. Replace them with the latest terminal server summary.
      const summary = latestTerminalRecord
        ? resourcePlanTerminalMessage(latestTerminalRecord)
        : null;
      return summary ? [{ ...message, content: summary, streaming: false }] : [message];
    }

    // Older clients streamed every approved resource body into the plan's chat
    // placeholder. Once the server record is complete, collapse any plan-bound
    // text to the canonical result so archived conversations do not resurrect
    // multi-thousand-character material dumps.
    if (
      message.role === "assistant"
      && message.kind === "text"
      && message.planId
      && isPlanResultText(message)
    ) {
      const record = terminalRecords.get(message.planId);
      const summary = record ? resourcePlanTerminalMessage(record) : null;
      if (summary) {
        return [{ ...message, content: summary, streaming: false }];
      }
    }

    if (!message.planId && isLegacyResourceDump(message)) {
      const summary = latestTerminalRecord
        ? resourcePlanTerminalMessage(latestTerminalRecord)
        : null;
      return [{
        ...message,
        content: summary ?? "学习路径资料已更新到学习路径和资源中心。",
        streaming: false,
      }];
    }

    return [message];
  });
}

/** Reconcile inactive conversation snapshots as well as the open chat. */
export function reconcilePlanFailureConversations<
  T extends { messages: ChatMessage[] },
>(sessions: T[], records: ResourcePlanRecord[]): T[] {
  return sessions.map((session) => ({
    ...session,
    messages: reconcilePlanFailureMessages(session.messages, records),
  }));
}
