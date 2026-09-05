"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import { requestErrorMessage } from "@/lib/api-error";
import {
  CUSTOM_AGENT_DUTY_MAX,
  CUSTOM_AGENT_NAME_MAX,
  CUSTOM_AGENT_PROMPT_MAX,
  CUSTOM_AGENT_SCOPE_MAX,
  createCustomAgent,
  customAgentMonogram,
  deleteCustomAgent,
  listCustomAgents,
  updateCustomAgent,
  validateCustomAgentInput,
  type CustomAgent,
  type CustomAgentInput,
} from "@/lib/custom-agents";
import { MATERIAL_TYPES, MATERIAL_TYPE_LABEL } from "@/lib/material-types";
import type { ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60";

/** 统一门禁说明：提示词只改写作风格，不能绕过审核。 */
export const AGENT_GUARDRAIL_NOTE =
  "提示词只影响写作风格与侧重，产出仍会走统一的质量审核与防幻觉门禁。";

interface AgentDraft {
  name: string;
  duty: string;
  systemPrompt: string;
  outputType: ResourceType;
  knowledgeScope: string[];
}

function emptyDraft(): AgentDraft {
  return {
    name: "",
    duty: "",
    systemPrompt: "",
    outputType: "reading",
    knowledgeScope: [],
  };
}

function draftFromAgent(agent: CustomAgent): AgentDraft {
  return {
    name: agent.name,
    duty: agent.duty,
    systemPrompt: agent.system_prompt,
    outputType: agent.output_type,
    knowledgeScope: [...agent.knowledge_scope],
  };
}

function draftToInput(draft: AgentDraft): CustomAgentInput {
  return {
    name: draft.name,
    duty: draft.duty,
    system_prompt: draft.systemPrompt,
    output_type: draft.outputType,
    knowledge_scope: draft.knowledgeScope,
  };
}

export function CustomAgentWorkspace() {
  const { mode } = useOrchestratorContext((state) => ({
    mode: state.mode,
  }));
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomAgent | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft);
  const [scopeInput, setScopeInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomAgent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => {
    if (mode === "checking") return;
    setLoading(true);
    listCustomAgents(mode)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [mode]);

  useEffect(refresh, [refresh]);

  const promptLength = draft.systemPrompt.length;
  const promptOverflow = promptLength > CUSTOM_AGENT_PROMPT_MAX;
  const outputTypeDesc = useMemo(
    () => MATERIAL_TYPES.find((item) => item.id === draft.outputType)?.desc ?? "",
    [draft.outputType],
  );

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setScopeInput("");
    setError("");
    setFormOpen(true);
  };

  const openEdit = (agent: CustomAgent) => {
    setEditing(agent);
    setDraft(draftFromAgent(agent));
    setScopeInput("");
    setError("");
    setFormOpen(true);
  };

  const addScopeTag = () => {
    const tag = scopeInput.trim();
    if (!tag) return;
    if (draft.knowledgeScope.length >= CUSTOM_AGENT_SCOPE_MAX) {
      setError(`知识范围最多 ${CUSTOM_AGENT_SCOPE_MAX} 条`);
      return;
    }
    if (draft.knowledgeScope.includes(tag)) {
      setScopeInput("");
      return;
    }
    setDraft({ ...draft, knowledgeScope: [...draft.knowledgeScope, tag] });
    setScopeInput("");
  };

  const submit = async () => {
    const input = draftToInput(draft);
    const message = validateCustomAgentInput(input);
    if (message) {
      setError(message);
      return;
    }
    if (mode !== "live") {
      setError("学习服务未连接，自建智能体需要后端调度才能执行，暂时无法保存。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) await updateCustomAgent(mode, editing.id, input);
      else await createCustomAgent(mode, input);
      setFormOpen(false);
      setEditing(null);
      refresh();
    } catch (cause) {
      setError(requestErrorMessage(cause, "保存智能体失败，请稍后重试。"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      await deleteCustomAgent(mode, pendingDelete.id);
      setPendingDelete(null);
      refresh();
    } catch (cause) {
      setError(requestErrorMessage(cause, "删除智能体失败，请稍后重试。"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">我的智能体</h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {agents.length} 个
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              自建的是「执行者」，不是新资料类型：产出类型仍从既有 9 种里选。建好后在学习资料规划的
              「执行者」下拉里挑它，就能用你的提示词生成这份资料。
            </p>
          </div>
          <Button type="button" onClick={openCreate} disabled={mode !== "live"}>
            <Plus className="mr-1 size-4" />新建智能体
          </Button>
        </div>

        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          {AGENT_GUARDRAIL_NOTE}
        </p>

        {mode === "offline" && (
          <p className="mt-3 rounded-lg border border-warning/35 bg-warning/[0.06] px-3 py-2 text-[12px] text-foreground/80">
            学习服务未连接：自建智能体必须由后端调度执行，离线时既不展示也不能新建。
          </p>
        )}
      </section>

      {error && !formOpen && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />正在读取我的智能体…
        </p>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="还没有属于你的智能体"
          desc="新建一个，写清它的职责与系统提示词，再选一种既有输出类型；之后在学习资料规划里把任务的执行者换成它即可。"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {agents.map((agent) => (
            <article key={agent.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                  {customAgentMonogram(agent.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {MATERIAL_TYPE_LABEL[agent.output_type] ?? agent.output_type}
                    </span>
                    <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {agent.status === "active" ? "启用中" : "已归档"}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                    {agent.duty || "（未填写职责）"}
                  </p>
                  {agent.knowledge_scope.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {agent.knowledge_scope.map((tag) => (
                        <span key={tag} className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">{agent.agent_key}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(agent)}>
                  <Pencil className="mr-1 size-3.5" />编辑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setPendingDelete(agent)}
                >
                  <Trash2 className="mr-1 size-3.5" />删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d2419]/35 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-agent-form-title"
            className="flex h-[min(92vh,860px)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
              <div>
                <h3 id="custom-agent-form-title" className="font-semibold">
                  {editing ? "编辑智能体" : "新建智能体"}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  自定义的是执行者；输出类型只能从既有 9 种资料类型里挑一种。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭智能体表单"
                onClick={() => setFormOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <label className="block space-y-1 text-xs text-muted-foreground">
                名称（最多 {CUSTOM_AGENT_NAME_MAX} 字）
                <input
                  className={FIELD}
                  value={draft.name}
                  maxLength={CUSTOM_AGENT_NAME_MAX}
                  placeholder="例如：严谨的物理竞赛助教"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>

              <label className="block space-y-1 text-xs text-muted-foreground">
                职责（一句话，最多 {CUSTOM_AGENT_DUTY_MAX} 字）
                <input
                  className={FIELD}
                  value={draft.duty}
                  maxLength={CUSTOM_AGENT_DUTY_MAX}
                  placeholder="例如：把抽象公式拆成可动手验证的推导步骤"
                  onChange={(event) => setDraft({ ...draft, duty: event.target.value })}
                />
              </label>

              <label className="block space-y-1 text-xs text-muted-foreground">
                系统提示词
                <textarea
                  className={cn(FIELD, "min-h-40 resize-y leading-relaxed")}
                  value={draft.systemPrompt}
                  placeholder="描述它的写作风格、讲解顺序、必须覆盖的角度，以及要避免的表达方式。"
                  onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
                />
                <span
                  className={cn(
                    "block text-right font-mono text-[11px] tabular-nums",
                    promptOverflow ? "text-danger" : "text-muted-foreground",
                  )}
                >
                  {promptLength} / {CUSTOM_AGENT_PROMPT_MAX} 字
                  {promptOverflow ? `（已超出 ${CUSTOM_AGENT_PROMPT_MAX} 字上限）` : ""}
                </span>
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  {AGENT_GUARDRAIL_NOTE}
                </span>
              </label>

              <fieldset className="space-y-1.5">
                <legend className="text-xs text-muted-foreground">
                  输出类型（只能从既有 9 种资料类型里选一种）
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MATERIAL_TYPES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={draft.outputType === option.id}
                      title={option.desc}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left transition",
                        draft.outputType === option.id
                          ? "border-primary bg-primary/10"
                          : "hover:bg-accent",
                      )}
                      onClick={() => setDraft({ ...draft, outputType: option.id })}
                    >
                      <span className="block text-[13px] font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {option.desc}
                      </span>
                    </button>
                  ))}
                </div>
                {outputTypeDesc && (
                  <p className="text-[11px] text-muted-foreground">
                    选中后，用它执行的任务会固定产出「{MATERIAL_TYPE_LABEL[draft.outputType]}」：{outputTypeDesc}
                  </p>
                )}
              </fieldset>

              <fieldset className="space-y-1.5">
                <legend className="text-xs text-muted-foreground">
                  知识范围（可选，最多 {CUSTOM_AGENT_SCOPE_MAX} 条）
                </legend>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    value={scopeInput}
                    placeholder="例如：电磁感应"
                    aria-label="新增知识范围标签"
                    onChange={(event) => setScopeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addScopeTag();
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addScopeTag}
                    disabled={draft.knowledgeScope.length >= CUSTOM_AGENT_SCOPE_MAX}
                  >
                    添加
                  </Button>
                </div>
                {draft.knowledgeScope.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {draft.knowledgeScope.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                        aria-label={`移除知识范围 ${tag}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            knowledgeScope: draft.knowledgeScope.filter((item) => item !== tag),
                          })
                        }
                      >
                        {tag}
                        <X className="size-3" aria-hidden />
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>

              {error && (
                <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}
            </div>

            <footer className="flex shrink-0 justify-end gap-2 border-t bg-muted/10 px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
                取消
              </Button>
              <Button type="button" onClick={submit} disabled={saving}>
                {saving ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden /> : null}
                {saving ? "保存中…" : editing ? "保存修改" : "创建智能体"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d2419]/35 p-4" role="presentation">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="custom-agent-delete-title"
            className="w-full max-w-[420px] rounded-2xl border bg-card p-5 shadow-2xl"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div>
                <h3 id="custom-agent-delete-title" className="text-sm font-semibold">
                  确认删除「{pendingDelete.name}」？
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  删除后无法恢复；已经写进学习资料规划的任务需要重新选择执行者。
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
                取消
              </Button>
              <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleting}>
                {deleting ? "删除中…" : "确认删除"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
