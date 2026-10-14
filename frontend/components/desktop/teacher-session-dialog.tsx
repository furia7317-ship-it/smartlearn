"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, PencilLine, Trash2, X } from "lucide-react";
import styles from "./teacher-workspace.module.css";

export type TeacherSessionAction = { kind: "clear" } | { kind: "delete" | "rename"; id: string; title: string };

export function TeacherSessionDialog({ action, onClose, onConfirm }: {
  action: TeacherSessionAction | null;
  onClose: () => void;
  onConfirm: (action: TeacherSessionAction, value: string) => void | Promise<void>;
}) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!action) return;
    setValue(action.kind === "rename" ? action.title : "");
    setError("");
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("input, [data-cancel]")?.focus());
    return () => { cancelAnimationFrame(frame); previous?.focus(); };
  }, [action]);
  useEffect(() => {
    if (!action) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) close.current(); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [action, busy]);
  if (typeof document === "undefined") return null;
  return createPortal(<AnimatePresence>{action && <motion.div className={styles.dialogBackdrop}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}
    onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <motion.div ref={panel} role={action.kind === "rename" ? "dialog" : "alertdialog"} aria-modal="true"
      aria-labelledby="teacher-action-title" aria-describedby="teacher-action-description" className={styles.dialog}
      initial={reduced ? false : { opacity: 0, scale: .9, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: .96, y: 8 }} transition={{ duration: reduced ? 0 : .28, ease: [.22, 1, .36, 1] }}>
      <button className={styles.dialogClose} onClick={onClose} disabled={busy} aria-label="关闭会话提示"><X size={18} /></button>
      <div className={styles.dialogIcon}>{action.kind === "rename" ? <PencilLine size={25} /> : <Trash2 size={25} />}</div>
      <small className={styles.eyebrow}>会话管理</small>
      <h2 id="teacher-action-title">{action.kind === "clear" ? "清除本账号全部会话？" : action.kind === "delete" ? "删除这段会话？" : "给会话起个名字"}</h2>
      <p id="teacher-action-description">{action.kind === "clear" ? "将删除本账号的所有历史会话及消息，包括资料问答。清除后无法恢复，已生成的学习资料、学习路径与画像会保留。" : action.kind === "delete" ? `“${action.title}”中的消息将一并删除，删除后无法恢复。` : "用一个容易辨认的名字，方便下次继续学习。"}</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); if (busy || (action.kind === "rename" && !value.trim())) return;
        setBusy(true); setError("");
        try { await onConfirm(action, value); onClose(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成，请重试"); }
        finally { setBusy(false); }
      }}>
        {action.kind === "rename" && <input aria-label="会话名称" value={value} onChange={(event) => setValue(event.target.value)} maxLength={40} disabled={busy} />}
        {error && <p className={styles.dialogError} role="alert">{error}</p>}
        <div className={styles.dialogActions}>
          <button type="button" data-cancel onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className={styles.confirmButton} disabled={busy || (action.kind === "rename" && !value.trim())}>
            {busy && <Loader2 size={16} className="animate-spin" />}{busy ? "正在处理…" : action.kind === "clear" ? "清除全部会话" : action.kind === "delete" ? "确认删除" : "保存名称"}
          </button>
        </div>
      </form>
    </motion.div>
  </motion.div>}</AnimatePresence>, document.body);
}
