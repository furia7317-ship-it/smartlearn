"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Contrast, Hand, Loader2, Pause, Play, UserRound } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import {
  getAvatarConfig,
  loadAvatarSdk,
  type AvatarConfig,
  type AvatarPlatform,
} from "@/lib/avatar";
import { toSpeakableText } from "@/lib/speech-text";
import { API_BASE } from "@/lib/api";
import { playCloudSpeech, playSpeechBlob, requestMiniMaxSpeech } from "@/lib/cloud-speech";
import { cn } from "@/lib/utils";
import teacherStyles from "./desktop/teacher-workspace.module.css";

type AvatarState = "idle" | "connecting" | "ready" | "error";

/**
 * 数字人讲解。
 *
 * - **安全默认**：后端不向渲染进程下发长期供应商凭据，只提供短期签名
 *   WebSocket URL；数字人不可用时通过后端 MiniMax 朗读。
 *
 * studio 接线不变：仍只接收 `answer`。
 */
export function DigitalHuman({ answer, variant = "studio" }: { answer: string; variant?: "studio" | "teacher" }) {
  const { mode } = useOrchestratorContext((state) => ({
    mode: state.mode,
  }));
  const [speaking, setSpeaking] = useState(false);
  const [preparingSpeech, setPreparingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [cfg, setCfg] = useState<AvatarConfig | null>(null);
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [opacity, setOpacity] = useState(100);

  const platformRef = useRef<AvatarPlatform | null>(null);
  const startedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackTimer = useRef<number | undefined>(undefined);
  const speechController = useRef<AbortController | null>(null);

  const rawText = (answer || "").trim();
  const text = toSpeakableText(rawText);
  // 用数字人 UI（配置就绪且未连接失败）；否则用语音兜底的占位形象
  const useAvatarUi = !!cfg && avatarState !== "error";

  // 后端只返回公共元数据与短期签名 URL；未配置时 cfg=null → 走 TTS。
  useEffect(() => {
    let alive = true;
    getAvatarConfig(mode)
      .then((c) => {
        if (alive) setCfg(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode]);

  /* ── MiniMax TTS；合成失败时保留错误，不静默换成系统音色 ── */
  const ttsStop = useCallback(() => {
    window.clearTimeout(fallbackTimer.current);
    speechController.current?.abort();
    speechController.current = null;
    setPreparingSpeech(false);
    setSpeaking(false);
  }, []);

  const ttsSpeak = useCallback(
    async (t: string) => {
      ttsStop();
      setSpeechError("");
      const controller = new AbortController();
      speechController.current = controller;
      try {
        await playCloudSpeech(t, controller.signal, {
          request: (part, signal) => requestMiniMaxSpeech(API_BASE, part, signal),
          play: playSpeechBlob,
          onPhase: (phase) => {
            if (speechController.current !== controller) return;
            setPreparingSpeech(phase === "loading");
            setSpeaking(phase === "playing");
          },
        });
      } catch (error) {
        if (!controller.signal.aborted && speechController.current === controller) {
          setSpeechError(error instanceof Error ? error.message : "MiniMax 语音暂时不可用，请重试");
        }
      } finally {
        controller.abort();
        if (speechController.current === controller) {
          speechController.current = null;
          setPreparingSpeech(false);
          setSpeaking(false);
        }
      }
    },
    [ttsStop]
  );

  /* ── 讯飞数字人 ── */
  const connectAvatar = useCallback(async (): Promise<boolean> => {
    if (startedRef.current && platformRef.current) return true;
    if (!cfg || !containerRef.current) return false;
    setAvatarState("connecting");
    setErrMsg("");
    try {
      // 每次真正连接前刷新签名，避免面板打开超过 5 分钟后使用过期 URL。
      const liveCfg = (await getAvatarConfig(mode)) ?? cfg;
      setCfg(liveCfg);
      const Platform = await loadAvatarSdk();
      const p = new Platform({ useInlinePlayer: true });
      p.setApiInfo({
        appId: liveCfg.appId,
        signedUrl: liveCfg.signedUrl,
        ...(liveCfg.sceneId ? { sceneId: liveCfg.sceneId } : {}),
      });
      p.setGlobalParams({
        stream: { protocol: "xrtc" },
        avatar: { avatar_id: liveCfg.avatarId, width: 720, height: 1280 },
        tts: { vcn: liveCfg.vcn },
      });
      p.on("error", (e: unknown) => {
        setErrMsg(e instanceof Error ? e.message : String(e ?? "数字人连接异常"));
      });
      // 连接超时兜底：XRTC 连不上（网络/形象ID/场景）时不卡在「连接中」，转 TTS
      await Promise.race([
        p.start({ wrapper: containerRef.current }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("连接超时（请检查网络 / 形象ID / 发音人）")), 15000)
        ),
      ]);
      platformRef.current = p;
      startedRef.current = true;
      setAvatarState("ready");
      return true;
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setAvatarState("error");
      return false;
    }
  }, [cfg, mode]);

  const speak = useCallback(async () => {
    if (!text) return;
    // 配了数字人 → 走虚拟人；失败回退 TTS
    if (cfg && avatarState !== "error") {
      const ok = await connectAvatar();
      if (ok && platformRef.current) {
        try {
          await platformRef.current.interrupt().catch(() => {});
          setSpeaking(true);
          window.clearTimeout(fallbackTimer.current);
          fallbackTimer.current = window.setTimeout(
            () => setSpeaking(false),
            Math.min(90000, Math.max(2500, text.length * 130))
          );
          await platformRef.current.writeText(text, {});
          return;
        } catch (e) {
          setErrMsg(e instanceof Error ? e.message : String(e));
          setAvatarState("error");
          // 落到 TTS 兜底
        }
      }
    }
    await ttsSpeak(text);
  }, [text, cfg, avatarState, connectAvatar, ttsSpeak]);

  const stop = useCallback(() => {
    window.clearTimeout(fallbackTimer.current);
    if (startedRef.current && platformRef.current) {
      platformRef.current.interrupt().catch(() => {});
    }
    ttsStop();
    setSpeaking(false);
  }, [ttsStop]);

  // 卸载时停止并销毁
  useEffect(() => {
    return () => {
      window.clearTimeout(fallbackTimer.current);
      speechController.current?.abort();
      speechController.current = null;
      const p = platformRef.current;
      if (p) {
        try {
          p.stop();
          p.destroy();
        } catch {
          /* 忽略 */
        }
        platformRef.current = null;
        startedRef.current = false;
      }
    };
  }, []);

  const statusLabel = !cfg
    ? "MiniMax 语音讲解"
    : avatarState === "connecting"
      ? "讯飞数字人连接中…"
      : avatarState === "ready"
        ? "讯飞 2D 数字人 · 已连接"
        : avatarState === "error"
          ? "数字人连接失败 · 已用语音兜底"
          : "讯飞 2D 数字人 · 待讲解";

  if (variant === "teacher") return <div className={teacherStyles.digitalHuman}>
    <header><h2><Bot size={22} />数字人交互</h2><span data-ready={avatarState === "ready"}>{avatarState === "connecting" ? "连接中" : avatarState === "ready" ? "已连接" : "未连接"}</span></header>
    <div className={teacherStyles.humanStage}>
      {useAvatarUi && <div ref={containerRef} className={teacherStyles.humanVideo} style={{ opacity: opacity / 100 }} />}
      {avatarState !== "ready" && <div className={teacherStyles.humanIdle}>
        {avatarState === "connecting" ? <Loader2 className="animate-spin" size={32} /> : <UserRound size={42} strokeWidth={1.1} />}
        <p>{avatarState === "connecting" ? "数字人正在连接…" : cfg ? "准备好，便开始讲解" : "让知识，有声有色"}</p>
        <small>{cfg ? "连接数字人后可播放讲解" : "数字人暂未连接，可先听语音讲解"}</small>
      </div>}
      {speaking && <span className={teacherStyles.speakingBadge}>正在讲解</span>}
      {preparingSpeech && <span className={teacherStyles.speakingBadge}>正在准备语音…</span>}
    </div>
    <label className={teacherStyles.opacityControl}><span><Contrast size={15} />透明度</span><input type="range" aria-label="数字人透明度" min="20" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} disabled={avatarState !== "ready"} /></label>
    {avatarState === "error" && <p className={teacherStyles.humanError} role="status">数字人暂时无法连接，已切换为语音讲解。</p>}
    {speechError && <p className={teacherStyles.humanError} role="alert">{speechError}</p>}
    <div className={teacherStyles.humanActions}><button onClick={() => void speak()} disabled={!text || speaking || preparingSpeech || avatarState === "connecting"}>
      {avatarState === "connecting" ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />} {cfg && avatarState !== "error" ? "启动数字人" : "朗读当前回答"}
    </button><button onClick={stop} disabled={!speaking && !preparingSpeech}><Hand size={15} />打断</button></div>
  </div>;

  return (
    <div className="flex h-full flex-col">
      {/* 形象舞台 */}
      <div className="relative grid flex-1 place-items-center overflow-hidden bg-gradient-to-b from-surface-2/40 to-background p-6">
        {useAvatarUi ? (
          <>
            <div
              ref={containerRef}
              className="grid h-full w-full place-items-center [&_canvas]:max-h-full [&_canvas]:max-w-full [&_video]:max-h-full [&_video]:max-w-full [&_video]:object-contain"
            />
            {avatarState !== "ready" && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  {avatarState === "connecting" ? (
                    <>
                      <Loader2 className="size-7 animate-spin text-primary" />
                      <span className="text-[12px]">数字人连接中…</span>
                    </>
                  ) : (
                    <>
                      <UserRound className="size-20 text-primary/70" strokeWidth={1.3} />
                      <span className="text-[12px]">点下方「讲解」，数字人将开口</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="relative grid size-44 place-items-center rounded-3xl bg-gradient-to-br from-primary/15 to-transparent ring-1 ring-border">
            <UserRound
              className={cn(
                "size-24 text-primary/80 transition-transform duration-300",
                speaking && "scale-105"
              )}
              strokeWidth={1.3}
            />
            {speaking && (
              <div className="absolute bottom-6 flex items-end gap-1">
                {[10, 18, 24, 16, 12].map((h, i) => (
                  <span
                    key={i}
                    className="w-1 animate-pulse rounded-full bg-primary"
                    style={{ height: h, animationDelay: `${i * 120}ms`, animationDuration: "600ms" }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
          {avatarState === "error" && <AlertTriangle className="size-3 text-warning" />}
          {statusLabel}
        </span>
      </div>

      {/* 控制区 */}
      <div className="shrink-0 space-y-3 border-t bg-surface-2/30 p-4">
        {avatarState === "error" && errMsg && (
          <p className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-[11px] leading-relaxed text-warning">
            数字人：{errMsg}
          </p>
        )}
        <div className="thin-scroll max-h-24 overflow-y-auto rounded-lg border bg-card/50 p-3 text-[13px] leading-relaxed text-muted-foreground">
          {rawText || "还没有可讲解的回答——先在左侧让 AI 答疑生成一段讲解，再点「讲解当前回答」。"}
        </div>
        <button
          onClick={speaking || preparingSpeech ? stop : speak}
          disabled={!text || avatarState === "connecting"}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
            !text || avatarState === "connecting"
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : speaking || preparingSpeech
                ? "bg-danger/10 text-danger hover:bg-danger/15"
                : "bg-primary text-primary-foreground hover:opacity-90"
          )}
        >
          {avatarState === "connecting" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> 连接数字人…
            </>
          ) : speaking || preparingSpeech ? (
            <>
              <Pause className="size-4" /> 停止讲解
            </>
          ) : (
            <>
              <Play className="size-4" /> 讲解当前回答
            </>
          )}
        </button>
        {speechError && <p className="text-center text-[11px] text-warning" role="alert">{speechError}</p>}
      </div>
    </div>
  );
}
