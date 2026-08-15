"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  FileCheck2,
  Loader2,
  MousePointerClick,
  Play,
  ShieldCheck,
} from "lucide-react";

import { AgentIconTile } from "@/components/agent-bits";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResourceItem, ResourceStatus, ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ── 各类型迷你预览 ───────────────────────────── */

export function ResourcePreview({
  type,
  pending,
}: {
  type: ResourceType;
  pending: boolean;
}) {
  if (pending) {
    return (
      <div className="relative h-14 overflow-hidden rounded-lg">
        <Skeleton className="h-full w-full rounded-lg" />
        <span className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">
          智能体生成中…
        </span>
      </div>
    );
  }

  switch (type) {
    case "explainer":
      return (
        <div className="flex h-14 flex-col justify-center gap-1.5 rounded-lg bg-muted/60 px-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-info">§1</span>
            <div className="h-1.5 w-[88%] rounded-full bg-foreground/15" />
          </div>
          <div className="ml-5 h-1.5 w-[70%] rounded-full bg-foreground/10" />
          <div className="ml-5 h-1.5 w-[52%] rounded-full bg-foreground/10" />
        </div>
      );
    case "mindmap":
      return (
        <div className="grid h-14 place-items-center rounded-lg bg-muted/60">
          <svg viewBox="0 0 190 44" className="h-11 w-44">
            <line x1="62" y1="22" x2="118" y2="8" stroke="#5f847255" strokeWidth="1.5" />
            <line x1="62" y1="22" x2="118" y2="22" stroke="#5f847255" strokeWidth="1.5" />
            <line x1="62" y1="22" x2="118" y2="36" stroke="#5f847255" strokeWidth="1.5" />
            <rect x="18" y="15" width="44" height="14" rx="4" fill="#5f8472" />
            <rect x="118" y="2" width="52" height="11" rx="3.5" fill="#5f847226" stroke="#5f847266" />
            <rect x="118" y="17" width="52" height="11" rx="3.5" fill="#5f847226" stroke="#5f847266" />
            <rect x="118" y="32" width="52" height="11" rx="3.5" fill="#5f847226" stroke="#5f847266" />
            <text x="40" y="25" textAnchor="middle" fontSize="7" fill="#fff">动态规划</text>
            <text x="144" y="10.5" textAnchor="middle" fontSize="6" fill="#5f8472">重叠子问题</text>
            <text x="144" y="25.5" textAnchor="middle" fontSize="6" fill="#5f8472">转移方程</text>
            <text x="144" y="40.5" textAnchor="middle" fontSize="6" fill="#5f8472">经典模型</text>
          </svg>
        </div>
      );
    case "quiz":
      return (
        <div className="flex h-14 flex-col justify-center gap-1.5 rounded-lg bg-warning/[0.07] px-3 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="grid size-3.5 place-items-center rounded-full border border-warning/50 text-[8px] text-warning">A</span>
            <div className="h-1.5 w-[62%] rounded-full bg-foreground/10" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="grid size-3.5 place-items-center rounded-full bg-warning text-[8px] font-bold text-white">B</span>
            <div className="h-1.5 w-[48%] rounded-full bg-warning/30" />
            <span className="text-[8px] text-warning">✓</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="grid size-3.5 place-items-center rounded-full border border-warning/50 text-[8px] text-warning">C</span>
            <div className="h-1.5 w-[55%] rounded-full bg-foreground/10" />
          </div>
        </div>
      );
    case "solution":
      return (
        <div className="flex h-14 flex-col justify-center gap-1.5 rounded-lg bg-[#9a6a32]/[0.07] px-3 text-[9px]">
          <div className="flex items-center gap-1.5"><span className="font-semibold text-[#8b5620]">题</span><div className="h-1.5 w-[72%] rounded-full bg-foreground/12" /></div>
          <div className="flex items-center gap-1.5"><span className="font-semibold text-success">答</span><div className="h-1.5 w-[52%] rounded-full bg-success/20" /></div>
          <div className="flex items-center gap-1.5"><span className="font-semibold text-info">析</span><div className="h-1.5 w-[64%] rounded-full bg-info/20" /></div>
        </div>
      );
    case "code":
      return (
        <div className="flex h-14 flex-col justify-center gap-1 rounded-lg bg-zinc-900 px-3 font-mono text-[9px] leading-snug">
          <div><span className="text-sky-300">def</span> <span className="text-zinc-100">climb</span><span className="text-zinc-400">(n):</span></div>
          <div className="pl-3 text-zinc-400">dp = [<span className="text-amber-200">1</span>, <span className="text-amber-200">1</span>] + [<span className="text-amber-200">0</span>] * (n-<span className="text-amber-200">1</span>)</div>
          <div className="pl-3 text-zinc-500"># TODO: 写出状态转移 ↓</div>
        </div>
      );
    case "video":
      return (
        <div className="relative h-14 overflow-hidden rounded-lg bg-zinc-900">
          <div className="absolute inset-x-0 top-0 flex justify-between px-1.5 pt-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="h-1 w-2.5 rounded-[2px] bg-zinc-700" />
            ))}
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <span className="grid size-7 place-items-center rounded-full bg-danger">
              <Play className="ml-0.5 size-3.5 fill-white text-white" />
            </span>
          </div>
          <span className="absolute bottom-1 right-1.5 rounded bg-black/55 px-1 font-mono text-[9px] text-zinc-200">
            03:12
          </span>
        </div>
      );
    case "reading":
      return (
        <div className="flex h-14 flex-col justify-center gap-1.5 rounded-lg bg-success/[0.07] px-3">
          {["贪心与 DP 的边界在哪里", "从斐波那契到股票买卖", "面试官最爱的 3 道 DP"].map((t) => (
            <div key={t} className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <span className="size-1 rounded-full bg-success" />
              <span className="truncate">{t}</span>
            </div>
          ))}
        </div>
      );
    case "interactive":
      return (
        <div className="relative h-14 overflow-hidden rounded-lg bg-[#101a17]">
          {/* 用一组透视线框暗示「可旋转的三维模型」，纯 CSS，无需真的起 WebGL */}
          <div className="absolute inset-0 grid place-items-center">
            <span className="block size-8 rotate-12 border border-[#6fd0a1]/70" />
            <span className="absolute size-8 -rotate-12 border border-[#6fd0a1]/35" />
          </div>
          <span className="absolute bottom-1 left-1.5 flex items-center gap-1 rounded bg-black/45 px-1 font-mono text-[9px] text-[#8fe0bb]">
            <MousePointerClick className="size-2.5" />
            可交互
          </span>
        </div>
      );
    default:
      return <div className="h-14 rounded-lg bg-muted" />;
  }
}

