"use client";

import { useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import { ArrowUpRight, Check, GitBranch, Loader2, Settings2, Sparkles, Wand2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ResourceCard } from "@/components/resource-card";
import { ResourcePathAttachmentDialog } from "@/components/resource-path-attachment-dialog";
import { ResourceViewer } from "@/components/resource-viewer";
import {
  ResourceConfigPopover,
  type ConfigAnchor,
} from "@/components/resource-config-popover";
import { Button } from "@/components/ui/button";
import { useMaterialGenerator } from "@/hooks/use-material-generator";
import { FORM_MATERIAL_TYPES } from "@/lib/material-types";
import { visibleGenerationResources } from "@/lib/resource-generation-state";
import { cn } from "@/lib/utils";

export default function CreatePage() {
  const {
    mode,
    topic,
    setTopic,
    knowledge,
    setKnowledge,
    selected,
    toggle,
    assessments,
    assessmentId,
    setAssessmentId,
    quizConfig,
    setQuizCount,
    quizSelected,
    quizTotal,
    running,
    done,
    status,
    resources,
    openItem,
    setOpenItem,
    canRun,
    run,
  } = useMaterialGenerator();

  const [cfg, setCfg] = useState<ConfigAnchor | null>(null);
  const [attachItem, setAttachItem] = useState<(typeof resources)[number] | null>(null);
  const visibleResources = visibleGenerationResources(resources);
  const readyCount = resources.filter((resource) => resource.status === "ready").length;

  const inputCls =
    "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="生成资料"
          desc="选择要生成的资料类型、填写知识点，多智能体按你的学情生成并保存到资源中心"
        >
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            {mode === "live" ? "在线后端" : mode === "offline" ? "后端未连接" : "检测中"}
          </span>
        </PageHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
          {/* 左：表单 */}
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">主题 / 科目</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="如：数据结构 · 动态规划"
                className={cn(inputCls, "mt-1.5")}
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">
                知识点与要求
              </label>
              <textarea
                value={knowledge}
                onChange={(e) => setKnowledge(e.target.value)}
                placeholder="列出希望覆盖的知识点或具体要求，AI 会据此生成。如：状态转移方程的列法、0-1 背包、滚动数组优化…"
                rows={4}
                className={cn(inputCls, "mt-1.5 resize-none")}
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">
                资料类型（可多选）
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {FORM_MATERIAL_TYPES.map((mt) => {
                  const active = selected.has(mt.id);
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
                        onClick={() => toggle(mt.id)}
                        aria-pressed={active}
                        title={`${mt.desc}（右键配置生成参数）`}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-lg border px-2.5 py-2 pr-7 text-left text-[12px] transition-colors",
                          active
                            ? "border-primary bg-primary/[0.06] text-foreground"
                            : "bg-surface-2/50 text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded border",
                            active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
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
                          "absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/60 transition hover:bg-accent hover:text-foreground",
                          mt.id === "quiz" || mt.id === "solution" ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        <Settings2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                右键资料类型可配置生成参数
              </p>
            </div>

            {quizSelected && (
              <button
                type="button"
                onClick={(e) => setCfg({ x: e.clientX, y: e.clientY, type: "quiz" })}
                className="flex w-full items-center gap-2 rounded-lg border bg-surface-2/40 px-3 py-2 text-left text-[12px] transition-colors hover:border-primary/40"
              >
                <Settings2 className="size-3.5 shrink-0 text-primary" />
                {quizTotal < 1 ? (
                  <span className="text-danger">题目配置：至少配置 1 道题</span>
                ) : (
                  <span className="text-muted-foreground">
                    题目：选择 {quizConfig.choice} · 判断 {quizConfig.judge} · 简答 {quizConfig.short}（点此调整）
                  </span>
                )}
              </button>
            )}

            {assessments.length > 0 && (
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  导入摸底数据（可选）
                </label>
                <select
                  value={assessmentId}
                  onChange={(e) => setAssessmentId(e.target.value)}
                  className={cn(inputCls, "mt-1.5")}
                >
                  <option value="" className="bg-card">不导入</option>
                  {assessments.map((a) => (
                    <option key={a.id} value={a.id} className="bg-card">
                      {a.subject} · {a.self_level}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  导入后 AI 会结合你的摸底学情调整资料深浅与侧重。
                </p>
              </div>
            )}

            <Button onClick={run} disabled={!canRun} className="w-full gap-1.5">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {running ? "生成中…" : "开始生成"}
            </Button>
          </section>

          {/* 右：流式输出 */}
          <section className="min-h-[320px] rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 border-b pb-3">
              <Sparkles className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">生成内容</h2>
              {status && (
                <span className="ml-auto truncate text-[11px] text-muted-foreground">{status}</span>
              )}
            </div>

            {visibleResources.length === 0 ? (
              <div className="grid place-items-center px-4 py-16 text-center">
                <Wand2 className="size-7 text-muted-foreground/50" />
                <p className="mt-3 max-w-[28em] text-[13px] leading-relaxed text-muted-foreground">
                  在左侧选择资料类型、填写知识点，点击「开始生成」。生成的资料会实时出现在这里，并自动保存到资源中心。
                </p>
              </div>
            ) : (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {visibleResources.map((r) => (
                    <div key={r.id} className="space-y-1.5">
                      <ResourceCard item={r} onOpen={setOpenItem} />
                      {r.status === "ready" && (
                        <button
                          type="button"
                          onClick={() => setAttachItem(r)}
                          className="ml-auto flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent"
                        >
                          <GitBranch className="size-3" />挂载到学习路径
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {done && readyCount > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success/[0.05] px-3.5 py-2.5 text-[12px]">
                    <Check className="size-4 text-success" />
                    <span className="text-foreground/85">资料已生成并保存。</span>
                    <Link href="/resources" className="ml-auto flex items-center gap-0.5 font-medium text-primary hover:underline">
                      去资源中心 <ArrowUpRight className="size-3.5" />
                    </Link>
                    {[...selected].includes("quiz") && (
                      <Link href="/practice" className="flex items-center gap-0.5 font-medium text-primary hover:underline">
                        去试题库 <ArrowUpRight className="size-3.5" />
                      </Link>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <ResourceViewer item={openItem} onClose={() => setOpenItem(null)} />
      <ResourcePathAttachmentDialog item={attachItem} onClose={() => setAttachItem(null)} />
      <ResourceConfigPopover
        anchor={cfg}
        onClose={() => setCfg(null)}
        quizConfig={quizConfig}
        setQuizCount={setQuizCount}
      />
    </div>
  );
}
