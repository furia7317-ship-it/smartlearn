"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Settings2, X } from "lucide-react";

import { MATERIAL_TYPE_LABEL } from "@/lib/material-types";
import type { ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ConfigAnchor {
  x: number;
  y: number;
  type: ResourceType;
}

export type QuizConfig = { choice: number; judge: number; short: number };
type QuizKey = keyof QuizConfig;

/**
 * 资料类型「生成配置」浮层：在资料类型上右键（或点齿轮）唤出，定位在光标处。
 * 当前题库（quiz）已接入具体配置（各题型数量），其余类型先放占位入口，后续逐类补全。
 */
export function ResourceConfigPopover({
  anchor,
  onClose,
  quizConfig,
  setQuizCount,
}: {
  anchor: ConfigAnchor | null;
  onClose: () => void;
  quizConfig: QuizConfig;
  setQuizCount: (key: QuizKey, value: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // 延迟一帧再监听，避免唤出它的那次点击/右键立刻把它关掉
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
    };
  }, [anchor, onClose]);

  if (!mounted || !anchor) return null;

  const isQuiz = anchor.type === "quiz" || anchor.type === "solution";
  const W = 288;
  const H = isQuiz ? 268 : 168;
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - H - 8));
  const total = quizConfig.choice + quizConfig.judge + quizConfig.short;

  const inputCls =
    "mt-1 w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12, ease: [0.25, 1, 0.5, 1] }}
      style={{ left, top, width: W }}
      className="fixed z-[80] rounded-xl border bg-popover p-3 shadow-xl"
      role="dialog"
      aria-modal="false"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5 border-b pb-2">
        <Settings2 className="size-3.5 text-primary" />
        <span className="text-[12px] font-semibold">
          {MATERIAL_TYPE_LABEL[anchor.type] ?? anchor.type} · 生成配置
        </span>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="ml-auto grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {isQuiz ? (
        <div className="pt-2.5">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["choice", "选择题"],
                ["judge", "判断题"],
                ["short", "简答题"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-[11px] text-muted-foreground">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={1}
                  value={quizConfig[key]}
                  onChange={(e) => setQuizCount(key, e.target.valueAsNumber)}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
          <p
            className={cn(
              "mt-2 text-[11px]",
              total < 1 ? "text-danger" : "text-muted-foreground"
            )}
          >
            {total < 1 ? "至少配置 1 道题" : `共 ${total} 道 · 每类 0–30，AI 按此数量出题`}
          </p>
        </div>
      ) : (
        <p className="pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          该类型的生成配置即将开放，当前使用智能默认参数生成。后续可在此调整篇幅、难度与侧重。
        </p>
      )}
    </motion.div>,
    document.body
  );
}
