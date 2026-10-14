"use client";

import { useEffect, useRef } from "react";
import { Check, ClipboardCheck, X } from "lucide-react";
import { QUESTION_TYPES, summarizeExamComposition, type ExamComposition } from "@/lib/course-assessment";
import styles from "./desktop-course-assessment.module.css";

export function AssessmentTypeDialog({ open, composition, onChange, onClose, onGenerate }: {
  open: boolean;
  composition: ExamComposition;
  onChange: (value: ExamComposition) => void;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = summarizeExamComposition(composition);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);

  return <dialog ref={dialog} className={styles.typeDialog} aria-labelledby="question-types-title" onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.typeDialogInner}>
      <header><div><span className={styles.eyebrow}>PAPER COMPOSITION</span><h2 id="question-types-title">这次想考哪些题型？</h2><p>自由搭配题型与题量，AI 将按您的选择和课程范围出卷。</p></div><button type="button" aria-label="关闭题型选择" onClick={onClose}><X /></button></header>
      <div className={styles.typeGrid}>
        {QUESTION_TYPES.map((item) => {
          const count = composition[item.type] || 0;
          return <div key={item.type} className={styles.typeCard} data-selected={count > 0}>
            <label><input type="checkbox" checked={count > 0} onChange={(event) => onChange({ ...composition, [item.type]: event.target.checked ? 1 : 0 })} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{count > 0 ? <Check aria-hidden /> : null}</label>
            <div><small>每题 {item.score} 分</small><label><span className="sr-only">{item.label}数量</span><input type="number" min={0} max={10} step={1} value={count} onChange={(event) => onChange({ ...composition, [item.type]: Math.min(10, Math.max(0, Math.floor(Number(event.target.value) || 0))) })} /><span>题</span></label></div>
          </div>;
        })}
      </div>
      <footer><div aria-live="polite"><strong>共 {summary.count} 题 · {summary.score} 分</strong><small>{summary.count > 30 ? "每份试卷最多 30 题，请减少题量" : summary.count === 0 ? "请至少选择一种题型" : `预计 ${summary.minutes} 分钟 · 成绩按百分制折算`}</small></div><button type="button" className={styles.examPrimary} disabled={summary.count === 0 || summary.count > 30} onClick={onGenerate}><ClipboardCheck aria-hidden />确认题型并组卷</button></footer>
    </div>
  </dialog>;
}
