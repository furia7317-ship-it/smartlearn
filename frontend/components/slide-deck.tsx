"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, MessageSquareText, Presentation } from "lucide-react";

import type { Slide } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 应用内 PPT 放映器：把课件大纲（slides）渲染成可翻页的「幻灯片」，
 * web / 桌面通用、纯前端离线可用（不依赖 Office 在线查看器或 localhost 文件）。
 * 支持左右方向键 / 点击翻页、缩略图跳转，并可对单页调用 AI 讲解。
 */
export function SlideDeck({
  slides,
  title,
  onExplainSlide,
  onReachEnd,
  compact = false,
}: {
  slides: Slide[];
  title?: string;
  /** 点「讲解本页」时回调当前页与序号；不传则不显示讲解按钮。 */
  onExplainSlide?: (slide: Slide, index: number) => void;
  /** Reaching the last slide is durable evidence that the deck was viewed. */
  onReachEnd?: () => void;
  /** 紧凑模式（弹窗内预览）：隐藏标题栏、缩略图更小。 */
  compact?: boolean;
}) {
  const total = slides.length;
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);

  const go = useCallback(
    (next: number) => {
      setIndex((cur) => {
        const clamped = Math.max(0, Math.min(total - 1, next));
        setDir(clamped >= cur ? 1 : -1);
        return clamped;
      });
    },
    [total]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  useEffect(() => {
    if (total > 0 && index === total - 1) onReachEnd?.();
  }, [index, onReachEnd, total]);

  if (total === 0) return null;
  const slide = slides[index];
  const isTitleSlide =
    (slide.layout ?? "").includes("title") || (slide.slide_num ?? index + 1) === 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 放映台 */}
      <div className="relative grid min-h-0 flex-1 place-items-center">
        <div className="relative aspect-[16/9] max-h-full w-full max-w-5xl overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* 顶部装饰条 + 页码 */}
          <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-5 pt-3 sm:px-8">
            <span className="h-1 w-10 rounded-full bg-primary" />
            {title && (
              <span className="truncate text-[11px] font-medium text-muted-foreground">
                {title}
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {String(slide.slide_num ?? index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
          </div>

          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={index}
              custom={dir}
              initial={{ opacity: 0, x: dir * 36 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -36 }}
              transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
              className={cn(
                "flex h-full w-full flex-col px-6 sm:px-12",
                isTitleSlide ? "items-center justify-center text-center" : "justify-center"
              )}
            >
              <h3
                className={cn(
                  "font-display font-semibold leading-tight tracking-tight",
                  isTitleSlide ? "text-[clamp(20px,3.4vw,40px)]" : "text-[clamp(17px,2.5vw,30px)]"
                )}
              >
                {slide.title}
              </h3>
              {Array.isArray(slide.content) && slide.content.length > 0 && (
                <ul
                  className={cn(
                    "space-y-2.5",
                    isTitleSlide ? "mt-4 text-muted-foreground" : "mt-5"
                  )}
                >
                  {slide.content.map((c, j) => (
                    <li
                      key={j}
                      className={cn(
                        "flex gap-2.5 text-[clamp(12px,1.5vw,18px)] leading-relaxed text-foreground/85",
                        isTitleSlide && "justify-center"
                      )}
                    >
                      {!isTitleSlide && (
                        <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          </AnimatePresence>

          {/* 左右翻页热区 */}
          {index > 0 && (
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="上一页"
              className="group absolute inset-y-0 left-0 z-10 grid w-12 place-items-center text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-foreground sm:w-16"
            >
              <ChevronLeft className="size-6 transition-transform group-hover:-translate-x-0.5" />
            </button>
          )}
          {index < total - 1 && (
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="下一页"
              className="group absolute inset-y-0 right-0 z-10 grid w-12 place-items-center text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-foreground sm:w-16"
            >
              <ChevronRight className="size-6 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </div>

      {/* 控制条 */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="grid size-8 place-items-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            aria-label="上一页"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === total - 1}
            className="grid size-8 place-items-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            aria-label="下一页"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Presentation className="size-3.5" />
          第 {index + 1} / {total} 页 · ← → 翻页
        </span>
        {onExplainSlide && (
          <button
            type="button"
            onClick={() => onExplainSlide(slide, index)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <MessageSquareText className="size-3.5" />
            AI 讲解本页
          </button>
        )}
      </div>

      {/* 缩略图条 */}
      {!compact && (
        <div className="thin-scroll flex shrink-0 gap-2 overflow-x-auto pb-1">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              className={cn(
                "group relative aspect-[16/9] w-28 shrink-0 overflow-hidden rounded-md border bg-card px-2 py-1.5 text-left transition-colors",
                i === index ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40"
              )}
            >
              <span className="font-mono text-[8px] text-muted-foreground">
                {String(s.slide_num ?? i + 1).padStart(2, "0")}
              </span>
              <span className="mt-0.5 line-clamp-2 text-[9px] font-medium leading-snug text-foreground/80">
                {s.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
