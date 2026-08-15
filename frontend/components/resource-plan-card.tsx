"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Maximize2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BUILTIN_AGENT_KEY,
  builtinAgentForType,
  customAgentMonogram,
  isCustomAgentKey,
  planTaskAgentPatch,
  type CustomAgent,
} from "@/lib/custom-agents";
import {
  addOutlineSection,
  addPlanTask,
  movePlanDay,
  removeOutlineSection,
  removePlanTask,
  updateOutlineSection,
  updatePlanDay,
  updatePlanTask,
  validatePlanDraft,
  type ResourcePlan,
  type ResourceType,
} from "@/lib/resource-plan";
import { cn } from "@/lib/utils";
import { LEVEL_LABEL } from "@/lib/learning-baseline-gate";

const FIELD =
  "w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  explainer: "讲义",
  mindmap: "思维导图",
  quiz: "测验",
  solution: "题目解析",
  reading: "延伸阅读",
  code: "代码示例",
  video: "视频脚本",
  courseware: "课件",
  interactive: "交互演示",
};

/** 稳定引用：默认空数组不能内联，否则每次渲染都会换掉 props 身份。 */
const EMPTY_CUSTOM_AGENTS: readonly CustomAgent[] = [];

interface ResourcePlanCardProps {
  plan: ResourcePlan;
  saving: boolean;
  executing: boolean;
  error?: string;
  /** 用户自建的智能体：出现在任务「执行者」下拉的第二组里。 */
  customAgents?: readonly CustomAgent[];
  onSave(plan: ResourcePlan): Promise<void>;
  onConfirm(plan: ResourcePlan): Promise<void>;
  onReplan(plan: ResourcePlan, feedback: string): Promise<void>;
  onCancel(plan: ResourcePlan): Promise<void>;
}

