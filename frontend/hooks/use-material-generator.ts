"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { streamSSE } from "@/lib/api";
import { getStudentId } from "@/lib/student-identity";
import {
  assessmentToContext,
  listAssessments,
  type AssessmentRecord,
} from "@/lib/library";
import {
  createInitialMaterialTypeSelection,
  materialTypesForRequest,
  MATERIAL_TYPE_LABEL,
  toggleMaterialTypeSelection,
} from "@/lib/material-types";
import { finalizeGeneratedResources } from "@/lib/resource-generation-state";
import {
  agentRunStoreReducer,
  createAgentRunStore,
  normalizeAgentRunEvent,
  selectActiveRun,
} from "@/lib/agent-run-store";
import type { ResourceData, ResourceItem, ResourceType } from "@/lib/types";

/** 与 use-orchestrator.metaFromData 对齐：从内容载荷提炼卡片元信息。 */
function metaFromData(d: ResourceData): string[] {
  const meta: string[] = [];
  const n = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).length : 0);
  if (n("questions")) meta.push(`${n("questions")} 题`);
  if (n("key_points")) meta.push(`${n("key_points")} 个要点`);
  if (n("scenes")) meta.push(`${n("scenes")} 个章节内容`);
  if (n("articles")) meta.push(`${n("articles")} 篇`);
  if (n("nodes")) meta.push(`${n("nodes")} 节点`);
  if (n("slides")) meta.push(`${n("slides")} 页`);
  if (n("interactions")) meta.push(`${n("interactions")} 个交互点`);
  if (typeof d.language === "string") meta.push(d.language);
  return meta.slice(0, 3);
}

function deriveSubtitle(d: ResourceData): string {
  return (
    (d.overview as string) ||
    (d.summary as string) ||
    (d.description as string) ||
    (d.explanation as string) ||
    "生成完成，已保存到资源中心"
  );
}

function placeholder(type: ResourceType): ResourceItem {
  return {
    id: `${type}_gen`,
    type,
    title: MATERIAL_TYPE_LABEL[type] ?? type,
    subtitle: "排队等待生成…",
    meta: [],
    status: "pending",
    version: 1,
    sources: 0,
  };
}

/**
 * 资源生成控制器：表单状态 + 后端 SSE 流式生成，
 * 由 web `/create` 与桌面 `/desktop/create` 两套布局共用，二者只是视图不同。
 */
