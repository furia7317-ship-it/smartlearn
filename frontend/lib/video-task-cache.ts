const VIDEO_TASK_PREFIX = "sl_video_task_v1:";
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const VIDEO_WORKFLOW_VERSION = "remotion-whiteboard-mimo-v5";

export interface VideoTaskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageKey(resourceKey: string): string {
  return `${VIDEO_TASK_PREFIX}${encodeURIComponent(resourceKey)}`;
}

export function rememberVideoTaskId(
  storage: VideoTaskStorage,
  resourceKey: string,
  taskId: string,
): string {
  const normalized = taskId.trim();
  if (!TASK_ID_PATTERN.test(normalized)) return "";
  try {
    storage.setItem(storageKey(resourceKey), normalized);
  } catch {
    // The embedded id remains usable when storage is unavailable.
  }
  return normalized;
}

export function readVideoTaskId(
  storage: VideoTaskStorage,
  resourceKey: string,
  embeddedTaskId = "",
): string {
  const embedded = rememberVideoTaskId(storage, resourceKey, embeddedTaskId);
  if (embedded) return embedded;
  let cached = "";
  try {
    cached = storage.getItem(storageKey(resourceKey))?.trim() ?? "";
  } catch {
    return "";
  }
  if (TASK_ID_PATTERN.test(cached)) return cached;
  if (cached) {
    try {
      storage.removeItem(storageKey(resourceKey));
    } catch {
      // Ignore disabled storage.
    }
  }
  return "";
}

export function forgetVideoTaskId(storage: VideoTaskStorage, resourceKey: string): void {
  try {
    storage.removeItem(storageKey(resourceKey));
  } catch {
    // Ignore disabled storage.
  }
}