/* ── 状态徽标 ─────────────────────────────────── */

function StatusBadge({ status }: { status: ResourceStatus }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Loader2 className="size-2.5 animate-spin" />
          生成中
        </Badge>
      );
    case "review":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-warning/40 bg-warning/10 text-[10px] text-warning"
        >
          <FileCheck2 className="size-2.5" />
          待审核
        </Badge>
      );
    case "rejected":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-danger/40 bg-danger/10 text-[10px] text-danger"
        >
          <AlertTriangle className="size-2.5" />
          驳回重做
        </Badge>
      );
    case "failed":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-danger/40 bg-danger/10 text-[10px] text-danger"
        >
          <AlertTriangle className="size-2.5" />
          生成失败
        </Badge>
      );
    case "ready":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-success/40 bg-success/10 text-[10px] text-success"
        >
          <ShieldCheck className="size-2.5" />
          已过审
        </Badge>
      );
  }
}

/* ── 资源卡 ───────────────────────────────────── */

export function ResourceCard({
  item,
  onOpen,
}: {
  item: ResourceItem;
  onOpen?: (item: ResourceItem) => void;
}) {
  const pending = item.status === "pending";
  const clickable = item.status === "ready" && !!onOpen;
  const open = () => clickable && onOpen?.(item);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onClick={open}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "rounded-xl border bg-card p-3 transition-shadow hover:shadow-md",
        item.status === "rejected" && "border-danger/50",
        item.status === "failed" && "border-danger/50 bg-danger/[0.02]",
        item.status === "ready" && "border-success/25",
        clickable &&
          "cursor-pointer outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/40"
      )}
    >
      <div className="flex items-start gap-2.5">
        <AgentIconTile id={item.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold leading-tight">
              {item.title}
            </span>
            {item.version > 1 && (
              <Badge className="h-4 shrink-0 bg-warning/15 px-1 text-[9px] text-warning">
                v{item.version} 重做版
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {item.subtitle}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div className="mt-2.5">
        <ResourcePreview type={item.type} pending={pending} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
        {item.meta.map((m, i) => (
          <span key={m} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/40">·</span>}
            {m}
          </span>
        ))}
        {!pending && (
          <span className="ml-auto flex items-center gap-0.5 font-medium text-primary/80">
            <ShieldCheck className="size-2.5" />
            引用 {item.sources} 处
          </span>
        )}
      </div>

      {clickable && (
        <div className="mt-2 flex items-center justify-end gap-0.5 border-t pt-2 text-[11px] font-medium text-primary">
          {item.type === "quiz" ? "开始答题" : item.type === "solution" ? "查看题目解析" : "查看详情"}
          <ArrowUpRight className="size-3" />
        </div>
      )}
    </motion.div>
  );
}
