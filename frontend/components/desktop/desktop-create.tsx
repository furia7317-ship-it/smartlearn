"use client";

import { useState, type ReactNode } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import { ArrowUpRight, Check, Download, Library, Loader2, Settings2, Sparkles, Wand2 } from "lucide-react";

import { DesktopResourceCard } from "@/components/desktop/desktop-resource-card";
import { AgentRunInspector } from "@/components/agent-run-inspector";
import { ResourceViewer } from "@/components/resource-viewer";
import {
  ResourceConfigPopover,
  type ConfigAnchor,
} from "@/components/resource-config-popover";
import { useMaterialGenerator } from "@/hooks/use-material-generator";
import { downloadText, materialsToMarkdown } from "@/lib/export-materials";
import { FORM_MATERIAL_TYPES } from "@/lib/material-types";
import { visibleGenerationResources } from "@/lib/resource-generation-state";
import { cn } from "@/lib/utils";

/** 桌面专属「资源生成」：左表单 + 右富输出（参考国一作品「智慧备课」排版），
 *  生成后可导出 Markdown 或进资源中心。逻辑与 web `/create` 共用同一 hook。 */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-[13px] font-medium text-foreground/80">
        {required && <span className="text-danger">*</span>}
        {label}
      </label>
      {children}
    </div>
  );
}

