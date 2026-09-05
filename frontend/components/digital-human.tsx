"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Pause, Play, UserRound } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import {
  getAvatarConfig,
  loadAvatarSdk,
  type AvatarConfig,
  type AvatarPlatform,
} from "@/lib/avatar";
import { toSpeakableText } from "@/lib/speech-text";
import { cn } from "@/lib/utils";

type AvatarState = "idle" | "connecting" | "ready" | "error";

/**
 * 数字人讲解。
 *
 * - **安全默认**：后端不向渲染进程下发长期供应商凭据，只提供短期签名
 *   WebSocket URL；数字人不可用时回退 `speechSynthesis` 朗读。
 *
 * studio 接线不变：仍只接收 `answer`。
 */
export function DigitalHuman({ answer }: { answer: string }) {
  const { mode } = useOrchestratorContext((state) => ({
    mode: state.mode,
  }));
  const [speaking, setSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [cfg, setCfg] = useState<AvatarConfig | null>(null);
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [errMsg, setErrMsg] = useState("");

  const platformRef = useRef<AvatarPlatform | null>(null);
  const startedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackTimer = useRef<number | undefined>(undefined);

  const rawText = (answer || "").trim();
  const text = toSpeakableText(rawText);
  // 用数字人 UI（配置就绪且未连接失败）；否则用语音兜底的占位形象
  const useAvatarUi = !!cfg && avatarState !== "error";

  useEffect(() => {
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

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

  /* ── 浏览器 TTS 兜底 ── */
  const ttsStop = useCallback(() => {
    window.clearTimeout(fallbackTimer.current);
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* 忽略 */
    }
  }, []);

  const ttsSpeak = useCallback(
    (t: string) => {
      ttsStop();
      setSpeaking(true);
      const estMs = Math.min(90000, Math.max(2500, t.length * 130));
      fallbackTimer.current = window.setTimeout(() => setSpeaking(false), estMs);
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const u = new SpeechSynthesisUtterance(t);
        const voices = synth.getVoices?.() ?? [];
        const v =
          voices.find((x) => /zh[-_]?cn/i.test(x.lang)) ||
          voices.find((x) => /^zh/i.test(x.lang)) ||
          voices[0];
        if (v) u.voice = v;
        u.lang = v?.lang || "zh-CN";
        u.onend = () => {
          window.clearTimeout(fallbackTimer.current);
          setSpeaking(false);
        };
        synth.cancel();
        synth.speak(u);
      } catch {
        /* 出错由兜底计时器收尾 */
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
    ttsSpeak(text);
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
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* 忽略 */
      }
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
    ? mode === "live"
      ? "讯飞数字人未配置 · 用语音讲解"
      : "演示语音 · 数字人需连后端"
    : avatarState === "connecting"
      ? "讯飞数字人连接中…"
      : avatarState === "ready"
        ? "讯飞 2D 数字人 · 已连接"
        : avatarState === "error"
          ? "数字人连接失败 · 已用语音兜底"
          : "讯飞 2D 数字人 · 待讲解";

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
          onClick={speaking ? stop : speak}
          disabled={!text || avatarState === "connecting"}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
            !text || avatarState === "connecting"
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : speaking
                ? "bg-danger/10 text-danger hover:bg-danger/15"
                : "bg-primary text-primary-foreground hover:opacity-90"
          )}
        >
          {avatarState === "connecting" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> 连接数字人…
            </>
          ) : speaking ? (
            <>
              <Pause className="size-4" /> 停止讲解
            </>
          ) : (
            <>
              <Play className="size-4" /> 讲解当前回答
            </>
          )}
        </button>
        {!ttsSupported && !cfg && (
          <p className="text-center text-[11px] text-warning">
            当前环境无语音合成；桌面端（Electron）会用系统中文语音朗读。
          </p>
        )}
      </div>
    </div>
  );
}
