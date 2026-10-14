"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Check, Clock3, Loader2, PlayCircle, Search, Sparkles, Video } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link } from "@/components/shell-link";
import { Button } from "@/components/ui/button";
import { saveMaterial } from "@/lib/library";
import {
  analyzeBilibiliVideo,
  mapVideoLearningPayloadToResources,
  searchBilibiliVideos,
  toBilibiliEmbedUrl,
  type BilibiliVideoResult,
  type VideoLearningPayload,
} from "@/lib/video-learning";
import { cn } from "@/lib/utils";

export default function VideoLearningPage() {
  const session = useOrchestratorContext((state) => ({
    mode: state.mode,
    recordWatchedVideo: state.recordWatchedVideo,
    appendResources: state.appendResources,
    hydrated: state.hydrated,
  }));
  const [query, setQuery] = useState("动态规划 数据结构");
  const [results, setResults] = useState<BilibiliVideoResult[]>([]);
  const [selected, setSelected] = useState<BilibiliVideoResult | null>(null);
  const [note, setNote] = useState("");
  const [watchedSeconds, setWatchedSeconds] = useState(0);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<VideoLearningPayload | null>(null);

  const embedUrl = useMemo(
    () => selected ? selected.embed_url || toBilibiliEmbedUrl(selected.bvid) : "",
    [selected],
  );

  const searchVideos = async () => {
    if (!query.trim() || searching || session.mode !== "live") return;
    setSearching(true);
    setError("");
    setPayload(null);
    try {
      const found = await searchBilibiliVideos(session.mode, query, 8);
      setResults(found);
      setSelected(found[0] ?? null);
      setWatchedSeconds(0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "视频搜索失败");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const markWatched = () => {
    if (!selected) return;
    const seconds = Math.max(600, watchedSeconds);
    setWatchedSeconds(seconds);
    session.recordWatchedVideo(selected, { watchedSeconds: seconds, summary: selected.summary });
  };

  const generateResources = async () => {
    if (!selected || analyzing || session.mode !== "live") return;
    setAnalyzing(true);
    setError("");
    try {
      const next = await analyzeBilibiliVideo(session.mode, selected, { watchedSeconds, note });
      await Promise.all([next.summary_resource, next.quiz_resource].map((resource) => saveMaterial(session.mode, {
        type: resource.type,
        title: resource.title,
        subtitle: resource.subtitle,
        meta: resource.meta,
        sources: resource.sources,
        knowledge_points: resource.knowledge_points,
        data: resource.data,
        source: "video",
        approval_token: resource.approval_token,
      })));
      session.appendResources(mapVideoLearningPayloadToResources(next));
      session.recordWatchedVideo(selected, { watchedSeconds, summary: next.analysis.summary });
      setPayload(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "视频学习分析失败");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader title="视频学习" eyebrow="学习工具">
          <Link href="/resources?type=quiz" className="flex items-center gap-1 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent">
            查看复盘题 <ArrowUpRight className="size-3.5" />
          </Link>
        </PageHeader>

        <section className="rounded-xl border bg-card p-4">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">搜索学习视频</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void searchVideos(); }}
                placeholder="输入知识点、课程主题或视频链接"
                disabled={!session.hydrated || session.mode !== "live"}
                className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-55"
              />
            </label>
            <Button onClick={() => void searchVideos()} disabled={!session.hydrated || searching || session.mode !== "live"} className="gap-1.5">
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}搜索视频
            </Button>
          </div>
          {session.mode === "offline" && <p className="mt-2 text-xs text-danger">后端未连接，视频检索与 AI 分析暂不可用。</p>}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </section>

        <div className="grid gap-4 lg:grid-cols-12">
          <section className="min-w-0 lg:col-span-4">
            {results.length === 0 ? (
              <EmptyState icon={Video} title="还没有搜索结果" desc="搜索一个知识点，或直接粘贴视频链接。" />
            ) : (
              <div className="thin-scroll max-h-[680px] space-y-2 overflow-y-auto pr-1">
                {results.map((video) => (
                  <button
                    key={video.bvid}
                    type="button"
                    onClick={() => { setSelected(video); setPayload(null); setWatchedSeconds(0); }}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                      selected?.bvid === video.bvid ? "border-primary bg-primary/[0.05]" : "hover:border-primary/40",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-primary"><PlayCircle className="size-4" /></span>
                    <span className="min-w-0">
                      <strong className="line-clamp-2 text-[13px] leading-snug">{video.title}</strong>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">{video.author || video.bvid}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="min-w-0 space-y-4 lg:col-span-8">
            {selected ? (
              <>
                <div className="overflow-hidden rounded-xl border bg-card">
                  <header className="flex items-start gap-3 border-b px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold">{selected.title}</h2>
                      <p className="mt-1 text-[11px] text-muted-foreground">{selected.bvid} · {selected.author || "哔哩哔哩"}</p>
                    </div>
                    <a href={selected.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-primary hover:bg-accent">
                      原页面 <ArrowUpRight className="size-3" />
                    </a>
                  </header>
                  <div className="aspect-video bg-zinc-950">
                    <iframe key={selected.bvid} src={embedUrl} title={selected.title} className="h-full w-full" allow="fullscreen; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                  </div>
                </div>

                <section className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold">观看后生成总结与复盘题</h2>
                      <p className="mt-1 text-[11px] text-muted-foreground">生成内容会持久化保存到资源中心。</p>
                    </div>
                    <Button variant="outline" onClick={markWatched} className="gap-1.5"><Clock3 className="size-4" />标记已观看</Button>
                    <Button onClick={() => void generateResources()} disabled={analyzing || session.mode !== "live"} className="gap-1.5">
                      {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}生成学习资源
                    </Button>
                  </div>
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="可选：记录疑问或重点，AI 会纳入总结和题目。" className="mt-3 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
                </section>

                {payload && (
                  <section className="rounded-xl border border-success/30 bg-success/[0.05] p-4">
                    <div className="flex items-center gap-1.5 text-sm font-semibold"><Check className="size-4 text-success" />已生成并保存</div>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{payload.analysis.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href="/resources?type=reading" className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-primary">查看总结</Link>
                      <Link href="/resources?type=quiz" className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-primary">查看题目</Link>
                      <Link href="/path" className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-primary">查看总学习路径</Link>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <EmptyState icon={PlayCircle} title="选择一个视频开始学习" desc="选中视频后可在应用内播放，并生成总结和复盘题。" />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
