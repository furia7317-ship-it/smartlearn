import { resourcePlanTerminalMessage } from "./resource-plan-completion.ts";
import { planResourceId } from "./resource-plan-identity.ts";
import {
  recoverResourcePlanRecord,
  type ResourcePlanRecoveryContext,
} from "./resource-plan-recovery.ts";
import type { ResourcePlanRecord } from "./resource-plan.ts";
import type { ResourceItem } from "./types.ts";

export function finalizeResourcePlanExecution(
  record: ResourcePlanRecord,
  previous: ResourceItem[],
  context: ResourcePlanRecoveryContext = {},
) {
  if (record.plan.status !== "completed" && record.plan.status !== "failed") {
    throw new Error(`计划执行流已结束，但服务端计划仍处于 ${record.plan.status} 状态`);
  }

  const tasks = record.plan.tasks;
  if (tasks.length === 0) throw new Error("终态计划至少包含一个资料任务");
  if (tasks.some((task) => task.status !== "ready" && task.status !== "failed")) {
    throw new Error(`${record.plan.status} 计划任务状态只能是 ready 或 failed`);
  }
  if (record.plan.status === "completed" && tasks.some((task) => task.status !== "ready")) {
    throw new Error("completed 完成计划的所有任务必须为 ready");
  }
  if (record.plan.status === "failed" && !tasks.some((task) => task.status === "failed")) {
    throw new Error("failed 失败计划至少包含一个 failed 任务");
  }

  const recovered = recoverResourcePlanRecord(record, previous, context);
  const recoveredById = new Map(recovered.resources.map((resource) => [resource.id, resource]));
  for (const task of tasks) {
    const recoveredStatus = recoveredById.get(
      planResourceId(record.plan.plan_id, task.task_id),
    )?.status;
    if (recoveredStatus !== task.status) {
      throw new Error(
        `任务 ${task.task_id} 的审核恢复状态 ${recoveredStatus ?? "missing"} 与计划状态 ${task.status} 不一致`,
      );
    }
  }
  return {
    ...recovered,
    // Both success and failure are terminal outcomes.  Returning null for a
    // failed plan left the main chat placeholder blank while only the side
    // trace showed the failure.
    message: resourcePlanTerminalMessage(record),
  };
}
