"use client";

import { useMemo, useState } from "react";
import { GitBranch, Link2, Trash2, X } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import type { SubjectLearningPath } from "@/lib/master-learning-path";
import type { ResourceItem } from "@/lib/types";

interface AttachmentTarget {
  key: string;
  label: string;
}

function targetsForSubject(subject: SubjectLearningPath | undefined): AttachmentTarget[] {
  if (!subject) return [];
  return subject.path.flatMap((step) =>
    (step.steps ?? []).flatMap((task) => {
      if (!task.completion_key) return [];
      return [{
        key: task.completion_key,
        label: `${step.day} · ${task.title}`,
      }];
    }),
  );
}

function ResourcePathAttachmentForm({
  item,
  onClose,
  onAttached,
}: {
  item: ResourceItem;
  onClose: () => void;
  onAttached?: (message: string) => void;
}) {
  const {
    attachResourceToPath,
    detachResourceFromPath,
    resourcePathAttachments,
    subjectPaths,
  } = useOrchestratorContext((state) => ({
    attachResourceToPath: state.attachResourceToPath,
    detachResourceFromPath: state.detachResourceFromPath,
    resourcePathAttachments: state.resourcePathAttachments,
    subjectPaths: state.subjectPaths,
  }));
  const current = resourcePathAttachments[item.id];
  const availableSubjects = useMemo(
    () => subjectPaths.filter((subject) => targetsForSubject(subject).length > 0),
    [subjectPaths],
  );
  const initialSubjectId = availableSubjects.some((subject) => subject.id === current?.subjectId)
    ? current.subjectId
    : availableSubjects[0]?.id ?? "";
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const selectedSubject = availableSubjects.find((subject) => subject.id === subjectId);
  const targets = targetsForSubject(selectedSubject);
  const initialTaskKey = current?.subjectId === initialSubjectId
    && targets.some((target) => target.key === current.taskKey)
    ? current.taskKey
    : targets[0]?.key ?? "";
  const [taskKey, setTaskKey] = useState(initialTaskKey);
  const [error, setError] = useState("");
  const currentSubject = subjectPaths.find((subject) => subject.id === current?.subjectId);
  const currentTarget = targetsForSubject(currentSubject).find((target) => target.key === current?.taskKey);

  const selectSubject = (nextSubjectId: string) => {
    setSubjectId(nextSubjectId);
    const subject = availableSubjects.find((entry) => entry.id === nextSubjectId);
    setTaskKey(targetsForSubject(subject)[0]?.key ?? "");
    setError("");
  };

  const save = () => {
    if (!selectedSubject || !taskKey) return;
    try {
      attachResourceToPath(item, selectedSubject.id, taskKey);
      const target = targets.find((entry) => entry.key === taskKey);
      onAttached?.(`已挂载到「${selectedSubject.title}」${target ? ` · ${target.label}` : ""}`);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "挂载失败，请重新选择");
    }
  };

  const detach = () => {
    detachResourceFromPath(item.id);
    onAttached?.(`已将「${item.title}」从学习路径移除`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`挂载${item.title}到学习路径`}
      onClick={onClose}
    >
      <section
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[#d5c2a4] bg-[#fffaf2] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[#dfcfb8] px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-[#3a2a18] text-[#fffaf1]">
            <GitBranch className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm">挂载到学习路径</strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.title}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭资料挂载"
            className="grid size-8 place-items-center rounded-lg hover:bg-black/5"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            资料只会增加到所选任务的引用列表，不会复制内容，也不会重新生成资料。重新编排学习时间后，资料仍跟随该任务。
          </p>

          {current && (
            <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.07] px-3 py-2.5 text-xs">
              <Link2 className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>
                <span className="block font-medium text-foreground">当前挂载位置</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {currentSubject?.title ?? "原科目路径已不存在"}
                  {currentTarget ? ` · ${currentTarget.label}` : ""}
                </span>
              </span>
            </div>
          )}

          {availableSubjects.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-[#62513c]">
                科目学习路径
                <select
                  value={subjectId}
                  onChange={(event) => selectSubject(event.target.value)}
                  className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35"
                >
                  {availableSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>{subject.title}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-[#62513c]">
                挂载位置
                <select
                  value={taskKey}
                  onChange={(event) => setTaskKey(event.target.value)}
                  className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35"
                >
                  {targets.map((target) => (
                    <option key={target.key} value={target.key}>{target.label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
              还没有可挂载的科目学习路径。请先生成至少一条包含学习任务的科目路径。
            </div>
          )}

          {error && <p role="alert" className="text-xs text-danger">{error}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#dfcfb8] pt-4">
            {current && (
              <Button variant="ghost" onClick={detach} className="mr-auto gap-1.5 text-danger hover:text-danger">
                <Trash2 className="size-3.5" />移除挂载
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={!selectedSubject || !taskKey} className="gap-1.5">
              <Link2 className="size-3.5" />{current ? "更新挂载位置" : "确认挂载"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ResourcePathAttachmentDialog({
  item,
  onClose,
  onAttached,
}: {
  item: ResourceItem | null;
  onClose: () => void;
  onAttached?: (message: string) => void;
}) {
  if (!item) return null;
  return (
    <ResourcePathAttachmentForm
      key={`${item.id}:${item.version}`}
      item={item}
      onClose={onClose}
      onAttached={onAttached}
    />
  );
}
