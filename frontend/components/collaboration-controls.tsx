"use client";

import { useEffect, useId, useRef, useSyncExternalStore, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { COLLABORATION_OPTIONS, DEFAULT_COLLABORATION, readCollaboration, writeCollaboration, type CollaborationOptions } from "@/lib/collaboration";

function subscribe(listener: () => void) {
  window.addEventListener("sl-collaboration-change", listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener("sl-collaboration-change", listener); window.removeEventListener("storage", listener); };
}
const serverSnapshot = () => JSON.stringify(DEFAULT_COLLABORATION);
const snapshot = () => JSON.stringify(readCollaboration());

export function CollaborationControls({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const value = JSON.parse(useSyncExternalStore(subscribe, snapshot, serverSnapshot)) as CollaborationOptions;
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!compact || !expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [compact, expanded]);
  const reduceMotion = useReducedMotion();
  const transition = { duration: reduceMotion ? 0 : 0.18 };
  const selectClass = "min-w-0 rounded-md border border-[#cec3b0] bg-[#fffcf6] px-2 py-1.5 text-[#354c40] transition-[border-color,box-shadow,background-color] duration-150 hover:border-[#738c79] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#738c79]/40 disabled:cursor-wait motion-reduce:transition-none";
  const update = (next: CollaborationOptions) => {
    try { writeCollaboration(next); setError(""); } catch { setError("浏览器未能保存设置，请检查存储空间后重试。"); }
  };
  const chosen = COLLABORATION_OPTIONS.find(o => o.value === value.effort)!;
  return <fieldset ref={rootRef} disabled={disabled} className={compact ? "relative mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs disabled:opacity-60" : "mb-3 min-w-0 rounded-xl border border-[#d8c9b2] bg-[#f5efe4]/75 px-3 py-2 text-xs disabled:opacity-60"} onKeyDown={event => {
    if (event.key === "Escape" && expanded) {
      event.stopPropagation();
      setExpanded(false);
      toggleRef.current?.focus();
    }
  }}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="flex items-center gap-2 font-medium text-[#375749]">{compact ? "协作模式" : "协作强度"}
        <motion.select aria-label={compact ? "协作模式" : "协作强度"} title={chosen.detail} value={value.effort} onChange={e => update({ ...value, effort: e.target.value as CollaborationOptions["effort"] })} whileTap={disabled || reduceMotion ? undefined : { scale: 0.97 }} transition={transition} className={selectClass}>
          {COLLABORATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </motion.select>
      </label>
      {!compact && <span className="text-[#776b58]">{value.sources.web ? "允许联网补充" : "联网补充已关闭"}</span>}
    </div>
    {!compact && <motion.p key={value.effort} initial={reduceMotion ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-2 leading-5 text-[#776b58]">{chosen.detail}</motion.p>}
    <div className={compact ? "contents" : "mt-1"}>
      <motion.button ref={toggleRef} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} whileHover={disabled || reduceMotion ? undefined : { x: 2 }} whileTap={disabled || reduceMotion ? undefined : { scale: 0.97 }} transition={transition} className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-[#496454] transition-colors hover:bg-[#e4e9df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#738c79]/50 disabled:cursor-wait motion-reduce:transition-none">
        <motion.span aria-hidden="true" animate={{ rotate: expanded ? 180 : 0 }} transition={transition}><ChevronDown size={14} /></motion.span>
        {compact ? `资料来源${value.sources.web ? " · 联网" : ""}` : "资料来源与安排"}
      </motion.button>
      <AnimatePresence initial={false}>
      {expanded && <motion.div id={panelId} initial={compact ? { opacity: 0, y: reduceMotion ? 0 : 6 } : { height: 0, opacity: 0 }} animate={compact ? { opacity: 1, y: 0 } : { height: "auto", opacity: 1 }} exit={compact ? { opacity: 0, y: reduceMotion ? 0 : 6 } : { height: 0, opacity: 0 }} transition={transition} className={compact ? "absolute inset-x-0 bottom-full z-30 mb-2 max-h-[min(300px,45dvh)] overflow-y-auto rounded-xl border border-[#d8c9b2] bg-[#fffcf6] p-3 shadow-lg" : "overflow-hidden"}>
      {compact && <p className="leading-5 text-[#776b58]">{chosen.label}：{chosen.detail}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {([ ["course", "课程知识库"], ["personal", "我的资料"], ["web", "联网补充"] ] as const).map(([key, label]) =>
          <motion.label key={key} animate={{ backgroundColor: value.sources[key] ? "#e4ebdf" : "#fffcf6", borderColor: value.sources[key] ? "#a2b398" : "#ded4c5" }} whileHover={disabled || reduceMotion ? undefined : { y: -1 }} whileTap={disabled || reduceMotion ? undefined : { scale: 0.97 }} transition={transition} className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[#375749] focus-within:ring-2 focus-within:ring-[#738c79]/40"><input type="checkbox" checked={value.sources[key]} onChange={e => update({ ...value, sources: { ...value.sources, [key]: e.target.checked } })} className="accent-[#496454]" />{label}</motion.label>)}
      </div>
      <p className="mt-2 leading-5 text-[#776b58]">本次上传的附件也会作为依据。仅根据附件生成时，可关闭课程库、我的资料和联网补充。</p>
      <label className="mt-2 flex items-center gap-2">任务安排
        <motion.select aria-label="任务安排" value={value.preference} onChange={e => update({ ...value, preference: e.target.value as CollaborationOptions["preference"] })} whileTap={disabled || reduceMotion ? undefined : { scale: 0.97 }} transition={transition} className={selectClass}>
          <option value="auto">自动安排</option><option value="parallel">优先并行</option><option value="staged">优先分阶段</option>
        </motion.select>
      </label>
      </motion.div>}
      </AnimatePresence>
    </div>
    {error && <p role="alert" className="mt-2 w-full text-red-700">{error}</p>}
  </fieldset>;
}
