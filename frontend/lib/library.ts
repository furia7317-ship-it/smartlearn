/**
 * 统一资料库层 —— 生成资料 / 试题库 / 摸底记录的持久化。
 *
 * - live：调用后端 `/api/materials`、`/api/papers`、`/api/diagnostic`（跨设备持久）。
 * - offline：只读取/写入本地已有缓存，不合成示例内容。
 *
 * 所有函数都接受 `mode`（来自 useOrchestratorContext().mode）以决定走哪条路径。
 */

import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import { getStudentId } from "./student-identity";
import type { QuizQuestion, ResourceData, ResourceItem, ResourceType } from "./types";

type Mode = "checking" | "live" | "offline";

const LS_MATERIALS = "sl_materials_v1";
const LS_PAPERS = "sl_papers_v1";
const LS_ASSESSMENTS = "sl_assessments_v1";

/* ── localStorage 小工具 ── */

function lsRead<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function lsWrite<T>(key: string, items: T[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* 配额/隐私模式：静默 */
  }
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ── 资料（资源中心持久化） ── */

export interface MaterialInput {
  type: ResourceType;
  title: string;
  subtitle?: string;
  meta?: string[];
  sources?: number;
  knowledge_points?: string;
  data: ResourceData;
  source?: "form" | "studio" | "video" | "web";
  approval_token?: string | null;
}

/** 列表项：等价于 ResourceItem（status 固定 ready），本地缓存项含 data。 */
export interface StoredMaterial extends ResourceItem {
  knowledge_points: string;
  created_at: string;
  source: string;
  external_video?: ExternalVideoSummary | null;
  exam_id?: string | null;
  review_approved: true;
}

export interface ExternalVideoSummary {
  bvid: string;
  title: string;
  url: string;
  embed_url: string;
  author: string;
  duration: string;
  summary: string;
}

export interface ReflectionInput {
  taskKey: string;
  day: string;
  title: string;
  knowledgePoints?: string;
  userContent: string;
  aiSupplement?: string;
  contextSummary?: string;
}

function summaryToItem(s: Record<string, unknown>): StoredMaterial {
  return {
    id: String(s.id),
    type: s.type as ResourceType,
    title: String(s.title ?? ""),
    subtitle: String(s.subtitle ?? ""),
    meta: Array.isArray(s.meta) ? (s.meta as string[]) : [],
    status: "ready",
    version: 1,
    sources: typeof s.sources === "number" ? s.sources : 0,
    data: (s.data as ResourceData) ?? undefined,
    knowledge_points: String(s.knowledge_points ?? ""),
    created_at: String(s.created_at ?? ""),
    source: String(s.source ?? ""),
    external_video:
      s.external_video && typeof s.external_video === "object"
        ? (s.external_video as ExternalVideoSummary)
        : null,
    exam_id: (s.exam_id as string | null) ?? null,
    review_approved: true,
  };
}

export async function listMaterials(mode: Mode): Promise<StoredMaterial[]> {
  if (mode === "live") {
    const res = await requireOk(
      await fetch(`${API_BASE}/api/materials/${getStudentId()}`, {
        cache: "no-store",
        credentials: "include",
      })
    );
    const json = (await res.json()) as Record<string, unknown>[];
    return json
      .filter((item) => item.review_approved === true)
      .map(summaryToItem);
  }
  return lsRead<StoredMaterial>(LS_MATERIALS).filter(
    (item) => item.review_approved === true,
  );
}

/** 取材料完整内容（live 摘要列表不含 data，点开时按需拉取）。 */
export async function getMaterialData(mode: Mode, id: string): Promise<ResourceData | undefined> {
  if (mode === "live") {
    try {
      const studentId = encodeURIComponent(getStudentId());
      const res = await fetch(
        `${API_BASE}/api/materials/detail/${id}?student_id=${studentId}`,
        { cache: "no-store", credentials: "include" },
      );
      if (!res.ok) return undefined;
      const json = (await res.json()) as { data?: ResourceData };
      return json.data;
    } catch {
      return undefined;
    }
  }
  const found = lsRead<StoredMaterial>(LS_MATERIALS).find((m) => m.id === id);
  return found?.data;
}

export interface NoteInput {
  resourceId: string;
  resourceTitle: string;
  title: string;
  selectedText: string;
  noteContent: string;
  knowledgePoints?: string;
}

export interface MaterialMediaLinkResult {
  material_id: string;
  media_task_id: string;
  media_status: string;
  media_workflow_version: string;
  media_file_url?: string | null;
}

/** Persist a server-owned render task on the approved video material. */
export async function linkMaterialVideo(
  mode: Mode,
  materialId: string,
  taskId: string,
  resourceTaskId = "",
): Promise<MaterialMediaLinkResult | null> {
  if (mode !== "live") return null;
  const response = await requireOk(
    await fetch(`${API_BASE}/api/materials/detail/${encodeURIComponent(materialId)}/media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        student_id: getStudentId(),
        task_id: taskId,
        resource_task_id: resourceTaskId,
      }),
    }),
  );
  return (await response.json()) as MaterialMediaLinkResult;
}

export async function saveMaterial(mode: Mode, input: MaterialInput): Promise<void> {
  if (mode === "live") {
    if (!input.approval_token) {
      throw new Error("资料尚未通过服务端审核，无法保存；请重新生成后再试。");
    }
    await requireOk(
      await fetch(`${API_BASE}/api/materials/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          student_id: getStudentId(),
          type: input.type,
          title: input.title,
          subtitle: input.subtitle ?? "",
          meta: input.meta ?? [],
          sources: input.sources ?? 0,
          knowledge_points: input.knowledge_points ?? "",
          data: input.data ?? {},
          source: input.source ?? "form",
          approval_token: input.approval_token,
        }),
      })
    );
    return;
  }

  throw new Error("离线模式无法验证服务端审核凭证，资料没有保存。请恢复后端后重试。");
}

