/** Convert viewport pointer movement to graph percentages, including scaled canvases. */
export function moveGraphNode(
  start: { x: number; y: number; width: number; height: number; radiusX: number; radiusY: number },
  dx: number,
  dy: number,
): { x: number; y: number } {
  if (start.width <= 0 || start.height <= 0) return { x: start.x, y: start.y };
  const paddingX = Math.min(50, start.radiusX / start.width * 100);
  const paddingY = Math.min(50, start.radiusY / start.height * 100);
  return {
    x: Math.max(paddingX, Math.min(100 - paddingX, start.x + dx / start.width * 100)),
    y: Math.max(paddingY, Math.min(100 - paddingY, start.y + dy / start.height * 100)),
  };
}
