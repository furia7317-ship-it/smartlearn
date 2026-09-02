"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  GitBranch,
  Globe,
  Loader2,
  MessageSquareText,
  PencilLine,
  Sparkles,
  Waypoints,
  X,
} from "lucide-react";
import { openInBrowser } from "@/lib/browser-bus";
import { API_BASE, streamSSE, streamSSEGet } from "@/lib/api";

import { AgentIconTile } from "@/components/agent-bits";
import { CodeExecutionVisualizer } from "@/components/code-execution-visualizer";
import { HtmlSandbox } from "@/components/html-sandbox";
import { Markdown } from "@/components/markdown";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { useTeacherWindow } from "@/components/desktop/teacher-window-provider";
import { ResourcePathAttachmentDialog } from "@/components/resource-path-attachment-dialog";
import { QuizRunner } from "@/components/quiz-runner";
import { SlideDeck } from "@/components/slide-deck";
import { VideoPlayer } from "@/components/video-player";
import { Badge } from "@/components/ui/badge";
import { TYPE_NAMES } from "@/lib/resource-types";
import { exportCoursewarePpt } from "@/lib/ppt-export";
import type { QuizSubmission } from "@/lib/practice-feedback";
import { PptGenerateModal } from "@/components/ppt-generate-modal";
import { getStudentId } from "@/lib/student-identity";
import {
  LEARNING_ACTIVITY_UPDATED_EVENT,
  addLearningActivityDuration,
  addLearningActivityInteraction,
  createLearningActivityEvent,
  finishLearningActivityEvent,
  learningActivityInputFromResource,
  persistLearningActivityEvent,
  type LearningActivityEvent,
  type LearningActivityInteraction,
} from "@/lib/learning-activity";
import { getMaterialData, linkMaterialVideo } from "@/lib/library";
import { createNoteSourceDraft, saveNoteSourceDraft } from "@/lib/note-draft";
import {
  checkCodeVisualizationEligibility,
  requestCodeVisualization,
  restoreCodeVisualization,
  type CodeVisualizationEligibility,
  type CodeVisualizationResponse,
} from "@/lib/code-lab";
import type { MindmapNode, ResourceData, ResourceItem, Slide } from "@/lib/types";
import {
  forgetVideoTaskId,
  readVideoTaskId,
  rememberVideoTaskId,
  VIDEO_WORKFLOW_VERSION,
} from "@/lib/video-task-cache";
import { cn } from "@/lib/utils";
import { MindmapWorkspace } from "@/components/mindmap-workspace";

/** 资源正文：走全站统一 Markdown（含 remark-math + rehype-katex 公式渲染）。 */
function Prose({ content }: { content: string }) {
  return <Markdown content={content} />;
}

function normalizedResourceData(data: ResourceData): ResourceData {
  const candidates = [data.explanation, data.content];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) continue;
    const inner = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      const parsed = JSON.parse(inner) as ResourceData;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...data, ...parsed };
      }
    } catch {
      // Leave genuinely malformed legacy content untouched; the viewer still
      // renders the original Markdown instead of crashing.
    }
  }
  return data;
}

/* ── 各类型正文 ─────────────────────────────────── */