export async function saveReflection(
  mode: Mode,
  input: ReflectionInput,
): Promise<StoredMaterial> {
  if (mode !== "live") {
    throw new Error("后端未连接，复盘暂时无法安全保存。请恢复服务后重试。");
  }
  const response = await requireOk(
    await fetch(`${API_BASE}/api/materials/reflections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        student_id: getStudentId(),
        task_key: input.taskKey,
        day: input.day,
        title: input.title,
        knowledge_points: input.knowledgePoints ?? "",
        user_content: input.userContent,
        ai_supplement: input.aiSupplement ?? "",
        context_summary: input.contextSummary ?? "",
      }),
    }),
  );
  return summaryToItem((await response.json()) as Record<string, unknown>);
}

export async function saveNote(mode: Mode, input: NoteInput): Promise<StoredMaterial> {
  if (mode !== "live") {
    throw new Error("后端未连接，笔记暂时无法保存到资源中心。请恢复服务后重试。");
  }
  const response = await requireOk(
    await fetch(`${API_BASE}/api/materials/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        student_id: getStudentId(),
        resource_id: input.resourceId,
        resource_title: input.resourceTitle,
        title: input.title,
        selected_text: input.selectedText,
        note_content: input.noteContent,
        knowledge_points: input.knowledgePoints ?? "",
      }),
    }),
  );
  return summaryToItem((await response.json()) as Record<string, unknown>);
}

export async function deleteMaterial(mode: Mode, id: string): Promise<void> {
  if (mode === "live") {
    await requireOk(
      await fetch(
        `${API_BASE}/api/materials/detail/${id}?student_id=${encodeURIComponent(getStudentId())}`,
        { method: "DELETE", credentials: "include" },
      )
    );
    return;
  }
  lsWrite(LS_MATERIALS, lsRead<StoredMaterial>(LS_MATERIALS).filter((m) => m.id !== id));
}

export async function clearMaterials(mode: Mode): Promise<void> {
  if (mode === "live") {
    await requireOk(
      await fetch(`${API_BASE}/api/materials/${getStudentId()}`, {
        method: "DELETE",
        credentials: "include",
      })
    );
    return;
  }
  lsWrite<StoredMaterial>(LS_MATERIALS, []);
}

/* ── 试题库 ── */

export interface PaperSummary {
  id: string;
  exam_id: string;
  title: string;
  topic: string;
  category: string;
  tags: string[];
  status: string;
  overall_score: number | null;
  question_count: number;
  created_at: string;
}

export interface PaperDetail extends PaperSummary {
  questions: QuizQuestion[];
  answers?: Record<string, string>;
}

interface StoredPaper extends PaperSummary {
  questions: QuizQuestion[];
}

export interface PaperInput {
  title: string;
  topic: string;
  category?: string;
  tags?: string[];
  questions: QuizQuestion[];
}

export async function listPapers(mode: Mode): Promise<PaperSummary[]> {
  if (mode === "live") {
    try {
      const res = await fetch(`${API_BASE}/api/papers/${getStudentId()}`, { cache: "no-store" });
      if (!res.ok) return [];
      return (await res.json()) as PaperSummary[];
    } catch {
      return [];
    }
  }
  return lsRead<StoredPaper>(LS_PAPERS).map((paper) => ({
    id: paper.id,
    exam_id: paper.exam_id,
    title: paper.title,
    topic: paper.topic,
    category: paper.category,
    tags: paper.tags,
    status: paper.status,
    overall_score: paper.overall_score,
    question_count: paper.question_count,
    created_at: paper.created_at,
  }));
}

export async function getPaperDetail(mode: Mode, id: string): Promise<PaperDetail | undefined> {
  if (mode === "live") {
    try {
      const res = await fetch(`${API_BASE}/api/papers/detail/${id}`, { cache: "no-store" });
      if (!res.ok) return undefined;
      return (await res.json()) as PaperDetail;
    } catch {
      return undefined;
    }
  }
  return lsRead<StoredPaper>(LS_PAPERS).find((p) => p.id === id || p.exam_id === id);
}

