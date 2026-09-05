"use client";

import { useState } from "react";
import {
  CalendarClock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { LearningBaselineGate } from "@/components/learning-baseline-gate";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import { localDateKey } from "@/lib/path-schedule-clock";
import type { SubjectLearningPath } from "@/lib/master-learning-path";
import { cn } from "@/lib/utils";

function subjectStatus(subject: SubjectLearningPath): string {
  if (subject.status === "active") return "已启用";
  if (subject.status === "scheduled") return `${subject.activationDate ?? "待定"} 启用`;
  if (subject.status === "paused") return "已暂停";
  if (subject.status === "completed") return "已完成";
  return "待启用";
}

function DialogFrame({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <section
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`关闭${title}`}
            className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}

function NewSubjectDialog({
  disabled,
  onClose,
  onSubmit,
}: {
  disabled: boolean;
  onClose: () => void;
  onSubmit: (request: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [deadline, setDeadline] = useState("");
  const inputClass = "mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  const submit = () => {
    if (!topic.trim() || !goal.trim() || disabled) return;
    onSubmit([
      "请为我生成一条独立的科目学习路径。生成后保持待启用，由我决定何时加入总学习路径。",
      `学习主题：${topic.trim()}`,
      `学习目标：${goal.trim()}`,
      context.trim() ? `当前情况或卡点：${context.trim()}` : "",
      deadline ? `希望完成日期：${deadline}` : "",
    ].filter(Boolean).join("\n"));
    onClose();
  };

  return (
    <DialogFrame
      title="生成科目学习路径"
      description="每个科目只保留一条路径；生成后先待启用，不会立即占用总路径时间。"
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium">
          学习主题 <span className="text-danger">*</span>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="如：数据结构" className={inputClass} />
        </label>
        <label className="text-xs font-medium">
          学习目标 <span className="text-danger">*</span>
          <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="如：掌握线性表与树" className={inputClass} />
        </label>
        <label className="text-xs font-medium">
          当前情况或卡点
          <textarea value={context} onChange={(event) => setContext(event.target.value)} rows={3} className={`${inputClass} resize-none`} />
        </label>
        <label className="text-xs font-medium">
          希望完成日期
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={disabled || !topic.trim() || !goal.trim()} className="gap-1.5">
          <Sparkles className="size-4" />继续确认并生成
        </Button>
      </div>
    </DialogFrame>
  );
}

function ActivationDialog({
  subject,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath;
  onClose: () => void;
  onConfirm: (id: string, date: string) => void;
}) {
  const today = localDateKey();
  const [date, setDate] = useState(subject.activationDate || today);
  return (
    <DialogFrame
      title="设置启用时间"
      description={`启用后，「${subject.title}」会交给总学习路径统一排程。`}
      onClose={onClose}
    >
      <label className="text-xs font-medium">
        启用日期
        <input
          type="date"
          min={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        选择今天会立即启用；选择未来日期会在当天自动加入总路径。
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={() => { onConfirm(subject.id, date); onClose(); }} disabled={!date}>
          {date > today ? "确认定时启用" : "立即启用"}
        </Button>
      </div>
    </DialogFrame>
  );
}

function ReplanDialog({
  subject,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath;
  onClose: () => void;
  onConfirm: (id: string, minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(subject.dailyMinutes);
  const bounded = Math.max(10, Math.min(240, Math.round(minutes || 0)));
  return (
    <DialogFrame
      title="重新编排学习时间"
      description="只调整现有任务的日期分布，不重新生成资源，也不会清除完成记录。"
      onClose={onClose}
    >
      <label className="text-xs font-medium">
        每天用于该科目的时间
        <span className="mt-1.5 flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={240}
            step={5}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <span className="text-muted-foreground">分钟</span>
        </span>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={() => { onConfirm(subject.id, bounded); onClose(); }} disabled={minutes < 10 || minutes > 240}>
          确认重新编排
        </Button>
      </div>
    </DialogFrame>
  );
}

function SupplementDialog({
  subject,
  disabled,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath;
  disabled: boolean;
  onClose: () => void;
  onConfirm: (id: string, title: string, detail: string) => void;
}) {
  const [detail, setDetail] = useState("");
  return (
    <DialogFrame
      title="补充科目学习路径"
      description={`新增内容会追加到「${subject.title}」，不会创建第二条科目路径。`}
      onClose={onClose}
    >
      <label className="text-xs font-medium">
        需要补充的内容
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          rows={5}
          placeholder="如：补充链表反转、双指针方法和两道练习"
          className="mt-1.5 w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        原有资料继续复用，只为新增知识点生成必要内容。
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button
          disabled={disabled || detail.trim().length < 4}
          onClick={() => { onConfirm(subject.id, subject.title, detail); onClose(); }}
        >
          确认补充
        </Button>
      </div>
    </DialogFrame>
  );
}

export function WebSubjectPathManager() {
  const session = useOrchestratorContext((state) => ({
    deleteSubjectPath: state.deleteSubjectPath,
    subjectPaths: state.subjectPaths,
    pauseSubjectPath: state.pauseSubjectPath,
    resumeSubjectPath: state.resumeSubjectPath,
    masterLearningPath: state.masterLearningPath,
    running: state.running,
    mode: state.mode,
    requestLearningPath: state.requestLearningPath,
    activateSubjectPath: state.activateSubjectPath,
    replanSubjectPath: state.replanSubjectPath,
    requestSubjectPathSupplement: state.requestSubjectPathSupplement,
    pendingLearningPath: state.pendingLearningPath,
    continueLearningPath: state.continueLearningPath,
    cancelLearningPath: state.cancelLearningPath,
    retryLearningPath: state.retryLearningPath,
    editLearningPath: state.editLearningPath,
    openLearningPathKnowledgeBase: state.openLearningPathKnowledgeBase,
    recordLearningPathClarification: state.recordLearningPathClarification,
  }));
  const [newPathOpen, setNewPathOpen] = useState(false);
  const [activation, setActivation] = useState<SubjectLearningPath | null>(null);
  const [replan, setReplan] = useState<SubjectLearningPath | null>(null);
  const [supplement, setSupplement] = useState<SubjectLearningPath | null>(null);

  const remove = (subject: SubjectLearningPath) => {
    if (!window.confirm(`删除「${subject.title}」学习路径？已生成资料仍会保留在资源中心。`)) return;
    session.deleteSubjectPath(subject.id);
  };

  return (
    <>
      <section aria-label="科目学习路径" className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">科目学习路径</h2>
            <p className="mt-1 text-xs text-muted-foreground">启用后由总学习路径统一安排</p>
          </div>
          <Button size="sm" onClick={() => setNewPathOpen(true)} className="h-8 gap-1.5">
            <Plus className="size-3.5" />生成科目路径
          </Button>
        </div>

        {session.subjectPaths.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            还没有科目路径。生成后可单独设置启用日期。
          </p>
        ) : session.subjectPaths.map((subject) => (
          <article key={subject.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{subject.title}</h3>
                  <span className={cn(
                    "rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground",
                    (subject.status === "active" || subject.status === "completed") && "bg-success/10 text-success",
                  )}>
                    {subjectStatus(subject)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${subject.progress}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                  <span>{subject.path.length} 天 · 每日 {subject.dailyMinutes} 分钟</span>
                  <span>{subject.progress}%</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(subject)}
                aria-label={`删除${subject.title}学习路径`}
                title="删除学习路径"
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-1.5 border-t pt-2">
              <button type="button" onClick={() => setSupplement(subject)} className="rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent">补充</button>
              <button type="button" onClick={() => setReplan(subject)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"><CalendarClock className="size-3" />重新编排</button>
              {(subject.status === "ready" || subject.status === "scheduled") && (
                <button type="button" onClick={() => setActivation(subject)} className="rounded-md border px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent">
                  {subject.status === "scheduled" ? "修改启用时间" : "设置启用时间"}
                </button>
              )}
              {subject.status === "active" && (
                <button type="button" onClick={() => session.pauseSubjectPath(subject.id)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"><Pause className="size-3" />暂停</button>
              )}
              {subject.status === "paused" && (
                <button type="button" onClick={() => session.resumeSubjectPath(subject.id)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent"><RotateCcw className="size-3" />重新启用</button>
              )}
            </div>
          </article>
        ))}

        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-surface-2/35 p-3 text-xs">
          <span><span className="block text-muted-foreground">已启用</span><strong className="mt-1 block">{session.masterLearningPath.activeSubjects.length} 个科目</strong></span>
          <span><span className="block text-muted-foreground">待加入统筹</span><strong className="mt-1 block">{session.masterLearningPath.readySubjects.length + session.masterLearningPath.scheduledSubjects.length} 个科目</strong></span>
        </div>
      </section>

      {newPathOpen && <NewSubjectDialog disabled={session.running || session.mode !== "live"} onClose={() => setNewPathOpen(false)} onSubmit={session.requestLearningPath} />}
      {activation && <ActivationDialog subject={activation} onClose={() => setActivation(null)} onConfirm={session.activateSubjectPath} />}
      {replan && <ReplanDialog subject={replan} onClose={() => setReplan(null)} onConfirm={session.replanSubjectPath} />}
      {supplement && <SupplementDialog subject={supplement} disabled={session.running || session.mode !== "live"} onClose={() => setSupplement(null)} onConfirm={session.requestSubjectPathSupplement} />}
      {session.pendingLearningPath?.request && (session.pendingLearningPath.stage === "confirming" || Boolean(session.pendingLearningPath.error)) && (
        <LearningBaselineGate
          request={session.pendingLearningPath.request}
          onChoose={session.continueLearningPath}
          onCancel={session.cancelLearningPath}
          planningError={session.pendingLearningPath.error ?? null}
          onRetryPlan={session.retryLearningPath}
          onEditPlan={session.editLearningPath}
          onOpenKnowledgeBase={session.openLearningPathKnowledgeBase}
          planning={session.pendingLearningPath.stage === "planning"}
          initialConfirmation={session.pendingLearningPath.confirmation}
          onClarification={session.recordLearningPathClarification}
        />
      )}
      {session.pendingLearningPath?.stage === "planning" && !session.pendingLearningPath.error && (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg" role="status">
          <Play className="size-3.5 animate-pulse text-primary" />正在生成科目学习路径
        </div>
      )}
    </>
  );
}
