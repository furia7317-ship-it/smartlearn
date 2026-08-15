"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Download, Globe, Loader2, Presentation, Sparkles, X } from "lucide-react";

import { openInBrowser } from "@/lib/browser-bus";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { SlideDeck } from "@/components/slide-deck";
import {
  buildAipptQuery,
  createAippt,
  exportCoursewarePpt,
  listPptTemplatesFull,
  officeViewerUrl,
  pollAippt,
  type PptTemplate,
} from "@/lib/ppt-export";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type Phase = "pick" | "generating" | "done" | "error";

/**
 * 「生成 PPT」弹窗：图片模板墙(讯飞智文，缩略图可视化) → 选模板 → 生成成品 PPT →
 * 在内置浏览器用 Office 在线查看器打开 + 下载。智文未配置时回落内置主题(python-pptx 大纲版)。
 */
export function PptGenerateModal({
  item,
  onClose,
}: {
  item: ResourceItem | null;
  onClose: () => void;
}) {
  const { mode } = useOrchestratorContext();
  const [provider, setProvider] = useState<"zhiwen" | "builtin">("builtin");
  const [templates, setTemplates] = useState<PptTemplate[]>([]);
  const [style, setStyle] = useState<string>("全部");
  const [selected, setSelected] = useState<string>("");
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [progress, setProgress] = useState(0);
  const [pptUrl, setPptUrl] = useState("");
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  // 应用内放映预览（离线可用，绕开 Office 在线查看器无法访问 localhost 的问题）
  const [showSlides, setShowSlides] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!item) return;
    setPhase("pick");
    setProgress(0);
    setPptUrl("");
    setError("");
    setSelected("");
    setStyle("全部");
    setShowSlides(false);
    setLoadingTpl(true);
    listPptTemplatesFull({ size: 60 })
      .then((res) => {
        setProvider(res.provider);
        setTemplates(res.templates);
        setSelected(res.templates[0]?.key ?? "");
      })
      .catch(() => {})
      .finally(() => setLoadingTpl(false));
    return () => abortRef.current?.abort();
  }, [item]);

  const styles = useMemo(() => {
    const s = new Set<string>();
    for (const t of templates) if (t.style) s.add(t.style);
    return ["全部", ...Array.from(s)];
  }, [templates]);

  const shown = useMemo(
    () => (style === "全部" ? templates : templates.filter((t) => t.style === style)),
    [templates, style]
  );

  if (!item) return null;

  const slides = Array.isArray(item.data?.slides) ? item.data!.slides! : [];
  const hasSlides = slides.length > 0;

  const generate = async () => {
    if (!selected) return;
    // 后端未连接时无法在前端产出 .pptx 文件，只能查看已有幻灯片预览。
    if (mode !== "live") {
      setShowSlides(true);
      return;
    }
    setPhase("generating");
    setProgress(0);
    setError("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      let url: string;
      if (provider === "zhiwen") {
        const { sid } = await createAippt(buildAipptQuery(item), selected, ctrl.signal);
        url = await pollAippt(sid, (p) => setProgress(p), ctrl.signal);
      } else {
        url = await exportCoursewarePpt(item, {
          template: selected,
          onProgress: (p) => setProgress(p.progress ?? 0),
          signal: ctrl.signal,
        });
      }
      setPptUrl(url);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setPhase("error");
    }
  };

  const preview = () => {
    if (!pptUrl) return;
    const u = provider === "zhiwen" ? officeViewerUrl(pptUrl) : pptUrl;
    if (!openInBrowser(u)) window.open(u, "_blank", "noopener");
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = pptUrl;
    a.download = `${item.title || "courseware"}.pptx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const overlay = (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-2 border-b bg-surface-2/60 px-4 py-3">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-[15px] font-semibold">生成 PPT · 选模板</h2>
          <span className="text-[11px] text-muted-foreground">
            {provider === "zhiwen" ? "讯飞智文 · 成品带版式配图" : "内置主题 · 大纲版"}
          </span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* 风格筛选 */}
        {provider === "zhiwen" && styles.length > 1 && phase === "pick" && (
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
            {styles.map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[12px] transition-colors",
                  style === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* 主体 */}
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {phase === "pick" &&
            (loadingTpl ? (
              <div className="grid place-items-center py-16 text-sm text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                <span className="mt-2">加载模板…</span>
              </div>
            ) : provider === "zhiwen" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {shown.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setSelected(t.key)}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border bg-card text-left transition-all",
                      selected === t.key
                        ? "border-primary ring-2 ring-primary/40"
                        : "hover:border-primary/40"
                    )}
                  >
                    {/* 缩略图 */}
                    {t.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.thumbnail}
                        alt={t.style || "模板"}
                        loading="lazy"
                        className="aspect-[16/9] w-full bg-muted object-cover"
                      />
                    ) : (
                      <div className="grid aspect-[16/9] w-full place-items-center bg-muted text-[11px] text-muted-foreground">
                        无预览
                      </div>
                    )}
                    <div className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {[t.style, t.color].filter(Boolean).join(" · ") || "模板"}
                      </span>
                      {t.pageCount ? <span className="ml-auto shrink-0">{t.pageCount}页</span> : null}
                    </div>
                    {selected === t.key && (
                      <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              // builtin 回落：内置主题列表
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setSelected(t.key)}
                    className={cn(
                      "overflow-hidden rounded-lg border text-left text-[13px] transition-colors",
                      selected === t.key
                        ? "border-primary ring-2 ring-primary/40"
                        : "hover:border-primary/40"
                    )}
                  >
                    {/* 主题色卡（无缩略图时的可视化预览） */}
                    {t.bg && (
                      <div
                        className="flex aspect-[16/9] flex-col justify-center gap-1.5 px-3"
                        style={{ background: t.bg }}
                      >
                        <span className="h-1 w-8 rounded-full" style={{ background: t.accent }} />
                        <span className="text-[12px] font-semibold" style={{ color: t.titleColor }}>
                          {t.name || t.key}
                        </span>
                        <span className="h-1 w-12 rounded-full opacity-50" style={{ background: t.titleColor }} />
                      </div>
                    )}
                    <div className="px-2.5 py-2">
                      <div className="font-medium">{t.name || t.key}</div>
                      {t.desc && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{t.desc}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}

          {phase === "generating" && (
            <div className="grid place-items-center py-16 text-center">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="mt-3 text-sm font-medium">
                {provider === "zhiwen" ? "讯飞智文生成中…" : "生成中…"} {Math.round(progress * 100)}%
              </p>
              <div className="mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(5, Math.round(progress * 100))}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                成品含版式与配图，约需 1-2 分钟,请稍候…
              </p>
            </div>
          )}

          {phase === "done" && (
            <div className="grid place-items-center py-14 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-success/15 text-success">
                <Check className="size-6" />
              </span>
              <p className="mt-3 text-sm font-semibold">PPT 已生成</p>
              <p className="mt-1 text-[12px] text-muted-foreground">可直接放映预览或下载 .pptx</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                {hasSlides && (
                  <button
                    onClick={() => setShowSlides(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
                  >
                    <Presentation className="size-4" /> 放映预览
                  </button>
                )}
                {provider === "zhiwen" && (
                  <button
                    onClick={preview}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium hover:bg-accent"
                  >
                    <Globe className="size-4" /> Office 在线打开
                  </button>
                )}
                <button
                  onClick={download}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium hover:bg-accent"
                >
                  <Download className="size-4" /> 下载 PPTX
                </button>
              </div>
              <p className="mt-2.5 max-w-[34em] text-[11px] leading-relaxed text-muted-foreground">
                放映预览在应用内离线渲染，随处可看；
                {provider === "zhiwen"
                  ? "「Office 在线打开」展示带版式配图的成品（需公网访问）。"
                  : "下载的 .pptx 为内置主题大纲版。"}
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="grid place-items-center py-16 text-center">
              <p className="text-sm font-medium text-danger">生成失败</p>
              <p className="mt-1 max-w-[32em] text-[12px] text-muted-foreground">{error}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                {hasSlides && (
                  <button
                    onClick={() => setShowSlides(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
                  >
                    <Presentation className="size-4" /> 改用放映预览
                  </button>
                )}
                <button
                  onClick={() => setPhase("pick")}
                  className="rounded-lg border px-3.5 py-2 text-[13px] font-medium hover:bg-accent"
                >
                  返回重选
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        {phase === "pick" && (
          <footer className="flex shrink-0 items-center gap-3 border-t bg-surface-2/40 px-4 py-3">
            <span className="text-[12px] text-muted-foreground">
              {provider === "zhiwen" ? `共 ${shown.length} 套模板` : "选择一套主题"}
            </span>
            <button
              onClick={generate}
              disabled={!selected}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="size-4" /> 生成 PPT
            </button>
          </footer>
        )}
      </div>
    </div>
  );

  // 应用内放映预览：盖在弹窗之上，纯前端渲染当前课件的每一页
  const slidePreview = showSlides && hasSlides && (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b bg-surface-2/60 px-3 py-2.5 sm:px-4">
        <button
          onClick={() => setShowSlides(false)}
          aria-label="返回"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">返回</span>
        </button>
        <Presentation className="size-4 text-primary" />
        <h2 className="truncate text-[15px] font-semibold">{item.title} · 放映预览</h2>
        {pptUrl && (
          <button
            onClick={download}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-accent"
          >
            <Download className="size-3.5" />
            <span className="hidden sm:inline">下载 PPTX</span>
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
        <SlideDeck slides={slides} title={item.title} />
      </div>
    </div>
  );

  return mounted
    ? createPortal(
        <>
          {overlay}
          {slidePreview}
        </>,
        document.body
      )
    : null;
}