function lectureSections(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const sections: { id: string; label: string; content: string }[] = [];
  let start = 0;
  let label = "讲义导读";
  const push = (end: number) => {
    const content = lines.slice(start, end).join("\n").trim();
    if (!content) return;
    sections.push({ id: `lecture-section-${sections.length + 1}`, label, content });
  };
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    push(index);
    start = index;
    label = match[2].replace(/[*_`]/g, "").trim();
  });
  push(lines.length);
  return sections;
}

export function extractPythonCodeExamples(markdown: string): ResourceData[] {
  const examples: ResourceData[] = [];
  const pattern = /```(?:python|py)\s*\r?\n([\s\S]*?)```/gi;
  for (const match of markdown.matchAll(pattern)) {
    const code = match[1]?.trim();
    if (!code) continue;
    examples.push({
      type: "code",
      language: "python",
      title: `代码示例 ${examples.length + 1}`,
      code,
      explanation: "从讲义正文识别的可运行 Python 示例。",
    });
  }
  return examples;
}

function ExplainerBody({ d, resourceId }: { d: ResourceData; resourceId: string }) {
  const codeExamples = useMemo(() => {
    const embedded = Array.isArray(d.embedded_code_examples)
      ? (d.embedded_code_examples as ResourceData[])
      : [];
    const extracted = extractPythonCodeExamples(
      [d.explanation, d.content].filter((value): value is string => typeof value === "string").join("\n"),
    );
    const seen = new Set<string>();
    return [...embedded, ...extracted].filter((example) => {
      const code = typeof example.code === "string" ? example.code.trim() : "";
      if (!code || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
  }, [d.content, d.embedded_code_examples, d.explanation]);
  const readings = Array.isArray(d.embedded_readings)
    ? (d.embedded_readings as ResourceData[])
    : [];
  const sections = useMemo(() => lectureSections(typeof d.explanation === "string" ? d.explanation : ""), [d.explanation]);
  const outline = useMemo(
    () => [
      ...sections.map(({ id, label }) => ({ id, label })),
      ...(codeExamples.length ? [{ id: "lecture-code", label: "动手演示" }] : []),
      ...(readings.length ? [{ id: "lecture-reading", label: "扩展阅读" }] : []),
    ],
    [codeExamples.length, readings.length, sections],
  );
  const articleRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(outline[0]?.id ?? "");

  useEffect(() => {
    const article = articleRef.current;
    const scrollRoot = article?.closest<HTMLElement>("[data-resource-scroll='true']");
    if (!article || !scrollRoot || outline.length === 0) return;
    const update = () => {
      const rootTop = scrollRoot.getBoundingClientRect().top + 112;
      let current = outline[0].id;
      for (const entry of outline) {
        const node = article.querySelector<HTMLElement>(`#${entry.id}`);
        if (node && node.getBoundingClientRect().top <= rootTop) current = entry.id;
      }
      setActiveId(current);
    };
    update();
    scrollRoot.addEventListener("scroll", update, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", update);
  }, [outline]);

  const jumpTo = (id: string) => {
    const node = articleRef.current?.querySelector<HTMLElement>(`#${id}`);
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  };

  return (
    <div ref={articleRef} className="grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-card/85 p-2.5 lg:sticky lg:top-3" aria-label="讲义章节目录">
        <div className="px-2 pb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">讲义章节</div>
        <nav className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          {outline.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => jumpTo(entry.id)}
              aria-current={activeId === entry.id ? "location" : undefined}
              className={cn(
                "min-w-max rounded-lg px-2.5 py-2 text-left text-xs leading-5 transition-colors lg:min-w-0",
                activeId === entry.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="mr-1.5 font-mono text-[10px] opacity-70">{String(index + 1).padStart(2, "0")}</span>
              {entry.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 space-y-5">
        {d.overview && (
          <p className="rounded-lg border-l-2 border-primary bg-muted/40 px-3.5 py-2.5 text-[13.5px] font-medium leading-relaxed">
            {d.overview}
          </p>
        )}
        {sections.map((section) => (
          <section key={section.id} id={section.id} data-lecture-section className="scroll-mt-6">
            <Prose content={section.content} />
          </section>
        ))}
        {d.analogy && (
          <div className="rounded-lg border border-info/25 bg-info/[0.05] px-3.5 py-3">
            <div className="text-[11px] font-semibold text-info">生活类比</div>
            <p className="mt-1 font-kai text-[14px] leading-relaxed text-foreground/90">{d.analogy}</p>
          </div>
        )}
        {Array.isArray(d.key_points) && d.key_points.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">要点总结</div>
            <ul className="space-y-1.5">
              {d.key_points.map((p, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {codeExamples.length > 0 && (
          <section id="lecture-code" data-lecture-section className="scroll-mt-6 space-y-3 border-t pt-5">
            <div><div className="text-[11px] font-semibold text-primary">动手演示</div><h2 className="mt-1 font-display text-lg font-semibold">把概念落到可运行代码</h2></div>
            {codeExamples.map((example, index) => (
              <CodeBody
                key={String(example.task_id ?? index)}
                d={normalizedResourceData(example)}
                resourceId={`${resourceId}:code:${String(example.task_id ?? index)}`}
              />
            ))}
          </section>
        )}
        {readings.length > 0 && (
          <section id="lecture-reading" data-lecture-section className="scroll-mt-6 space-y-3 border-t pt-5">
            <div><div className="text-[11px] font-semibold text-primary">课外延伸</div><h2 className="mt-1 font-display text-lg font-semibold">从本节知识继续往外读</h2></div>
            {readings.map((reading, index) => <ReadingBody key={String(reading.task_id ?? index)} d={normalizedResourceData(reading)} />)}
          </section>
        )}
      </div>
    </div>
  );
}

function ReadingBody({ d }: { d: ResourceData }) {
  return (
    <div className="space-y-4">
      {d.content && <Prose content={d.content} />}
      {Array.isArray(d.key_terms) && d.key_terms.length > 0 && (
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">关键术语</div>
          <div className="space-y-1.5">
            {d.key_terms.map((t, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-2 text-[13px] leading-relaxed">
                <span className="font-semibold text-primary">{t.term}</span>
                <span className="text-muted-foreground"> —— {t.definition}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(d.discussion_questions) && d.discussion_questions.length > 0 && (
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">思考题</div>
          <ul className="space-y-1.5">
            {d.discussion_questions.map((q, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                <span className="font-mono text-[11px] text-primary">Q{i + 1}</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(d.references) && d.references.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          参考：{d.references.join(" · ")}
        </p>
      )}
    </div>
  );
}

function ReflectionBody({ d }: { d: ResourceData }) {
  const userContent = typeof d.user_content === "string" ? d.user_content : "";
  const aiSupplement = typeof d.ai_supplement === "string" ? d.ai_supplement : "";
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#d9b36d] bg-[#fff8e9] p-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-[#6f4b20]">
          <span>我的复盘</span>
          <span className="rounded-full bg-[#f3e0b9] px-2 py-1 text-[10px]">学生原文</span>
        </div>
        <div className="whitespace-pre-wrap text-[13.5px] leading-7 text-[#4c3923]">
          {userContent || "未保存学生原文"}
        </div>
      </section>
      {aiSupplement && (
        <section className="rounded-xl border border-[#96b5a0] bg-[#eef6f0] p-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-[#356044]">
            <span>AI 补充</span>
            <span className="rounded-full bg-[#d8eadc] px-2 py-1 text-[10px]">教师补充</span>
          </div>
          <div className="whitespace-pre-wrap text-[13.5px] leading-7 text-[#30533a]">
            {aiSupplement}
          </div>
        </section>
      )}
    </div>
  );
}

function CodeBlock({
  code,
  language,
  action,
}: {
  code: string;
  language?: string;
  action?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-zinc-900">
      {(language || action) && (
        <div className="flex min-h-9 items-center justify-between gap-3 border-b border-white/10 px-3 py-1">
          <span className="font-mono text-[10px] text-zinc-400">{language}</span>
          {action}
        </div>
      )}
      <pre className="thin-scroll overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-zinc-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CodeBody({ d, resourceId }: { d: ResourceData; resourceId: string }) {
  const [visualization, setVisualization] = useState<CodeVisualizationResponse | null>(null);
  const [visualizing, setVisualizing] = useState(false);
  const [visualizationError, setVisualizationError] = useState("");
  const [eligibility, setEligibility] = useState<CodeVisualizationEligibility | null>(null);
  const code = typeof d.code === "string" ? d.code : "";
  const language = String(d.language || "python").trim().toLocaleLowerCase();

  useEffect(() => {
    let cancelled = false;
    setEligibility(null);
    setVisualization(null);
    setVisualizationError("");
    void checkCodeVisualizationEligibility(code, language)
      .then(async (result) => {
        if (cancelled) return;
        setEligibility(result);
        if (!result.eligible) return;
        try {
          const restored = await restoreCodeVisualization(code, resourceId);
          if (!cancelled && restored?.execution.trace.length) {
            setVisualization(restored);
          }
        } catch {
          // A missing persistence service must not hide an otherwise valid action.
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEligibility({ eligible: false, reason: "暂时无法校验代码", line: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, resourceId]);

  if (!code) return <Empty />;

  const visualize = async () => {
    if (!eligibility?.eligible || visualizing) return;
    setVisualizing(true);
    setVisualizationError("");
    try {
      const result = await requestCodeVisualization(code, {
        title: typeof d.title === "string" ? d.title : "代码示例",
        context: typeof d.explanation === "string" ? d.explanation : "",
        resourceId,
      });
      if (result.execution.trace.length === 0) {
        const error = result.execution.error;
        setVisualization(null);
        setVisualizationError(
          error ? `${error.type}：${error.message}` : "代码运行后没有产生可演示的执行轨迹",
        );
        return;
      }
      setVisualization(result);
    } catch (error) {
      setVisualizationError(error instanceof Error ? error.message : String(error));
    } finally {
      setVisualizing(false);
    }
  };

  return (
    <div className="space-y-4">
      <CodeBlock
        code={code}
        language={d.language}
        action={eligibility?.eligible ? (
          <button
            type="button"
            onClick={() => void visualize()}
            disabled={visualizing}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {visualizing ? <Loader2 className="size-3.5 animate-spin" /> : <Waypoints className="size-3.5" />}
            {visualizing ? "生成中" : visualization ? "重新生成" : "生成演示"}
          </button>
        ) : undefined}
      />
      {visualizationError && (
        <p className="text-[11px] text-danger">{visualizationError}</p>
      )}
      {visualization && <CodeExecutionVisualizer code={code} result={visualization} />}
      {d.explanation && (
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">代码解释</div>
          <p className="text-[13px] leading-relaxed text-foreground/90">{d.explanation}</p>
        </div>
      )}
      {d.output && (
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">预期输出</div>
          <pre className="rounded-lg bg-muted/60 px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed">
            {d.output}
          </pre>
        </div>
      )}
      {Array.isArray(d.variations) && d.variations.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-[12px] font-semibold text-muted-foreground">变体写法</div>
          {d.variations.map((v, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-[12.5px] text-foreground/80">{v.description}</p>
              <CodeBlock code={v.code} language={d.language} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoBody({
  d,
  resourceId,
  resourceKey,
  mode,
  onDataPatch,
}: {
  d: ResourceData;
  resourceId: string;
  resourceKey: string;
  mode: "checking" | "live" | "offline";
  onDataPatch: (id: string, patch: Partial<ResourceData>) => void;
}) {
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  const [audioMessage, setAudioMessage] = useState("");
  const [renderError, setRenderError] = useState("");
  const [persistenceWarning, setPersistenceWarning] = useState("");
  const [renderStage, setRenderStage] = useState("");
  const [pausedTaskId, setPausedTaskId] = useState("");
  const startedRef = useRef(false);

  const persistTaskLink = useCallback(async (taskId: string) => {
    rememberVideoTaskId(window.localStorage, resourceKey, taskId);
    onDataPatch(resourceId, { media_task_id: taskId, media_status: "rendering" });
    try {
      const linked = await linkMaterialVideo(
        mode,
        resourceId,
        taskId,
        typeof d.task_id === "string" ? d.task_id : "",
      );
      if (!linked) return;
      onDataPatch(resourceId, {
        media_task_id: linked.media_task_id,
        media_status: linked.media_status,
        media_workflow_version: linked.media_workflow_version,
        media_file_url: linked.media_file_url ?? undefined,
      });
      setPersistenceWarning("");
    } catch (error) {
      setPersistenceWarning(
        error instanceof Error ? error.message : "成片关联暂未写入资料库",
      );
    }
  }, [d.task_id, mode, onDataPatch, resourceId, resourceKey]);

  const watchVideoTask = useCallback(async (taskId: string) => {
    let terminalStatus: "completed" | "failed" | "stale" | null = null;
    let failureMessage = "";
    await streamSSEGet(`/api/media/video/${encodeURIComponent(taskId)}`, ({ data }) => {
      if (typeof data.progress === "number") setProgress(data.progress);
      if (typeof data.audio_message === "string") setAudioMessage(data.audio_message);
      if (typeof data.render_stage === "string") setRenderStage(data.render_stage);
      if (data.status === "completed") {
        if (data.workflow_version === VIDEO_WORKFLOW_VERSION) {
          terminalStatus = "completed";
          setVideoUrl(`${API_BASE}/api/media/video/${encodeURIComponent(taskId)}/file`);
        } else {
          terminalStatus = "stale";
        }
      }
      if (data.status === "failed") {
        terminalStatus = "failed";
        failureMessage = String(data.error ?? "视频渲染失败");
        setRenderError(failureMessage);
      }
    });
    if (terminalStatus === null) {
      throw new Error("视频任务连接已中断，未收到完成或失败状态");
    }
    if (terminalStatus === "failed") {
      throw new Error(failureMessage || "视频渲染失败");
    }
    if (terminalStatus === "stale") {
      throw new Error("旧版视频需要按固定画布工作流重新生成");
    }
    await persistTaskLink(taskId);
  }, [persistTaskLink]);

  const renderVideo = useCallback(async () => {
    setRendering(true);
    setPausedTaskId("");
    setProgress(0);
    setRenderError("");
    setRenderStage("queued");
    try {
      const response = await fetch(`${API_BASE}/api/media/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: String(d.title ?? "讲解视频"),
          student_id: getStudentId(),
          script: d,
        }),
      });
      if (!response.ok) throw new Error(`创建视频任务失败 HTTP ${response.status}`);
      const payload = (await response.json()) as { task_id: string };
      await persistTaskLink(payload.task_id);
      await watchVideoTask(payload.task_id);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    } finally {
      setRendering(false);
    }
  }, [d, persistTaskLink, watchVideoTask]);

  const resumeVideo = useCallback(async (taskId: string) => {
    setRendering(true);
    setRenderError("");
    setPausedTaskId("");
    setRenderStage("正在恢复视频任务");
    try {
      const response = await fetch(
        `${API_BASE}/api/media/video/${encodeURIComponent(taskId)}/resume`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(`恢复视频任务失败 HTTP ${response.status}`);
      await watchVideoTask(taskId);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
      setPausedTaskId(taskId);
    } finally {
      setRendering(false);
    }
  }, [watchVideoTask]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const embeddedTaskId = typeof d.media_task_id === "string" ? d.media_task_id : "";
    const existingTaskId = readVideoTaskId(
      window.localStorage,
      resourceKey,
      embeddedTaskId,
    );
    const inspectExistingTask = async () => {
      if (!existingTaskId) {
        setRendering(false);
        setRenderStage("尚未生成 MP4");
        return;
      }
      try {
        const response = await fetch(
          `${API_BASE}/api/media/video/${encodeURIComponent(existingTaskId)}/snapshot`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`读取视频状态失败 HTTP ${response.status}`);
        const snapshot = await response.json() as {
          status?: string;
          workflow_version?: string;
          active?: boolean;
          resumable?: boolean;
          error?: string | null;
          render_stage?: string;
        };
        if (snapshot.status === "completed" && snapshot.workflow_version === VIDEO_WORKFLOW_VERSION) {
          setVideoUrl(`${API_BASE}/api/media/video/${encodeURIComponent(existingTaskId)}/file`);
          setRendering(false);
          return;
        }
        if (snapshot.active) {
          setRendering(true);
          await watchVideoTask(existingTaskId);
          return;
        }
        if (snapshot.resumable && snapshot.workflow_version === VIDEO_WORKFLOW_VERSION) {
          setPausedTaskId(existingTaskId);
          setRenderStage("视频任务已暂停");
          setRendering(false);
          return;
        }
        setRenderError(snapshot.error || "视频需要重新生成");
        setRendering(false);
      } catch (error) {
        forgetVideoTaskId(window.localStorage, resourceKey);
        setRenderError(error instanceof Error ? error.message : String(error));
        setRendering(false);
      }
    };
    void inspectExistingTask();
  }, [d.media_task_id, resourceKey, watchVideoTask]);

  return (
    <div className="space-y-3">
      {videoUrl ? (
        <video controls preload="metadata" src={videoUrl} className="w-full rounded-xl border bg-black" />
      ) : (
        <div className="space-y-3">
          <VideoPlayer d={d} />
          <div className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground" aria-live="polite">
            {rendering && <Loader2 className="size-3.5 animate-spin" />}
            {rendering
              ? `正在渲染 MP4 · ${renderStage || "正在生成章节内容成片"} · ${Math.round(progress * 100)}%`
              : renderError
                ? "MP4 生成未完成"
                : pausedTaskId
                  ? "MP4 任务已暂停，不会占用 CPU"
                  : "MP4 尚未生成"}
          </div>
          {!rendering && (
            <button
              type="button"
              onClick={() => void (pausedTaskId ? resumeVideo(pausedTaskId) : renderVideo())}
              className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-[12px] font-medium text-foreground hover:bg-muted"
            >
              {pausedTaskId ? "继续生成视频" : renderError ? "重新生成视频" : "生成视频"}
            </button>
          )}
        </div>
      )}
      {audioMessage && <p className="text-[11px] text-muted-foreground">{audioMessage}</p>}
      {persistenceWarning && (
        <p className="text-[11px] text-warning">
          成片可以播放，但资料关联尚未持久化：{persistenceWarning}
        </p>
      )}
      {renderError && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-danger">
          <p className="min-w-0 flex-1">
            视频未能完成自动生成：{renderError}。章节内容脚本已保留，可直接重试。
          </p>
          <button
            type="button"
            onClick={() => void renderVideo()}
            disabled={rendering}
            className="rounded-md border border-danger/30 px-2.5 py-1.5 font-medium hover:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            重新生成 MP4
          </button>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        视频会按“钩子—概念—例子—易错点—应用—总结”自动合片并烧录字幕；TTS 密钥未配置时先输出完整字幕成片，后续可直接补配音。
      </p>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
      该资源暂无可展示的详细内容。
    </div>
  );
}

function SolutionBody({ d }: { d: ResourceData }) {
  const questions = d.questions ?? [];
  if (questions.length === 0) return <Empty />;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#d8c7ae] bg-[#fffaf1] px-4 py-3">
        <div className="text-[11px] font-semibold tracking-[0.12em] text-[#8b5620]">题目解析</div>
        <p className="mt-1 text-sm leading-6 text-[#5f4a32]">题目、参考答案与解析成组呈现，适合订正、复盘和考前查漏。</p>
      </div>
      {questions.map((question, index) => (
        <article key={question.id ?? index} className="solution-paper overflow-hidden rounded-xl border border-[#d8c7ae] bg-white shadow-sm">
          <header className="flex items-start gap-3 border-b border-[#eadfce] bg-[#fbf7f0] px-4 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#3a2a18] font-mono text-xs font-semibold text-[#fffaf1]">{index + 1}</span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a7d5c]">{question.type === "mcq" ? "选择题" : question.type === "judge" ? "判断题" : "简答题"}</div>
              <div className="mt-1 text-[14px] font-medium leading-7 text-[#332719]">
                <Markdown content={question.stem} className="md-tight" />
              </div>
            </div>
          </header>
          {Array.isArray(question.options) && question.options.length > 0 && (
            <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
              {question.options.map((option) => (
                <div key={option} className="rounded-lg border border-[#e2d6c4] bg-[#fffdf8] px-3 py-2 text-xs leading-5 text-[#5f4a32]">
                  <Markdown content={option} className="md-tight" />
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 border-t border-[#eadfce] bg-[#fffaf4] px-4 py-4 sm:grid-cols-[minmax(140px,0.36fr)_minmax(0,1fr)]">
            <section>
              <div className="text-[10px] font-semibold tracking-[0.1em] text-success">参考答案</div>
              <div className="mt-1 font-kai text-[15px] font-semibold leading-6 text-[#385c43]">
                <Markdown content={question.answer ?? ""} className="md-tight" fallback={<p>暂无答案</p>} />
              </div>
            </section>
            <section className="border-t border-[#e7dac8] pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <div className="text-[10px] font-semibold tracking-[0.1em] text-[#8b5620]">逐题解析</div>
              <div className="mt-1 font-kai text-[14px] leading-7 text-[#51402e]">
                <Markdown content={question.explanation ?? ""} className="md-tight" fallback={<p>暂无解析</p>} />
              </div>
            </section>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ── 主体分发（课件走全屏放映器，单独处理） ────────── */

function ViewerBody({
  item,
  mode,
  onResourceDataPatch,
  onJump,
  onOpenPractice,
  practiceGenerating,
  practiceError,
  onAskMindmap,
  onQuizSubmit,
}: {
  item: ResourceItem;
  mode: "checking" | "live" | "offline";
  onResourceDataPatch: (id: string, patch: Partial<ResourceData>) => void;
  onJump: (label: string) => void;
  onOpenPractice: (label: string) => void | Promise<void>;
  practiceGenerating: boolean;
  practiceError: string;
  onAskMindmap: (label: string) => void;
  onQuizSubmit: (submission: QuizSubmission) => void;
}) {
  const d = item.data ? normalizedResourceData(item.data) : undefined;
  if (!d) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-foreground/85">{item.subtitle}</p>
        <Empty />
      </div>
    );
  }
  switch (item.type) {
    case "explainer":
      return <ExplainerBody d={d} resourceId={item.id} />;
    case "mindmap":
      return (
        <MindmapWorkspace
          key={item.id}
          data={d}
          title={item.title}
          onOpenResource={onJump}
          onOpenPractice={onOpenPractice}
          practiceGenerating={practiceGenerating}
          practiceError={practiceError}
          onAskTeacher={onAskMindmap}
        />
      );
    case "quiz":
      return <QuizRunner questions={d.questions ?? []} onSubmit={onQuizSubmit} />;
    case "solution":
      return <SolutionBody d={d} />;
    case "reading":
      return d.kind === "reflection" ? <ReflectionBody d={d} /> : <ReadingBody d={d} />;
    case "code":
      return <CodeBody d={d} resourceId={item.id} />;
    case "interactive":
      return <HtmlSandbox key={`${item.id}:${item.version}`} payload={d} title={item.title} />;
    case "video":
      return (
        <VideoBody
          key={item.id}
          d={d}
          resourceId={item.id}
          resourceKey={`${item.id}:${item.version}`}
          mode={mode}
          onDataPatch={onResourceDataPatch}
        />
      );
    default:
      return <Empty />;
  }
}

/* ── AI 讲解：把资源/某页内容压成提示语 ───────────── */

function flattenNodes(nodes: MindmapNode[] | undefined, depth = 0): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map(
      (n) =>
        `${"  ".repeat(depth)}- ${n.label}${
          n.children?.length ? `\n${flattenNodes(n.children, depth + 1)}` : ""
        }`
    )
    .join("\n");
}

function explainPromptForResource(item: ResourceItem): string {
  const d = item.data ? normalizedResourceData(item.data) : undefined;
  const name = TYPE_NAMES[item.type] ?? item.type;
  let body = "";
  if (d) {
    if (item.type === "courseware" && Array.isArray(d.slides)) {
      body = d.slides
        .map(
          (s, i) =>
            `第${s.slide_num ?? i + 1}页 ${s.title}${
              s.content?.length ? `：${s.content.join("、")}` : ""
            }`
        )
        .join("\n");
    } else if (item.type === "explainer") {
      body = [d.overview, d.explanation].filter(Boolean).join("\n");
    } else if (item.type === "reading") {
      body = d.content ?? "";
    } else if (item.type === "code") {
      body = [d.explanation, d.code].filter(Boolean).join("\n");
    } else if (item.type === "mindmap") {
      body = flattenNodes(d.nodes);
    } else if (item.type === "quiz") {
      body = (d.questions ?? []).map((q, i) => `${i + 1}. ${q.stem}`).join("\n");
    } else if (item.type === "video") {
      body = (d.narration ?? []).map((n) => n.text).join(" ");
    }
  }
  body = (body || item.subtitle || "").slice(0, 2000);
  return `请结合下面这份「${item.title}」（${name}），用通俗易懂的方式为我讲解其中的核心内容、重点和易错点：\n\n${body}`;
}

function explainPromptForSlide(item: ResourceItem, slide: Slide, i: number): string {
  const bullets =
    Array.isArray(slide.content) && slide.content.length
      ? `\n- ${slide.content.join("\n- ")}`
      : "";
  return `请讲解课件「${item.title}」第 ${slide.slide_num ?? i + 1} 页（${slide.title}）的内容，用通俗易懂的方式说明要点与背后的原理：${bullets}`;
}

/* ── 全屏查看器 ─────────────────────────────────── */

function useResourceLearningActivity(item: ResourceItem | null) {
  const activityRef = useRef<LearningActivityEvent | null>(null);
  const lastActiveAtRef = useRef<number | null>(null);
  const descriptor = useMemo(() => {
    if (!item || typeof window === "undefined") return null;
    try {
      return learningActivityInputFromResource(item, getStudentId());
    } catch {
      return null;
    }
  }, [item]);

  useEffect(() => {
    if (!descriptor) return;
    let disposed = false;
    let event = createLearningActivityEvent(descriptor);
    activityRef.current = event;

    const publish = () => {
      event = persistLearningActivityEvent(window.localStorage, event);
      activityRef.current = event;
      window.dispatchEvent(new CustomEvent(LEARNING_ACTIVITY_UPDATED_EVENT, {
        detail: { learnerId: event.learnerId, eventId: event.id },
      }));
    };
    const visibleAndFocused = () =>
      document.visibilityState !== "hidden" && document.hasFocus();
    const flushActive = (now = Date.now()) => {
      if (activityRef.current?.id === event.id) event = activityRef.current;
      const previous = lastActiveAtRef.current;
      if (previous !== null && now > previous) {
        event = addLearningActivityDuration(event, (now - previous) / 1000, new Date(now));
      }
      lastActiveAtRef.current = visibleAndFocused() ? now : null;
    };
    const flush = () => {
      if (disposed) return;
      flushActive();
      publish();
    };
    const finish = () => {
      if (disposed) return;
      flushActive();
      event = finishLearningActivityEvent(event);
      lastActiveAtRef.current = null;
      publish();
      disposed = true;
    };
    const resume = () => {
      if (visibleAndFocused()) {
        lastActiveAtRef.current = Date.now();
      }
    };
    const pause = () => {
      flushActive();
      lastActiveAtRef.current = null;
      publish();
    };
    const onVisibilityChange = () => {
      if (visibleAndFocused()) resume();
      else pause();
    };

    lastActiveAtRef.current = visibleAndFocused() ? Date.now() : null;
    publish();
    const heartbeat = window.setInterval(flush, 5_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", resume);
    window.addEventListener("blur", pause);
    window.addEventListener("pagehide", finish);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", resume);
      window.removeEventListener("blur", pause);
      window.removeEventListener("pagehide", finish);
      finish();
      if (activityRef.current?.id === event.id) activityRef.current = null;
    };
  }, [descriptor]);

  return useCallback((interaction: LearningActivityInteraction, amount = 1) => {
    const current = activityRef.current;
    if (!current || typeof window === "undefined") return;
    const next = addLearningActivityInteraction(current, interaction, amount);
    activityRef.current = persistLearningActivityEvent(window.localStorage, next);
    window.dispatchEvent(new CustomEvent(LEARNING_ACTIVITY_UPDATED_EVENT, {
      detail: { learnerId: next.learnerId, eventId: next.id },
    }));
  }, []);
}

export function ResourceViewer({
  item,
  onClose,
  taskKey,
}: {
  item: ResourceItem | null;
  onClose: () => void;
  taskKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { open: teacherOpen, openTeacher } = useTeacherWindow();
  const {
    askResourceQuestion,
    mode,
    patchResourceData,
    recordPractice,
    recordResourceStudy,
    resourcePathAttachments,
    resources,
    running,
  } = useOrchestratorContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const learningRecordedRef = useRef("");
  const lastTrackedScrollRef = useRef(0);
  const [linkedItem, setLinkedItem] = useState<ResourceItem | null>(null);
  const viewedItem = linkedItem ?? item;
  const viewedItemId = viewedItem?.id ?? "";
  const noteLearningActivityInteraction = useResourceLearningActivity(viewedItem);
  const [practiceGeneratingLabel, setPracticeGeneratingLabel] = useState("");
  const [practiceError, setPracticeError] = useState("");
  const practiceAbortRef = useRef<AbortController | null>(null);
  const [selectedText, setSelectedText] = useState("");
  // 「生成 PPT」弹窗（图片模板墙 + 讯飞智文成品生成），见 PptGenerateModal
  const [pptOpen, setPptOpen] = useState(false);
  const [pathAttachOpen, setPathAttachOpen] = useState(false);
  const [exportingPpt, setExportingPpt] = useState(false);
  // 用 portal 渲染到 body：避免被持久浏览器的 fixed 容器(z-10)困住，确保查看器盖住全屏
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    practiceAbortRef.current?.abort();
    practiceAbortRef.current = null;
    setLinkedItem(null);
    setPracticeGeneratingLabel("");
    setPracticeError("");
    setPathAttachOpen(false);
  }, [item?.id]);
  useEffect(() => () => practiceAbortRef.current?.abort(), []);
  const recordReadCompletion = useCallback(() => {
    const evidenceKey = viewedItem ? `${viewedItem.id}:${taskKey ?? ""}` : "";
    if (!viewedItem || viewedItem.type === "quiz" || learningRecordedRef.current === evidenceKey) return;
    learningRecordedRef.current = evidenceKey;
    recordResourceStudy(viewedItem, linkedItem ? undefined : taskKey);
  }, [linkedItem, recordResourceStudy, taskKey, viewedItem]);

  const trackReadingProgress = () => {
    const node = contentRef.current;
    if (!node || node.scrollHeight <= 0) return;
    const now = Date.now();
    if (now - lastTrackedScrollRef.current >= 3_000) {
      lastTrackedScrollRef.current = now;
      noteLearningActivityInteraction("scrolls");
    }
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 32) {
      recordReadCompletion();
    }
  };

  const submitQuiz = (submission: QuizSubmission) => {
    if (!viewedItem || viewedItem.type !== "quiz") return;
    noteLearningActivityInteraction("practiceSubmissions");
    learningRecordedRef.current = `${viewedItem.id}:${taskKey ?? ""}`;
    recordPractice(viewedItem, submission, linkedItem ? undefined : taskKey);
  };

  const openTutorAnswer = (
    prompt: string,
    displayQuestion = "讲解这份资料",
    context = "",
  ) => {
    if (!viewedItem || !prompt.trim() || running) return;
    const visibleContext = context.trim() || viewedItem.subtitle || "围绕当前资料内容进行问答";
    const accepted = askResourceQuestion({
      resourceId: viewedItem.id,
      resourceTitle: viewedItem.title,
      resourceContext: visibleContext,
      prompt,
      displayQuestion,
    });
    if (!accepted) return;
    noteLearningActivityInteraction("questions");
    openTeacher({
      module: "resource",
      title: viewedItem.title,
      detail: visibleContext,
      entityId: viewedItem.id,
    });
  };

  const openTutorQuestion = (context = "") => {
    if (!viewedItem) return;
    openTeacher({
      module: "resource",
      title: viewedItem.title,
      detail: context.trim() || viewedItem.subtitle || "围绕当前资料内容进行问答",
      entityId: viewedItem.id,
    });
  };

  const openRelatedLecture = async (label: string) => {
    if (!item) return;
    const currentPlan = typeof item.data?.plan_id === "string" ? item.data.plan_id : item.id.split(":")[0];
    const currentDay = String(item.data?.day_index ?? item.data?.day ?? item.data?.chapter_id ?? "");
    const normalized = label.trim().toLocaleLowerCase("zh-CN");
    const ranked = resources
      .filter((candidate) => candidate.type === "explainer" && candidate.status === "ready")
      .map((candidate) => {
        const candidatePlan = typeof candidate.data?.plan_id === "string" ? candidate.data.plan_id : candidate.id.split(":")[0];
        const candidateDay = String(candidate.data?.day_index ?? candidate.data?.day ?? candidate.data?.chapter_id ?? "");
        const searchable = `${candidate.title} ${candidate.subtitle} ${candidate.meta.join(" ")} ${String(candidate.data?.title ?? "")}`.toLocaleLowerCase("zh-CN");
        let score = 0;
        if (currentPlan && candidatePlan === currentPlan) score += 60;
        if (currentDay && candidateDay === currentDay) score += 35;
        if (normalized && searchable.includes(normalized)) score += 70;
        if (normalized && normalized.includes(candidate.title.toLocaleLowerCase("zh-CN"))) score += 25;
        return { candidate, score };
      })
      .filter((entry) => entry.score >= 60)
      .sort((a, b) => b.score - a.score);
    const match = ranked[0]?.candidate;
    if (!match) {
      openTutorAnswer(
        `请结合当前课程知识库、我的学习画像、摸底结果与记忆记录，为思维导图节点「${label}」生成一份结构完整的对应讲义，并保存到资源中心。`,
        `讲解知识节点「${label}」`,
        `当前思维导图节点：${label}`,
      );
      return;
    }
    if (match.data) {
      setLinkedItem(match);
      return;
    }
    const data = await getMaterialData(mode, match.id).catch(() => undefined);
    setLinkedItem(data ? { ...match, data } : match);
  };

  const openPractice = async (label: string) => {
    if (!item || item.type !== "mindmap" || practiceGeneratingLabel) return;
    if (mode !== "live") {
      setPracticeError("后端尚未连接，暂时无法生成配套练习。");
      return;
    }

    const sourceData = item.data ? normalizedResourceData(item.data) : undefined;
    const currentPlan = typeof sourceData?.plan_id === "string" ? sourceData.plan_id : item.id.split(":")[0];
    const currentDay = String(sourceData?.day_index ?? sourceData?.day ?? sourceData?.chapter_id ?? "");
    const relatedResources = resources
      .filter((candidate) => {
        const candidatePlan = typeof candidate.data?.plan_id === "string" ? candidate.data.plan_id : candidate.id.split(":")[0];
        const candidateDay = String(candidate.data?.day_index ?? candidate.data?.day ?? candidate.data?.chapter_id ?? "");
        return candidate.status === "ready" && (
          (currentPlan && candidatePlan === currentPlan)
          || (currentDay && candidateDay === currentDay)
        );
      })
      .slice(0, 8)
      .map((candidate) => candidate.title);
    const outline = flattenNodes(sourceData?.nodes).slice(0, 4000);
    const controller = new AbortController();
    practiceAbortRef.current = controller;
    setPracticeGeneratingLabel(label);
    setPracticeError("");

    let approvedQuiz: ResourceData | null = null;
    let streamError = "";
    const idempotencyKey = globalThis.crypto.randomUUID();
    try {
      await streamSSE(
        "/api/materials/generate",
        {
          topic: `${item.title}：${label} 配套练习`,
          student_id: getStudentId(),
          material_types: ["quiz"],
          knowledge_points: label,
          requirements: `只围绕思维导图「${item.title}」中的当前节点「${label}」生成可直接作答的练习，覆盖概念辨析与实际应用，难度与当前课程上下文一致。`,
          assessment_context: [
            `当前思维导图：${item.title}`,
            `当前知识节点：${label}`,
            item.subtitle ? `资源摘要：${item.subtitle}` : "",
            item.meta.length ? `课程标签：${item.meta.join("、")}` : "",
            relatedResources.length ? `同课程已过审资源：${relatedResources.join("、")}` : "",
            outline ? `思维导图结构：\n${outline}` : "",
          ].filter(Boolean).join("\n"),
          idempotency_key: idempotencyKey,
          quiz_config: { choice: 5, judge: 0, short: 0 },
        },
        ({ event, data }) => {
          if (event === "error") {
            streamError = String(data.message ?? "练习生成失败");
            return;
          }
          if (event !== "content" || data.review_approved !== true) return;
          const candidate = (data.data ?? {}) as ResourceData;
          const resourceType = String(data.type ?? candidate.type ?? data.agent ?? "");
          if (resourceType !== "quiz" || !Array.isArray(candidate.questions)) return;

          approvedQuiz = candidate;
          const subtitle = [candidate.overview, candidate.summary, candidate.description]
            .find((value): value is string => typeof value === "string" && value.trim().length > 0)
            ?? `围绕「${label}」生成的配套练习`;
          setLinkedItem({
            id: `mindmap-practice:${item.id}:${Date.now()}`,
            type: "quiz",
            title: typeof candidate.title === "string" && candidate.title.trim()
              ? candidate.title
              : `${label}配套练习`,
            subtitle,
            meta: [`${candidate.questions.length} 题`, `节点：${label}`],
            status: "ready",
            version: 1,
            sources: Array.isArray(candidate.sources) ? candidate.sources.length : 0,
            data: candidate,
          });
        },
        controller.signal,
      );
      if (!approvedQuiz) {
        throw new Error(streamError || "练习生成完成，但没有返回通过审核的题目，请稍后重试。");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setPracticeError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (practiceAbortRef.current === controller) {
        practiceAbortRef.current = null;
        setPracticeGeneratingLabel("");
      }
    }
  };

  const goBack = useCallback(() => {
    if (linkedItem) setLinkedItem(null);
    else onClose();
  }, [linkedItem, onClose]);

  const captureSelection = () => {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const root = contentRef.current;
    if (!selection || !range || !root || !root.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 2400);
    if (text.length >= 2) {
      if (text !== selectedText) noteLearningActivityInteraction("selections");
      setSelectedText(text);
    }
  };

  const askAboutSelection = (question?: string) => {
    if (!viewedItem || !selectedText) return;
    const selectedContext = `选中内容：${selectedText}`;
    const request = question?.trim()
      ? `我在资料「${viewedItem.title}」中选中了下面这段内容：\n\n> ${selectedText}\n\n我的问题：${question.trim()}`
      : `请解释我在资料「${viewedItem.title}」中选中的下面这段内容。先用一句话说结论，再解释含义、原理和一个例子：\n\n> ${selectedText}`;
    setSelectedText("");
    openTutorAnswer(request, question?.trim() || "解释选中内容", selectedContext);
  };

  const openQuestionAboutSelection = () => {
    if (!viewedItem || !selectedText) return;
    const context = `我在资料「${viewedItem.title}」中选中了下面这段内容：\n\n> ${selectedText}`;
    setSelectedText("");
    openTutorQuestion(context);
  };

  const openNoteForSelection = () => {
    if (!viewedItem || !selectedText) return;
    saveNoteSourceDraft(createNoteSourceDraft({
      resourceId: viewedItem.id,
      resourceTitle: viewedItem.title,
      resourceType: viewedItem.type,
      selectedText,
    }));
    setSelectedText("");
    onClose();
    router.push(
      pathname.startsWith("/desktop")
        ? "/desktop/notes/new"
        : "/notes/new",
    );
  };

  useEffect(() => {
    if (!viewedItemId) return;
    learningRecordedRef.current = "";
    setSelectedText("");
  }, [taskKey, viewedItemId]);

  useEffect(() => {
    if (!viewedItemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!teacherOpen) goBack();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [goBack, teacherOpen, viewedItemId]);

  useEffect(() => {
    if (!viewedItem || viewedItem.type === "quiz" || viewedItem.type === "courseware") return;
    const timer = window.setTimeout(() => {
      const node = contentRef.current;
      if (node && node.scrollHeight <= node.clientHeight + 24) recordReadCompletion();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [recordReadCompletion, viewedItem]);

  const slides = viewedItem?.type === "courseware" ? viewedItem.data?.slides : undefined;
  const isDeck = Array.isArray(slides) && slides.length > 0;
  const canExportPpt = viewedItem?.type === "courseware" && isDeck;
  const canAttachToPath = Boolean(
    viewedItem && (
      viewedItem.id === item?.id || resources.some((resource) => resource.id === viewedItem.id)
    ),
  );
  const currentPathAttachment = viewedItem
    ? resourcePathAttachments[viewedItem.id]
    : undefined;

  const exportPptx = async () => {
    if (!viewedItem || !canExportPpt || exportingPpt) return;
    setExportingPpt(true);
    try {
      const url = await exportCoursewarePpt(viewedItem);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${viewedItem.title || "courseware"}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "导出 PPTX 失败");
    } finally {
      setExportingPpt(false);
    }
  };

  // 资源里挂了视频链接（如视频学习总结）→ 提供「内置浏览器打开」
  const videoUrl = (viewedItem?.data?.video as { url?: string } | undefined)?.url ?? "";

  const overlay = (
    <AnimatePresence>
      {viewedItem && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[60] flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* 顶部栏 */}
            <header className="flex shrink-0 items-center gap-3 border-b bg-surface-2/60 px-3 py-2.5 sm:px-4">
              <button
                onClick={goBack}
                aria-label="返回"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                <span className="hidden sm:inline">返回</span>
              </button>
              <AgentIconTile id={viewedItem.type} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold leading-tight">{viewedItem.title}</h2>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {TYPE_NAMES[viewedItem.type] ?? viewedItem.type}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {viewedItem.subtitle}
                </div>
              </div>

              <button
                type="button"
                disabled={running}
                onClick={() => openTutorAnswer(
                  explainPromptForResource(viewedItem),
                  "讲解整份资料",
                  viewedItem.subtitle || `${TYPE_NAMES[viewedItem.type] ?? viewedItem.type}的核心内容、重点和易错点`,
                )}
                title="让当前智能教师实时讲解这份资源"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <MessageSquareText className="size-3.5" />
                <span className="hidden sm:inline">智能教师讲解</span>
              </button>
              {canAttachToPath && (
                <button
                  type="button"
                  onClick={() => setPathAttachOpen(true)}
                  title={currentPathAttachment ? "查看或修改学习路径挂载位置" : "挂载到科目学习路径"}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-accent"
                >
                  <GitBranch className="size-3.5" />
                  <span className="hidden sm:inline">{currentPathAttachment ? "已挂载" : "挂载到路径"}</span>
                </button>
              )}
              {videoUrl && (
                <button
                  type="button"
                  onClick={() => {
                    if (!openInBrowser(videoUrl)) window.open(videoUrl, "_blank", "noopener");
                  }}
                  title="在内置浏览器打开视频"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-accent"
                >
                  <Globe className="size-3.5" />
                  <span className="hidden sm:inline">看视频</span>
                </button>
              )}
              {canExportPpt && (
                <button
                  type="button"
                  onClick={() => void exportPptx()}
                  disabled={exportingPpt}
                  title="导出当前课件为 PPTX"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportingPpt ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {exportingPpt ? "导出中" : "导出 PPTX"}
                  </span>
                </button>
              )}
              {canExportPpt && (
                <button
                  type="button"
                  onClick={() => setPptOpen(true)}
                  title="选模板生成精美 PPT"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-accent"
                >
                  <Sparkles className="size-3.5" />
                  <span className="hidden sm:inline">生成 PPT</span>
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="关闭"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            {/* 正文 */}
            {isDeck ? (
              <div ref={contentRef} onMouseUp={captureSelection} onKeyUp={captureSelection} className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
                <SlideDeck
                  slides={slides!}
                   title={viewedItem.title}
                   onExplainSlide={(s, i) => openTutorAnswer(
                     explainPromptForSlide(viewedItem, s, i),
                     `讲解第 ${s.slide_num ?? i + 1} 页：${s.title}`,
                     `当前课件页：${s.title}${s.content?.length ? `；${s.content.join("、")}` : ""}`,
                   )}
                  onReachEnd={recordReadCompletion}
                />
              </div>
            ) : (
              <div
                ref={contentRef}
                onScroll={trackReadingProgress}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
                 className={cn(
                   "thin-scroll min-h-0 flex-1",
                   viewedItem.type === "mindmap" ? "overflow-hidden" : "overflow-y-auto"
                 )}
                 data-resource-scroll="true"
               >
                 <div className={cn("w-full", viewedItem.type === "mindmap" ? "h-full" : viewedItem.type === "explainer" || viewedItem.type === "interactive" ? "mx-auto max-w-6xl px-4 py-6 sm:px-6" : "mx-auto max-w-3xl px-4 py-6 sm:px-6")}>
                   <ViewerBody
                    item={viewedItem}
                    mode={mode}
                    onResourceDataPatch={patchResourceData}
                    onJump={(label) => void openRelatedLecture(label)}
                    onOpenPractice={openPractice}
                    practiceGenerating={Boolean(practiceGeneratingLabel)}
                    practiceError={practiceError}
                    onAskMindmap={(label) => openTutorAnswer(
                      `请结合当前思维导图，讲解知识节点「${label}」。先说明它在整体知识结构中的位置，再讲核心概念、前置知识、常见误区和一个具体例子。`,
                      `讲解知识节点「${label}」`,
                      `当前思维导图节点：${label}`,
                    )}
                    onQuizSubmit={submitQuiz}
                  />
                </div>
              </div>
            )}

            {selectedText && (
              <div className="absolute bottom-20 right-4 z-20 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[#c9aa78] bg-[#fffaf2] p-2.5 shadow-xl" role="status" aria-live="polite">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="size-4 shrink-0 text-[#8b5620]" />
                  <p className="min-w-0 flex-1 truncate text-xs text-[#5f4a32]">已选中：{selectedText}</p>
                  <button type="button" onClick={() => setSelectedText("")} className="grid size-6 place-items-center rounded-md text-[#786650] hover:bg-[#eee4d5]" aria-label="取消选中内容"><X className="size-3.5" /></button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button type="button" disabled={running} onClick={() => askAboutSelection()} className="flex-1 rounded-lg bg-[#3a2a18] px-3 py-2 text-xs font-medium text-[#fffaf1] hover:bg-[#4c3821] disabled:cursor-not-allowed disabled:opacity-45">解释选中内容</button>
                  <button type="button" onClick={openQuestionAboutSelection} className="flex-1 rounded-lg border border-[#cdbb9f] px-3 py-2 text-xs font-medium text-[#704719] hover:bg-[#f4eadb]">就此询问</button>
                  <button type="button" onClick={openNoteForSelection} className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#b7864c] bg-[#f7ead7] px-3 py-2 text-xs font-medium text-[#704719] hover:bg-[#edd9bd]"><PencilLine className="size-3.5" />写笔记</button>
                </div>
              </div>
            )}

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return mounted
    ? createPortal(
        <>
          {overlay}
          <PptGenerateModal item={pptOpen ? viewedItem : null} onClose={() => setPptOpen(false)} />
          <ResourcePathAttachmentDialog
            item={pathAttachOpen ? viewedItem : null}
            onClose={() => setPathAttachOpen(false)}
          />
        </>,
        document.body
      )
    : null;
}
