export type TeacherWindowRect = { left: number; top: number; width: number; height: number };
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const TEACHER_WINDOW_DEFAULT = { width: 390, height: 560 };
const GAP = 12;

export function fitTeacherWindow(rect: TeacherWindowRect, viewport: { width: number; height: number }): TeacherWindowRect {
  const width = Math.min(Math.max(360, rect.width), Math.max(0, viewport.width - GAP * 2));
  const height = Math.min(Math.max(420, rect.height), Math.max(0, viewport.height - GAP * 2));
  return { width, height, left: Math.max(GAP, Math.min(rect.left, viewport.width - width - GAP)),
    top: Math.max(GAP, Math.min(rect.top, viewport.height - height - GAP)) };
}

export function resizeTeacherWindow(rect: TeacherWindowRect, edge: ResizeEdge, dx: number, dy: number,
  viewport: { width: number; height: number }): TeacherWindowRect {
  const start = fitTeacherWindow(rect, viewport);
  let { left, top, width, height } = start;
  const minWidth = Math.min(360, viewport.width - GAP * 2);
  const minHeight = Math.min(420, viewport.height - GAP * 2);
  if (edge.includes("e")) width = Math.max(minWidth, Math.min(width + dx, viewport.width - left - GAP));
  if (edge.includes("s")) height = Math.max(minHeight, Math.min(height + dy, viewport.height - top - GAP));
  if (edge.includes("w")) { left = Math.max(GAP, Math.min(left + dx, left + width - minWidth)); width = start.left + start.width - left; }
  if (edge.includes("n")) { top = Math.max(GAP, Math.min(top + dy, top + height - minHeight)); height = start.top + start.height - top; }
  return { left, top, width, height };
}
