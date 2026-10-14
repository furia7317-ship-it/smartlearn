"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { WelcomeHandbook } from "./welcome-handbook";
import { DESKTOP_GUIDE_STEPS, REPLAY_GUIDE_EVENT, guideCardPosition } from "@/lib/welcome";
import styles from "./welcome.module.css";

type TargetRect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export function DesktopWelcomeGuide() {
  const { user, completeGuide } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState<number | "handbook" | null>(null);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [cardHeight, setCardHeight] = useState(330);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const offeredRef = useRef(false);
  const started = step !== null;

  useEffect(() => {
    if (user?.onboarding_completed && user.guide_completed === false && !offeredRef.current) {
      offeredRef.current = true;
      setStep(0);
    }
  }, [user]);
  useEffect(() => {
    const replay = () => { setError(""); setStep("handbook"); };
    window.addEventListener(REPLAY_GUIDE_EVENT, replay);
    return () => window.removeEventListener(REPLAY_GUIDE_EVENT, replay);
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (started && dialog && !dialog.open) dialog.showModal();
    if (!started && dialog?.open) dialog.close();
  }, [started]);

  useEffect(() => {
    if (typeof step !== "number") return;
    const selector = `[data-guide="${DESKTOP_GUIDE_STEPS[step].target}"]`;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(selector);
        const bounds = target?.getBoundingClientRect();
        const width = window.innerWidth;
        const height = window.innerHeight;
        setViewport({ width, height });
        setRect(bounds && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < height
          ? { top: Math.max(6, bounds.top - 6), left: Math.max(6, bounds.left - 6), right: Math.min(width - 6, bounds.right + 6), bottom: Math.min(height - 6, bounds.bottom + 6), width: Math.min(width - 12, bounds.width + 12), height: Math.min(height - 12, bounds.height + 12) }
          : null);
        setCardHeight(cardRef.current?.getBoundingClientRect().height ?? 330);
      });
    };
    const observer = new ResizeObserver(update);
    const target = document.querySelector<HTMLElement>(selector);
    if (target) observer.observe(target);
    if (cardRef.current) observer.observe(cardRef.current);
    update();
    // Rail and teacher positions can change with responsive layout or restored preferences.
    const settle = window.setTimeout(update, 400);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [step]);

  const finish = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (!user?.guide_completed) await completeGuide();
      setStep(null);
    } catch { setError("引导进度暂未保存，请重试。已填写的学习档案不会丢失。"); }
    finally { setSaving(false); }
  }, [completeGuide, saving, user]);
  const current = typeof step === "number" ? DESKTOP_GUIDE_STEPS[step] : null;
  const position = guideCardPosition(rect, viewport.width, viewport.height, cardHeight);

  return <dialog ref={dialogRef} className={styles.tourDialog} aria-label={step === "handbook" ? "新生入学手册" : "新用户入口引导"} onCancel={(event) => { event.preventDefault(); void finish(); }}>
    {step === "handbook" ? <div className={styles.handbookOverlay}><WelcomeHandbook returning onContinue={() => setStep(0)} onClose={() => void finish()} /></div> : current && typeof step === "number" ? <>
      {rect ? <div className={styles.spotlight} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden /> : <div className={styles.tourShade} aria-hidden />}
      <section ref={cardRef} className={styles.tourCard} style={position} aria-labelledby="desktop-guide-title" aria-describedby="desktop-guide-description">
        <div className={styles.tourTop}><span>学枢入门 · {step + 1} / {DESKTOP_GUIDE_STEPS.length}</span><button type="button" disabled={saving} onClick={() => void finish()}>跳过引导</button></div>
        <div aria-live="polite" aria-atomic="true"><h2 id="desktop-guide-title">{current.title}</h2><p id="desktop-guide-description">{current.text}</p></div>
        <div className={styles.tourProgress} aria-hidden>{DESKTOP_GUIDE_STEPS.map((item, index) => <span key={item.target} data-active={index <= step} />)}</div>
        {error && <p role="alert">{error}</p>}
        <div className={styles.tourActions}>
          {step > 0 && <button type="button" disabled={saving} className={styles.secondary} onClick={() => { setError(""); setStep(step - 1); }}>上一步</button>}
          <button type="button" disabled={saving} className={styles.primary} onClick={() => { setError(""); if (step === DESKTOP_GUIDE_STEPS.length - 1) void finish(); else setStep(step + 1); }}>{saving ? "正在保存" : step === DESKTOP_GUIDE_STEPS.length - 1 ? "开始学习" : "下一步"}</button>
        </div>
      </section>
    </> : null}
  </dialog>;
}
