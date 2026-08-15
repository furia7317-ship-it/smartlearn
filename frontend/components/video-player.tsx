"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";

import type { ResourceData } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Scene {
  text: string;
  duration: number;
  title: string;
  purpose?: string;
  visualTemplate?: string;
  visualParams?: Record<string, unknown>;
  focusTerms?: string[];
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 模板可视化舞台：按当前章节内容推进 */
function Stage({
  d,
  scene,
  idx,
  total,
}: {
  d: ResourceData;
  scene: Scene;
  idx: number;
  total: number;
}) {
  const params = scene.visualParams ?? ((d.params ?? {}) as Record<string, unknown>);
  const template = scene.visualTemplate ?? d.template;
  const title = scene.title || (params.title as string) || d.title || "讲解短片";

  if (template === "formula_step") {
    const formula = (params.formula as string) || "";
    const steps = (params.steps as string[]) || [];
    const activeStep = steps.length ? Math.min(idx, steps.length - 1) : -1;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5">
        <motion.div
          key={formula}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl bg-white/5 px-6 py-4 font-mono text-[22px] font-semibold tracking-wide text-white"
        >
          {formula}
        </motion.div>
        {steps.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-white/30">→</span>}
                <motion.span
                  animate={{
                    scale: i === activeStep ? 1.08 : 1,
                    opacity: i <= activeStep ? 1 : 0.4,
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[13px] font-medium",
                    i === activeStep
                      ? "bg-primary text-primary-foreground shadow-lg"
                      : "bg-white/10 text-white/80"
                  )}
                >
                  {s}
                </motion.span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (template === "concept_card") {
    const items = Array.from(new Set([...(scene.focusTerms ?? []), ...(((params.items as string[]) || []))]));
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="font-display text-xl font-semibold text-white">{title}</div>
        <div className="flex flex-col items-center gap-1.5">
          {items.map((it, i) => (
            <motion.div
              key={i}
              animate={{ opacity: i <= idx ? 1 : 0.35, x: 0 }}
              className={cn(
                "rounded-lg px-4 py-1.5 text-[14px]",
                i === idx ? "bg-primary/20 text-white" : "text-white/70"
              )}
            >
              {it}
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  // 通用舞台：标题 + 章节内容进度律动
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="font-display text-xl font-semibold text-white">{title}</div>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <motion.span
            key={i}
            animate={{
              scale: i === idx ? 1.4 : 1,
              opacity: i === idx ? 1 : 0.3,
            }}
            className="size-2.5 rounded-full bg-primary"
          />
        ))}
      </div>
    </div>
  );
}

export function VideoPlayer({ d }: { d: ResourceData }) {
  const scenes: Scene[] = d.scenes && d.scenes.length > 0
    ? d.scenes.map((scene, index) => ({
        text: scene.narration ?? scene.text ?? scene.title ?? `章节内容 ${index + 1}`,
        duration: scene.duration ?? 20,
        title: scene.title ?? `章节内容 ${index + 1}`,
        purpose: scene.purpose,
        visualTemplate: scene.visual_template,
        visualParams: scene.visual_params,
        focusTerms: scene.focus_terms,
      }))
    : d.narration && d.narration.length > 0
      ? d.narration.map((n, index) => ({
          text: n.text,
          duration: n.duration ?? 20,
          title: n.title ?? `章节内容 ${index + 1}`,
        }))
      : [{ text: d.title ?? "讲解短片", duration: 20, title: d.title ?? "讲解短片" }];

  const total = scenes.reduce((s, sc) => s + sc.duration, 0);
  const elapsedBefore = (i: number) =>
    scenes.slice(0, i).reduce((s, sc) => s + sc.duration, 0);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    const dur = (scenes[idx]?.duration ?? 6) * 1000;
    timer.current = window.setTimeout(() => {
      if (idx < scenes.length - 1) {
        setIdx((i) => i + 1);
      } else {
        setPlaying(false);
        setEnded(true);
      }
    }, dur);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx]);

  const play = () => {
    if (ended) {
      setIdx(0);
      setEnded(false);
    }
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const seek = (i: number) => {
    setIdx(i);
    setEnded(false);
  };

  const nowSec = elapsedBefore(idx) + (playing ? 0 : 0);

  return (
    <div className="space-y-3">
      {/* 舞台 */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900">
        {/* 顶栏 */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 py-2">
          <span className="rounded-md bg-white/10 px-2 py-0.5 font-display text-[11px] text-white/80">
            {d.title ?? "讲解短片"}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] text-white/50">
            <Volume2 className="size-3" />
            旁白讲解
          </span>
        </div>

        <Stage d={d} scene={scenes[idx]} idx={idx} total={scenes.length} />

        {/* 字幕 */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-9 pt-8">
          <AnimatePresence mode="wait">
            <motion.p
              key={idx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="mx-auto max-w-[90%] text-center text-[14px] font-medium leading-relaxed text-white drop-shadow"
            >
              {scenes[idx]?.text}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* 进度条 */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <motion.div
            key={`${idx}-${playing}`}
            className="h-full bg-primary"
            initial={{ width: `${(elapsedBefore(idx) / total) * 100}%` }}
            animate={{
              width: `${((elapsedBefore(idx) + (playing ? scenes[idx].duration : 0)) / total) * 100}%`,
            }}
            transition={{
              duration: playing ? scenes[idx].duration : 0.2,
              ease: "linear",
            }}
          />
        </div>

        {/* 大播放钮（暂停/未播时） */}
        {!playing && (
          <button
            onClick={play}
            aria-label="播放"
            className="absolute inset-0 grid place-items-center bg-black/20 transition-colors hover:bg-black/10"
          >
            <span className="grid size-14 place-items-center rounded-full bg-primary/90 shadow-xl transition-transform hover:scale-105">
              {ended ? (
                <RotateCcw className="size-6 text-white" />
              ) : (
                <Play className="ml-1 size-7 fill-white text-white" />
              )}
            </span>
          </button>
        )}
      </div>

      {/* 控制条 */}
      <div className="flex items-center gap-3">
        <button
          onClick={playing ? pause : play}
          aria-label={playing ? "暂停" : "播放"}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
        >
          {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4 fill-current" />}
        </button>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {fmt(nowSec)} / {fmt(total)}
        </span>
        {/* 章节内容跳转点 */}
        <div className="flex flex-1 items-center gap-1.5">
          {scenes.map((_, i) => (
            <button
              key={i}
              onClick={() => seek(i)}
              aria-label={`第 ${i + 1} 个章节内容`}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i === idx ? "bg-primary" : i < idx ? "bg-primary/40" : "bg-muted"
              )}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {idx + 1}/{scenes.length} 段
        </span>
      </div>
      {(d.key_takeaways?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="视频重点">
          {d.key_takeaways?.slice(0, 6).map((term) => (
            <span key={term} className="rounded-full border bg-muted/35 px-2.5 py-1 text-[11px] text-muted-foreground">
              {term}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