export default function DesktopCreate() {
  const g = useMaterialGenerator();
  const [cfg, setCfg] = useState<ConfigAnchor | null>(null);

  const inputCls =
    "w-full rounded-lg border bg-card px-3.5 py-2.5 text-sm outline-none transition-colors focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/30";
  const hasQuiz = [...g.selected].includes("quiz");
  const readyCount = g.resources.filter((r) => r.status === "ready").length;
  const visibleResources = visibleGenerationResources(g.resources);

  const onExport = () => {
    downloadText(
      `${g.topic.trim() || "资源生成"}.md`,
      materialsToMarkdown(g.resources.filter((resource) => resource.status === "ready")),
    );
  };

  return (
    <div className="flex h-full">
      {/* 左：表单面板 */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r bg-surface-2/30">
        <header className="flex items-center gap-2.5 border-b px-6 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Wand2 className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold leading-tight">资源生成</h1>
          </div>
          <span className="ml-auto shrink-0 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground">
            {g.mode === "live" ? "在线后端" : g.mode === "offline" ? "后端未连接" : "检测中"}
          </span>
        </header>

        <div className="thin-scroll flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <Field label="主题 / 科目" required>
            <input
              value={g.topic}
              onChange={(e) => g.setTopic(e.target.value)}
              placeholder="如：数据结构 · 动态规划"
              className={inputCls}
            />
          </Field>

          <Field label="知识点与要求" required>
            <textarea
              value={g.knowledge}
              onChange={(e) => g.setKnowledge(e.target.value)}
              rows={5}
              placeholder="列出希望覆盖的知识点或具体要求，AI 会据此生成。如：状态转移方程的列法、0-1 背包、滚动数组优化…"
              className={cn(inputCls, "resize-none leading-relaxed")}
            />
          </Field>

          <Field label="资料类型（可多选）" required>
            <div className="grid grid-cols-2 gap-2">
              {FORM_MATERIAL_TYPES.map((mt) => {
                const active = g.selected.has(mt.id);
                return (
                  <div
                    key={mt.id}
                    className="group relative"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCfg({ x: e.clientX, y: e.clientY, type: mt.id });
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => g.toggle(mt.id)}
                      aria-pressed={active}
                      title={`${mt.desc}（右键配置生成参数）`}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 pr-8 text-left text-[13px] transition-colors",
                        active
                          ? "border-primary bg-primary/[0.07] text-foreground"
                          : "bg-card text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded border",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40"
                        )}
                      >
                        {active && <Check className="size-3" />}
                      </span>
                      <span className="font-medium">{mt.label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) =>
                        setCfg({ x: e.clientX, y: e.clientY, type: mt.id })
                      }
                      title="配置生成参数"
                      aria-label={`配置${mt.label}生成参数`}
                      className={cn(
                        "absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/60 transition hover:bg-accent hover:text-foreground",
                        mt.id === "quiz" ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <Settings2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              右键资料类型可配置生成参数
            </p>
          </Field>

          {hasQuiz && (
            <button
              type="button"
              onClick={(e) => setCfg({ x: e.clientX, y: e.clientY, type: "quiz" })}
              className="flex w-full items-center gap-2 rounded-lg border bg-card px-3.5 py-2.5 text-left text-[13px] transition-colors hover:border-primary/40"
            >
              <Settings2 className="size-4 shrink-0 text-primary" />
              {g.quizTotal < 1 ? (
                <span className="text-danger">题目配置：至少配置 1 道题</span>
              ) : (
                <span className="text-muted-foreground">
                  题目：选择 {g.quizConfig.choice} · 判断 {g.quizConfig.judge} · 简答 {g.quizConfig.short}（点此调整）
                </span>
              )}
            </button>
          )}

          {g.assessments.length > 0 && (
            <Field label="导入摸底数据（可选）">
              <select
                value={g.assessmentId}
                onChange={(e) => g.setAssessmentId(e.target.value)}
                className={inputCls}
              >
                <option value="" className="bg-card">不导入</option>
                {g.assessments.map((a) => (
                  <option key={a.id} value={a.id} className="bg-card">
                    {a.subject} · {a.self_level}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="border-t px-6 py-4">
          <button
            onClick={g.run}
            disabled={!g.canRun}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
              g.canRun
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground"
            )}
          >
            {g.running ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {g.running ? "生成中…" : "开始生成"}
          </button>
        </div>
      </aside>

      {/* 右：输出面板 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-7">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-[15px] font-semibold">生成内容</h2>
          {g.status && (
            <span className="truncate text-[12px] text-muted-foreground">· {g.status}</span>
          )}
          {g.done && readyCount > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onExport}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
              >
                <Download className="size-4" /> 导出
              </button>
              <Link
                href="/resources"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Library className="size-4" /> 资源中心
              </Link>
            </div>
          )}
        </header>

        <div className="thin-scroll flex-1 overflow-y-auto px-7 py-6">
          {visibleResources.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <Wand2 className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mx-auto mt-4 max-w-[34em] text-sm leading-relaxed text-muted-foreground">
                  在左侧选择资料类型、填写知识点，点击「开始生成」。生成的资料会实时出现在这里，
                  并自动存入资源中心，完成后可一键导出。
                </p>
              </div>
            </div>
          ) : (
            <>
              {g.activeAgentRun && (
                <section className="mb-5 overflow-hidden rounded-xl border bg-card">
                  <div className="border-b px-4 py-2.5 text-[12px] font-semibold">
                    实时智能体执行轨迹
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <AgentRunInspector run={g.activeAgentRun} />
                  </div>
                </section>
              )}
              {Object.values(g.outputStreams).some(Boolean) && (
                <section className="mb-5 rounded-xl border bg-card p-4">
                  <div className="mb-2 text-[12px] font-semibold">已过审内容流</div>
                  <pre className="thin-scroll max-h-52 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                    {Object.entries(g.outputStreams)
                      .filter(([, value]) => Boolean(value))
                      .map(([type, value]) => `${FORM_MATERIAL_TYPES.find((item) => item.id === type)?.label ?? type}\n${value}`)
                      .join("\n\n")}
                  </pre>
                </section>
              )}
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {visibleResources.map((r) => (
                  <DesktopResourceCard key={r.id} item={r} onOpen={g.setOpenItem} />
                ))}
              </div>
              {g.done && readyCount > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/[0.05] px-4 py-3 text-[13px]">
                  <Check className="size-4 shrink-0 text-success" />
                  <span className="text-foreground/85">
                    已生成 {readyCount} 项并存入资源中心{hasQuiz ? "（题目已入试题库）" : ""}。
                  </span>
                  <button
                    onClick={onExport}
                    className="ml-auto flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <Download className="size-3.5" /> 导出 Markdown
                  </button>
                  <Link
                    href="/resources"
                    className="flex items-center gap-0.5 font-medium text-primary hover:underline"
                  >
                    去资源中心 <ArrowUpRight className="size-3.5" />
                  </Link>
                  {hasQuiz && (
                    <Link
                      href="/practice"
                      className="flex items-center gap-0.5 font-medium text-primary hover:underline"
                    >
                      去试题库 <ArrowUpRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <ResourceViewer item={g.openItem} onClose={() => g.setOpenItem(null)} />
      <ResourceConfigPopover
        anchor={cfg}
        onClose={() => setCfg(null)}
        quizConfig={g.quizConfig}
        setQuizCount={g.setQuizCount}
      />
    </div>
  );
}