function useMaterialGeneratorController() {
  const { mode } = useOrchestratorContext();

  const [topic, setTopic] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [selected, setSelected] = useState<Set<ResourceType>>(
    createInitialMaterialTypeSelection,
  );
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [assessmentId, setAssessmentId] = useState("");

  // 题目生成配置（练习题或题目解析时生效）。各题型数量由前端先限定范围。
  const [quizConfig, setQuizConfig] = useState({ choice: 5, judge: 0, short: 0 });
  const setQuizCount = (key: "choice" | "judge" | "short", value: number) =>
    setQuizConfig((prev) => ({
      ...prev,
      [key]: Number.isFinite(value) ? Math.max(0, Math.min(30, Math.floor(value))) : 0,
    }));

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState("");
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [openItem, setOpenItem] = useState<ResourceItem | null>(null);
  const [outputStreams, setOutputStreams] = useState<Record<string, string>>({});
  const [agentRunStore, dispatchAgentRun] = useReducer(
    agentRunStoreReducer,
    undefined,
    createAgentRunStore,
  );
  const tokenRef = useRef(0);
  const traceSequenceRef = useRef(1);

  useEffect(() => {
    if (mode === "checking") return;
    listAssessments(mode).then(setAssessments).catch(() => setAssessments([]));
  }, [mode]);

  const toggle = (id: ResourceType) =>
    setSelected((prev) => toggleMaterialTypeSelection(prev, id));

  const quizSelected = selected.has("quiz") || selected.has("solution");
  const quizTotal = quizConfig.choice + quizConfig.judge + quizConfig.short;

  const canRun =
    !running &&
    mode === "live" &&
    selected.size > 0 &&
    (topic.trim().length > 0 || knowledge.trim().length > 0) &&
    // 勾了练习题就必须至少出 1 道，避免空配置
    (!quizSelected || quizTotal >= 1);

  const patchByType = (type: string, patch: Partial<ResourceItem>) =>
    setResources((prev) => prev.map((r) => (r.type === type ? { ...r, ...patch } : r)));

  const run = async () => {
    if (!canRun) return;
    const t = ++tokenRef.current;
    const types = materialTypesForRequest(selected);
    setRunning(true);
    setDone(false);
    setStatus("准备生成…");
    setResources(types.map(placeholder));
    setOutputStreams({});
    dispatchAgentRun({ type: "clear" });
    traceSequenceRef.current = 1;

    const assessmentContext = assessmentId
      ? assessmentToContext(assessments.find((a) => a.id === assessmentId)!)
      : "";

    if (mode !== "live") {
      setStatus("后端未连接，无法生成真实资料。请先启动本地后端。");
      setResources((prev) => finalizeGeneratedResources(prev, true));
      setRunning(false);
      return;
    }

    let streamFailed = false;
    const idempotencyKey = globalThis.crypto.randomUUID();
    try {
      await streamSSE(
        "/api/materials/generate",
        {
          topic: topic.trim(),
          student_id: getStudentId(),
          material_types: types,
          knowledge_points: knowledge.trim(),
          assessment_context: assessmentContext,
          idempotency_key: idempotencyKey,
          ...(quizSelected ? { quiz_config: quizConfig } : {}),
        },
        ({ event, data }) => {
          if (tokenRef.current !== t) return;
          if (event === "trace") {
            const trace = normalizeAgentRunEvent(data, traceSequenceRef.current++);
            if (trace) dispatchAgentRun({ type: "ingest", event: trace });
          } else if (event === "plan") {
            const modules = (data.modules as string[]) ?? types;
            setResources(modules.map((m) => placeholder(m as ResourceType)));
          } else if (event === "progress") {
            const agent = data.agent as string;
            if (agent && agent !== "reviewer" && (data.status as string) === "started") {
              patchByType(agent, {
                status: "pending",
                subtitle: data.retry ? "按驳回意见重做…" : "生成中…",
              });
              setStatus(`${MATERIAL_TYPE_LABEL[agent] ?? agent} 生成中…`);
            } else if (agent === "reviewer") {
              setStatus("质检审核 · 知识库比对中…");
            }
          } else if (event === "content_start") {
            const resourceType = String(data.type ?? "");
            if (data.review_approved === true && resourceType) {
              setOutputStreams((current) => ({ ...current, [resourceType]: "" }));
            }
          } else if (event === "content_delta") {
            const resourceType = String(data.type ?? "");
            const delta = typeof data.delta === "string" ? data.delta : "";
            if (data.review_approved === true && resourceType && delta) {
              setOutputStreams((current) => ({
                ...current,
                [resourceType]: `${current[resourceType] ?? ""}${delta}`,
              }));
              setStatus(`${MATERIAL_TYPE_LABEL[resourceType] ?? resourceType} 正在流式输出…`);
            }
          } else if (event === "content") {
            const d = (data.data ?? {}) as ResourceData;
            const resourceType = String(data.type ?? d.type ?? data.agent ?? "");
            // 候选内容不会进入卡片。只有统一审核管线显式批准并回传的最终
            // 版本，才可从“生成中”切换为“已过审”。
            if (data.review_approved !== true || !resourceType) return;
            patchByType(resourceType, {
              title:
                (d.title as string) ||
                MATERIAL_TYPE_LABEL[resourceType] ||
                resourceType,
              subtitle: deriveSubtitle(d),
              meta: metaFromData(d),
              sources: Array.isArray(d.sources) ? d.sources.length : 0,
              status: "ready",
              data: d,
            });
          } else if (event === "done") {
            setStatus("生成完成");
          } else if (event === "saved") {
            setStatus(
              `已保存 ${data.count ?? ""} 份资料到资源中心${
                types.includes("quiz") ? "（题目已入试题库）" : ""
              }`
            );
          } else if (event === "error") {
            streamFailed = true;
            setStatus(`生成失败：${(data.message as string) ?? "未知错误"}`);
          }
        }
      );
      if (tokenRef.current !== t) return;
      setResources((prev) => finalizeGeneratedResources(prev, streamFailed));
    } catch (err) {
      if (tokenRef.current !== t) return;
      streamFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`与后端连接出现问题（${msg}）。请确认后端已启动。`);
      setResources((prev) => finalizeGeneratedResources(prev, true));
    }

    setRunning(false);
    setDone(true);
  };

  return {
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
    outputStreams,
    activeAgentRun: selectActiveRun(agentRunStore),
    openItem,
    setOpenItem,
    canRun,
    run,
  };
}

export type MaterialGeneratorController = ReturnType<typeof useMaterialGeneratorController>;

const MaterialGeneratorContext = createContext<MaterialGeneratorController | null>(null);

/** Root-scoped provider keeps the SSE request and its visible state alive across route changes. */
export function MaterialGeneratorProvider({ children }: { children: ReactNode }) {
  const controller = useMaterialGeneratorController();
  return createElement(MaterialGeneratorContext.Provider, { value: controller }, children);
}

export function useMaterialGenerator(): MaterialGeneratorController {
  const controller = useContext(MaterialGeneratorContext);
  if (!controller) {
    throw new Error("useMaterialGenerator must be used within MaterialGeneratorProvider");
  }
  return controller;
}
