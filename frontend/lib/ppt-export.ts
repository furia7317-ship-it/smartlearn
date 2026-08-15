import { getStudentId } from "./student-identity.ts";
import { API_BASE } from "./api.ts";
import type { ResourceItem, Slide } from "./types";

export const PPT_API_BASE = API_BASE;

export interface PptExportPayload {
  topic: string;
  student_id: string;
  slides: Slide[];
  template?: string;
}

export interface PptTemplateOption {
  key: string;
  name: string;
  desc?: string;
  kind?: string;
}

/** 拉取可选 PPT 模板（内置主题 + 文件母版）。失败返回空数组（UI 退化为默认）。 */
export async function listPptTemplates(): Promise<PptTemplateOption[]> {
  try {
    const res = await fetch(`${PPT_API_BASE}/api/media/ppt/templates`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { templates?: PptTemplateOption[] };
    return json.templates ?? [];
  } catch {
    return [];
  }
}

export interface PptProgress {
  id?: string;
  status?: string;
  progress?: number;
  error?: string | null;
}

export function buildPptExportPayload(
  item: ResourceItem,
  studentId = getStudentId(),
  template?: string
): PptExportPayload {
  const slides = Array.isArray(item.data?.slides) ? item.data.slides : [];
  // 模板优先级：显式选择 > 生成器在大纲里挑的 template
  const chosen = template || (item.data as { template?: string } | undefined)?.template;
  return {
    topic: item.title || item.data?.title || "课件",
    student_id: studentId,
    slides: slides.map((slide, index) => ({
      slide_num: slide.slide_num ?? index + 1,
      title: slide.title,
      content: Array.isArray(slide.content) ? slide.content : [],
      layout: slide.layout ?? "content",
    })),
    ...(chosen ? { template: chosen } : {}),
  };
}

export function pptDownloadUrl(taskId: string): string {
  return `${PPT_API_BASE}/api/media/ppt/${encodeURIComponent(taskId)}/file`;
}

async function waitForPptTask(
  taskId: string,
  onProgress?: (progress: PptProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${PPT_API_BASE}/api/media/ppt/${encodeURIComponent(taskId)}`, {
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`PPT 进度接口异常 HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;

      const data = JSON.parse(dataLines.join("\n")) as PptProgress;
      onProgress?.(data);

      if (event === "done" || data.status === "completed") {
        if (data.status === "failed") {
          throw new Error(data.error || "PPT 生成失败");
        }
        if (data.status === "completed") return;
      }
      if (data.status === "failed") {
        throw new Error(data.error || "PPT 生成失败");
      }
    }
  }
}

/* ── 讯飞智文 真·PPT 生成（成品带版式/配图，pptUrl 托管在智文 CDN） ── */

export interface PptTemplate {
  key: string;
  name?: string;
  desc?: string;
  kind?: string;
  thumbnail?: string;
  style?: string;
  color?: string;
  industry?: string;
  pageCount?: number;
  /** 内置主题的配色（用于无缩略图时画一个可视化色卡）。 */
  bg?: string;
  titleColor?: string;
  accent?: string;
}

export interface PptTemplatesResult {
  provider: "zhiwen" | "builtin";
  templates: PptTemplate[];
  total?: number;
}

/**
 * 内置主题（与后端 app/services/media/ppt.py 的 THEMES 同步）。
 * 后端不可达或返回空时用它兜底，保证模板墙仍有内置主题可选。
 */
export const BUILTIN_TEMPLATES: PptTemplate[] = [
  { key: "academic", name: "学术简约", desc: "白底深蓝标题，正式清爽，适合课堂讲义", kind: "builtin", bg: "#FFFFFF", titleColor: "#1F3864", accent: "#2E74B5" },
  { key: "tech", name: "科技蓝", desc: "深蓝底亮青强调，科技感，适合前沿/工程主题", kind: "builtin", bg: "#0B1F3A", titleColor: "#FFFFFF", accent: "#21D4FD" },
  { key: "warm", name: "暖阳", desc: "米色暖调，亲和柔和，适合入门/科普", kind: "builtin", bg: "#FFF8F0", titleColor: "#B5651D", accent: "#E8A04C" },
  { key: "chalk", name: "板书", desc: "墨绿黑板风，粉笔字，适合公式推导/演算", kind: "builtin", bg: "#1E3A2F", titleColor: "#F5F5DC", accent: "#F2C14E" },
  { key: "business", name: "商务红", desc: "浅灰底酒红强调，稳重正式，适合答辩/汇报", kind: "builtin", bg: "#F5F5F5", titleColor: "#8B1E2D", accent: "#C0392B" },
  { key: "fresh", name: "清新绿", desc: "浅绿底墨绿标题，轻松明快，适合通识/兴趣课", kind: "builtin", bg: "#F2FAF5", titleColor: "#1E5631", accent: "#3CB371" },
];

