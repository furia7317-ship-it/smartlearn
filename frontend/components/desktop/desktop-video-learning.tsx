"use client";

import { useMemo, useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Loader2,
  PlayCircle,
  Search,
  Sparkles,
  Video,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
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

const DEFAULT_QUERY = "动态规划 数据结构";

function displayDuration(seconds: number): string {
  if (seconds <= 0) return "未记录";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoLearningPage() {
  const { mode, hydrated, appendResources, recordWatchedVideo } = useOrchestratorContext();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [results, setResults] = useState<BilibiliVideoResult[]>([]);
  const [selected, setSelected] = useState<BilibiliVideoResult | null>(null);
  const [note, setNote] = useState("");
  const [watchedSeconds, setWatchedSeconds] = useState(0);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<VideoLearningPayload | null>(null);

  const selectedEmbed = useMemo(() => {
    if (!selected) return "";
    return selected.embed_url || toBilibiliEmbedUrl(selected.bvid);
  }, [selected]);

  const runSearch = async () => {
    if (!query.trim() || searching || mode !== "live") return;
    setSearching(true);
    setError("");
    setPayload(null);
    try {
      const found = await searchBilibiliVideos(mode, query, 8);
      setResults(found);
      if (found[0]) {
        setSelected(found[0]);
        setWatchedSeconds(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频搜索失败");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const markWatched = () => {
    if (!selected) return;
    const seconds = Math.max(watchedSeconds, 600);
    setWatchedSeconds(seconds);
    recordWatchedVideo(selected, { watchedSeconds: seconds, summary: selected.summary });
  };

  const generateLearningResources = async () => {
    if (!selected || analyzing || mode !== "live") return;
    setAnalyzing(true);
    setError("");
    try {
      const nextPayload = await analyzeBilibiliVideo(mode, selected, {
        watchedSeconds,
        note,
      });
      const resources = mapVideoLearningPayloadToResources(nextPayload);
      await Promise.all([
        saveMaterial(mode, {
          type: nextPayload.summary_resource.type,
          title: nextPayload.summary_resource.title,
          subtitle: nextPayload.summary_resource.subtitle,
          meta: nextPayload.summary_resource.meta,
          sources: nextPayload.summary_resource.sources,
          knowledge_points: nextPayload.summary_resource.knowledge_points,
          data: nextPayload.summary_resource.data,
          source: "video",
          approval_token: nextPayload.summary_resource.approval_token,
        }),
        saveMaterial(mode, {
          type: nextPayload.quiz_resource.type,
          title: nextPayload.quiz_resource.title,
          subtitle: nextPayload.quiz_resource.subtitle,
          meta: nextPayload.quiz_resource.meta,
          sources: nextPayload.quiz_resource.sources,
          knowledge_points: nextPayload.quiz_resource.knowledge_points,
          data: nextPayload.quiz_resource.data,
          source: "video",
          approval_token: nextPayload.quiz_resource.approval_token,
        }),
      ]);
      appendResources(resources);
      recordWatchedVideo(selected, {
        watchedSeconds,
        summary: nextPayload.analysis.summary,
      });
      setPayload(nextPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频学习分析失败");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="视频学习"
        >
          <Link
            href="/resources?type=quiz"
            className="flex items-center gap-1 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-accent"
          >
            查看已生成题目
            <ArrowUpRight className="size-3.5" />
          </Link>
        </PageHeader>

        <section className="rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-2 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={!hydrated || mode !== "live"}
                aria-describedby={mode === "offline" ? "video-service-recovery" : undefined}
                title={mode === "offline" ? "后端未连接；启动本地后端后才能搜索视频" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder="输入知识点、课程主题或视频链接"
                className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <Button
              onClick={runSearch}
              disabled={!hydrated || searching || mode !== "live"}
              aria-describedby={mode === "offline" ? "video-service-recovery" : undefined}
              title={mode === "offline" ? "后端未连接；启动本地后端后才能搜索视频" : "搜索学习视频"}
              className="gap-1.5"
            >
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              搜索视频
            </Button>
          </div>
          {mode === "offline" && (
            <p id="video-service-recovery" className="mt-2 text-[12px] text-danger">
              视频搜索与 AI 分析已停用：请启动 backend 的 uvicorn 服务，确认 http://127.0.0.1:8000/docs 可访问，再到设置页重新检查。
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </section>

        <div className="grid gap-4 lg:grid-cols-12">
          <section className="min-w-0 space-y-3 lg:col-span-4">
            {results.length === 0 ? (
              <EmptyState
                icon={Video}
                title="还没有搜索结果"
                desc="搜索一个知识点，或直接粘贴视频链接。需要本地后端在线才能检索与生成复盘。"
              />
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">可学习视频</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    选择一个视频后可在右侧内置播放器观看
                  </p>
                </div>
                <div className="thin-scroll max-h-[620px] space-y-2 overflow-y-auto p-3">
                  {results.map((item) => {
                    const active = selected?.bvid === item.bvid;
                    return (
                      <button
                        key={item.bvid}
                        onClick={() => {
                          setSelected(item);
                          setPayload(null);
                          setWatchedSeconds(0);
                        }}
                        className={cn(
                          "w-full rounded-lg border p-3 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/5"
                            : "bg-surface-2/40 hover:border-primary/40 hover:bg-accent/40"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-primary">
                            <PlayCircle className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
                              {item.title}
                            </span>
                            <span className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                              {item.summary || item.author || item.bvid}
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="min-w-0 space-y-4 lg:col-span-8">
            {selected ? (
              <>
                <div className="overflow-hidden rounded-xl border bg-card">
                  <div className="flex flex-wrap items-start gap-2 border-b px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold">{selected.title}</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {selected.bvid} · {selected.author || "哔哩哔哩"}
                      </p>
                    </div>
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] text-primary hover:bg-accent"
                    >
                      打开原页面
                      <ArrowUpRight className="size-3" />
                    </a>
                  </div>
                  <div className="aspect-video bg-zinc-950">
                    <iframe
                      key={selected.bvid}
                      src={selectedEmbed}
                      title={selected.title}
                      className="h-full w-full"
                      allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>

                <section className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">观看后生成学习资源</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        当前记录：{displayDuration(watchedSeconds)} · 总结和题目会保存到资源中心
                      </p>
                    </div>
                    <Button variant="outline" className="ml-auto gap-1.5" onClick={markWatched}>
                      <Clock3 className="size-4" />
                      标记已观看
                    </Button>
                    <Button
                      className="gap-1.5"
                      onClick={generateLearningResources}
                      disabled={analyzing || mode !== "live"}
                      title={mode === "offline" ? "后端未连接；恢复服务后才能生成总结和题目" : "生成总结和复盘题"}
                    >
                      {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      生成总结和题目
                    </Button>
                  </div>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    placeholder="可选：写下你观看后的疑问或重点，AI 会纳入总结和题目。"
                    className="mt-3 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </section>

                {payload && (
                  <section className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <Check className="size-4 text-success" />
                      已生成并保存
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {payload.analysis.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {payload.analysis.key_points.map((point) => (
                        <span key={point} className="rounded-md bg-muted px-2 py-1 text-[11px]">
                          {point}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Link
                        href="/resources?type=reading"
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent"
                      >
                        查看总结
                      </Link>
                      <Link
                        href="/resources?type=quiz"
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent"
                      >
                        查看题目
                      </Link>
                      <Link
                        href="/path"
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent"
                      >
                        查看学习路径
                      </Link>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <EmptyState
                icon={PlayCircle}
                title="选择一个视频开始学习"
                desc="搜索结果会显示在左侧。选中视频后可在应用内播放，观看后生成总结和复盘题。"
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
