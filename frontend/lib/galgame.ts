import { API_BASE } from "./api.ts";
import { requireOk } from "./api-error.ts";
import type { ResourceData, ResourceItem } from "./types.ts";

export interface GalgameSourceRef {
  id: string;
  title: string;
  excerpt: string;
  locator: string;
}

export interface GalgameChoice {
  id: string;
  label: string;
  next_scene_id: string;
  feedback: string;
  correct: boolean | null;
}

export interface GalgameScene {
  id: string;
  title: string;
  speaker: string;
  expression: "neutral" | "smile" | "thinking" | "encourage";
  text: string;
  blackboard_title: string;
  blackboard_points: string[];
  source_ids: string[];
  choices: GalgameChoice[];
  duration_seconds: number;
}

export type GalgameCompanionPose =
  | "greeting"
  | "explaining"
  | "pointing"
  | "thinking"
  | "reading"
  | "encourage";

export const GALGAME_COMPANION_POSE_ASSETS: Record<GalgameCompanionPose, string> = {
  greeting: "/brand/theater/study-companion-greeting.png",
  explaining: "/brand/theater/study-companion-explaining.png",
  pointing: "/brand/theater/study-companion.png",
  thinking: "/brand/theater/study-companion-thinking.png",
  reading: "/brand/theater/study-companion-reading.png",
  encourage: "/brand/theater/study-companion-encourage.png",
};

export type GalgameBackdrop = "courtyard" | "lecture" | "library" | "study" | "corridor";

export const GALGAME_BACKDROP_ASSETS: Record<GalgameBackdrop, string> = {
  courtyard: "/brand/theater/scene-courtyard.png",
  lecture: "/brand/theater/scene-lecture.png",
  library: "/brand/theater/scene-library.png",
  study: "/brand/theater/scene-study.png",
  corridor: "/brand/theater/scene-corridor.png",
};

/** Choose a deterministic pose per scene so playback and replay show the same performance. */
export function selectGalgameCompanionPose(
  scene: GalgameScene,
  sceneIndex: number,
  sceneCount: number,
): GalgameCompanionPose {
  if (sceneIndex === 0) return "greeting";
  if (scene.expression === "encourage" || sceneIndex === sceneCount - 1) return "encourage";
  if (scene.expression === "thinking") return sceneIndex % 2 === 0 ? "reading" : "thinking";
  if (scene.source_ids.length > 1) return "reading";
  return sceneIndex % 2 === 0 ? "pointing" : "explaining";
}

/** Move the lesson through distinct academy spaces while keeping replay deterministic. */
export function selectGalgameBackdrop(
  scene: GalgameScene,
  sceneIndex: number,
  sceneCount: number,
): GalgameBackdrop {
  if (sceneIndex === 0) return "courtyard";
  if (scene.expression === "encourage" || sceneIndex === sceneCount - 1) return "corridor";
  if (scene.expression === "thinking") return "study";
  if (scene.source_ids.length > 1) return "library";
  const teachingCycle: GalgameBackdrop[] = ["study", "lecture", "library"];
  return teachingCycle[sceneIndex % teachingCycle.length];
}

export interface GalgameProject {
  id: string;
  title: string;
  source_title: string;
  source_kind: string;
  resource_id: string;
  companion_name: string;
  language: string;
  learning_objectives: string[];
  key_takeaways: string[];
  sources: GalgameSourceRef[];
  scenes: GalgameScene[];
  video_script: Record<string, unknown>;
  generation_provider: string;
  created_at: string;
}

export interface GalgameAttachment {
  id: string;
  name: string;
  kind: string;
  mime_type: string;
  text: string;
  pages?: number;
  truncated?: boolean;
}

export interface GalgameProgress {
  projectId: string;
  sceneId: string;
  visitedSceneIds: string[];
  choiceHistory: { sceneId: string; choiceId: string; label: string }[];
  videoTaskId?: string;
  updatedAt: string;
}

export interface GalgameVideoSnapshot {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | string;
  progress: number;
  error?: string | null;
  render_stage?: string;
  tts_provider?: string;
  active?: boolean;
  resumable?: boolean;
}

export interface GalgameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PROJECTS_PREFIX = "sl_galgame_projects_v1:";
const PROGRESS_PREFIX = "sl_galgame_progress_v1:";
const MAX_PROJECTS = 20;
const MAX_SOURCE_TEXT = 18_000;
const OMITTED_RESOURCE_FIELDS = new Set([
  "html",
  "css",
  "js",
  "runtime",
  "approval_token",
  "image_data",
]);

