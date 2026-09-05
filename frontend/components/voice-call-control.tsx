"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  LoaderCircle,
  Maximize2,
  Mic,
  Minimize2,
  PhoneOff,
  Volume2,
  X,
} from "lucide-react";

import { useRealtimeVoice, type VoicePhase } from "@/hooks/use-realtime-voice";
import type { ChatMessage, ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: "语音通话",
  connecting: "连接语音…",
  listening: "正在聆听",
  user_speaking: "正在识别",
  finalizing: "判断是否说完…",
  thinking: "正在快速回复",
  teacher_speaking: "教师正在回答",
  error: "语音不可用",
};
const VOICE_ACTION_CLASS = "transform-gpu transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out active:scale-90 motion-reduce:transition-none";

type VoiceSurface = "closed" | "full" | "mini" | "inline";

export function VoiceCallControl({
  messages,
  running,
  enabled,
  onSend,
  onStop,
  onClose,
  onNewConversation,
  resources,
  onOpenResource,
  compact = false,
  surfaceMode = "fullscreen",
  className,
}: {
  messages: ChatMessage[];
  running: boolean;
  enabled: boolean;
  onSend: (text: string) => void;
  onStop?: () => void | Promise<void>;
  onClose?: () => void;
  onNewConversation?: () => void;
  resources?: ResourceItem[];
  onOpenResource?: (resourceId: string) => void | Promise<void>;
  compact?: boolean;
  surfaceMode?: "fullscreen" | "inline";
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [surface, setSurface] = useState<VoiceSurface>("closed");
  const voice = useRealtimeVoice({
    messages,
    running,
    enabled,
    onSend,
    onStop,
    onClose,
    onNewConversation,
    resources,
    onOpenResource,
  });
  const detail = voice.error || voice.partialTranscript || voice.feedback || PHASE_LABEL[voice.phase];
  const showDetail = !compact && (voice.active || voice.phase === "error");
  const inactiveTitle = voice.phase === "error"
    ? `${detail} · 点击重试`
    : "开始实时语音通话";
  const Icon = voice.phase === "connecting"
    ? LoaderCircle
    : voice.phase === "teacher_speaking"
      ? Volume2
      : voice.active
        ? AudioLines
        : Mic;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (surface !== "full") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSurface("mini");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [surface]);

  const openCall = () => {
    if (!enabled && !voice.active) return;
    setSurface(surfaceMode === "inline" ? "inline" : "full");
    if (!voice.active) voice.toggle();
  };

  const endCall = async () => {
    await voice.stop();
    setSurface("closed");
  };

  const voiceSurface = surface === "inline" ? (
    <motion.section
      key="inline-voice-call"
      initial={reducedMotion ? false : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
      transition={{ duration: reducedMotion ? 0.01 : 0.18, ease: "easeOut" }}
      className="absolute inset-0 z-[60] flex flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_38%,rgba(102,75,43,0.96),rgba(29,24,19,0.99)_68%)] text-[#fffaf1]"
      role="dialog"
      aria-label="窗口内语音通话"
    >
      <header className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
        <div>
          <p className="text-[9px] font-medium tracking-[0.22em] text-white/45">学枢 · 智能教师</p>
          <p className="mt-0.5 text-xs font-semibold text-white/85">语音通话</p>
        </div>
        <button
          type="button"
          className={cn("ml-auto grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white", VOICE_ACTION_CLASS)}
          onClick={() => void endCall()}
          aria-label="关闭语音通话"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
        <div className="relative grid size-28 place-items-center">
          <span
            className={cn(
              "absolute inset-0 rounded-full border border-[#d6b47d]/35 bg-[#b88248]/10",
              voice.active && "animate-ping",
            )}
            style={{ animationDuration: "2.4s" }}
            aria-hidden
          />
          <span
            className={cn(
              "absolute inset-3 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f4d6a1,#9b6536_48%,#3f2b1d)] shadow-[0_0_48px_rgba(203,153,92,0.34)]",
              voice.phase === "thinking" && "animate-pulse",
            )}
            aria-hidden
          />
          <Icon
            className={cn(
              "relative size-8 text-[#fff8e9]",
              voice.phase === "connecting" && "animate-spin",
            )}
            strokeWidth={1.35}
            aria-hidden
          />
        </div>

        <h2 className="mt-6 font-display text-xl font-semibold">{PHASE_LABEL[voice.phase]}</h2>
        <p className={cn(
          "mt-2 min-h-10 max-w-72 text-xs leading-5",
          voice.phase === "error" ? "text-[#ffb4a7]" : "text-white/58",
        )}>
          {voice.phase === "error"
            ? detail
            : voice.partialTranscript || voice.feedback || "直接说出你的问题。"}
        </p>

        <div className="mt-4 flex h-8 items-center justify-center gap-1" aria-hidden>
          {[14, 24, 32, 20, 36, 25, 15].map((height, index) => (
            <span
              key={`${height}:${index}`}
              className={cn(
                "w-1 rounded-full bg-[#edcf9c]/80",
                voice.active ? "animate-pulse" : "opacity-35",
              )}
              style={{
                height,
                animationDelay: `${index * 90}ms`,
                animationDuration: "900ms",
              }}
            />
          ))}
        </div>

        <button
          type="button"
          className={cn("mt-7 grid size-12 place-items-center rounded-full bg-[#b9483d] text-white shadow-[0_10px_28px_rgba(185,72,61,0.32)] hover:bg-[#ca5548]", VOICE_ACTION_CLASS)}
          onClick={() => void endCall()}
          aria-label="结束语音通话"
          title="结束通话"
        >
          <PhoneOff className="size-5" aria-hidden />
        </button>
      </div>
    </motion.section>
  ) : surface === "full" ? (
    <motion.section
      key="full-voice-call"
      initial={reducedMotion ? false : { opacity: 0, scale: 1.015 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
      transition={{ duration: reducedMotion ? 0.01 : 0.2, ease: "easeOut" }}
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgba(99,76,48,0.46),rgba(18,16,14,0.97)_58%)] px-5 py-8 text-[#fffaf1]"
      role="dialog"
      aria-modal="true"
      aria-label="与智能教师的语音通话"
    >
      <button
        type="button"
        className={cn("absolute right-5 top-5 grid size-10 place-items-center rounded-full border border-white/15 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white", VOICE_ACTION_CLASS)}
        onClick={() => void endCall()}
        aria-label="关闭语音通话"
      >
        <X className="size-5" aria-hidden />
      </button>

      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <p className="text-xs font-medium tracking-[0.28em] text-white/55">学枢 · 智能教师</p>
        <div className="relative mt-12 grid size-44 place-items-center">
          <span
            className={cn(
              "absolute inset-0 rounded-full border border-[#d6b47d]/35 bg-[#b88248]/10",
              voice.active && "animate-ping",
            )}
            style={{ animationDuration: "2.4s" }}
            aria-hidden
          />
          <span
            className={cn(
              "absolute inset-4 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f4d6a1,#9b6536_48%,#3f2b1d)] shadow-[0_0_80px_rgba(203,153,92,0.38)]",
              voice.phase === "thinking" && "animate-pulse",
            )}
            aria-hidden
          />
          <Icon
            className={cn(
              "relative size-12 text-[#fff8e9]",
              voice.phase === "connecting" && "animate-spin",
            )}
            strokeWidth={1.35}
            aria-hidden
          />
        </div>

        <h2 className="mt-9 font-display text-3xl font-semibold">{PHASE_LABEL[voice.phase]}</h2>
        <p className={cn(
          "mt-3 min-h-12 max-w-lg text-sm leading-6",
          voice.phase === "error" ? "text-[#ffb4a7]" : "text-white/62",
        )}>
          {voice.phase === "error"
            ? detail
            : voice.partialTranscript || voice.feedback || "直接说出你的问题，我会结合当前课程和学习路径回答。"}
        </p>

        <div className="mt-7 flex h-10 items-center justify-center gap-1.5" aria-hidden>
          {[18, 30, 42, 26, 48, 34, 20].map((height, index) => (
            <span
              key={`${height}:${index}`}
              className={cn(
                "w-1.5 rounded-full bg-[#edcf9c]/80 transition-all",
                voice.active ? "animate-pulse" : "opacity-35",
              )}
              style={{
                height,
                animationDelay: `${index * 90}ms`,
                animationDuration: "900ms",
              }}
            />
          ))}
        </div>

        <div className="mt-12 flex items-center gap-4">
          <button
            type="button"
            className={cn("grid size-12 place-items-center rounded-full border border-white/15 bg-white/8 text-white/80 hover:bg-white/14 hover:text-white", VOICE_ACTION_CLASS)}
            onClick={() => setSurface("mini")}
            aria-label="将语音通话缩小为悬浮窗"
            title="缩小通话窗口"
          >
            <Minimize2 className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            className={cn("grid size-14 place-items-center rounded-full bg-[#b9483d] text-white shadow-[0_12px_34px_rgba(185,72,61,0.34)] hover:bg-[#ca5548]", VOICE_ACTION_CLASS)}
            onClick={() => void endCall()}
            aria-label="结束语音通话"
            title="结束通话"
          >
            <PhoneOff className="size-6" aria-hidden />
          </button>
        </div>
        <p className="mt-7 text-[11px] text-white/38">按 Esc 可缩小通话窗口</p>
      </div>
    </motion.section>
  ) : surface === "mini" ? (
    <motion.section
      key="mini-voice-call"
      initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
      transition={{ duration: reducedMotion ? 0.01 : 0.18, ease: "easeOut" }}
      className="fixed bottom-5 right-5 z-[100] flex w-[min(330px,calc(100vw-32px))] items-center gap-3 rounded-2xl border border-[#5c4630] bg-[#211b16] p-3 text-[#fffaf1] shadow-[0_20px_52px_rgba(22,16,11,0.42)]"
      role="dialog"
      aria-label="语音通话悬浮窗"
    >
      <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e4bd83,#85562f_58%,#3c291c)]">
        <Icon className={cn("size-5", voice.phase === "connecting" && "animate-spin")} aria-hidden />
        {voice.active && <span className="absolute inset-0 animate-ping rounded-full border border-[#d9b178]/50" />}
      </span>
      <button
        type="button"
        className={cn("min-w-0 flex-1 text-left", VOICE_ACTION_CLASS)}
        onClick={() => setSurface("full")}
        aria-label="恢复语音通话全屏"
      >
        <strong className="block truncate text-sm">{PHASE_LABEL[voice.phase]}</strong>
        <span className={cn(
          "mt-0.5 block truncate text-[10px]",
          voice.phase === "error" ? "text-[#ffb4a7]" : "text-white/50",
        )}>
          {detail}
        </span>
      </button>
      <button
        type="button"
        className={cn("grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white", VOICE_ACTION_CLASS)}
        onClick={() => setSurface("full")}
        aria-label="恢复语音通话全屏"
        title="展开"
      >
        <Maximize2 className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-[#a9473a] text-white hover:bg-[#bc5144]", VOICE_ACTION_CLASS)}
        onClick={() => void endCall()}
        aria-label="结束语音通话"
        title="结束通话"
      >
        <PhoneOff className="size-4" aria-hidden />
      </button>
    </motion.section>
  ) : null;

  return (
    <>
      <div className={cn("flex min-w-0 items-center gap-1.5", className)} role="status" aria-live="polite">
        {showDetail && (
          <span
            className={cn(
              "max-w-48 truncate text-[10px]",
              voice.phase === "error" ? "text-destructive" : "text-muted-foreground",
            )}
            title={detail}
          >
            {detail}
          </span>
        )}
        <button
          type="button"
          onClick={openCall}
          disabled={!enabled && !voice.active}
          aria-label={voice.active
            ? "打开与智能教师的语音通话界面"
            : voice.phase === "error"
              ? `语音通话不可用：${detail}；点击重试`
              : "开始与智能教师的语音通话"}
          title={voice.active ? `${detail} · 点击打开通话界面` : inactiveTitle}
          className={cn(
            "relative grid size-8 shrink-0 transform-gpu place-items-center rounded-full border transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none disabled:active:scale-100",
            voice.active
              ? "border-[#b75b4b] bg-[#a9473a] text-white shadow-[0_0_0_3px_rgba(169,71,58,0.12)]"
              : voice.phase === "error"
                ? "border-destructive/45 bg-destructive/5 text-destructive hover:bg-destructive/10"
                : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted",
            !enabled && "cursor-not-allowed opacity-45",
          )}
        >
          <Icon className={cn("size-4", voice.phase === "connecting" && "animate-spin")} />
          {voice.phase === "user_speaking" && <span className="absolute inset-0 animate-ping rounded-full border border-[#c97665]" />}
        </button>
      </div>
      {mounted
        ? surfaceMode === "inline"
          ? <AnimatePresence initial={false}>{voiceSurface}</AnimatePresence>
          : createPortal(<AnimatePresence initial={false}>{voiceSurface}</AnimatePresence>, document.body)
        : null}
    </>
  );
}
