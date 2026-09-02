"use client";

import { CalendarDays, FileText, Trash2 } from "lucide-react";
import Image from "next/image";

import type { PaperSummary } from "@/lib/library";
import { cn } from "@/lib/utils";

/** 学枢红熊猫品牌图标。 */
function Seal() {
  return (
    <Image
      src="/brand/xueshu-app-icon-128.webp"
      alt=""
      width={36}
      height={36}
      className="size-9 shrink-0 select-none rounded-md shadow-sm"
    />
  );
}

function scoreTone(score: number): string {
  if (score >= 80) return "border-success/40 bg-success/[0.08] text-success";
  if (score >= 60) return "border-warning/40 bg-warning/[0.08] text-warning";
  return "border-danger/40 bg-danger/[0.08] text-danger";
}

/**
 * 试卷封皮 —— 墨与朱批风格的试卷封面卡片。
 * 题头（科目）→ 标题 → 朱印 → 题量/日期 → 批改分数色带。
 */
export function PaperCover({
  paper,
  onOpen,
  onDelete,
}: {
  paper: PaperSummary;
  onOpen: (paper: PaperSummary) => void;
  onDelete?: (paper: PaperSummary) => void;
}) {
  const date = (paper.created_at || "").slice(5, 10).replace("-", "月") + (paper.created_at ? "日" : "");
  const graded = paper.status === "graded" && typeof paper.overall_score === "number";

  return (
    <button
      type="button"
      onClick={() => onOpen(paper)}
      className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/40"
    >
      {/* 顶栏：印章 + 分类 */}
      <div className="flex items-center gap-2.5 border-b bg-surface-2/50 px-4 py-3">
        <Seal />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-muted-foreground">
            {paper.category || "未分类"}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/70">学枢 · 试卷</div>
        </div>
        {onDelete && (
          <span
            role="button"
            tabIndex={0}
            aria-label="删除试卷"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(paper);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onDelete(paper);
              }
            }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </span>
        )}
      </div>

      {/* 封面正文：题头 + 标题 */}
      <div className="flex flex-1 flex-col items-center px-4 py-6 text-center">
        <div className="font-display text-[13px] tracking-wide text-muted-foreground">
          《{paper.topic || "综合"}》
        </div>
        <h3 className="mt-1.5 line-clamp-2 font-display text-[16px] font-semibold leading-snug">
          {paper.title || "AI 生成练习卷"}
        </h3>
        <div className="mt-3 h-px w-16 bg-danger/40" />
        {paper.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1">
            {paper.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 底栏：题量 / 日期 / 分数 */}
      <div className="flex items-center gap-3 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileText className="size-3.5" />
          {paper.question_count} 题
        </span>
        {date && (
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {date}
          </span>
        )}
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px]",
            graded
              ? scoreTone(paper.overall_score as number)
              : "border-muted-foreground/30 text-muted-foreground"
          )}
        >
          {graded ? `${Math.round(paper.overall_score as number)} 分` : "待作答"}
        </span>
      </div>
    </button>
  );
}