function requestSignal(timeoutMs: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

function storageKey(prefix: string, studentId: string): string {
  return `${prefix}${encodeURIComponent(studentId)}`;
}

function normalizedLine(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function labelForKey(key: string): string {
  const labels: Record<string, string> = {
    overview: "概览",
    explanation: "讲解",
    analogy: "类比",
    key_points: "关键要点",
    content: "正文",
    key_terms: "术语",
    references: "参考资料",
    discussion_questions: "讨论题",
    questions: "练习题",
    narration: "讲解词",
    scenes: "场景",
    slides: "课件",
    summary: "摘要",
    code: "代码",
    output: "运行结果",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

function collectResourceText(
  value: unknown,
  key: string,
  lines: string[],
  depth = 0,
): void {
  if (lines.join("\n").length >= MAX_SOURCE_TEXT || depth > 6) return;
  if (OMITTED_RESOURCE_FIELDS.has(key)) return;
  if (typeof value === "string") {
    const text = normalizedLine(value);
    if (!text) return;
    lines.push(`${labelForKey(key)}：${text}`);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(`${labelForKey(key)}：${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 60).forEach((item, index) => {
      const itemKey = typeof item === "object" && item !== null ? `${key} ${index + 1}` : key;
      collectResourceText(item, itemKey, lines, depth + 1);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
    collectResourceText(childValue, childKey, lines, depth + 1);
  });
}

/** Convert an approved SmartLearn resource into bounded, evidence-bearing source text. */
export function resourceDataToTheaterText(resource: ResourceItem): string {
  const data = (resource.data ?? {}) as ResourceData;
  const lines = [
    `资料标题：${resource.title}`,
    ...(resource.subtitle ? [`资料说明：${resource.subtitle}`] : []),
    ...(resource.meta.length > 0 ? [`资料标签：${resource.meta.join("、")}`] : []),
  ];
  collectResourceText(data, "content", lines);
  return lines.join("\n").slice(0, MAX_SOURCE_TEXT);
}

export async function uploadGalgameDocument(file: File): Promise<GalgameAttachment> {
  const body = new FormData();
  body.append("file", file);
  const response = await requireOk(await fetch(`${API_BASE}/api/galgame/attachments`, {
    method: "POST",
    credentials: "include",
    signal: requestSignal(90_000),
    body,
  }));
  return (await response.json()) as GalgameAttachment;
}

export async function generateGalgameProject(input: {
  studentId: string;
  sourceTitle: string;
  sourceText: string;
  sourceKind: string;
  resourceId?: string;
  resourceType?: string;
  companionName?: string;
  readingPace?: "slow" | "normal" | "fast";
}): Promise<GalgameProject> {
  const response = await requireOk(await fetch(`${API_BASE}/api/galgame/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: requestSignal(180_000),
    body: JSON.stringify({
      student_id: input.studentId,
      source_title: input.sourceTitle,
      source_text: input.sourceText.slice(0, MAX_SOURCE_TEXT),
      source_kind: input.sourceKind,
      resource_id: input.resourceId ?? "",
      resource_type: input.resourceType ?? "reading",
      companion_name: input.companionName ?? "知夏",
      language: "zh-CN",
      reading_pace: input.readingPace ?? "normal",
    }),
  }));
  return (await response.json()) as GalgameProject;
}

export async function synthesizeGalgameLine(text: string): Promise<{
  url: string;
  provider: string;
}> {
  const response = await requireOk(await fetch(`${API_BASE}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: requestSignal(45_000),
    body: JSON.stringify({ text: text.slice(0, 600) }),
  }));
  return {
    url: URL.createObjectURL(await response.blob()),
    provider: response.headers.get("X-Voice-Provider") ?? "tts",
  };
}

export async function createGalgameVideo(
  studentId: string,
  project: GalgameProject,
): Promise<{ task_id: string; status: string }> {
  const response = await requireOk(await fetch(`${API_BASE}/api/media/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: requestSignal(45_000),
    body: JSON.stringify({
      student_id: studentId,
      topic: project.title,
      script: project.video_script,
    }),
  }));
  return (await response.json()) as { task_id: string; status: string };
}

export async function getGalgameVideoSnapshot(taskId: string): Promise<GalgameVideoSnapshot> {
  const response = await requireOk(await fetch(
    `${API_BASE}/api/media/video/${encodeURIComponent(taskId)}/snapshot`,
    { cache: "no-store", credentials: "include", signal: requestSignal(20_000) },
  ));
  return (await response.json()) as GalgameVideoSnapshot;
}

export function galgameVideoUrl(taskId: string): string {
  return `${API_BASE}/api/media/video/${encodeURIComponent(taskId)}/file`;
}

function isProject(value: unknown): value is GalgameProject {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GalgameProject>;
  return typeof item.id === "string" && typeof item.title === "string" && Array.isArray(item.scenes);
}

export function readGalgameProjects(storage: GalgameStorage, studentId: string): GalgameProject[] {
  try {
    const raw = storage.getItem(storageKey(PROJECTS_PREFIX, studentId));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed)
      ? parsed.filter(isProject).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, MAX_PROJECTS)
      : [];
  } catch {
    return [];
  }
}

export function saveGalgameProject(
  storage: GalgameStorage,
  studentId: string,
  project: GalgameProject,
): GalgameProject[] {
  const projects = [project, ...readGalgameProjects(storage, studentId).filter((item) => item.id !== project.id)]
    .slice(0, MAX_PROJECTS);
  try {
    storage.setItem(storageKey(PROJECTS_PREFIX, studentId), JSON.stringify(projects));
  } catch {
    // A full localStorage must not make the generated lesson unusable.
  }
  return projects;
}

export function readGalgameProgress(
  storage: GalgameStorage,
  studentId: string,
  projectId: string,
): GalgameProgress | null {
  try {
    const key = `${storageKey(PROGRESS_PREFIX, studentId)}:${encodeURIComponent(projectId)}`;
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as Partial<GalgameProgress> | null;
    if (!parsed || parsed.projectId !== projectId || typeof parsed.sceneId !== "string") return null;
    return {
      projectId,
      sceneId: parsed.sceneId,
      visitedSceneIds: Array.isArray(parsed.visitedSceneIds) ? parsed.visitedSceneIds.map(String) : [],
      choiceHistory: Array.isArray(parsed.choiceHistory) ? parsed.choiceHistory : [],
      ...(parsed.videoTaskId ? { videoTaskId: String(parsed.videoTaskId) } : {}),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveGalgameProgress(
  storage: GalgameStorage,
  studentId: string,
  progress: GalgameProgress,
): void {
  try {
    const key = `${storageKey(PROGRESS_PREFIX, studentId)}:${encodeURIComponent(progress.projectId)}`;
    storage.setItem(key, JSON.stringify(progress));
  } catch {
    // Progress is a convenience; playback must continue when storage is unavailable.
  }
}
