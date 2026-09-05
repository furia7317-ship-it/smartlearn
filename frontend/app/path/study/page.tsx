"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock3,
  MessageCircleQuestion,
  Sparkles,
  X,
} from "lucide-react";
import { AssistantAvatar } from "@/components/agent-bits";
import { Markdown } from "@/components/markdown";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ResourceCard } from "@/components/resource-card";
import { ResourceViewer } from "@/components/resource-viewer";
import { ShellLink as Link } from "@/components/shell-link";
import { Thinking } from "@/components/thinking";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { streamSSE } from "@/lib/api";
import {
  buildDailyTaskPlan,
  materialCompletionKey,
  resourceCompletionKey,
} from "@/lib/daily-task-plan";
import { getStudentId } from "@/lib/student-identity";
import {
  buildStudyPlan,
  defaultStudyStageIndex,
} from "@/lib/study-plan";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export default function StudyPage() {
  const {
    hydrated,
    mode,
    masterPath,
    resources,
    completedMaterials,
  } = useOrchestratorContext((state) => ({
    hydrated: state.hydrated,
    mode: state.mode,
    masterPath: state.masterPath,
    resources: state.resources,
    completedMaterials: state.completedMaterials,
  }));
  const path = masterPath;
  const stages = useMemo(() => buildStudyPlan(path, resources), [path, resources]);
  const done = useMemo(() => new Set(completedMaterials), [completedMaterials]);

  const mainRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [messages, setMessages] = useState<AskMessage[]>([
    {
      id: "m0",
      role: "assistant",
      content:
        "我是你的**答疑辅导师**。阅读当前路径资料时，可以选中文字让我解释，也可以直接提问。",
    },
  ]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [openItem, setOpenItem] = useState<ResourceItem | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [viewed, setViewed] = useState<Set<number>>(() => new Set([0]));

  useEffect(() => {
    if (!hydrated || stages.length === 0) return;
    const raw = new URLSearchParams(window.location.search).get("stage");
    const numeric = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    const byDay = raw === null ? -1 : stages.findIndex((stage) => stage.day === raw);
    const requested = byDay >= 0 ? byDay : numeric;
    const initial =
      Number.isInteger(requested) && requested >= 0 && requested < stages.length
        ? requested
        : defaultStudyStageIndex(stages);
    setActiveStep(initial);
    setViewed((current) => new Set(current).add(initial));
  }, [hydrated, stages]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const goStep = useCallback(
    (index: number) => {
      if (stages.length === 0) return;
      const next = Math.max(0, Math.min(index, stages.length - 1));
      setActiveStep(next);
      setViewed((current) => new Set(current).add(next));
      const query = new URLSearchParams(window.location.search);
      query.set("stage", String(next));
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${query.toString()}${window.location.hash}`
      );
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [stages.length]
  );

  const push = useCallback(
    (role: AskMessage["role"], content: string, streaming = false) => {
      const id = `m${++msgId.current}`;
      setMessages((current) => [
        ...current,
        { id, role, content, streaming },
      ]);
      return id;
    },
    []
  );
  const patch = useCallback(
    (id: string, content: string, streaming?: boolean) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id ? { ...message, content, streaming } : message
        )
      );
    },
    []
  );

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || asking) return;
      const history = messages
        .filter(
          (message) =>
            !message.streaming && message.content.trim().length > 0
        )
        .slice(-10)
        .map((message) => ({
          role: message.role,
          content: message.content.trim().slice(0, 4000),
        }));

      setPanelOpen(true);
      push("user", text);
      setAsking(true);
      const answerId = push("assistant", "", true);
      try {
        if (mode !== "live") {
          patch(
            answerId,
            "学习服务当前未连接，暂时无法获取真实答疑。请启动本地后端后重试。",
            false
          );
          return;
        }

        let content = "";
        await streamSSE(
          "/api/chat",
          { student_id: getStudentId(), message: text, history },
          ({ event, data }) => {
            if (event === "delta") {
              content += (data.text as string) ?? "";
              patch(answerId, content, true);
            } else if (event === "content") {
              content = (data.data as string) ?? content;
              patch(answerId, content, true);
            } else if (event === "error") {
              throw new Error((data.message as string) ?? "答疑服务返回错误");
            }
          }
        );
        patch(
          answerId,
          content || "答疑服务没有返回内容，请稍后重试。",
          false
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        patch(answerId, `答疑失败：${detail}`, false);
      } finally {
        setAsking(false);
      }
    },
    [asking, messages, mode, patch, push]
  );

  const onMouseUp = useCallback(() => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed) return setSelection(null);
    const text = selected.toString().trim();
    if (text.length < 2) return setSelection(null);
    const range = selected.getRangeAt(0);
    if (
      mainRef.current &&
      !mainRef.current.contains(range.commonAncestorContainer)
    ) {
      return setSelection(null);
    }
    const rect = range.getBoundingClientRect();
    setSelection({
      text,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const explainSelection = useCallback(() => {
    if (!selection) return;
    const text = selection.text;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    void ask(`请结合当前学习阶段解释：${text}`);
  }, [ask, selection]);

  const active = stages[activeStep];
  const totalMinutes = stages.reduce((sum, stage) => sum + stage.minutes, 0);

  return (
    <div className="flex h-full min-h-0">
      <div
        ref={mainRef}
        onMouseUp={onMouseUp}
        className="thin-scroll min-w-0 flex-1 overflow-y-auto"
      >
        <div className="web-route-frame web-route-frame--reading space-y-5">
          <div className="flex items-center gap-3">
            <Link
              href="/path"
              className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground"
              aria-label="返回路径"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-lg font-semibold tracking-tight">
                {active?.title ?? "学习路径"}
              </h1>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {active
                  ? `共 ${stages.length} 个阶段 · 约 ${totalMinutes} 分钟 · 可自由切换`
                  : "这里会展示智能体为你生成的真实学习路径"}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                mode === "live"
                  ? "bg-success/12 text-success"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {mode === "live"
                ? "在线 · 真实答疑"
                : mode === "checking"
                  ? "正在连接"
                  : "后端未连接"}
            </span>
          </div>

          {!hydrated ? (
            <div className="rounded-xl border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
              正在恢复你的学习路径…
            </div>
          ) : !active ? (
            <section className="rounded-xl border border-dashed bg-card px-5 py-14 text-center">
              <h2 className="text-base font-semibold">还没有可学习的路径</h2>
              <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                先在学习工作台描述目标并生成资料。路径智能体完成编排后，任务和资料会自动出现在这里。
              </p>
              <Button asChild className="mt-5 gap-1.5">
                <Link href="/studio">
                  前往学习工作台
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </section>
          ) : (
            <>
              <div className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {stages.map((stage, index) => {
                  const isActive = index === activeStep;
                  const isViewed = viewed.has(index) && !isActive;
                  return (
                    <button
                      key={stage.key}
                      onClick={() => goStep(index)}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                        isActive
                          ? "border-primary bg-primary/10 text-foreground"
                          : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "rounded px-1 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {stage.day}
                      </span>
                      <span className="text-[12px] font-medium">
                        {stage.title}
                      </span>
                      {isViewed && <Check className="size-3 text-success" />}
                    </button>
                  );
                })}
              </div>

              <section className="rounded-xl border bg-card p-4 lg:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[11px] font-semibold text-background">
                        {active.day}
                      </span>
                      <h2 className="text-[16px] font-semibold">{active.title}</h2>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {active.desc}
                    </p>
                    {active.objective && (
                      <p className="mt-2 rounded-lg bg-primary/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/85">
                        <span className="font-medium text-primary">学习目标：</span>
                        {active.objective}
                      </p>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    {active.minutes} 分钟
                  </span>
                </div>

                {active.tasks.length > 0 && (
                  <div className="mt-5 space-y-2.5">
                    <h3 className="text-[12px] font-semibold text-muted-foreground">
                      本阶段任务
                    </h3>
                    {buildDailyTaskPlan(path[active.index], active.index, completedMaterials).tasks.map((task) => {
                      const key = task.key;
                      const completed = task.completed;
                      return (
                        <div
                          key={`${key}-${task.title}`}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left",
                            completed
                              ? "border-success/30 bg-success/[0.06]"
                              : "bg-background/50"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                              completed
                                ? "border-success bg-success text-white"
                                : "border-border"
                            )}
                          >
                            {completed && <Check className="size-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium">
                              {task.title}
                            </span>
                            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                              {task.detail}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {task.minutes} 分钟
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-5">
                  <h3 className="mb-2.5 text-[12px] font-semibold text-muted-foreground">
                    学习资料
                  </h3>
                  {active.resources.length > 0 ? (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {active.resources.map((item) => {
                        const legacyKey = materialCompletionKey(active.index, item.type);
                        const completed = done.has(resourceCompletionKey(item.id)) || done.has(legacyKey);
                        return (
                          <div key={item.id} className="space-y-1.5">
                            <ResourceCard item={item} onOpen={setOpenItem} />
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                                completed
                                  ? "bg-success/10 text-success"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              <CheckCircle2 className="size-3.5" />
                              {completed ? "已按学习行为完成" : "读到末尾或提交答案后自动完成"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-7 text-center text-[12px] text-muted-foreground">
                      该阶段暂时没有已生成且可用的资料。
                    </div>
                  )}
                </div>
              </section>

              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeStep === 0}
                  onClick={() => goStep(activeStep - 1)}
                  className="gap-1"
                >
                  <ArrowLeft className="size-3.5" />
                  上一阶段
                </Button>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {activeStep + 1} / {stages.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeStep === stages.length - 1}
                  onClick={() => goStep(activeStep + 1)}
                  className="gap-1"
                >
                  下一阶段
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {selection && (
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={explainSelection}
          style={{ left: selection.x, top: selection.y }}
          className="fixed z-50 -translate-x-1/2 -translate-y-[130%] flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background shadow-lg"
        >
          <Sparkles className="size-3.5" />
          AI 解释
        </button>
      )}

      {panelOpen ? (
        <aside className="hidden w-[348px] shrink-0 flex-col border-l bg-surface-2 md:flex">
          <div className="flex items-center gap-2 border-b px-3.5 py-3">
            <MessageCircleQuestion className="size-4 text-primary" />
            <span className="text-[13px] font-semibold">答疑辅导</span>
            <span className="ml-auto" />
            <button
              onClick={() => setPanelOpen(false)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="收起"
            >
              <X className="size-4" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="thin-scroll flex-1 space-y-4 overflow-y-auto px-3.5 py-4"
          >
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] leading-relaxed text-primary-foreground">
                    {message.content}
                  </div>
                </div>
              ) : (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2"
                >
                  <AssistantAvatar className="size-6 shrink-0 rounded-md text-[12px]" />
                  <div className="min-w-0 flex-1 pt-0.5">
                    {message.streaming && !message.content ? (
                      <Thinking />
                    ) : (
                      <Markdown
                        content={message.content}
                        streaming={message.streaming}
                      />
                    )}
                  </div>
                </motion.div>
              )
            )}
          </div>

          <div className="shrink-0 border-t p-2.5">
            <div className="flex items-end gap-1.5 rounded-xl border bg-card p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void ask(input);
                    setInput("");
                  }
                }}
                placeholder={
                  asking ? "辅导师思考中…" : "选中资料或直接提问"
                }
                disabled={asking}
                rows={1}
                className="max-h-28 min-h-8 flex-1 resize-none border-0 bg-transparent p-1.5 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <Button
                size="icon"
                className="size-7 shrink-0 rounded-full"
                disabled={asking || !input.trim()}
                onClick={() => {
                  void ask(input);
                  setInput("");
                }}
                aria-label="发送"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </div>
        </aside>
      ) : (
        <button
          onClick={() => setPanelOpen(true)}
          className="hidden shrink-0 items-center gap-2 border-l bg-surface-2 px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground md:flex [writing-mode:vertical-rl]"
        >
          <MessageCircleQuestion className="size-4" />
          答疑辅导
        </button>
      )}

      <ResourceViewer item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}