export function ResourcePlanCard({
  plan,
  saving,
  executing,
  error,
  customAgents = EMPTY_CUSTOM_AGENTS,
  onSave,
  onConfirm,
  onReplan,
  onCancel,
}: ResourcePlanCardProps) {
  const [draft, setDraft] = useState<ResourcePlan>(() => structuredClone(plan));
  const [feedback, setFeedback] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const readOnly = ["running", "completed", "cancelled"].includes(plan.status);
  const busy = saving || executing;

  useEffect(() => {
    setDraft(structuredClone(plan));
    setFeedback("");
  }, [plan]);

  useEffect(() => {
    if (!editorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setEditorOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, editorOpen]);

  const validation = useMemo(() => validatePlanDraft(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(plan), [draft, plan]);
  const retryTaskCount = useMemo(
    () => plan.tasks.filter((task) => task.status !== "ready").length,
    [plan.tasks],
  );

  return (
    <section className="max-w-[880px] rounded-2xl border bg-card shadow-sm">
      <header className="border-b bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                学习资料规划 v{plan.version}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {draft.days.length} 天 · {draft.tasks.length} 份资料
              </span>
            </div>
            <h3 className="mt-2 text-base font-semibold">{draft.request_summary}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              先确认每天学什么和每份资料的大纲，再让资料智能体并行生成。
            </p>
            {draft.learner_context && (
              <p className="mt-1 text-xs text-primary">本路径依据：{({diagnostic:"摸底测试",self_report:"用户自评",existing_profile:"历史画像",explicit_default:"用户明确选择系统默认"} as Record<string,string>)[draft.learner_context.source] ?? draft.learner_context.source} · {LEVEL_LABEL[draft.learner_context.level as keyof typeof LEVEL_LABEL] ?? draft.learner_context.level}</p>
            )}
          </div>
          {readOnly && (
            <span className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground">
              {plan.status === "running" ? "生成中" : plan.status === "completed" ? "已完成" : "已取消"}
            </span>
          )}
        </div>
        {!editorOpen && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {validation.valid ? "规划摘要已就绪，编辑操作会在独立工作区打开。" : "当前规划需要修复后才能确认。"}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
              <Maximize2 className="mr-1 size-3.5" />展开编辑规划
            </Button>
          </div>
        )}
      </header>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d2419]/35 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`resource-plan-editor-${plan.plan_id}`}
            className="flex h-[min(92vh,880px)] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
          >
            <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b bg-card px-5 py-3">
              <div>
                <h4 id={`resource-plan-editor-${plan.plan_id}`} className="font-semibold">编辑学习资料规划</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">正文单独滚动，保存、确认和重规划操作固定在底部。</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setEditorOpen(false)} aria-label="关闭规划编辑器" title="关闭规划编辑器">
                <X className="size-4" />
              </Button>
            </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {draft.days.map((day, dayIndex) => {
          const dayTasks = draft.tasks.filter((task) => task.day === day.day);
          return (
            <details key={day.day} open className="group rounded-xl border bg-background">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3">
                <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  {day.day}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{day.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {day.minutes} 分钟 · {dayTasks.length} 份资料
                </span>
              </summary>

              <div className="space-y-4 border-t p-3">
                <div className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    当天主题
                    <input
                      className={FIELD}
                      value={day.title}
                      disabled={readOnly}
                      onChange={(event) =>
                        setDraft(updatePlanDay(draft, day.day, { title: event.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    学习时长
                    <input
                      className={FIELD}
                      type="number"
                      min={15}
                      max={480}
                      value={day.minutes}
                      disabled={readOnly}
                      onChange={(event) =>
                        setDraft(updatePlanDay(draft, day.day, { minutes: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <div className="flex items-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`上移 ${day.day}`}
                      disabled={readOnly || dayIndex === 0}
                      onClick={() => setDraft(movePlanDay(draft, dayIndex, dayIndex - 1))}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`下移 ${day.day}`}
                      disabled={readOnly || dayIndex === draft.days.length - 1}
                      onClick={() => setDraft(movePlanDay(draft, dayIndex, dayIndex + 1))}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                  </div>
                </div>

                <label className="block space-y-1 text-xs text-muted-foreground">
                  当天目标
                  <textarea
                    className={cn(FIELD, "min-h-16 resize-y")}
                    value={day.objective}
                    disabled={readOnly}
                    onChange={(event) =>
                      setDraft(updatePlanDay(draft, day.day, { objective: event.target.value }))
                    }
                  />
                </label>

                <div className="space-y-3">
                  {dayTasks.map((task) => {
                    const runByCustomAgent = isCustomAgentKey(task.agent);
                    return (
                    <article key={task.task_id} className="rounded-lg border bg-muted/10 p-3">
                      <div className="grid gap-2 md:grid-cols-[150px_140px_1fr_100px_auto]">
                        <label className="space-y-1 text-[11px] text-muted-foreground">
                          执行者
                          <select
                            className={FIELD}
                            value={runByCustomAgent ? task.agent : BUILTIN_AGENT_KEY}
                            disabled={readOnly}
                            onChange={(event) =>
                              setDraft(
                                updatePlanTask(
                                  draft,
                                  task.task_id,
                                  // agent 与 type 必须成对写入：只改其一会让后端
                                  // 「按 agent 生成、按 type 审核落库」，产出必然被误判。
                                  planTaskAgentPatch(event.target.value, customAgents, task.type),
                                ),
                              )
                            }
                          >
                            {/* 内置执行者不单独暴露：它永远由资料类型推导，
                                单独可选只会制造 agent/type 失配，对用户也没有价值。 */}
                            <option value={BUILTIN_AGENT_KEY}>
                              内置智能体（跟随资料类型）
                            </option>
                            {customAgents.length > 0 && (
                              <optgroup label="我的智能体">
                                {customAgents.map((agent) => (
                                  <option key={agent.agent_key} value={agent.agent_key}>
                                    {`${customAgentMonogram(agent.name)} · ${agent.name}`}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </label>
                        <label className="space-y-1 text-[11px] text-muted-foreground">
                          资料类型
                          <select
                            className={FIELD}
                            value={task.type}
                            disabled={readOnly || runByCustomAgent}
                            title={
                              runByCustomAgent
                                ? "该任务由自建智能体执行，资料类型跟随智能体的输出类型"
                                : undefined
                            }
                            onChange={(event) => {
                              const type = event.target.value as ResourceType;
                              // 改类型时执行者跟着重推，保持二者一致（solution 复用出题智能体）。
                              setDraft(
                                updatePlanTask(draft, task.task_id, {
                                  type,
                                  agent: builtinAgentForType(type),
                                }),
                              );
                            }}
                          >
                            {Object.entries(RESOURCE_LABEL).map(([type, label]) => (
                              <option key={type} value={type}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-[11px] text-muted-foreground">
                          资料标题
                          <input
                            className={FIELD}
                            value={task.title}
                            disabled={readOnly}
                            onChange={(event) =>
                              setDraft(updatePlanTask(draft, task.task_id, { title: event.target.value }))
                            }
                          />
                        </label>
                        <label className="space-y-1 text-[11px] text-muted-foreground">
                          难度
                          <input
                            className={FIELD}
                            value={task.difficulty}
                            disabled={readOnly}
                            onChange={(event) =>
                              setDraft(updatePlanTask(draft, task.task_id, { difficulty: event.target.value }))
                            }
                          />
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`删除资料 ${task.title}`}
                          className="self-end text-danger"
                          disabled={readOnly}
                          onClick={() => setDraft(removePlanTask(draft, task.task_id))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <label className="mt-2 block space-y-1 text-[11px] text-muted-foreground">
                        知识点（用逗号分隔）
                        <input
                          className={FIELD}
                          value={task.knowledge_points.join("，")}
                          disabled={readOnly}
                          onChange={(event) =>
                            setDraft(
                              updatePlanTask(draft, task.task_id, {
                                knowledge_points: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
                              }),
                            )
                          }
                        />
                      </label>

                      <label className="mt-2 block space-y-1 text-[11px] text-muted-foreground">
                        资料大纲目标
                        <textarea
                          className={cn(FIELD, "min-h-14 resize-y")}
                          value={task.outline.objective}
                          disabled={readOnly}
                          onChange={(event) =>
                            setDraft(
                              updatePlanTask(draft, task.task_id, {
                                outline: { ...task.outline, objective: event.target.value },
                              }),
                            )
                          }
                        />
                      </label>

                      <div className="mt-3 space-y-2">
                        {task.outline.sections.map((section, sectionIndex) => (
                          <div key={`${task.task_id}-${sectionIndex}`} className="grid gap-2 rounded-md border bg-background p-2 md:grid-cols-2">
                            <input
                              aria-label="大纲章节标题"
                              className={FIELD}
                              value={section.title}
                              disabled={readOnly}
                              onChange={(event) =>
                                setDraft(updateOutlineSection(draft, task.task_id, sectionIndex, { title: event.target.value }))
                              }
                            />
                            <input
                              aria-label="大纲章节目标"
                              className={FIELD}
                              value={section.goal}
                              disabled={readOnly}
                              onChange={(event) =>
                                setDraft(updateOutlineSection(draft, task.task_id, sectionIndex, { goal: event.target.value }))
                              }
                            />
                            <input
                              aria-label="大纲必须覆盖点"
                              className={FIELD}
                              value={section.must_cover.join("，")}
                              disabled={readOnly}
                              onChange={(event) =>
                                setDraft(
                                  updateOutlineSection(draft, task.task_id, sectionIndex, {
                                    must_cover: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
                                  }),
                                )
                              }
                            />
                            <div className="flex gap-2">
                              <input
                                aria-label="目标字数"
                                className={FIELD}
                                type="number"
                                min={50}
                                max={3000}
                                value={section.target_words}
                                disabled={readOnly}
                                onChange={(event) =>
                                  setDraft(updateOutlineSection(draft, task.task_id, sectionIndex, { target_words: Number(event.target.value) }))
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="删除大纲章节"
                                disabled={readOnly}
                                onClick={() => setDraft(removeOutlineSection(draft, task.task_id, sectionIndex))}
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={readOnly}
                          onClick={() => setDraft(addOutlineSection(draft, task.task_id))}
                        >
                          <Plus className="mr-1 size-3.5" />添加大纲章节
                        </Button>
                      </div>

                      <label className="mt-3 block space-y-1 text-[11px] text-muted-foreground">
                        质量验收标准（每行一项）
                        <textarea
                          className={cn(FIELD, "min-h-16 resize-y")}
                          value={task.quality_criteria.join("\n")}
                          disabled={readOnly}
                          onChange={(event) =>
                            setDraft(
                              updatePlanTask(draft, task.task_id, {
                                quality_criteria: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean),
                              }),
                            )
                          }
                        />
                      </label>

                      {runByCustomAgent && (
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                          由自建智能体 <span className="font-mono">{task.agent}</span> 执行，资料类型已锁定为「
                          {RESOURCE_LABEL[task.type]}」；提示词只影响写作风格与侧重，产出仍会走统一的质量审核与防幻觉门禁。
                        </p>
                      )}
                    </article>
                    );
                  })}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={readOnly || draft.tasks.length >= 12}
                  onClick={() => setDraft(addPlanTask(draft, day.day, "explainer"))}
                >
                  <Plus className="mr-1 size-3.5" />添加资料
                </Button>
              </div>
            </details>
          );
        })}
      </div>

      <footer className="sticky bottom-0 shrink-0 space-y-3 border-t bg-muted/10 p-4">
        {(error || !validation.valid || plan.validation.errors.length > 0) && (
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error && <div>{error}</div>}
            {[...validation.errors, ...plan.validation.errors].map((item) => (
              <div key={item}>• {item}</div>
            ))}
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div className="text-xs text-muted-foreground">{validation.warnings.join("；")}</div>
        )}
        {plan.status === "failed" && (
          <div
            role="alert"
            className="rounded-lg border border-warning/35 bg-warning/5 px-3 py-2 text-xs text-foreground/80"
          >
            已交付的资料可以正常使用；其余候选不会出现在学习入口，可继续完成剩余内容。
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={readOnly || busy || !dirty || !validation.valid}
            onClick={() => onSave(draft)}
          >
            <Save className="mr-1 size-4" />{saving ? "保存中…" : "保存修改"}
          </Button>
          <Button
            type="button"
            disabled={readOnly || busy || dirty || !validation.valid}
            onClick={() => onConfirm(draft)}
          >
            <CheckCircle2 className="mr-1 size-4" />
            {executing
              ? "启动中…"
              : plan.status === "failed"
                ? `继续完成剩余 ${retryTaskCount} 份资料`
                : `确认并生成 ${draft.tasks.length} 份资料`}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={readOnly || busy}
            onClick={() => onReplan(draft, feedback)}
          >
            <RotateCcw className="mr-1 size-4" />让规划智能体重新规划
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            disabled={readOnly || busy}
            onClick={() => onCancel(draft)}
          >
            <Trash2 className="mr-1 size-4" />取消本次任务
          </Button>
        </div>
        {!readOnly && (
          <textarea
            className={cn(FIELD, "min-h-16 resize-y")}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="可选：告诉规划智能体要增加、删除或调整哪些内容"
          />
        )}
      </footer>
          </section>
        </div>
      )}
    </section>
  );
}
