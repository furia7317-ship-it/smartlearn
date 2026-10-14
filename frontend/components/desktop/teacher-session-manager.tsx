"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, BookOpen, Check, Loader2, MessageCircle, PencilLine, Plus, Search, Trash2 } from "lucide-react";
import type { ConversationSummary } from "@/hooks/use-orchestrator";
import { filterTeacherConversations, type ConversationFilter } from "@/lib/teacher-conversations";
import type { TeacherSessionAction } from "./teacher-session-dialog";
import styles from "./teacher-session-manager.module.css";

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "general", label: "学习问答" },
  { value: "resource_qa", label: "资料问答" },
];

function updatedLabel(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : date.toLocaleDateString("zh-CN", {
      year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
      month: "numeric", day: "numeric",
    });
}

export function TeacherSessionManager({
  conversations, disabledReason, deleteDisabledReason, clearDisabledReason,
  onNew, onSelect, onAction, onClose,
}: {
  conversations: ConversationSummary[];
  disabledReason: string;
  deleteDisabledReason: string;
  clearDisabledReason: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onAction: (action: TeacherSessionAction) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const input = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const visible = filterTeacherConversations(conversations, query, filter);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  return (
    <motion.section
      id="teacher-session-manager"
      role="region"
      aria-label="会话管理"
      className={styles.panel}
      initial={reduced ? false : { opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
      transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
    >
      <div className={styles.heading}>
        <button type="button" className={styles.back} onClick={onClose} aria-label="返回当前对话" title="返回当前对话"><ArrowLeft size={17} /></button>
        <div><h3>会话管理</h3><p>共 {conversations.length} 段会话 · 随时继续学习</p></div>
        <button type="button" className={styles.create} onClick={onNew} disabled={Boolean(disabledReason)} title={disabledReason || "新建会话"}><Plus size={15} />新建</button>
      </div>
      <label className={styles.search}>
        <Search size={16} aria-hidden />
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话或资料名称" aria-label="搜索会话" />
      </label>
      <div className={styles.filters} role="group" aria-label="会话类型">
        {FILTERS.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      </div>
      <ul className={`thin-scroll ${styles.list}`} aria-label="会话列表">
        {visible.map((conversation) => (
          <li key={conversation.id} className={styles.row} data-active={conversation.active}>
            <button type="button" className={styles.select} onClick={() => onSelect(conversation.id)} disabled={Boolean(disabledReason)} aria-current={conversation.active ? "true" : undefined} title={disabledReason || conversation.title}>
              <span className={styles.icon}>{conversation.kind === "resource_qa" ? <BookOpen size={17} /> : <MessageCircle size={17} />}</span>
              <span className={styles.details}>
                <strong>{conversation.title || "新会话"}</strong>
                <span className={styles.meta}>
                  {conversation.running ? <span className={styles.running}><Loader2 size={11} className="animate-spin" />回答中</span> : conversation.active ? <span className={styles.current}><Check size={11} />当前会话</span> : <span>{conversation.kind === "resource_qa" ? "资料问答" : "学习问答"}</span>}
                  <time dateTime={Number.isFinite(conversation.updatedAt) ? new Date(conversation.updatedAt).toISOString() : undefined}>{updatedLabel(conversation.updatedAt)}</time>
                </span>
              </span>
            </button>
            <div className={styles.actions}>
              <button type="button" aria-label={`重命名会话：${conversation.title}`} title={disabledReason || "重命名"} disabled={Boolean(disabledReason)} onClick={() => onAction({ kind: "rename", id: conversation.id, title: conversation.title })}><PencilLine size={14} /></button>
              <button type="button" aria-label={`删除会话：${conversation.title}`} title={deleteDisabledReason || "删除会话"} disabled={Boolean(deleteDisabledReason)} onClick={() => onAction({ kind: "delete", id: conversation.id, title: conversation.title })}><Trash2 size={14} /></button>
            </div>
          </li>
        ))}
        {visible.length === 0 && <li className={styles.empty}><MessageCircle size={28} /><strong>{query.trim() ? "没有找到匹配的会话" : "这里还没有会话"}</strong><p>{query.trim() ? "试试其他关键词，或切换会话类型。" : "新建一段对话，开始今天的学习。"}</p></li>}
      </ul>
      <footer className={styles.footer}>
        {disabledReason && <p role="status">{disabledReason}</p>}
        {!disabledReason && conversations.some((conversation) => conversation.running) && <p>切换会话后，回答会继续进行。</p>}
        <button type="button" onClick={() => onAction({ kind: "clear" })} disabled={Boolean(clearDisabledReason)} title={clearDisabledReason || "清除本账号全部会话"}><Trash2 size={14} />清除本账号全部会话</button>
      </footer>
    </motion.section>
  );
}
