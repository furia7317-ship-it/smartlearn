import { finalizeResourcePlanExecution } from "./resource-plan-finalization.ts";
import {
  recoverResourcePlanRecord,
  type ResourcePlanRecoveryContext,
} from "./resource-plan-recovery.ts";
import type { ResourcePlanRecord } from "./resource-plan.ts";
import type { ResourceItem } from "./types.ts";

export async function runPlansSequentially<T>(
  records: readonly T[],
  execute: (record: T) => Promise<void>,
): Promise<void> {
  for (const record of records) {
    await execute(record);
  }
}

export function isPlanRunActive(
  controllers: ReadonlyMap<string, AbortController>,
  planId: string,
  controller: AbortController | undefined,
): boolean {
  return Boolean(
    controller && controllers.get(planId) === controller && !controller.signal.aborted,
  );
}

export function finalizeResourcePlanAfterStream(
  record: ResourcePlanRecord,
  previous: ResourceItem[],
  streamError: string,
  context: ResourcePlanRecoveryContext = {},
) {
  if (record.plan.status === "completed" || record.plan.status === "failed") {
    return finalizeResourcePlanExecution(record, previous, context);
  }
  if (streamError) throw new Error(streamError);
  return finalizeResourcePlanExecution(record, previous, context);
}

/** The persisted terminal record, not an optional final SSE event, is final. */
export function isCompletedResourcePlanRecord(record: ResourcePlanRecord): boolean {
  return record.plan.status === "completed";
}

const TERMINAL_PLAN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface ResourcePlanSnapshotAcceptanceOptions {
  allowFailedRetry?: boolean;
}

export function acceptResourcePlanSnapshot(
  current: ResourcePlanRecord | undefined,
  incoming: ResourcePlanRecord,
  options: ResourcePlanSnapshotAcceptanceOptions = {},
): ResourcePlanRecord | null {
  if (!current) return incoming;
  if (incoming.plan.version < current.plan.version) return null;
  if (
    TERMINAL_PLAN_STATUSES.has(current.plan.status) &&
    !TERMINAL_PLAN_STATUSES.has(incoming.plan.status)
  ) {
    const newFailedLifecycle =
      current.plan.status === "failed" &&
      incoming.plan.version > current.plan.version;
    const allowedFailedRetry =
      options.allowFailedRetry === true &&
      current.plan.status === "failed" &&
      incoming.plan.status === "running";
    if (!newFailedLifecycle && !allowedFailedRetry) return null;
  }
  return incoming;
}

export function recoverAcceptedResourcePlanSnapshot(
  current: ResourcePlanRecord | undefined,
  incoming: ResourcePlanRecord,
  previous: ResourceItem[],
  context: ResourcePlanRecoveryContext = {},
  acceptance: ResourcePlanSnapshotAcceptanceOptions = {},
) {
  const record = acceptResourcePlanSnapshot(current, incoming, acceptance);
  if (!record) return null;
  return {
    record,
    recovered: recoverResourcePlanRecord(record, previous, context),
  };
}

type FinalizedResourcePlan = ReturnType<typeof finalizeResourcePlanAfterStream>;

export async function completeActiveResourcePlanRun(options: {
  isActive: () => boolean;
  read: () => Promise<ResourcePlanRecord>;
  previous: () => ResourceItem[];
  recoveryContext?: (record: ResourcePlanRecord) => ResourcePlanRecoveryContext;
  streamError: string;
  recordSnapshot: (record: ResourcePlanRecord) => boolean | void;
  applyFinalized: (record: ResourcePlanRecord, finalized: FinalizedResourcePlan) => void;
  notify: (message: string) => void;
}): Promise<{ record: ResourcePlanRecord; finalized: FinalizedResourcePlan } | null> {
  if (!options.isActive()) return null;

  let record: ResourcePlanRecord;
  try {
    record = await options.read();
  } catch (error) {
    if (options.streamError) throw new Error(options.streamError);
    throw error;
  }

  if (!options.isActive()) return null;
  if (options.recordSnapshot(record) === false) return null;

  const finalized = finalizeResourcePlanAfterStream(
    record,
    options.previous(),
    options.streamError,
    options.recoveryContext?.(record),
  );
  options.applyFinalized(record, finalized);
  if (finalized.message) options.notify(finalized.message);
  return { record, finalized };
}
