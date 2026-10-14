"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookMarked, CalendarDays, Loader2, X } from "lucide-react";
import styles from "./teacher-tool-window.module.css";

export type TeacherTool = "create" | "plan";

const loading = () => <div className={styles.loading}><Loader2 size={22} className="animate-spin" />正在打开…</div>;
const ResourceCreation = dynamic(() => import("./desktop-create"), { loading });
const LearningPlan = dynamic(() => import("./teacher-learning-plan"), { loading });

export function TeacherToolWindow({ tool, onClose, onAsk }: {
  tool: TeacherTool | null;
  onClose: () => void;
  onAsk: (question: string) => void;
}) {
  const reduced = useReducedMotion();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!tool) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>("[data-tool-close]")?.focus());
    const onKey = (event: KeyboardEvent) => {
      // Resource previews and generation options use the existing 60/80 overlay layers.
      // Their keyboard handling stays in charge while they are above this window.
      const anotherOverlay = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'))
        .some((node) => !panel.current?.contains(node) && node.getClientRects().length > 0 && Number(getComputedStyle(node).zIndex) > 55);
      if (anotherOverlay || event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary") ?? [])
        .filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [tool]);

  if (typeof document === "undefined") return null;
  return createPortal(<AnimatePresence>{tool && <motion.div className={styles.backdrop}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section ref={panel} role="dialog" aria-modal="true" aria-labelledby="teacher-tool-title" data-teacher-tool={tool}
      className={styles.panel} initial={reduced ? false : { opacity: 0, y: 20, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: .98 }} transition={{ duration: reduced ? 0 : .26, ease: [.22, 1, .36, 1] }}>
      <header className={styles.header}>
        <span className={styles.headerIcon}>{tool === "create" ? <BookMarked /> : <CalendarDays />}</span>
        <div><h2 id="teacher-tool-title">{tool === "create" ? "资源创作" : "学习计划"}</h2><p>{tool === "create" ? "准备学习资料，在这里查看生成进度与结果" : "从今日任务出发，安排自己的学习节奏"}</p></div>
        <button type="button" data-tool-close onClick={onClose} aria-label={tool === "create" ? "关闭资源创作窗口" : "关闭学习计划窗口"}><X size={21} /></button>
      </header>
      <div className={styles.body}>{tool === "create" ? <ResourceCreation embedded onTeacherRequested={onClose} /> : <LearningPlan onAsk={onAsk} onTeacherRequested={onClose} />}</div>
    </motion.section>
  </motion.div>}</AnimatePresence>, document.body);
}
