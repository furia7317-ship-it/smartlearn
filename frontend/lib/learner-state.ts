import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import { getStudentId } from "./student-identity";

export interface LearnerWorkspaceSnapshot<T extends object = Record<string, unknown>> {
  version: number;
  clientUpdatedAt: number;
  state: T;
}

interface WorkspaceResponse {
  version?: unknown;
  client_updated_at?: unknown;
  state?: unknown;
}

const WORKSPACE_READ_CACHE_MS = 2_000;
let workspaceReadInFlight: {
  studentId: string;
  promise: Promise<LearnerWorkspaceSnapshot<Record<string, unknown>>>;
} | null = null;
let workspaceReadCache: {
  studentId: string;
  snapshot: LearnerWorkspaceSnapshot<Record<string, unknown>>;
  readAt: number;
} | null = null;

function normalize<T extends object>(payload: WorkspaceResponse): LearnerWorkspaceSnapshot<T> {
  return {
    version: typeof payload.version === "number" ? payload.version : 0,
    clientUpdatedAt: typeof payload.client_updated_at === "number" ? payload.client_updated_at : 0,
    state: payload.state && typeof payload.state === "object" && !Array.isArray(payload.state)
      ? payload.state as T
      : {} as T,
  };
}

export async function getLearnerWorkspaceState<T extends object>(): Promise<LearnerWorkspaceSnapshot<T>> {
  const studentId = getStudentId();
  if (
    workspaceReadCache?.studentId === studentId &&
    Date.now() - workspaceReadCache.readAt <= WORKSPACE_READ_CACHE_MS
  ) {
    return workspaceReadCache.snapshot as LearnerWorkspaceSnapshot<T>;
  }
  if (workspaceReadInFlight?.studentId === studentId) {
    return workspaceReadInFlight.promise as Promise<LearnerWorkspaceSnapshot<T>>;
  }

  const promise = (async () => {
    const response = await requireOk(await fetch(
      `${API_BASE}/api/memory/workspace/${encodeURIComponent(studentId)}`,
      { cache: "no-store" },
    ));
    const snapshot = normalize<Record<string, unknown>>(
      await response.json() as WorkspaceResponse,
    );
    workspaceReadCache = { studentId, snapshot, readAt: Date.now() };
    return snapshot;
  })();
  workspaceReadInFlight = { studentId, promise };
  try {
    return await promise as LearnerWorkspaceSnapshot<T>;
  } finally {
    if (workspaceReadInFlight?.promise === promise) workspaceReadInFlight = null;
  }
}

export async function saveLearnerWorkspaceState<T extends object>(
  state: T,
  clientUpdatedAt: number,
  expectedVersion: number,
): Promise<LearnerWorkspaceSnapshot<T>> {
  workspaceReadCache = null;
  const response = await requireOk(await fetch(`${API_BASE}/api/memory/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: getStudentId(),
      state,
      client_updated_at: clientUpdatedAt,
      expected_version: expectedVersion,
    }),
  }));
  return normalize<T>(await response.json() as WorkspaceResponse);
}

export async function deleteLearnerWorkspaceState(): Promise<void> {
  workspaceReadCache = null;
  await requireOk(await fetch(
    `${API_BASE}/api/memory/workspace/${encodeURIComponent(getStudentId())}`,
    { method: "DELETE" },
  ));
}
