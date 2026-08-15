import type { PathStep, ResourceData, ResourceItem, ResourceType } from "./types";
import { API_BASE } from "./api.ts";
import { getStudentId } from "./student-identity.ts";

type Mode = "checking" | "live" | "offline";
const VIDEO_API_BASE = API_BASE;

export interface BilibiliVideoResult {
  bvid: string;
  title: string;
  url: string;
  embed_url?: string;
  author?: string;
  cover?: string;
  duration?: string;
  summary?: string;
  published_at?: string;
}

export interface WatchedVideoRecord extends BilibiliVideoResult {
  watched_seconds: number;
  watched_at: string;
  learning_summary?: string;
}

export interface VideoLearningPayload {
  video: BilibiliVideoResult;
  analysis: {
    summary: string;
    key_points: string[];
    questions: NonNullable<ResourceData["questions"]>;
  };
  summary_resource: VideoResourcePayload;
  quiz_resource: VideoResourcePayload;
  path_attachment: {
    type: "video";
    title: string;
    url: string;
    bvid: string;
    embed_url: string;
    summary: string;
    watched_seconds: number;
  };
}

interface VideoResourcePayload {
  type: ResourceType;
  title: string;
  subtitle?: string;
  meta?: string[];
  sources?: number;
  knowledge_points?: string;
  data: ResourceData;
  source?: string;
  approval_token?: string | null;
  review_approved?: boolean;
}

export function toBilibiliEmbedUrl(bvid: string): string {
  return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=0`;
}

function normalizeVideo(video: BilibiliVideoResult): Required<Pick<BilibiliVideoResult, "bvid" | "title" | "url">> &
  BilibiliVideoResult {
  const bvid = video.bvid;
  return {
    ...video,
    bvid,
    title: video.title || `视频 ${bvid}`,
    url: video.url || `https://www.bilibili.com/video/${bvid}/`,
    embed_url: video.embed_url || toBilibiliEmbedUrl(bvid),
  };
}

function resourceFromPayload(payload: VideoResourcePayload, suffix: string, bvid: string): ResourceItem {
  return {
    id: `bilibili_${bvid}_${suffix}`,
    type: payload.type,
    title: payload.title,
    subtitle: payload.subtitle ?? "",
    meta: payload.meta ?? [],
    status: "ready",
    version: 1,
    sources: payload.sources ?? 0,
    data: payload.data,
  };
}

export function mapVideoLearningPayloadToResources(payload: VideoLearningPayload): ResourceItem[] {
  const bvid = payload.video.bvid;
  return [
    resourceFromPayload(payload.summary_resource, "summary", bvid),
    resourceFromPayload(payload.quiz_resource, "quiz", bvid),
  ];
}

export function buildWatchedVideoStep(videoInput: BilibiliVideoResult, watchedSeconds: number): PathStep {
  const video = normalizeVideo(videoInput);
  return {
    day: "B站",
    title: video.title,
    desc: video.summary || "检索到的视频学习资源，可直接回看并用于复盘练习。",
    types: ["video"],
    state: "todo",
    links: [
      {
        type: "bilibili",
        title: video.title,
        url: video.url,
        bvid: video.bvid,
        embed_url: video.embed_url ?? toBilibiliEmbedUrl(video.bvid),
        watched_seconds: watchedSeconds,
      },
    ],
  };
}

export async function searchBilibiliVideos(
  mode: Mode,
  query: string,
  count = 8
): Promise<BilibiliVideoResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (mode !== "live") return [];
  try {
    const res = await fetch(
      `${VIDEO_API_BASE}/api/videos/bilibili/search?query=${encodeURIComponent(q)}&count=${count}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`视频搜索失败 HTTP ${res.status}`);
    const json = (await res.json()) as { results?: BilibiliVideoResult[] };
    return json.results ?? [];
  } catch {
    return [];
  }
}

export async function analyzeBilibiliVideo(
  mode: Mode,
  video: BilibiliVideoResult,
  options: { watchedSeconds?: number; note?: string } = {}
): Promise<VideoLearningPayload> {
  if (mode !== "live") throw new Error("后端未连接，无法生成视频学习分析");
  const res = await fetch(`${VIDEO_API_BASE}/api/videos/bilibili/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: getStudentId(),
      video: normalizeVideo(video),
      watched_seconds: options.watchedSeconds ?? 0,
      note: options.note ?? "",
    }),
  });
  if (!res.ok) throw new Error(`视频学习分析失败 HTTP ${res.status}`);
  return (await res.json()) as VideoLearningPayload;
}
