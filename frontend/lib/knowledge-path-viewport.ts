export const KNOWLEDGE_PATH_MIN_ZOOM = 0.6;
export const KNOWLEDGE_PATH_MAX_ZOOM = 1.8;

export interface KnowledgePathZoomAnchor {
  panX: number;
  panY: number;
  anchorX: number;
  anchorY: number;
  currentZoom: number;
  nextZoom: number;
}

export function clampKnowledgePathZoom(value: number): number {
  return Math.min(
    KNOWLEDGE_PATH_MAX_ZOOM,
    Math.max(KNOWLEDGE_PATH_MIN_ZOOM, Number(value.toFixed(3))),
  );
}

export function knowledgePathPanForZoomAnchor({
  panX,
  panY,
  anchorX,
  anchorY,
  currentZoom,
  nextZoom,
}: KnowledgePathZoomAnchor): { x: number; y: number } {
  const safeCurrentZoom = Math.max(currentZoom, Number.EPSILON);
  const worldX = (anchorX - panX) / safeCurrentZoom;
  const worldY = (anchorY - panY) / safeCurrentZoom;

  return {
    x: anchorX - worldX * nextZoom,
    y: anchorY - worldY * nextZoom,
  };
}
