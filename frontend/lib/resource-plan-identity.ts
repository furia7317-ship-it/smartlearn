export function planResourceId(planId: string, taskId: string): string {
  const prefix = `${planId}:`;
  return taskId.startsWith(prefix) ? taskId : `${prefix}${taskId}`;
}