export async function savePaper(mode: Mode, input: PaperInput): Promise<void> {
  if (mode === "live") {
    // live 下试卷由 /api/materials/save（quiz）自动建卷，无需单独保存
    return;
  }
  const paper: StoredPaper = {
    id: uid("paper"),
    exam_id: uid("exam"),
    title: input.title,
    topic: input.topic,
    category: input.category ?? "AI 生成",
    tags: input.tags ?? ["生成"],
    status: "created",
    overall_score: null,
    question_count: input.questions.length,
    created_at: new Date().toISOString(),
    questions: input.questions,
  };
  lsWrite(LS_PAPERS, [paper, ...lsRead<StoredPaper>(LS_PAPERS)]);
}

export async function deletePaper(mode: Mode, id: string): Promise<void> {
  if (mode === "live") {
    await requireOk(
      await fetch(`${API_BASE}/api/papers/${id}`, { method: "DELETE" })
    );
    return;
  }
  lsWrite(LS_PAPERS, lsRead<StoredPaper>(LS_PAPERS).filter((p) => p.id !== id));
}

/* ── 摸底记录 ── */

export interface DiagnosticAnalysis {
  summary?: string;
  narrative?: string;
  strengths?: string[];
  gaps?: string[];
  recommended_focus?: string[];
  knowledge_seed?: Record<string, number>;
  suggested_modules?: string[];
}

export interface AssessmentRecord {
  id: string;
  subject: string;
  self_level: string;
  analysis: DiagnosticAnalysis;
  created_at: string;
}

export async function listAssessments(mode: Mode): Promise<AssessmentRecord[]> {
  if (mode === "live") {
    try {
      const res = await fetch(`${API_BASE}/api/diagnostic/${getStudentId()}`, { cache: "no-store" });
      if (!res.ok) return [];
      return (await res.json()) as AssessmentRecord[];
    } catch {
      return [];
    }
  }
  return lsRead<AssessmentRecord>(LS_ASSESSMENTS);
}

/** offline 下保存摸底记录（live 由后端 /api/diagnostic 持久化）。 */
export function saveAssessmentLocal(rec: AssessmentRecord): void {
  lsWrite(LS_ASSESSMENTS, [rec, ...lsRead<AssessmentRecord>(LS_ASSESSMENTS)]);
}

/* ── 学习目标 ── */

const LS_GOALS = "sl_goals_v1";

export interface GoalRecord {
  id: string | number;
  title: string;
  description: string;
  start_date: string | null;
  target_date: string | null;
  topic: string;
  status: string;
  progress: number;
  horizon?: "long" | "mid" | "short";
}

export interface GoalInput {
  title: string;
  description: string;
  start_date?: string | null;
  target_date?: string | null;
  horizon?: "long" | "mid" | "short";
}

export async function listGoals(mode: Mode): Promise<GoalRecord[]> {
  if (mode === "live") {
    try {
      const res = await fetch(`${API_BASE}/api/goals/${getStudentId()}`, { cache: "no-store" });
      if (!res.ok) return [];
      return (await res.json()) as GoalRecord[];
    } catch {
      return [];
    }
  }
  return lsRead<GoalRecord>(LS_GOALS);
}

export async function saveGoal(mode: Mode, input: GoalInput): Promise<void> {
  if (mode === "live") {
    await requireOk(
      await fetch(`${API_BASE}/api/goals/${getStudentId()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          description: input.description,
          start_date: input.start_date ?? null,
          target_date: input.target_date ?? null,
          topic: input.title,
          target_mastery: 0.8,
          generate_path: false,
          source: "manual",
          horizon: input.horizon ?? "short",
        }),
      })
    );
    return;
  }
  const goal: GoalRecord = {
    id: uid("goal"),
    title: input.title,
    description: input.description,
    start_date: input.start_date ?? null,
    target_date: input.target_date ?? null,
    topic: input.title,
    status: "active",
    progress: 0,
    horizon: input.horizon ?? "short",
  };
  lsWrite(LS_GOALS, [goal, ...lsRead<GoalRecord>(LS_GOALS)]);
}

export async function deleteGoal(mode: Mode, id: string | number): Promise<void> {
  if (mode === "live") {
    await requireOk(
      await fetch(`${API_BASE}/api/goals/${id}`, { method: "DELETE" })
    );
    return;
  }
  lsWrite(LS_GOALS, lsRead<GoalRecord>(LS_GOALS).filter((g) => g.id !== id));
}

/** 把一条摸底分析压成可注入生成器的简短上下文。 */
export function assessmentToContext(rec: AssessmentRecord): string {
  const a = rec.analysis || {};
  const parts = [`科目「${rec.subject}」自评${rec.self_level}`];
  if (a.summary) parts.push(a.summary);
  if (a.gaps?.length) parts.push(`薄弱：${a.gaps.slice(0, 4).join("、")}`);
  if (a.recommended_focus?.length) parts.push(`重点：${a.recommended_focus.slice(0, 4).join("、")}`);
  return parts.join("；");
}