/** 模板列表（含 provider）：zhiwen=图片模板墙；builtin=内置主题回落。 */
export async function listPptTemplatesFull(
  opts: { style?: string; page?: number; size?: number } = {}
): Promise<PptTemplatesResult> {
  const params = new URLSearchParams();
  if (opts.style) params.set("style", opts.style);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.size) params.set("size", String(opts.size));
  try {
    const res = await fetch(`${PPT_API_BASE}/api/media/ppt/templates?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return { provider: "builtin", templates: BUILTIN_TEMPLATES };
    const json = (await res.json()) as PptTemplatesResult;
    const provider = json.provider ?? "builtin";
    const templates = json.templates ?? [];
    // 后端回落到内置但没返回任何主题 → 用前端内置清单兜底，避免模板墙空白
    if (provider === "builtin" && templates.length === 0) {
      return { provider: "builtin", templates: BUILTIN_TEMPLATES };
    }
    return { provider, templates, total: json.total };
  } catch {
    // 后端不可达：用内置主题，保证模板墙可用
    return { provider: "builtin", templates: BUILTIN_TEMPLATES };
  }
}

/** 把课件大纲压成智文的生成要求文本（标题 + 各页要点）。 */
export function buildAipptQuery(item: ResourceItem): string {
  const d = item.data as { title?: string; slides?: { title?: string; content?: string[] }[] } | undefined;
  const lines: string[] = [item.title || d?.title || "课件"];
  for (const s of d?.slides ?? []) {
    if (!s.title) continue;
    const c = Array.isArray(s.content) && s.content.length ? `：${s.content.join("、")}` : "";
    lines.push(`${s.title}${c}`);
  }
  return lines.join("\n").slice(0, 8000);
}

export async function createAippt(
  query: string,
  templateId: string,
  signal?: AbortSignal
): Promise<{ sid: string; cover?: string }> {
  const res = await fetch(`${PPT_API_BASE}/api/media/ppt/aippt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, template_id: templateId }),
    signal,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const j = (await res.json()) as { sid?: string; cover?: string };
  if (!j.sid) throw new Error("智文未返回任务 ID");
  return { sid: j.sid, cover: j.cover };
}

/** 轮询智文进度，done 返回 pptUrl；约每 3s 一次。 */
export async function pollAippt(
  sid: string,
  onProgress?: (p: number) => void,
  signal?: AbortSignal
): Promise<string> {
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (signal?.aborted) throw new Error("已取消");
    const res = await fetch(`${PPT_API_BASE}/api/media/ppt/aippt/${encodeURIComponent(sid)}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) continue;
    const j = (await res.json()) as { status?: string; progress?: number; ppt_url?: string };
    onProgress?.(typeof j.progress === "number" ? j.progress : 0);
    if (j.status === "completed" && j.ppt_url) return j.ppt_url;
    if (j.status === "failed") throw new Error("智文生成失败");
  }
  throw new Error("智文生成超时，请重试");
}

/** 用 Office 在线查看器打开 .pptx（在内置浏览器里预览成品）。 */
export function officeViewerUrl(pptUrl: string): string {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(pptUrl)}`;
}

export async function exportCoursewarePpt(
  item: ResourceItem,
  options: {
    onProgress?: (progress: PptProgress) => void;
    signal?: AbortSignal;
    studentId?: string;
    template?: string;
  } = {}
): Promise<string> {
  const payload = buildPptExportPayload(item, options.studentId, options.template);
  if (payload.slides.length === 0) {
    throw new Error("当前课件没有可导出的幻灯片");
  }

  const res = await fetch(`${PPT_API_BASE}/api/media/ppt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`PPT 创建失败 HTTP ${res.status}`);
  }
  const json = (await res.json()) as { task_id?: string };
  if (!json.task_id) {
    throw new Error("后端未返回 PPT 任务 ID");
  }

  await waitForPptTask(json.task_id, options.onProgress, options.signal);
  return pptDownloadUrl(json.task_id);
}
