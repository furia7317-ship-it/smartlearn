"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeStoredMessages, conversationTitle, createConversationId, upsertConversation, buildConversationStateSnapshot } from "@/lib/conversation-state";
import { useConversationPersistence } from "@/hooks/use-conversation-persistence";

import {
  cancelAgentRun,
  checkBackend,
  fetchAgentRunEvents,
  getCachedBackendStatus,
  resolveAgentResourceAction,
  streamSSE,
} from "@/lib/api";
import { ApiRequestError, requestErrorMessage } from "@/lib/api-error";
import {
  fallbackResourceAction,
  hasResourceTypeHint,
  isResourceOpenIntent,
  readyResourceCandidates,
  wantsResourceGeneration,
} from "@/lib/agent-action";
import {
  acceptsBoundRun,
  agentRunStoreReducer,
  bindNestedRunEventData,
  createAgentRunStore,
  normalizeAgentRunEvent,
} from "@/lib/agent-run-store";
import { WORKER_IDS, initialAgentState } from "@/lib/agents";
import { openInBrowser } from "@/lib/browser-bus";
import {
  inferConversationKind,
  inferResourceTitle,
  splitLegacyResourceConversation,
  type ConversationKind,
} from "@/lib/conversation-sessions";
import {
  getConversationState,
  getConversationSync,
  saveConversationState,
  type StoredConversationState,
} from "@/lib/conversation-store";
import {
  QUIZ_PASS_SCORE,
  resourceCompletionKey,
  taskCompletionKey,
} from "@/lib/daily-task-plan";
import type { MasteryLevel } from "@/lib/material-types";
import {
  applyResourcePathAttachments,
  bindSubjectSupplementRequest,
  buildMasterLearningPath,
  buildSubjectLearningPaths,
  type ResourcePathAttachment,
  type SubjectPathControl,
} from "@/lib/master-learning-path";
import { normalizePathSteps } from "@/lib/path-normalize";
import {
  localDateFromTimestamp,
  localDateKey,
  pathScheduleSignature,
} from "@/lib/path-schedule-clock";
import {
  cancelResourcePlan,
  createResourcePlan,
  getResourcePlan,
  replanResourcePlan,
  saveResourcePlan,
  streamResourcePlanExecution,
} from "@/lib/resource-plan-api";
import { planResourceId } from "@/lib/resource-plan-identity";
import {
  reconcilePlanFailureConversations,
  reconcilePlanFailureMessages,
  resourcePlanTerminalMessage,
} from "@/lib/resource-plan-completion";
import {
  acceptResourcePlanSnapshot,
  completeActiveResourcePlanRun,
  isCompletedResourcePlanRecord,
  isPlanRunActive,
  recoverAcceptedResourcePlanSnapshot,
  runPlansSequentially,
} from "@/lib/resource-plan-runtime";
import {
  type ResourceExecutionEvent,
  type ResourcePlan,
  type ResourcePlanRecord,
} from "@/lib/resource-plan";
import {
  createResourcePhaseState,
  reduceResourceExecutionEvent,
} from "@/lib/resource-phase-reducer";
import {
  recoverResourcePlanRecord,
  resourcePlanTaskOwnerCounts,
  scheduleSnapshotToPath as scheduleToPath,
} from "@/lib/resource-plan-recovery";
import { createReasoningPresentationQueue } from "@/lib/reasoning-presentation";
import { masteryTarget, mergeAssessmentTags } from "@/lib/profile-assessment";
import { getStudentId } from "@/lib/student-identity";
import {
  deleteLearnerWorkspaceState,
  getLearnerWorkspaceState,
  saveLearnerWorkspaceState,
} from "@/lib/learner-state";
import {
  DEFAULT_TEACHER,
  normalizeTeacherPersona,
  type TeacherPersona,
} from "@/lib/teacher-persona";
import { isValidLearningBaseline, needsLearningBaseline } from "@/lib/learning-baseline";
import { createMarketPathRecord, type MarketPathSnapshot } from "@/lib/learning-market";
import {
  confirmedLearningPathAnswers,
  learningPathConfirmationMessage,
  type LearningPathConfirmation,
} from "@/lib/learning-path-confirmation";
import { beginPlanning, canCancelPlanning, editPlanning, failPlanning, restoreLearningPathRun, type LearningPathRunState } from "@/lib/learning-path-run-state";
import { deleteMaterial, deletePaper, listMaterials } from "@/lib/library";
import {
  applyPracticeProfile,
  buildPathAdjustment,
  type PathAdjustment,
  type PracticeAttempt,
  type QuizSubmission,
} from "@/lib/practice-feedback";
import { PROFILE_BASE } from "@/lib/starter-content";
import type {
  AgentId,
  AgentRuntime,
  ChatMessage,
  LogLevel,
  LogLine,
  PathStep,
  Phase,
  ProfileDim,
  ResourceData,
  ResourceItem,
  ResourceType,
  TutorAttachment,
  TutorPageContext,
} from "@/lib/types";
import {
  buildWatchedVideoStep,
  searchBilibiliVideos,
  type BilibiliVideoResult,
  type WatchedVideoRecord,
} from "@/lib/video-learning";

export type OrchestratorMode = "checking" | "live" | "offline";

export interface PlanTask {
  agent: AgentId;
  label: string;
}

export interface TaskEvidenceRecord {
  kind: "resource_read" | "quiz_submission" | "written_response";
  content: string;
  completedAt: string;
  passed?: boolean;
}

/** SQLite workspace snapshot（不包含瞬态 running/phase/agents/logs）。 */
const SESSION_KEY = "sl_studio_session_v1";

function accountStorageKey(baseKey: string): string {
  return `${baseKey}:${getStudentId()}`;
}

interface TutorRunControl {
  conversationId: string;
  messageId: string;
  controller: AbortController;
}

interface DurableSession {
  messages: ChatMessage[];
  conversationHistory?: ConversationSession[];
  activeConversationId?: string;
  activeConversationTitle?: string;
  activeConversationUpdatedAt?: number;
  activeConversationKind?: ConversationKind;
  activeResourceId?: string;
  activeResourceTitle?: string;
  activeResourceContext?: string;
  activeTeacher?: TeacherPersona;
  resources: ResourceItem[];
  path: PathStep[];
  pathScheduleAnchor?: string;
  pathScheduleSignature?: string;
  subjectPathControls?: Record<string, SubjectPathControl>;
  resourcePathAttachments?: Record<string, ResourcePathAttachment>;
  profile: ProfileDim[];
  tags: string[];
  profileUpdatedAt?: string;
  profileSources?: string[];
  planTasks: PlanTask[];
  planReason: string;
  hasRunMain: boolean;
  practiceAttempts: PracticeAttempt[];
  adjustments: PathAdjustment[];
  /** 路径资料完成状态，键为 `${阶段下标}:${type}`。 */
  completedMaterials: string[];
  taskEvidence: Record<string, TaskEvidenceRecord>;
  watchedVideos: WatchedVideoRecord[];
  plans: Record<string, ResourcePlanRecord>;
  resourceExecution: ReturnType<typeof createResourcePhaseState>;
}

export interface ConversationSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  teacher: TeacherPersona;
  kind: ConversationKind;
  resourceId: string;
  resourceTitle: string;
  resourceContext: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  active: boolean;
  running: boolean;
  teacher: TeacherPersona;
  kind: ConversationKind;
  resourceId: string;
  resourceTitle: string;
}

export interface ResourceConversationRequest {
  resourceId: string;
  resourceTitle: string;
  resourceContext?: string;
  prompt: string;
  displayQuestion: string;
}

export interface ResourceRemovalResult {
  id: string;
  removedFrom: "library" | "session";
  removedPaper: boolean;
}

function now(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 辅导图节点名 → 可读步骤名。 */
const TUTOR_STEPS: Record<string, string> = {
  rag_retrieve: "知识库检索",
  read_profile: "读取画像",
  answer: "组织回答",
  // agent harness（/api/chat 工具调用）进度
  think: "理解问题",
  voice_tutor: "语音教师",
  tool: "调用工具",
  generate_learning_material: "生成学习资料",
  search_knowledge_base: "检索知识库",
};

function wantsResource(text: string): boolean {
  return wantsResourceGeneration(text);
}

function mergeResourceLists(
  persisted: readonly ResourceItem[],
  session: readonly ResourceItem[],
): ResourceItem[] {
  const merged = new Map(persisted.map((resource) => [resource.id, resource]));
  for (const resource of session) {
    const stored = merged.get(resource.id);
    merged.set(resource.id, stored ? { ...stored, ...resource, data: resource.data ?? stored.data } : resource);
  }
  return [...merged.values()];
}

/** 找视频意图：提到 B站/bilibili，或「找/搜/推荐…视频」→ 直接检索视频并在内置浏览器打开。 */
function wantsVideo(text: string): boolean {
  const platform = /b\s*站|bili|哔哩/i.test(text);
  const findVideo = /(找|搜|搜索|查|推荐|看看|来个|来点|有没有|有什么)[^。.!?！？]{0,8}视频/.test(text);
  return platform || findVideo;
}

/** 从「帮我找b站讲X的视频」里抽出主题关键词 X（去掉找/搜/B站/视频等填充词）。 */
function videoTopic(text: string): string {
  const cleaned = text
    .replace(/帮我|给我|请|麻烦/g, "")
    .replace(/找一?找|找一下|找|搜一?搜|搜索|搜|查一?查|查找|查|推荐|看一?看/g, "")
    .replace(/b\s*站|bilibili|哔哩哔哩/gi, "")
    .replace(/的?(教学|讲解|学习)?视频/g, "")
    .replace(/讲解|讲述|讲一?讲|讲|关于|有关|一下|一些|几个|的/g, "")
    .replace(/[，。、,.!?！？\s]+/g, " ")
    .trim();
  return cleaned || text.trim();
}

export type PendingLearningPath = LearningPathRunState;

export interface PendingSoftwareAction {
  id: number;
  type: "open_resource";
  resourceId: string;
}

interface ConfirmationReviewPayload {
  summary: string;
  decision: "execute" | "ask";
  questions?: unknown[];
}

const PENDING_LEARNING_PATH_KEY = "sl_pending_learning_path_v1";

/**
 * 协同编排引擎：live 模式消费版本化规划执行流与即时答疑 SSE。
 * 后端不可达时进入 offline 状态，只提示连接问题，不合成脚本数据。
 */
export function useOrchestrator() {
  const router = useRouter();
  const [mode, setMode] = useState<OrchestratorMode>(() => {
    const cached = getCachedBackendStatus();
    return cached === null ? "checking" : cached ? "live" : "offline";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState(createConversationId);
  const [activeConversationTitle, setActiveConversationTitle] = useState("");
  const [activeConversationUpdatedAt, setActiveConversationUpdatedAt] = useState(Date.now);
  const [conversationHistory, setConversationHistory] = useState<ConversationSession[]>([]);
  const [activeTeacher, setActiveTeacher] = useState<TeacherPersona>(DEFAULT_TEACHER);
  const [activeConversationKind, setActiveConversationKind] = useState<ConversationKind>("general");
  const [activeResourceId, setActiveResourceId] = useState("");
  const [activeResourceTitle, setActiveResourceTitle] = useState("");
  const [activeResourceContext, setActiveResourceContext] = useState("");
  const [agentRunStore, setAgentRunStore] = useState(createAgentRunStore);
  const [focusedRunByConversation, setFocusedRunByConversation] = useState<Record<string, string>>({});
  const [pendingLearningPaths, setPendingLearningPaths] = useState<Record<string, PendingLearningPath>>({});
  const pendingLearningPathRef = useRef(new Map<string, PendingLearningPath>());
  const [agents, setAgents] = useState<Record<AgentId, AgentRuntime>>(
    initialAgentState()
  );
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [profile, setProfile] = useState<ProfileDim[]>(PROFILE_BASE);
  const [tags, setTags] = useState<string[]>([]);
  const [profileUpdatedAt, setProfileUpdatedAt] = useState("");
  const [profileSources, setProfileSources] = useState<string[]>([]);
  const [path, setPath] = useState<PathStep[]>([]);
  const [pathScheduleAnchor, setPathScheduleAnchor] = useState("");
  const [storedPathScheduleSignature, setStoredPathScheduleSignature] = useState("");
  const [subjectPathControls, setSubjectPathControls] = useState<Record<string, SubjectPathControl>>({});
  const [resourcePathAttachments, setResourcePathAttachments] = useState<Record<string, ResourcePathAttachment>>({});
  const [planTasks, setPlanTasks] = useState<PlanTask[]>([]);
  const [planReason, setPlanReason] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [running, setRunning] = useState(false);
  const [runningConversationIds, setRunningConversationIds] = useState<Record<string, true>>({});
  const [hasRunMain, setHasRunMain] = useState(false);
  const [practiceAttempts, setPracticeAttempts] = useState<PracticeAttempt[]>([]);
  const [adjustments, setAdjustments] = useState<PathAdjustment[]>([]);
  const [completedMaterials, setCompletedMaterials] = useState<string[]>([]);
  const [taskEvidence, setTaskEvidence] = useState<Record<string, TaskEvidenceRecord>>({});
  const [watchedVideos, setWatchedVideos] = useState<WatchedVideoRecord[]>([]);
  const [plans, setPlans] = useState<Record<string, ResourcePlanRecord>>({});
  const [planSavingId, setPlanSavingId] = useState("");
  const [planExecutingId, setPlanExecutingId] = useState("");
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});
  const [resourceExecution, setResourceExecution] = useState(createResourcePhaseState);
  const [pendingSoftwareAction, setPendingSoftwareAction] = useState<PendingSoftwareAction | null>(null);

  const activeConversationIdRef = useRef(activeConversationId);
  const messagesRef = useRef(messages);
  const conversationHistoryRef = useRef(conversationHistory);
  const logIdRef = useRef(0);
  const msgIdRef = useRef(0);
  const softwareActionIdRef = useRef(0);
  const abortRef = useRef(new Map<string, AbortController>());
  const tutorRunsRef = useRef(new Map<string, TutorRunControl>());
  const conversationActivityRef = useRef(new Set<string>());
  const messageConversationRef = useRef(new Map<string, string>());
  const activePlanRunsRef = useRef(new Set<string>());
  const planConversationRef = useRef(new Map<string, string>());
  const learningPathRequestRef = useRef(new Set<string>());
  const learningPathReviewAbortRef = useRef(new Map<string, AbortController>());
  const messageRunBindingsRef = useRef(new Map<string, string>());
  const messageTraceSequenceRef = useRef(new Map<string, number>());
  const replayedRunIdsRef = useRef(new Set<string>());
  const plansRef = useRef(plans);
  const resourcesRef = useRef(resources);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const workspaceVersionRef = useRef(0);
  const workspaceSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const [conversationSyncReady, setConversationSyncReady] = useState(false);
  // 会话回灌完成前不落盘，避免用初始空状态覆盖已有存档。
  const [hydrated, setHydrated] = useState(false);
  const pendingLearningPath = pendingLearningPaths[activeConversationId] ?? null;
  const setPendingLearningPathForConversation = useCallback((
    conversationId: string,
    update: PendingLearningPath
      | null
      | ((current: PendingLearningPath | null) => PendingLearningPath | null),
  ) => {
    setPendingLearningPaths((current) => {
      const previous = current[conversationId] ?? null;
      const nextValue = typeof update === "function" ? update(previous) : update;
      const next = { ...current };
      if (nextValue) {
        next[conversationId] = {
          ...nextValue,
          conversationId: nextValue.conversationId || conversationId,
        };
        pendingLearningPathRef.current.set(conversationId, next[conversationId]);
      } else {
        delete next[conversationId];
        pendingLearningPathRef.current.delete(conversationId);
      }
      return next;
    });
  }, []);
  const setPendingLearningPath = useCallback((
    update: PendingLearningPath
      | null
      | ((current: PendingLearningPath | null) => PendingLearningPath | null),
  ) => {
    const directConversationId = typeof update === "function"
      ? ""
      : update?.conversationId ?? "";
    setPendingLearningPathForConversation(
      directConversationId || activeConversationIdRef.current,
      update,
    );
  }, [setPendingLearningPathForConversation]);
  const conversationRunning = messages.some(
    (message) => message.role === "assistant" && message.streaming,
  )
    || Boolean(runningConversationIds[activeConversationId]);

  const syncRunningState = useCallback(() => {
    const conversationIds = new Set<string>([
      ...tutorRunsRef.current.keys(),
      ...conversationActivityRef.current,
      ...Array.from(activePlanRunsRef.current)
        .map((planId) => planConversationRef.current.get(planId))
        .filter((conversationId): conversationId is string => Boolean(conversationId)),
    ]);
    setRunningConversationIds(
      Object.fromEntries(Array.from(conversationIds, (conversationId) => [conversationId, true])),
    );
    setRunning(conversationIds.size > 0);
  }, []);

  const pendingTracePlanId = pendingLearningPath?.traceMessageId
    ? messages.find((message) => message.id === pendingLearningPath.traceMessageId)?.planId
    : undefined;

  useEffect(() => {
    const storageKey = accountStorageKey(PENDING_LEARNING_PATH_KEY);
    try {
      const saved = sessionStorage.getItem(storageKey) ?? sessionStorage.getItem(PENDING_LEARNING_PATH_KEY);
      if (!saved) return;
      if (!sessionStorage.getItem(storageKey)) {
        sessionStorage.setItem(storageKey, saved);
        sessionStorage.removeItem(PENDING_LEARNING_PATH_KEY);
      }
      const stored = JSON.parse(saved) as {
        pending_learning_paths?: Record<string, unknown>;
      };
      if (stored.pending_learning_paths) {
        const restored = Object.entries(stored.pending_learning_paths).reduce<Record<string, PendingLearningPath>>(
          (current, [conversationId, value]) => {
            const parsed = restoreLearningPathRun(JSON.stringify(value));
            if (parsed) current[conversationId] = { ...parsed, conversationId };
            return current;
          },
          {},
        );
        pendingLearningPathRef.current = new Map(Object.entries(restored));
        setPendingLearningPaths(restored);
      } else {
        const parsed = restoreLearningPathRun(saved);
        if (parsed) setPendingLearningPath(parsed);
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [setPendingLearningPath]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationHistoryRef.current = conversationHistory;
  }, [conversationHistory]);

  useEffect(() => {
    for (const message of messages) {
      messageConversationRef.current.set(message.id, activeConversationId);
    }
    for (const session of conversationHistory) {
      for (const message of session.messages) {
        messageConversationRef.current.set(message.id, session.id);
      }
    }
  }, [activeConversationId, conversationHistory, messages]);

  useEffect(() => {
    pendingLearningPathRef.current = new Map(Object.entries(pendingLearningPaths));
    const storageKey = accountStorageKey(PENDING_LEARNING_PATH_KEY);
    if (Object.keys(pendingLearningPaths).length === 0) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      pending_learning_paths: pendingLearningPaths,
    }));
  }, [pendingLearningPaths]);

  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  useEffect(() => {
    resourcesRef.current = resources;
  }, [resources]);

  useEffect(() => {
    if (!hydrated || mode === "checking") return;
    let cancelled = false;
    void listMaterials(mode)
      .then((persisted) => {
        if (cancelled) return;
        setResources((current) => {
          const next = mergeResourceLists(persisted, current);
          resourcesRef.current = next;
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated, mode]);

  const storeAcceptedPlanSnapshot = useCallback((incoming: ResourcePlanRecord): boolean => {
    const planId = incoming.plan.plan_id;
    const accepted = acceptResourcePlanSnapshot(plansRef.current[planId], incoming);
    if (!accepted) return false;
    const next = { ...plansRef.current, [planId]: accepted };
    plansRef.current = next;
    setPlans(next);
    return true;
  }, []);

  // 启动时探测后端；后端不可达时不再降级为脚本演示，只进入离线提示状态。
  useEffect(() => {
    let cancelled = false;
    checkBackend().then((ok) => {
      if (!cancelled) setMode(ok ? "live" : "offline");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 直接发起 SQLite 回灌，让它与健康检查并行；localStorage 仅作为旧版本的一次性迁移来源。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storageKey = accountStorageKey(SESSION_KEY);
      try {
        const legacyRaw = localStorage.getItem(storageKey) ?? localStorage.getItem(SESSION_KEY);
        let s: Partial<DurableSession> | null = null;
        try {
          const stored = await getLearnerWorkspaceState<DurableSession>();
          workspaceVersionRef.current = stored.version;
          if (Object.keys(stored.state).length > 0) {
            s = stored.state;
            localStorage.removeItem(storageKey);
            localStorage.removeItem(SESSION_KEY);
          } else if (legacyRaw) {
            s = JSON.parse(legacyRaw) as Partial<DurableSession>;
            const migrated = await saveLearnerWorkspaceState(s, Date.now(), stored.version);
            workspaceVersionRef.current = migrated.version;
            localStorage.removeItem(storageKey);
            localStorage.removeItem(SESSION_KEY);
          }
        } catch {
          // 数据库暂不可达时只读取旧存档完成本次迁移，不再写回浏览器。
          if (legacyRaw) s = JSON.parse(legacyRaw) as Partial<DurableSession>;
        }
        if (cancelled) return;
        if (s) {
        // 任意一类有意义状态存在即回灌，包括仅摸底、仅生成或无对话的情况。
        const hasContent =
          (Array.isArray(s.messages) && s.messages.length > 0) ||
          (Array.isArray(s.tags) && s.tags.length > 0) ||
          (Array.isArray(s.resources) && s.resources.length > 0) ||
          (Array.isArray(s.path) && s.path.length > 0) ||
          (Array.isArray(s.practiceAttempts) && s.practiceAttempts.length > 0) ||
          (Array.isArray(s.watchedVideos) && s.watchedVideos.length > 0) ||
          (Array.isArray(s.conversationHistory) && s.conversationHistory.length > 0) ||
          (s.plans && typeof s.plans === "object" && Object.keys(s.plans).length > 0);
        if (hasContent) {
          const restoredMessages = Array.isArray(s.messages)
            ? normalizeStoredMessages(s.messages)
            : [];
          const restoredHistory = Array.isArray(s.conversationHistory)
            ? s.conversationHistory
                .filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages))
                .flatMap((item) => {
                  const itemMessages = normalizeStoredMessages(item.messages);
                  const legacySplit = splitLegacyResourceConversation(itemMessages);
                  const teacher = normalizeTeacherPersona(item.teacher);
                  if (legacySplit) {
                    const resourceTitle = item.resourceTitle || legacySplit.resourceTitle;
                    return [
                      {
                        ...item,
                        title: conversationTitle(legacySplit.generalMessages),
                        teacher,
                        messages: legacySplit.generalMessages,
                        kind: "general" as const,
                        resourceId: "",
                        resourceTitle: "",
                        resourceContext: "",
                      },
                      {
                        ...item,
                        id: `${item.id}_resource`,
                        title: conversationTitle(legacySplit.resourceMessages, "resource_qa", resourceTitle),
                        updatedAt: item.updatedAt + 1,
                        teacher,
                        messages: legacySplit.resourceMessages,
                        kind: "resource_qa" as const,
                        resourceId: item.resourceId || `legacy:${item.id}`,
                        resourceTitle,
                        resourceContext: item.resourceContext || "",
                      },
                    ];
                  }
                  const kind = inferConversationKind(itemMessages, item.kind);
                  const resourceTitle = item.resourceTitle || inferResourceTitle(itemMessages);
                  return [{
                    ...item,
                    title:
                      typeof item.title === "string" && item.title.trim()
                        ? item.title.trim().slice(0, 40)
                        : conversationTitle(itemMessages, kind, resourceTitle),
                    teacher,
                    messages: itemMessages,
                    kind,
                    resourceId: kind === "resource_qa" ? item.resourceId || `legacy:${item.id}` : "",
                    resourceTitle: kind === "resource_qa" ? resourceTitle : "",
                    resourceContext: kind === "resource_qa" ? item.resourceContext || "" : "",
                  }];
                })
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 100)
            : [];
          const restoredTeacher = normalizeTeacherPersona(s.activeTeacher);
          let restoredConversationId =
            typeof s.activeConversationId === "string" && s.activeConversationId
              ? s.activeConversationId
              : createConversationId();
          let restoredConversationTitle =
            typeof s.activeConversationTitle === "string"
              ? s.activeConversationTitle.trim().slice(0, 40)
              : "";
          let restoredUpdatedAt = typeof s.activeConversationUpdatedAt === "number"
            ? s.activeConversationUpdatedAt
            : Date.now();
          let activeMessages = restoredMessages;
          let nextHistory = restoredHistory;
          let restoredKind = inferConversationKind(restoredMessages, s.activeConversationKind);
          let restoredResourceTitle = typeof s.activeResourceTitle === "string"
            ? s.activeResourceTitle
            : inferResourceTitle(restoredMessages);
          let restoredResourceId = restoredKind === "resource_qa"
            ? typeof s.activeResourceId === "string" && s.activeResourceId
              ? s.activeResourceId
              : `legacy:${restoredConversationId}`
            : "";
          let restoredResourceContext = restoredKind === "resource_qa" && typeof s.activeResourceContext === "string"
            ? s.activeResourceContext
            : "";
          const legacyActiveSplit = splitLegacyResourceConversation(restoredMessages);
          if (legacyActiveSplit) {
            nextHistory = upsertConversation(nextHistory, {
              id: restoredConversationId,
              title: conversationTitle(legacyActiveSplit.generalMessages),
              updatedAt: restoredUpdatedAt,
              messages: legacyActiveSplit.generalMessages,
              teacher: restoredTeacher,
              kind: "general",
              resourceId: "",
              resourceTitle: "",
              resourceContext: "",
            });
            activeMessages = legacyActiveSplit.resourceMessages;
            restoredConversationId = createConversationId();
            restoredConversationTitle = "";
            restoredUpdatedAt = Date.now();
            restoredKind = "resource_qa";
            restoredResourceTitle = legacyActiveSplit.resourceTitle;
            restoredResourceId = `legacy:${restoredConversationId}`;
            restoredResourceContext = "";
          }
          setMessages(activeMessages);
          setConversationHistory(nextHistory);
          setActiveConversationId(restoredConversationId);
          setActiveConversationTitle(restoredConversationTitle);
          setActiveConversationUpdatedAt(restoredUpdatedAt);
          setActiveConversationKind(restoredKind);
          setActiveResourceId(restoredResourceId);
          setActiveResourceTitle(restoredResourceTitle);
          setActiveResourceContext(restoredResourceContext);
          setActiveTeacher(restoredTeacher);
          if (Array.isArray(s.resources)) setResources(s.resources);
          if (Array.isArray(s.path)) {
            const normalizedPath = normalizePathSteps(s.path);
            const signature = pathScheduleSignature(normalizedPath);
            setPath(normalizedPath);
            setStoredPathScheduleSignature(
              typeof s.pathScheduleSignature === "string" && s.pathScheduleSignature
                ? s.pathScheduleSignature
                : signature,
            );
            setPathScheduleAnchor(
              typeof s.pathScheduleAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.pathScheduleAnchor)
                ? s.pathScheduleAnchor
                : localDateFromTimestamp(s.activeConversationUpdatedAt),
            );
          }
          if (s.subjectPathControls && typeof s.subjectPathControls === "object") {
            setSubjectPathControls(s.subjectPathControls);
          }
          if (s.resourcePathAttachments && typeof s.resourcePathAttachments === "object") {
            setResourcePathAttachments(s.resourcePathAttachments);
          }
          if (Array.isArray(s.profile)) setProfile(s.profile);
          if (Array.isArray(s.tags)) setTags(s.tags);
          if (typeof s.profileUpdatedAt === "string") setProfileUpdatedAt(s.profileUpdatedAt);
          if (Array.isArray(s.profileSources)) setProfileSources(s.profileSources.filter((source) => typeof source === "string"));
          if (Array.isArray(s.planTasks)) setPlanTasks(s.planTasks);
          if (typeof s.planReason === "string") setPlanReason(s.planReason);
          if (typeof s.hasRunMain === "boolean") setHasRunMain(s.hasRunMain);
          if (Array.isArray(s.practiceAttempts)) setPracticeAttempts(s.practiceAttempts);
          if (Array.isArray(s.adjustments)) setAdjustments(s.adjustments);
          if (Array.isArray(s.completedMaterials)) {
            const evidence = s.taskEvidence ?? {};
            setCompletedMaterials(
              s.completedMaterials.filter((key) => evidence[key]?.kind !== "resource_read"),
            );
          }
          if (s.taskEvidence && typeof s.taskEvidence === "object") setTaskEvidence(s.taskEvidence);
          if (Array.isArray(s.watchedVideos)) setWatchedVideos(s.watchedVideos);
          if (s.plans && typeof s.plans === "object") setPlans(s.plans);
          if (
            s.resourceExecution &&
            Array.isArray(s.resourceExecution.phases) &&
            s.resourceExecution.phases.length === 6
          ) {
            setResourceExecution(s.resourceExecution);
          }
          // msgId 计数器跳过已用 id，防止新消息覆盖旧消息。
          const persistedMessages = [
            ...(s.messages ?? []),
            ...(s.conversationHistory ?? []).flatMap((session) => session.messages ?? []),
          ];
          const maxId = persistedMessages.reduce((mx, m) => {
            const n = Number(String(m.id).replace(/^m/, ""));
            return Number.isFinite(n) && n > mx ? n : mx;
          }, 0);
          msgIdRef.current = Math.max(msgIdRef.current, maxId);
        }
      }
      } catch {
        /* 忽略损坏的旧存档或暂时不可用的 SQLite。 */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const signature = pathScheduleSignature(path);
    if (!signature) {
      if (storedPathScheduleSignature) setStoredPathScheduleSignature("");
      if (pathScheduleAnchor) setPathScheduleAnchor("");
      return;
    }
    if (signature !== storedPathScheduleSignature) {
      setStoredPathScheduleSignature(signature);
      setPathScheduleAnchor(localDateKey());
      return;
    }
    if (!pathScheduleAnchor) setPathScheduleAnchor(localDateKey());
  }, [hydrated, path, pathScheduleAnchor, storedPathScheduleSignature]);

  // 防抖写入 SQLite。浏览器不再保存第二份可冲突的学习状态。
  useEffect(() => {
    if (!hydrated || mode !== "live" || !conversationSyncReady) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        // 仅当状态全空时清档；摸底或生成产生的画像、标签、资源也需要落盘。
        const empty =
          tags.length === 0 &&
          resources.length === 0 &&
          path.length === 0 &&
          Object.keys(subjectPathControls).length === 0 &&
          Object.keys(resourcePathAttachments).length === 0 &&
          practiceAttempts.length === 0 &&
          adjustments.length === 0 &&
          completedMaterials.length === 0 &&
          Object.keys(taskEvidence).length === 0 &&
          watchedVideos.length === 0 &&
          Object.keys(plans).length === 0;
        if (empty) {
          workspaceSaveChainRef.current = workspaceSaveChainRef.current.then(async () => {
            await deleteLearnerWorkspaceState();
            workspaceVersionRef.current = 0;
          }).catch(() => undefined);
          return;
        }
        const snapshot: DurableSession = {
          // Conversation working memory has its own normalized SQLite table.
          messages: [],
          conversationHistory: [],
          activeConversationId,
          activeConversationTitle,
          activeConversationUpdatedAt,
          activeConversationKind,
          activeResourceId,
          activeResourceTitle,
          activeResourceContext,
          activeTeacher,
          resources,
          path,
          pathScheduleAnchor,
          pathScheduleSignature: storedPathScheduleSignature,
          subjectPathControls,
          resourcePathAttachments,
          profile,
          tags,
          profileUpdatedAt,
          profileSources,
          planTasks,
          planReason,
          hasRunMain,
          practiceAttempts,
          adjustments,
          completedMaterials,
          taskEvidence,
          watchedVideos,
          plans,
          resourceExecution,
        };
        workspaceSaveChainRef.current = workspaceSaveChainRef.current.then(async () => {
          const saved = await saveLearnerWorkspaceState(
            snapshot,
            Date.now(),
            workspaceVersionRef.current,
          );
          workspaceVersionRef.current = saved.version;
        }).catch(() => undefined);
      })();
    }, 400);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [
    hydrated,
    mode,
    conversationSyncReady,
    activeConversationId,
    activeConversationTitle,
    activeConversationUpdatedAt,
    activeConversationKind,
    activeResourceId,
    activeResourceTitle,
    activeResourceContext,
    activeTeacher,
    conversationHistory,
    messages,
    resources,
    path,
    pathScheduleAnchor,
    storedPathScheduleSignature,
    subjectPathControls,
    resourcePathAttachments,
    profile,
    tags,
    profileUpdatedAt,
    profileSources,
    planTasks,
    planReason,
    hasRunMain,
    practiceAttempts,
    adjustments,
    completedMaterials,
    taskEvidence,
    watchedVideos,
    plans,
    resourceExecution,
  ]);

  const conversationSnapshot = useMemo(() => buildConversationStateSnapshot({
    messages, conversationHistory, activeConversationId, activeConversationTitle,
    activeConversationUpdatedAt, activeTeacher, activeConversationKind,
    activeResourceId, activeResourceTitle, activeResourceContext,
  }), [messages, conversationHistory, activeConversationId, activeConversationTitle,
    activeConversationUpdatedAt, activeTeacher, activeConversationKind,
    activeResourceId, activeResourceTitle, activeResourceContext]);

  const importRemoteConversations = useCallback((state: StoredConversationState, aliases: Record<string, string>) => {
    // Do not replace local messages while an agent is streaming. New remote
    // sessions can join the history; divergent versions are already durable.
    setConversationHistory((history) => {
      const known = new Set([activeConversationIdRef.current, ...history.map((s) => s.id),
        ...Object.values(aliases), ...getConversationSync().getPendingDeletions()]);
      const additions = state.sessions.filter((session) => !known.has(session.id));
      return additions.length ? [...history, ...additions].sort((a, b) => b.updatedAt - a.updatedAt) : history;
    });
  }, []);

  useConversationPersistence(
    hydrated && conversationSyncReady,
    conversationSnapshot,
    importRemoteConversations,
    mode === "live",
  );

  useEffect(() => {
    if (!hydrated || mode === "checking" || conversationSyncReady) return;
    let cancelled = false;
    const currentLocalState = buildConversationStateSnapshot({
      messages,
      conversationHistory,
      activeConversationId,
      activeConversationTitle,
      activeConversationUpdatedAt,
      activeTeacher,
      activeConversationKind,
      activeResourceId,
      activeResourceTitle,
      activeResourceContext,
    });

    const normalizeState = (state: StoredConversationState): StoredConversationState => ({
      activeConversationId: state.activeConversationId,
      sessions: state.sessions
        .map((session) => {
          const sessionMessages = normalizeStoredMessages(session.messages);
          const kind = inferConversationKind(sessionMessages, session.kind);
          const resourceTitle = session.resourceTitle || inferResourceTitle(sessionMessages);
          return {
            ...session,
            title:
              session.title?.trim().slice(0, 40) ||
              conversationTitle(sessionMessages, kind, resourceTitle),
            messages: sessionMessages,
            teacher: normalizeTeacherPersona(session.teacher),
            kind,
            resourceId: kind === "resource_qa" ? session.resourceId : "",
            resourceTitle: kind === "resource_qa" ? resourceTitle : "",
            resourceContext: kind === "resource_qa" ? session.resourceContext : "",
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 100),
    });

    const applyState = (state: StoredConversationState) => {
      const active = state.sessions.find((session) => session.id === state.activeConversationId)
        ?? state.sessions[0];
      if (!active) return;
      setMessages(active.messages);
      setConversationHistory(state.sessions.filter((session) => session.id !== active.id));
      setActiveConversationId(active.id);
      setActiveConversationTitle(active.title === "新会话" ? "" : active.title);
      setActiveConversationUpdatedAt(active.updatedAt);
      setActiveTeacher(active.teacher);
      setActiveConversationKind(active.kind);
      setActiveResourceId(active.resourceId);
      setActiveResourceTitle(active.resourceTitle);
      setActiveResourceContext(active.resourceContext);
      setHasRunMain(active.messages.length > 0);
      const maximumMessageId = state.sessions
        .flatMap((session) => session.messages)
        .reduce((maximum, message) => {
          const value = Number(String(message.id).replace(/^m/, ""));
          return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
        }, 0);
      msgIdRef.current = Math.max(msgIdRef.current, maximumMessageId);
    };

    void (async () => {
      const localState = normalizeState(currentLocalState);
      try {
        const serverState = normalizeState(await getConversationState(mode === "live"));
        if (cancelled) return;
        const hasMigratedLocalConversation = localState.sessions.some(
          (session) => session.messages.length > 0,
        );
        if (serverState.sessions.length === 0 && hasMigratedLocalConversation) {
          applyState(localState);
          if (mode === "live") await saveConversationState(localState);
        } else if (serverState.sessions.length > 0) {
          applyState(serverState);
        }
      } catch {
        if (!cancelled) applyState(localState);
      } finally {
        if (!cancelled) setConversationSyncReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeConversationId,
    activeConversationTitle,
    activeConversationKind,
    activeConversationUpdatedAt,
    activeResourceContext,
    activeResourceId,
    activeResourceTitle,
    activeTeacher,
    conversationHistory,
    conversationSyncReady,
    hydrated,
    mode,
    messages,
    plans,
  ]);



  const markProfileUpdate = useCallback((source: string) => {
    setProfileUpdatedAt(new Date().toISOString());
    setProfileSources((previous) => [source, ...previous.filter((item) => item !== source)].slice(0, 4));
  }, []);

  const log = useCallback(
    (agent: AgentId, text: string, level: LogLevel = "info") => {
      setLogs((prev) => [
        ...prev.slice(-59),
        { id: ++logIdRef.current, ts: now(), agent, text, level },
      ]);
    },
    []
  );

  const setAgent = useCallback((id: AgentId, patch: Partial<AgentRuntime>) => {
    setAgents((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const addMessage = useCallback(
    (
      role: ChatMessage["role"],
      kind: ChatMessage["kind"],
      content = "",
      streaming = false
    ): string => {
      const id = `m${++msgIdRef.current}`;
      const createdAt = Date.now();
      messageConversationRef.current.set(id, activeConversationIdRef.current);
      setMessages((prev) => [...prev, {
        id,
        role,
        kind,
        content,
        streaming,
        processingStartedAt: role === "assistant" && streaming ? createdAt : undefined,
      }]);
      setActiveConversationUpdatedAt(createdAt);
      return id;
    },
    []
  );

  const addMessageToConversation = useCallback(
    (
      conversationId: string,
      role: ChatMessage["role"],
      kind: ChatMessage["kind"],
      content = "",
      streaming = false,
    ): string => {
      if (conversationId === activeConversationIdRef.current) {
        return addMessage(role, kind, content, streaming);
      }
      const id = `m${++msgIdRef.current}`;
      const createdAt = Date.now();
      const message: ChatMessage = {
        id,
        role,
        kind,
        content,
        streaming,
        processingStartedAt: role === "assistant" && streaming ? createdAt : undefined,
      };
      messageConversationRef.current.set(id, conversationId);
      setConversationHistory((history) => history.map((session) =>
        session.id === conversationId
          ? {
              ...session,
              messages: [...session.messages, message],
              updatedAt: createdAt,
            }
          : session,
      ));
      return id;
    },
    [addMessage],
  );

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    const updatedAt = Date.now();
    const applyPatch = (message: ChatMessage): ChatMessage => {
      if (message.id !== id) return message;
      const next = { ...message, ...patch };
      if (patch.streaming === true && message.role === "assistant") {
        next.processingStartedAt = message.processingStartedAt ?? updatedAt;
        next.processingEndedAt = undefined;
      } else if (
        patch.streaming === false
        && message.processingStartedAt
        && !message.processingEndedAt
      ) {
        next.processingEndedAt = updatedAt;
      }
      return next;
    };
    setMessages((prev) => prev.map(applyPatch));
    setConversationHistory((history) => history.map((session) => {
      if (!session.messages.some((message) => message.id === id)) return session;
      return {
        ...session,
        messages: session.messages.map(applyPatch),
        updatedAt,
      };
    }));
    if (messageConversationRef.current.get(id) === activeConversationIdRef.current) {
      setActiveConversationUpdatedAt(updatedAt);
    }
  }, []);

  const finishMessage = useCallback((id: string, fallbackContent = "") => {
    const updatedAt = Date.now();
    const finish = (message: ChatMessage): ChatMessage => {
      if (message.id !== id) return message;
      return {
        ...message,
        content: message.content.trim() ? message.content : fallbackContent,
        streaming: false,
        processingEndedAt: message.processingStartedAt
          ? message.processingEndedAt ?? updatedAt
          : message.processingEndedAt,
      };
    };
    setMessages((previous) => previous.map(finish));
    setConversationHistory((history) => history.map((session) => {
      if (!session.messages.some((message) => message.id === id)) return session;
      return {
        ...session,
        messages: session.messages.map(finish),
        updatedAt,
      };
    }));
    if (messageConversationRef.current.get(id) === activeConversationIdRef.current) {
      setActiveConversationUpdatedAt(updatedAt);
    }
  }, []);

  const appendMessage = useCallback((id: string, chunk: string) => {
    const append = (message: ChatMessage) => (
      message.id === id ? { ...message, content: message.content + chunk } : message
    );
    setMessages((prev) =>
      prev.map(append)
    );
    const updatedAt = Date.now();
    setConversationHistory((history) => history.map((session) => {
      if (!session.messages.some((message) => message.id === id)) return session;
      return {
        ...session,
        messages: session.messages.map(append),
        updatedAt,
      };
    }));
    if (messageConversationRef.current.get(id) === activeConversationIdRef.current) {
      setActiveConversationUpdatedAt(updatedAt);
    }
  }, []);

  const patchResourceById = useCallback(
    (id: string, patch: Partial<ResourceItem>) => {
      setResources((prev) => {
        const next = prev.map((resource) =>
          resource.id === id ? { ...resource, ...patch } : resource
        );
        resourcesRef.current = next;
        return next;
      });
    },
    []
  );

  const patchResourceData = useCallback((id: string, dataPatch: Partial<ResourceData>) => {
    setResources((prev) => {
      const next = prev.map((resource) =>
        resource.id === id
          ? { ...resource, data: { ...(resource.data ?? {}), ...dataPatch } }
          : resource
      );
      resourcesRef.current = next;
      return next;
    });
  }, []);

  /**
   * 只消费后端真实发出的公开事件。消息在收到首个 run_id 后即锁定到该 run，
   * 后续任何其他 run 的迟到事件都会被拒绝，避免跨会话串轨迹。
   */
  const ingestRunEvent = useCallback((messageId: string, data: Record<string, unknown>) => {
    const fallbackSequence = (messageTraceSequenceRef.current.get(messageId) ?? 0) + 1;
    const boundRunId = messageRunBindingsRef.current.get(messageId);
    // A tool-launched resource plan keeps an internal child run for cancellation
    // and budgets. For the public inspector it is causally mounted into the
    // already-bound tutor run, with unique child IDs and the real tool span as
    // its parent. Unrelated run IDs are still rejected below.
    const normalizedData = bindNestedRunEventData(boundRunId, data, fallbackSequence);
    const event = normalizeAgentRunEvent(normalizedData, fallbackSequence);
    if (!event) return;
    if (!acceptsBoundRun(boundRunId, event.run_id)) return;
    messageRunBindingsRef.current.set(messageId, event.run_id);
    if (!boundRunId) {
      const ownerConversationId = messageConversationRef.current.get(messageId);
      if (ownerConversationId) {
        setFocusedRunByConversation((current) => ({
          ...current,
          [ownerConversationId]: event.run_id,
        }));
      }
    }
    messageTraceSequenceRef.current.set(
      messageId,
      Math.max(fallbackSequence, event.sequence),
    );
    setMessages((previous) =>
      previous.map((message) =>
        message.id === messageId ? { ...message, runId: event.run_id } : message,
      ),
    );
    setConversationHistory((history) => history.map((session) => {
      if (!session.messages.some((message) => message.id === messageId)) return session;
      return {
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId ? { ...message, runId: event.run_id } : message,
        ),
        updatedAt: Date.now(),
      };
    }));
    setAgentRunStore((state) => agentRunStoreReducer(state, { type: "ingest", event }));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const focusedRunId = focusedRunByConversation[activeConversationId];
    const target = focusedRunId
      ? messages.find(
          (message) => message.role === "assistant" && message.runId === focusedRunId,
        )
      : [...messages]
          .reverse()
          .find((message) => message.role === "assistant" && Boolean(message.runId));
    const runId = target?.runId;
    if (!target || !runId) return;

    messageConversationRef.current.set(target.id, activeConversationId);
    messageRunBindingsRef.current.set(target.id, runId);
    if (agentRunStore.runs[runId]) return;
    if (replayedRunIdsRef.current.has(runId)) return;
    replayedRunIdsRef.current.add(runId);

    const controller = new AbortController();
    void fetchAgentRunEvents(runId, controller.signal)
      .then((replay) => {
        if (controller.signal.aborted) return;
        for (const event of replay.events) ingestRunEvent(target.id, event);
      })
      .catch(() => {
        if (!controller.signal.aborted) replayedRunIdsRef.current.delete(runId);
      });
    return () => controller.abort();
  }, [
    activeConversationId,
    agentRunStore.runs,
    focusedRunByConversation,
    hydrated,
    ingestRunEvent,
    messages,
  ]);

  const focusMessageRun = useCallback((messageId: string) => {
    const target = messages.find(
      (message) => message.id === messageId && message.role === "assistant",
    );
    const runId = target?.runId;
    if (!target || !runId) return;

    messageConversationRef.current.set(target.id, activeConversationId);
    messageRunBindingsRef.current.set(target.id, runId);
    setFocusedRunByConversation((current) => ({
      ...current,
      [activeConversationId]: runId,
    }));
    if (agentRunStore.runs[runId]) return;
    if (replayedRunIdsRef.current.has(runId)) return;
    replayedRunIdsRef.current.add(runId);

    void fetchAgentRunEvents(runId)
      .then((replay) => {
        for (const event of replay.events) ingestRunEvent(target.id, event);
      })
      .catch(() => {
        replayedRunIdsRef.current.delete(runId);
      });
  }, [activeConversationId, agentRunStore.runs, ingestRunEvent, messages]);

  /* 在线模式（真实后端）。 */

  const executePlan = useCallback(
    async (
      plan: ResourcePlan,
      options: { confirm: boolean; resume?: boolean; traceMessageId?: string },
    ): Promise<boolean> => {
      if (activePlanRunsRef.current.has(plan.plan_id)) return false;
      activePlanRunsRef.current.add(plan.plan_id);
      const ctrl = new AbortController();
      abortRef.current.set(plan.plan_id, ctrl);
      const planAlive = () => isPlanRunActive(abortRef.current, plan.plan_id, ctrl);
      setRunning(activePlanRunsRef.current.size > 0);
      setPlanExecutingId(plan.plan_id);
      setPlanErrors((current) => ({ ...current, [plan.plan_id]: "" }));
      setPhase("generating");
      const ownerConversationId = planConversationRef.current.get(plan.plan_id)
        ?? activeConversationIdRef.current;
      planConversationRef.current.set(plan.plan_id, ownerConversationId);
      syncRunningState();
      const traceMsgId = options.traceMessageId ?? addMessageToConversation(
        ownerConversationId,
        "assistant",
        "text",
        "",
        true,
      );
      let streamError = "";
      let executionCompleted = false;
      const resourcePresentation = createReasoningPresentationQueue({
        isActive: planAlive,
        present: (event) => ingestRunEvent(traceMsgId, event),
      });

      setResources((previous) => {
        const byId = new Map(previous.map((item) => [item.id, item]));
        for (const task of plan.tasks) {
          const resourceId = planResourceId(plan.plan_id, task.task_id);
          if (!byId.has(resourceId)) {
            byId.set(resourceId, {
              id: planResourceId(plan.plan_id, task.task_id),
              type: task.type as ResourceType,
              title: task.title,
              subtitle: "等待按已确认大纲生成…",
              meta: task.knowledge_points.slice(0, 3),
              status: "pending",
              version: 1,
              sources: task.source_ids.length,
            });
          }
        }
        return Array.from(byId.values());
      });
      setPlanTasks(
        plan.tasks.map((task) => ({
          agent: task.agent as AgentId,
          label: task.title,
        }))
      );
      setPlanReason(plan.request_summary);
      const selectedAgents = new Set<string>(plan.tasks.map((task) => task.agent));
      for (const worker of [...WORKER_IDS, "courseware" as AgentId]) {
        setAgent(worker, {
          status: selectedAgents.has(worker) ? "idle" : "skipped",
          progress: 0,
          detail: selectedAgents.has(worker) ? "等待执行已确认大纲" : "规划未安排",
        });
      }

      try {
        try {
          await streamResourcePlanExecution(
            plan,
            (payload: ResourceExecutionEvent) => {
            if (!planAlive()) return;
            const event = payload.event;
            const data = payload;
            if (event === "trace" || event === "run_event") {
              if (data.event_type === "reasoning") {
                resourcePresentation.enqueueEvent(data);
              } else {
                ingestRunEvent(traceMsgId, data);
              }
              if (typeof data.phase === "string") {
                setResourceExecution((state) =>
                  reduceResourceExecutionEvent(state, {
                    event: "phase",
                    phase: data.phase,
                    status: data.status,
                    progress: data.progress,
                    detail: data.detail,
                  })
                );
              }
            } else if (event === "phase") {
              setResourceExecution((state) => reduceResourceExecutionEvent(state, data));
            } else if (event === "task_progress") {
              setResourceExecution((state) => reduceResourceExecutionEvent(state, data));
              const taskId = String(data.task_id ?? "");
              const agent = String(data.agent ?? "explainer") as AgentId;
              const status = String(data.status ?? "running");
              if (taskId) {
                const resourceId = planResourceId(plan.plan_id, taskId);
                patchResourceById(resourceId, {
                  status:
                    status === "generated"
                      ? "review"
                      : status === "rework"
                        ? "rejected"
                        : status === "failed"
                          ? "failed"
                          : "pending",
                  subtitle: String(data.detail ?? "正在生成"),
                });
              }
              setAgent(agent, {
                status: status === "generated" ? "done" : "working",
                progress: status === "generated" ? 100 : 45,
                detail: String(data.detail ?? ""),
              });
            } else if (event === "result_start") {
              resourcePresentation.enqueueAction(
                () => patchMessage(traceMsgId, { streaming: true }),
              );
            } else if (event === "result_delta") {
              const delta = typeof data.delta === "string" ? data.delta : "";
              if (delta) {
                resourcePresentation.enqueueAction(
                  () => appendMessage(traceMsgId, delta),
                  8,
                );
              }
            } else if (event === "result") {
              const text = typeof data.text === "string" ? data.text : "";
              if (text) {
                resourcePresentation.enqueueAction(
                  () => patchMessage(traceMsgId, { content: text, streaming: false }),
                );
              }
            } else if (event === "task_review") {
              setResourceExecution((state) => reduceResourceExecutionEvent(state, data));
              setPhase("reviewing");
              const taskId = String(data.task_id ?? "");
              const approved = Boolean(data.approved);
              const terminal = approved || data.terminal !== false;
              const issues = Array.isArray(data.issues) ? data.issues.map(String) : [];
              if (taskId) {
                const resourceId = planResourceId(plan.plan_id, taskId);
                patchResourceById(resourceId, {
                  status: approved ? "ready" : terminal ? "failed" : "pending",
                  subtitle: approved
                    ? "质量审核通过"
                    : issues.join("；") || "质量审核未通过",
                });
              }
              setAgent("reviewer", {
                status: approved || terminal ? "done" : "rework",
                progress: 100,
                detail: approved
                  ? "质量审核通过"
                  : terminal
                    ? issues[0] || "审核终止，候选资料未发布"
                    : "已发送精确返工意见",
              });
            } else if (event === "schedule") {
              const schedule = Array.isArray(data.schedule) ? data.schedule : [];
              const normalizedSchedule = scheduleToPath(schedule, plan.plan_id);
              if (normalizedSchedule.length > 0) {
                setPath(normalizedSchedule);
                setAgent("integrator", { status: "done", progress: 100, detail: "" });
                setAgent("planner", { status: "done", progress: 100, detail: "" });
              }
            } else if (event === "done") {
              executionCompleted = data.completed === true;
              // `done` means the server has persisted a terminal snapshot. It
              // is a success notification only when every planned task is
              // ready; a partial failure remains in the review/failure UI.
              setPhase(
                data.status === "cancelled"
                  ? "cancelled"
                  : executionCompleted
                    ? "done"
                    : "blocked",
              );
            } else if (event === "error") {
              streamError = String(data.message ?? "资料生成失败");
            }
            },
            { signal: ctrl.signal, confirm: options.confirm }
          );
        } catch (error) {
          if (ctrl.signal.aborted) return false;
          streamError = requestErrorMessage(error, "资料生成连接中断");
        }
        if (!planAlive()) return false;
        await resourcePresentation.drain();
        if (!planAlive()) return false;
        const completion = await completeActiveResourcePlanRun({
          isActive: planAlive,
          read: () => getResourcePlan(plan.plan_id),
          previous: () => resourcesRef.current,
          recoveryContext: (refreshed) => ({
            taskOwnerCounts: resourcePlanTaskOwnerCounts([
              ...Object.values(plansRef.current),
              refreshed,
            ]),
          }),
          streamError,
          recordSnapshot: (refreshed) => {
            const current = plansRef.current[plan.plan_id];
            const allowFailedRetry = current?.plan.status === "failed" && planAlive();
            const accepted = acceptResourcePlanSnapshot(
              current,
              refreshed,
              { allowFailedRetry },
            );
            if (!accepted) return false;
            const next = { ...plansRef.current, [plan.plan_id]: accepted };
            plansRef.current = next;
            setPlans(next);
            return true;
          },
          applyFinalized: (_refreshed, finalized) => {
            resourcesRef.current = finalized.resources;
            setResources(finalized.resources);
            if (finalized.path.length > 0) setPath(finalized.path);
            setResourceExecution(finalized.execution);
            patchMessage(traceMsgId, { streaming: false });
          },
          notify: (message) => patchMessage(traceMsgId, {
            content: message,
            streaming: false,
            planId: plan.plan_id,
          }),
        });
        if (!completion) return false;
        const refreshed = completion.record;
        // A disconnect may drop the final `done` SSE frame after the server
        // committed. The persisted record is authoritative for the top-level
        // phase shown in finally.
        executionCompleted = isCompletedResourcePlanRecord(refreshed);
        if (!executionCompleted && completion.finalized.message) {
          setPlanErrors((current) => ({
            ...current,
            [plan.plan_id]: completion.finalized.message ?? "资料生成未全部完成",
          }));
          setPhase("blocked");
        }
        const readyCount = refreshed.plan.tasks.filter((task) => task.status === "ready").length;
        const failedCount = refreshed.plan.tasks.length - readyCount;
        log(
          "planner",
          `规划 ${plan.plan_id} 已交付：${readyCount} 份通过，${failedCount} 份失败`,
          executionCompleted ? "ok" : "warn",
        );
      } catch (error) {
        if (!planAlive()) return false;
        const message = requestErrorMessage(error, "资料生成中断");
        setPlanErrors((current) => ({ ...current, [plan.plan_id]: message }));
        patchMessage(traceMsgId, { streaming: false });
        if (!options.resume) {
          addMessageToConversation(
            ownerConversationId,
            "assistant",
            "text",
            `资料生成中断：${message}。已完成的资料会保留，可在规划卡片中重试。`,
          );
        }
        log("supervisor", `规划执行中断：${message}`, "warn");
      } finally {
        activePlanRunsRef.current.delete(plan.plan_id);
        if (abortRef.current.get(plan.plan_id) === ctrl) abortRef.current.delete(plan.plan_id);
        setPlanExecutingId((current) =>
          current === plan.plan_id
            ? activePlanRunsRef.current.values().next().value ?? ""
            : current
        );
        syncRunningState();
        setPhase((current) =>
          activePlanRunsRef.current.size > 0
            ? "generating"
            : current === "idle" || current === "cancelled" || current === "blocked"
              ? current
              : executionCompleted
                ? "done"
                : "reviewing"
        );
      }
      return executionCompleted;
    },
    [addMessageToConversation, appendMessage, ingestRunEvent, log, patchMessage, patchResourceById, setAgent, syncRunningState]
  );

  const savePlan = useCallback(async (plan: ResourcePlan) => {
    setPlanSavingId(plan.plan_id);
    setPlanErrors((current) => ({ ...current, [plan.plan_id]: "" }));
    try {
      const record = await saveResourcePlan(plan);
      storeAcceptedPlanSnapshot(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlanErrors((current) => ({ ...current, [plan.plan_id]: message }));
      throw error;
    } finally {
      setPlanSavingId("");
    }
  }, [storeAcceptedPlanSnapshot]);

  const executePlanWithRecovery = useCallback(
    async (
      initialPlan: ResourcePlan,
      options: { confirm: boolean; traceMessageId?: string },
    ): Promise<boolean> => {
      let currentPlan = initialPlan;
      let completed = await executePlan(currentPlan, options);
      // The server already performs one item-level rework. Allow only one
      // persisted recovery pass for transient provider failures.
      for (let recoveryAttempt = 1; !completed && recoveryAttempt <= 1; recoveryAttempt += 1) {
        const checkpoint = await getResourcePlan(currentPlan.plan_id);
        if (checkpoint.plan.status !== "failed") break;
        log(
          "supervisor",
          `仅重试未通过资料（自动恢复 ${recoveryAttempt}/1），已完成内容保持不变`,
          "warn",
        );
        completed = await executePlan(checkpoint.plan, {
          confirm: false,
          resume: true,
          traceMessageId: options.traceMessageId,
        });
        currentPlan = checkpoint.plan;
      }
      return completed;
    },
    [executePlan, log],
  );

  const replanPlan = useCallback(async (plan: ResourcePlan, feedback: string) => {
    setPlanSavingId(plan.plan_id);
    setPlanErrors((current) => ({ ...current, [plan.plan_id]: "" }));
    try {
      const record = await replanResourcePlan(plan, feedback);
      if (!storeAcceptedPlanSnapshot(record)) return;
      const taskOwnerCounts = resourcePlanTaskOwnerCounts([
        ...Object.values(plansRef.current),
        record,
      ]);
      const recovered = recoverResourcePlanRecord(record, resourcesRef.current, { taskOwnerCounts });
      resourcesRef.current = recovered.resources;
      setResources(recovered.resources);
      setResourceExecution(recovered.execution);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlanErrors((current) => ({ ...current, [plan.plan_id]: message }));
      throw error;
    } finally {
      setPlanSavingId("");
    }
  }, [storeAcceptedPlanSnapshot]);

  const cancelPlan = useCallback(async (plan: ResourcePlan) => {
    setPlanSavingId(plan.plan_id);
    try {
      const record = await cancelResourcePlan(plan);
      const taskOwnerCounts = resourcePlanTaskOwnerCounts([
        ...Object.values(plansRef.current),
        record,
      ]);
      const accepted = recoverAcceptedResourcePlanSnapshot(
        plansRef.current[plan.plan_id],
        record,
        resourcesRef.current,
        { taskOwnerCounts },
      );
      if (!accepted) return;
      const { recovered } = accepted;
      storeAcceptedPlanSnapshot(accepted.record);
      resourcesRef.current = recovered.resources;
      setResources(recovered.resources);
      if (recovered.path.length > 0) setPath(recovered.path);
      setResourceExecution(recovered.execution);
    } finally {
      setPlanSavingId("");
    }
  }, [storeAcceptedPlanSnapshot]);

  const confirmResourcePlan = useCallback(
    async (plan: ResourcePlan) => {
      let confirmed = plan;
      const stored = plansRef.current[plan.plan_id]?.plan;
      if (stored && JSON.stringify(stored) !== JSON.stringify(plan)) {
        const record = await saveResourcePlan(plan);
        confirmed = record.plan;
        storeAcceptedPlanSnapshot(record);
      }
      await executePlan(confirmed, { confirm: true });
    },
    [executePlan, storeAcceptedPlanSnapshot]
  );

  const createPlanForRequest = useCallback(
    async (
      topic: string,
      confirmation?: LearningPathConfirmation,
      alreadyAdded = false,
      traceMessageId?: string,
      requestedConversationId?: string,
    ): Promise<{ ok: true } | { ok: false; error: { code?: string; message: string; retryable?: boolean; actions?: string[]; checkpoint?: unknown } }> => {
      const ownerConversationId = requestedConversationId ?? activeConversationIdRef.current;
      conversationActivityRef.current.add(ownerConversationId);
      syncRunningState();
      setHasRunMain(true);
      setPhase("planning");
      if (!alreadyAdded) addMessage("user", "text", topic);
      setAgent("supervisor", { status: "working", progress: 30, detail: "拆解需求并制定资料规划" });
      try {
        const effectiveTopic = confirmation?.refined_request?.trim()
          ? `${topic}\n\n用户补充确认：${confirmation.refined_request.trim()}`
          : topic;
        const record = await createResourcePlan({
          topic: effectiveTopic,
          requirements: effectiveTopic,
          planning_mode: confirmation ? "learning_path" : "resource",
          learning_baseline: confirmation?.baseline,
          learning_path_preferences: confirmation?.preferences,
        });
        planConversationRef.current.set(record.plan.plan_id, ownerConversationId);
        if (confirmation && !/补充到科目路径ID[：:]/.test(topic)) {
          setSubjectPathControls((current) => ({
            ...current,
            [record.plan.plan_id]: current[record.plan.plan_id] ?? {
              status: "ready",
              updatedAt: Date.now(),
            },
          }));
        }
        storeAcceptedPlanSnapshot(record);
        if (traceMessageId) {
          patchMessage(traceMessageId, { planId: record.plan.plan_id });
        }
        if (confirmation) {
          setPendingLearningPathForConversation(ownerConversationId, (current) => {
            if (!current) return current;
            return {
              ...current,
              planId: record.plan.plan_id,
              savedAt: Date.now(),
            };
          });
        }
        const showPlanCard = () => {
          const messageId = addMessageToConversation(
            ownerConversationId,
            "assistant",
            "plan_review",
            "",
          );
          patchMessage(messageId, { planId: record.plan.plan_id, streaming: false });
        };
        if (!confirmation) showPlanCard();
        setResourceExecution(
          reduceResourceExecutionEvent(createResourcePhaseState(), {
            event: "plan_ready",
            task_total: record.plan.tasks.length,
            auto_execute: record.plan.complexity.auto_execute,
          })
        );
        setAgent("supervisor", { status: "done", progress: 100, detail: "" });
        log(
          "supervisor",
          confirmation
            ? `学习方案已拆成 ${record.plan.tasks.length} 份资料，开始自动执行`
            : record.plan.status === "awaiting_confirmation"
            ? `复杂规划已拆成 ${record.plan.tasks.length} 份资料，等待确认`
            : `简单规划已验证，自动执行 ${record.plan.tasks.length} 份资料`,
          "ok"
        );
        if (confirmation) {
          const completed = await executePlanWithRecovery(record.plan, {
            confirm: record.plan.status === "awaiting_confirmation",
            traceMessageId,
          });
          if (!completed) {
            showPlanCard();
            return {
              ok: false,
              error: {
                code: "resource_review_failed",
                message: "一次自动返工后仍有供应商调用失败；已完成内容已保留，请检查模型额度或网络后重试",
                retryable: true,
              },
            };
          }
          showPlanCard();
        } else if (record.plan.complexity.auto_execute) {
          await executePlan(record.plan, { confirm: false, traceMessageId });
        }
        return { ok: true };
      } catch (error) {
        const apiError = error instanceof ApiRequestError ? error : undefined;
        const message = apiError?.detail ?? requestErrorMessage(error, "规划生成失败，请稍后重试");
        const structured = {
          code: apiError?.code,
          message,
          retryable: apiError?.retryable ?? true,
          actions: apiError?.actions,
          checkpoint: apiError?.checkpoint,
        };
        if (!confirmation) {
          addMessageToConversation(
            ownerConversationId,
            "assistant",
            "text",
            `资料规划已阻塞：${message}。请重试失败项、调整规划要求或打开课程知识库。`,
          );
          setPhase("blocked");
        }
        log("supervisor", `规划生成需要操作：${message}`, "warn");
        setAgent("supervisor", { status: "blocked", progress: 30, detail: "需要操作：重试失败项、调整要求或打开课程知识库" });
        return { ok: false, error: structured };
      } finally {
        conversationActivityRef.current.delete(ownerConversationId);
        syncRunningState();
        setPhase((current) => (current === "planning" ? "done" : current));
      }
    },
    [addMessage, addMessageToConversation, executePlan, executePlanWithRecovery, log, patchMessage, setAgent, setPendingLearningPathForConversation, storeAcceptedPlanSnapshot, syncRunningState]
  );

  const continueLearningPath = useCallback(async (confirmation: LearningPathConfirmation) => {
    const pending = pendingLearningPath;
    if (
      !pending ||
      !isValidLearningBaseline(confirmation.baseline)
    ) return;
    const ownerConversationId = pending.conversationId || activeConversationIdRef.current;
    if (learningPathRequestRef.current.has(ownerConversationId)) return;
    learningPathRequestRef.current.add(ownerConversationId);
    const submittedFromForm = pending.stage === "confirming";
    let reviewedConfirmation = confirmation;
    let traceMessageId = pending.traceMessageId ?? "";

    if (submittedFromForm) {
      if (traceMessageId) {
        patchMessage(traceMessageId, { streaming: false });
      }
      addMessage("user", "text", learningPathConfirmationMessage(confirmation));
      traceMessageId = addMessage("assistant", "text", "", true);
      setPendingLearningPathForConversation(ownerConversationId, {
        ...beginPlanning(pending, confirmation),
        traceMessageId,
      });
      setRunning(true);
      setPhase("planning");

      const controller = new AbortController();
      learningPathReviewAbortRef.current.set(ownerConversationId, controller);
      let streamedReasoning = "";
      const outcome: { result?: ConfirmationReviewPayload; error?: string } = {};
      try {
        await streamSSE(
          "/api/chat/clarify/stream",
          {
            student_id: getStudentId(),
            request: pending.request,
            task_family: "learning_path",
            owner_agent: "path_planner",
            phase: "confirmed",
            answers: confirmedLearningPathAnswers(confirmation),
          },
          ({ event, data }) => {
            if (event === "reasoning_reset") {
              streamedReasoning = "";
              patchMessage(traceMessageId, { reasoning: "", streaming: true });
              return;
            }
            if (event === "reasoning_delta" && typeof data.text === "string") {
              streamedReasoning += data.text;
              patchMessage(traceMessageId, {
                reasoning: streamedReasoning,
                streaming: true,
              });
              return;
            }
            if (event === "result") {
              outcome.result = data as unknown as ConfirmationReviewPayload;
              return;
            }
            if (event === "error") {
              outcome.error = typeof data.message === "string"
                ? data.message
                : "确认信息复核中断，请重试。";
            }
          },
          controller.signal,
        );
        if (outcome.error) throw new Error(outcome.error);
        const result = outcome.result;
        if (!result) throw new Error("智能体未返回确认后的执行判断，请重试。");
        if (result.decision !== "execute" || (result.questions?.length ?? 0) > 0) {
          throw new Error("确认后的信息仍未满足执行条件，请调整回答后重试。");
        }
        const reviewSummary = streamedReasoning.trim() || result.summary.trim();
        patchMessage(traceMessageId, {
          reasoning: reviewSummary,
          streaming: true,
        });
        reviewedConfirmation = {
          ...confirmation,
          reasoning_summary: [
            confirmation.reasoning_summary,
            reviewSummary,
          ].filter(Boolean).join("\n\n"),
        };
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          patchMessage(traceMessageId, { streaming: false });
          syncRunningState();
          learningPathRequestRef.current.delete(ownerConversationId);
          return;
        }
        const message = cause instanceof Error
          ? cause.message
          : "确认信息复核失败，请重试。";
        patchMessage(traceMessageId, {
          content: `学习任务复核未完成：${message}`,
          streaming: false,
        });
        setPendingLearningPathForConversation(ownerConversationId, failPlanning({
          ...beginPlanning(pending, confirmation),
          traceMessageId,
        }, {
          code: "confirmation_review_failed",
          message,
          retryable: true,
        }));
        setPhase("blocked");
        syncRunningState();
        learningPathRequestRef.current.delete(ownerConversationId);
        return;
      } finally {
        if (learningPathReviewAbortRef.current.get(ownerConversationId) === controller) {
          learningPathReviewAbortRef.current.delete(ownerConversationId);
        }
      }
    } else {
      traceMessageId ||= addMessage("assistant", "text", "", true);
      patchMessage(traceMessageId, {
        content: "",
        reasoning: confirmation.reasoning_summary || pending.clarificationSummary,
        streaming: true,
      });
      setPendingLearningPathForConversation(ownerConversationId, {
        ...beginPlanning(pending, confirmation),
        traceMessageId,
      });
    }

    const attempt = Math.max(1, pending.attempt ?? 1);
    setPendingLearningPathForConversation(ownerConversationId, (current) => current ? {
      ...beginPlanning(current, reviewedConfirmation),
      traceMessageId,
      attempt,
    } : current);
    try {
      const result = await createPlanForRequest(
        pending.request,
        reviewedConfirmation,
        true,
        traceMessageId,
        pending.conversationId,
      );
      if (result.ok) {
        // A retry reuses the same placeholder message. Keep the streamed
        // delivery summary that executePlan wrote into it.
        patchMessage(traceMessageId, { streaming: false });
        setPendingLearningPathForConversation(ownerConversationId, null);
        return;
      }
      patchMessage(traceMessageId, {
        content: `学习路径规划暂未完成：${result.error.message}`,
        streaming: false,
      });
      setPendingLearningPathForConversation(ownerConversationId, (current) => current ? failPlanning({
        ...current,
        traceMessageId,
        attempt: attempt + 1,
      }, result.error) : current);
    } finally {
      learningPathRequestRef.current.delete(ownerConversationId);
    }
  }, [
    addMessage,
    createPlanForRequest,
    patchMessage,
    pendingLearningPath,
    setPendingLearningPathForConversation,
    syncRunningState,
  ]);

  const recordLearningPathClarification = useCallback((summary: string, streaming = true) => {
    const conversationId = activeConversationIdRef.current;
    const current = pendingLearningPathRef.current.get(conversationId);
    const normalized = summary.trim();
    if (!current || !normalized) return;
    if (current.clarificationSummary !== normalized) {
      const next = { ...current, clarificationSummary: normalized, savedAt: Date.now() };
      setPendingLearningPathForConversation(conversationId, next);
    }
    if (current.traceMessageId) {
      patchMessage(current.traceMessageId, {
        reasoning: normalized,
        streaming,
      });
    }
  }, [patchMessage, setPendingLearningPathForConversation]);

  const retryLearningPath = useCallback(() => {
    if (!pendingLearningPath?.confirmation) return;
    const conversationId = pendingLearningPath.conversationId || activeConversationIdRef.current;
    if (pendingLearningPath.planId) {
      learningPathRequestRef.current.delete(conversationId);
      setPendingLearningPathForConversation(conversationId, {
        ...pendingLearningPath,
        stage: "planning",
        error: undefined,
        savedAt: Date.now(),
      });
      return;
    }
    void continueLearningPath(pendingLearningPath.confirmation);
  }, [continueLearningPath, pendingLearningPath, setPendingLearningPathForConversation]);

  const editLearningPath = useCallback(() => {
    setPendingLearningPath((current) => current ? editPlanning(current) : current);
  }, [setPendingLearningPath]);

  const openLearningPathKnowledgeBase = useCallback(() => {
    if (pendingLearningPath) {
      sessionStorage.setItem(
        accountStorageKey(PENDING_LEARNING_PATH_KEY),
        JSON.stringify({ ...pendingLearningPath, stage: "confirming", error: undefined }),
      );
    }
    router.push("/desktop/kb/");
  }, [pendingLearningPath, router]);

  const cancelLearningPath = useCallback(() => {
    if (!canCancelPlanning(pendingLearningPath)) return;
    if (pendingLearningPath?.traceMessageId) {
      patchMessage(pendingLearningPath.traceMessageId, {
        content: "已取消本次学习任务。",
        streaming: false,
      });
    }
    setPendingLearningPath(null);
  }, [patchMessage, pendingLearningPath, setPendingLearningPath]);

  useEffect(() => {
    const pendingConversationId = pendingLearningPath?.conversationId || activeConversationId;
    if (
      !hydrated ||
      mode !== "live" ||
      pendingLearningPath?.stage !== "planning" ||
      !pendingLearningPath.confirmation ||
      pendingLearningPath.error ||
      learningPathRequestRef.current.has(pendingConversationId)
    ) {
      return;
    }
    if (!pendingLearningPath.planId && pendingTracePlanId) {
      setPendingLearningPathForConversation(pendingConversationId, {
        ...pendingLearningPath,
        planId: pendingTracePlanId,
        savedAt: Date.now(),
      });
      return;
    }
    if (pendingLearningPath.planId) {
      let cancelled = false;
      const planId = pendingLearningPath.planId;
      const traceMessageId = pendingLearningPath.traceMessageId;
      learningPathRequestRef.current.add(pendingConversationId);
      void (async () => {
        try {
          const record = await getResourcePlan(planId);
          if (cancelled) return;
          storeAcceptedPlanSnapshot(record);
          const recovered = recoverResourcePlanRecord(record, resourcesRef.current, {
            taskOwnerCounts: resourcePlanTaskOwnerCounts([
              ...Object.values(plansRef.current),
              record,
            ]),
          });
          resourcesRef.current = recovered.resources;
          setResources(recovered.resources);
          if (recovered.path.length > 0) setPath(recovered.path);
          setResourceExecution(recovered.execution);
          if (traceMessageId) {
            patchMessage(traceMessageId, {
              planId,
              streaming: !["completed", "failed", "cancelled"].includes(record.plan.status),
            });
          }

          if (record.plan.status === "running") {
            setRunning(true);
            setPhase("generating");
            return;
          }
          if (record.plan.status === "completed" || record.plan.status === "cancelled") {
            if (traceMessageId) {
              patchMessage(traceMessageId, {
                content: resourcePlanTerminalMessage(record) ?? (
                  record.plan.status === "cancelled" ? "本次学习任务已取消。" : ""
                ),
                streaming: false,
              });
            }
            setPendingLearningPathForConversation(pendingConversationId, null);
            syncRunningState();
            setPhase(record.plan.status === "completed" ? "done" : "cancelled");
            learningPathRequestRef.current.delete(pendingConversationId);
            return;
          }

          const completed = await executePlanWithRecovery(record.plan, {
            confirm: record.plan.status === "awaiting_confirmation",
            traceMessageId,
          });
          if (cancelled) return;
          if (completed) {
            const finalRecord = await getResourcePlan(planId);
            if (traceMessageId) {
              patchMessage(traceMessageId, {
                content: resourcePlanTerminalMessage(finalRecord) ?? "",
                streaming: false,
              });
            }
            setPendingLearningPathForConversation(pendingConversationId, null);
          } else {
            const error = {
              code: "resource_review_failed",
              message: "资料执行未全部完成，已保留成功内容，可重试失败项。",
              retryable: true,
            };
            if (traceMessageId) {
              patchMessage(traceMessageId, {
                content: `学习路径规划暂未完成：${error.message}`,
                streaming: false,
              });
            }
            setPendingLearningPathForConversation(pendingConversationId, (current) => current
              ? failPlanning(current, error)
              : current);
          }
        } catch (cause) {
          if (cancelled) return;
          const message = requestErrorMessage(cause, "恢复学习任务失败，请稍后重试");
          if (traceMessageId) {
            patchMessage(traceMessageId, {
              content: `学习路径规划暂未完成：${message}`,
              streaming: false,
            });
          }
          setPendingLearningPathForConversation(pendingConversationId, (current) => current
            ? failPlanning(current, {
                code: "resume_failed",
                message,
                retryable: true,
              })
            : current);
          syncRunningState();
          setPhase("blocked");
        } finally {
          if (!cancelled && plansRef.current[planId]?.plan.status !== "running") {
            learningPathRequestRef.current.delete(pendingConversationId);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    void continueLearningPath(pendingLearningPath.confirmation);
  }, [
    continueLearningPath,
    executePlanWithRecovery,
    activeConversationId,
    hydrated,
    mode,
    patchMessage,
    pendingLearningPath,
    pendingTracePlanId,
    setPendingLearningPathForConversation,
    storeAcceptedPlanSnapshot,
    syncRunningState,
  ]);

  useEffect(() => {
    if (!hydrated || mode !== "live") return;
    let cancelled = false;
    const known = Object.values(plansRef.current);
    if (known.length === 0) return;
    void (async () => {
      const records = await Promise.all(
        known.map((record) => getResourcePlan(record.plan.plan_id)),
      );
      if (cancelled) return;
      const taskOwnerCounts = resourcePlanTaskOwnerCounts(records);
      const nextPlans = { ...plansRef.current };
      const acceptedRecords: ResourcePlanRecord[] = [];
      let mergedResources = resourcesRef.current;
      let latestRecovery: ReturnType<typeof recoverResourcePlanRecord> | undefined;
      for (const record of records) {
        const accepted = recoverAcceptedResourcePlanSnapshot(
          nextPlans[record.plan.plan_id],
          record,
          mergedResources,
          { taskOwnerCounts },
          { allowFailedRetry: true },
        );
        if (!accepted) continue;
        nextPlans[record.plan.plan_id] = accepted.record;
        acceptedRecords.push(accepted.record);
        const { recovered } = accepted;
        mergedResources = recovered.resources;
        if (recovered.path.length > 0 || !latestRecovery) latestRecovery = recovered;
      }
      plansRef.current = nextPlans;
      setPlans(nextPlans);
      resourcesRef.current = mergedResources;
      setResources(mergedResources);
      if (latestRecovery) {
        if (latestRecovery.path.length > 0) setPath(latestRecovery.path);
        setResourceExecution(latestRecovery.execution);
      }
      setMessages((current) => reconcilePlanFailureMessages(current, acceptedRecords));
      setConversationHistory((history) =>
        reconcilePlanFailureConversations(history, acceptedRecords),
      );
      const pendingPlanIds = new Set(
        Array.from(pendingLearningPathRef.current.values())
          .map((pending) => pending.planId)
          .filter((planId): planId is string => Boolean(planId)),
      );
      const approvedRecords = acceptedRecords.filter(
        (record) =>
          record.plan.status === "approved"
          && !pendingPlanIds.has(record.plan.plan_id),
      );
      await runPlansSequentially(approvedRecords, async (record) => {
        if (!cancelled) {
          await executePlan(record.plan, { confirm: false, resume: true });
        }
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [executePlan, hydrated, mode]);

  const runningPlanIds = Object.values(plans)
    .filter((record) => record.plan.status === "running")
    .map((record) => record.plan.plan_id)
    .sort()
    .join("|");

  useEffect(() => {
    if (!hydrated || mode !== "live" || !runningPlanIds) return;
    let cancelled = false;
    const ids = runningPlanIds.split("|").filter(Boolean);

    const refreshRunningPlans = async () => {
      const records = await Promise.all(ids.map((planId) => getResourcePlan(planId)));
      if (cancelled) return;
      const taskOwnerCounts = resourcePlanTaskOwnerCounts([
        ...Object.values(plansRef.current),
        ...records,
      ]);
      const nextPlans = { ...plansRef.current };
      const acceptedRecords: ResourcePlanRecord[] = [];
      let merged = resourcesRef.current;
      let latest: ReturnType<typeof recoverResourcePlanRecord> | undefined;
      for (const record of records) {
        const accepted = recoverAcceptedResourcePlanSnapshot(
          nextPlans[record.plan.plan_id],
          record,
          merged,
          { taskOwnerCounts },
        );
        if (!accepted) continue;
        nextPlans[record.plan.plan_id] = accepted.record;
        acceptedRecords.push(accepted.record);
        latest = accepted.recovered;
        merged = accepted.recovered.resources;
      }
      plansRef.current = nextPlans;
      setPlans(nextPlans);
      resourcesRef.current = merged;
      setResources(merged);
      if (latest) {
        if (latest.path.length > 0) setPath(latest.path);
        setResourceExecution(latest.execution);
      }
      setMessages((current) => reconcilePlanFailureMessages(current, acceptedRecords));
      setConversationHistory((history) =>
        reconcilePlanFailureConversations(history, acceptedRecords),
      );
      for (const [conversationId, pending] of pendingLearningPathRef.current) {
        const terminalPendingRecord = pending.planId
          ? acceptedRecords.find(
              (record) =>
                record.plan.plan_id === pending.planId
                && ["completed", "failed", "cancelled"].includes(record.plan.status),
            )
          : undefined;
        if (!terminalPendingRecord) continue;
        if (pending.traceMessageId) {
          patchMessage(pending.traceMessageId, {
            content: resourcePlanTerminalMessage(terminalPendingRecord)
              ?? (terminalPendingRecord.plan.status === "cancelled"
                ? "本次学习任务已取消。"
                : "学习路径资料未全部生成完成，已保留成功内容，可重试失败项。"),
            planId: terminalPendingRecord.plan.plan_id,
            streaming: false,
          });
        }
        learningPathRequestRef.current.delete(conversationId);
        syncRunningState();
        if (terminalPendingRecord.plan.status === "failed") {
          setPendingLearningPathForConversation(conversationId, failPlanning(pending, {
            code: "resource_review_failed",
            message: "资料执行未全部完成，已保留成功内容，可重试失败项。",
            retryable: true,
          }));
        } else {
          setPendingLearningPathForConversation(conversationId, null);
          setPhase(terminalPendingRecord.plan.status === "completed" ? "done" : "cancelled");
        }
      }
    };

    void refreshRunningPlans().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshRunningPlans().catch(() => undefined);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    hydrated,
    mode,
    patchMessage,
    runningPlanIds,
    setPendingLearningPathForConversation,
    syncRunningState,
  ]);

  /** 即时辅导：POST /api/chat，delta 逐字流。 */
  const runTutorLive = useCallback(
    async (
      question: string,
      displayQuestion = question,
      historyOverride?: ChatMessage[],
      attachments: TutorAttachment[] = [],
      pageContext?: TutorPageContext,
      responseMode: "text" | "voice" = "text",
    ) => {
      const ownerConversationId = activeConversationIdRef.current;
      const ownerTeacher = activeTeacher;
      const ctrl = new AbortController();
      setRunning(true);
      setHasRunMain(true);
      const scopedMessages = historyOverride ?? (
        ownerConversationId === activeConversationIdRef.current
          ? messagesRef.current
          : conversationHistoryRef.current.find(
              (session) => session.id === ownerConversationId,
            )?.messages ?? []
      );
      const history = scopedMessages
        .filter(
          (message) =>
            message.kind === "text" &&
            !message.streaming &&
            message.content.trim().length > 0
        )
        .slice(-100)
        .map((message) => ({
          role: message.role,
          content: message.content.trim().slice(0, 4000),
        }));
      const userMessageId = addMessageToConversation(
        ownerConversationId,
        "user",
        "text",
        displayQuestion,
      );
      if (attachments.length > 0) {
        patchMessage(userMessageId, {
          attachments: attachments.map(({ id, name, kind, media_type, size }) => ({
            id,
            name,
            kind,
            media_type,
            size,
          })),
        });
      }
      setPhase("tutoring");
      setAgent("tutor", {
        status: "working",
        detail: responseMode === "voice" ? "正在快速回复" : "正在思考并组织回答",
      });

      // 提前建立助手消息，让后端 run_id、公开事件和最终正文始终绑定到同一条回答。
      const msgId = addMessageToConversation(
        ownerConversationId,
        "assistant",
        "text",
        "",
        true,
      );
      const control: TutorRunControl = {
        conversationId: ownerConversationId,
        messageId: msgId,
        controller: ctrl,
      };
      tutorRunsRef.current.set(ownerConversationId, control);
      syncRunningState();
      setFocusedRunByConversation((current) => {
        if (!current[ownerConversationId]) return current;
        const next = { ...current };
        delete next[ownerConversationId];
        return next;
      });
      const runActive = () => tutorRunsRef.current.get(ownerConversationId) === control;
      let sourceCount = 0;
      let terminalMessage = false;
      let presentationQueue = Promise.resolve();
      const presentedReasoning = new Map<string, string>();
      const enqueuePresentation = (
        apply: () => void,
        delayMs = 0,
      ) => {
        presentationQueue = presentationQueue.then(async () => {
          if (!runActive()) return;
          apply();
          if (delayMs > 0) await sleep(delayMs);
        });
      };
      const enqueueTraceEvent = (data: Record<string, unknown>) => {
        if (data.event_type !== "reasoning") {
          enqueuePresentation(() => ingestRunEvent(msgId, data));
          return;
        }
        const spanKey = String(data.span_id ?? data.event_id ?? "reasoning");
        const previous = presentedReasoning.get(spanKey) ?? "";
        const delta = typeof data.reasoning_delta === "string"
          ? data.reasoning_delta
          : "";
        const complete = typeof data.reasoning_text === "string"
          ? data.reasoning_text
          : "";
        const target = complete || `${previous}${delta}`;
        if (!target.startsWith(previous)) {
          presentedReasoning.set(spanKey, target);
          enqueuePresentation(() => ingestRunEvent(msgId, data));
          return;
        }
        const remaining = target.slice(previous.length);
        let emitted = previous;
        for (let index = 0; index < remaining.length; index += 6) {
          const piece = remaining.slice(index, index + 6);
          emitted += piece;
          const visible = emitted;
          const presentationEvent = {
            ...data,
            event_id: `${String(data.event_id ?? spanKey)}:presentation:${visible.length}`,
            status: data.status === "completed" ? "running" : data.status,
            reasoning_text: undefined,
            reasoning_delta: piece,
            decision_summary: visible,
          };
          enqueuePresentation(
            () => ingestRunEvent(msgId, presentationEvent),
            40,
          );
        }
        presentedReasoning.set(spanKey, target);
        if (data.status === "completed") {
          enqueuePresentation(() => ingestRunEvent(msgId, data));
        }
      };
      try {
        await streamSSE(
          "/api/chat",
          {
            student_id: getStudentId(),
            conversation_id: ownerConversationId,
            message: question,
            history,
            attachments,
            page_context: pageContext ? {
              module: pageContext.module?.trim().slice(0, 80) || "",
              title: pageContext.title?.trim().slice(0, 180) || "",
              detail: pageContext.detail?.trim().slice(0, 1200) || "",
              entity_id: pageContext.entityId?.trim().slice(0, 120) || "",
            } : undefined,
            teacher_persona: ownerTeacher,
            response_mode: responseMode,
          },
          ({ event, data }) => {
            if (!runActive()) return;
            if (
              responseMode === "voice"
              && ["trace", "run_event", "progress", "context_budget", "sources"].includes(event)
            ) return;
            if (event === "trace" || event === "run_event") {
              enqueueTraceEvent(data);
            } else if (event === "context_budget") {
              const used = Number(data.estimated_input_tokens ?? 0);
              const budget = Number(data.input_budget ?? 0);
              const compressed = Number(data.compressed_history_messages ?? 0);
              log(
                "tutor",
                `上下文预算 ${used}/${budget} tokens${compressed ? ` · 已压缩 ${compressed} 条旧消息` : ""}`,
                "ok",
              );
            } else if (event === "progress") {
              const step = TUTOR_STEPS[(data.agent as string) ?? ""] ?? (data.agent as string);
              const detail = (data.detail as string) ?? "";
              if ((data.status as string) === "started" || detail) {
                log("tutor", `${step}${detail ? `：${detail}` : ""}`);
              }
            } else if (event === "sources") {
              sourceCount = Array.isArray(data.data) ? data.data.length : 0;
              if (sourceCount) log("tutor", `引用来源 ${sourceCount} 处已就位`, "ok");
            } else if (event === "delta") {
              enqueuePresentation(
                () => appendMessage(msgId, (data.text as string) ?? ""),
                responseMode === "voice" ? 0 : 8,
              );
            } else if (event === "answer_reset") {
              enqueuePresentation(
                () => patchMessage(msgId, { content: "", streaming: true }),
              );
            } else if (event === "content") {
              const full = (data.data as string) ?? "";
              enqueuePresentation(
                () => patchMessage(msgId, { content: full, streaming: false }),
              );
            } else if (event === "blocked") {
              terminalMessage = true;
              const message = (data.message as string) ?? "知识库未命中可靠内容。";
              const actions = Array.isArray(data.actions)
                ? (data.actions as string[]).map((action) =>
                    action === "open_kb" ? "打开知识库" : "重新检索",
                  )
                : [];
              enqueuePresentation(() => patchMessage(msgId, {
                  content: [message, actions.length ? `可操作：${actions.join("、")}` : ""].filter(Boolean).join("\n"),
                  streaming: false,
                }));
              log("tutor", message, "warn");
            } else if (event === "error") {
              terminalMessage = true;
              const message = (data.message as string) ?? "回答暂时不可用，请稍后重试。";
              enqueuePresentation(
                () => patchMessage(msgId, { content: message, streaming: false }),
              );
              log("tutor", `回答失败：${message}`, "warn");
            } else if (event === "done") {
              const status = String(data.status ?? "failed");
              if (status === "cancelled") {
                terminalMessage = true;
                enqueuePresentation(() => finishMessage(msgId, "本轮 AI 运行已停止。"));
                setPhase("cancelled");
              } else if (status === "failed" || status === "blocked") {
                terminalMessage = true;
                enqueuePresentation(() => finishMessage(
                  msgId,
                  status === "blocked"
                    ? "本轮被系统阻塞，但后端没有返回可展示的原因。请检查知识库或模型配置后重试。"
                    : "本轮执行失败，但后端没有返回可展示的错误详情。请重试或检查模型服务。",
                ));
                setPhase(status === "blocked" ? "blocked" : "failed");
              }
            }
          },
          ctrl.signal
        );
        if (!runActive()) return;
        await presentationQueue;
        if (!runActive()) return;
        patchMessage(msgId, { streaming: false });
        // 只有思考链、没有正文时补一句提示，避免空气泡
        if (!terminalMessage) {
          finishMessage(msgId, "后端没有返回可展示内容，请稍后重试。");
        }
        setAgent("tutor", { status: terminalMessage ? "idle" : "done", detail: "" });
        setPhase(terminalMessage ? "blocked" : "done");
      } catch (err) {
        if (!runActive()) return;
        const msg = err instanceof Error ? err.message : String(err);
        patchMessage(msgId, { content: `辅导请求失败：${msg}。`, streaming: false });
        setAgent("tutor", { status: "idle", detail: "" });
        setPhase("blocked");
      } finally {
        if (tutorRunsRef.current.get(ownerConversationId) === control) {
          tutorRunsRef.current.delete(ownerConversationId);
        }
        syncRunningState();
      }
    },
    [
      activeTeacher,
      addMessageToConversation,
      appendMessage,
      finishMessage,
      ingestRunEvent,
      log,
      patchMessage,
      setAgent,
      syncRunningState,
    ]
  );

  /* 用户消息入口。 */

  /** 找视频：检索 B站 学习视频，给出可点链接，并在内置浏览器打开搜索结果。 */
  const runVideoSearch = useCallback(
    async (query: string) => {
      const ownerConversationId = activeConversationIdRef.current;
      conversationActivityRef.current.add(ownerConversationId);
      syncRunningState();
      addMessageToConversation(ownerConversationId, "user", "text", query);
      setPhase("tutoring");
      const topic = videoTopic(query);
      const ack = addMessageToConversation(
        ownerConversationId,
        "assistant",
        "text",
        "",
        true,
      );
      let vids: BilibiliVideoResult[] = [];
      try {
        try {
          vids = await searchBilibiliVideos(mode, topic, 5);
        } catch {
          /* 失败走下面的搜索页兜底 */
        }
        if (!conversationActivityRef.current.has(ownerConversationId)) return;
        const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(topic)}`;
        const body =
          vids.length > 0
            ? `为你找到这些 B站「${topic}」学习视频，点开会在右侧「内置浏览器」播放：\n\n${vids
                .map((v) => `- [${v.title}](${v.url})`)
                .join("\n")}\n\n或 [在内置浏览器打开 B站 搜索结果](${searchUrl})。`
            : `已为你 [在内置浏览器打开 B站「${topic}」搜索](${searchUrl})，可在里面直接挑选学习视频。`;
        for (let index = 0; index < body.length; index += 4) {
          if (!conversationActivityRef.current.has(ownerConversationId)) return;
          patchMessage(ack, { content: body.slice(0, index + 4), streaming: true });
          await sleep(18);
        }
        finishMessage(ack, body);
        if (!conversationActivityRef.current.has(ownerConversationId)) return;
        openInBrowser(searchUrl);
        setPhase("done");
      } finally {
        conversationActivityRef.current.delete(ownerConversationId);
        syncRunningState();
      }
    },
    [addMessageToConversation, finishMessage, mode, patchMessage, syncRunningState]
  );

  /**
   * 学习路径的唯一入口。聊天意图和路径页表单都先进入同一个学情确认，
   * 确认后继续复用 createPlanForRequest 的 learning_path 管线。
   */
  const requestLearningPath = useCallback(
    (request: string, visibleRequest?: string) => {
      const trimmed = request.trim();
      const visible = (visibleRequest ?? request).trim();
      if (!trimmed || conversationRunning || mode === "checking") return;
      const routedRequest = bindSubjectSupplementRequest(
        trimmed,
        buildSubjectLearningPaths({
          plans,
          fallbackPath: path,
          fallbackAnchor: pathScheduleAnchor,
          controls: subjectPathControls,
          completedKeys: completedMaterials,
        }),
      );
      if (mode === "offline") {
        addMessage("user", "text", visible || trimmed);
        addMessage(
          "assistant",
          "text",
          "后端未连接，无法生成学习路径。请启动本地后端后重试。",
        );
        return;
      }
      addMessage("user", "text", visible || trimmed);
      const traceMessageId = addMessage("assistant", "text", "", true);
      setPendingLearningPath({
        version: 1,
        request: routedRequest,
        conversationId: activeConversationIdRef.current,
        stage: "confirming",
        traceMessageId,
        savedAt: Date.now(),
      });
    },
    [addMessage, completedMaterials, conversationRunning, mode, path, pathScheduleAnchor, plans, setPendingLearningPath, subjectPathControls],
  );

  const requestSubjectPathSupplement = useCallback((subjectId: string, subjectTitle: string, detail: string) => {
    const trimmed = detail.trim();
    if (!trimmed) return;
    const request = [
      "请补充现有科目学习路径，不创建新的科目路径。",
      `学习主题：${subjectTitle}`,
      `补充到科目路径ID：${subjectId}`,
      `补充要求：${trimmed}`,
      "合并要求：保留原有日程和资源，只为新增内容生成必要资源并追加到该科目路径。",
    ].join("\n");
    requestLearningPath(request, `补充「${subjectTitle}」学习路径：${trimmed}`);
  }, [requestLearningPath]);

  const runResourceOpenAction = useCallback(async (request: string) => {
    const ownerConversationId = activeConversationIdRef.current;
    conversationActivityRef.current.add(ownerConversationId);
    const actionActive = () => conversationActivityRef.current.has(ownerConversationId);
    const finishAction = () => {
      conversationActivityRef.current.delete(ownerConversationId);
      syncRunningState();
    };
    syncRunningState();
    setHasRunMain(true);
    addMessageToConversation(ownerConversationId, "user", "text", request);
    setPhase("tutoring");
    setAgent("tutor", { status: "working", detail: "匹配可打开的学习资料" });

    let availableResources = resourcesRef.current;
    try {
      const persisted = await listMaterials(mode);
      if (!actionActive()) return;
      availableResources = mergeResourceLists(persisted, availableResources);
      resourcesRef.current = availableResources;
      setResources(availableResources);
    } catch {
      // 已有会话候选仍可继续使用；资料库暂时不可用时不改写成生成任务。
    }

    const candidates = readyResourceCandidates(availableResources);
    if (candidates.length === 0) {
      addMessageToConversation(ownerConversationId, "assistant", "text", "当前没有已生成且通过审核的资料可以打开。我没有替你生成新资料。你可以先到「资源中心」确认资料状态，或明确告诉我要生成什么。", false);
      setAgent("tutor", { status: "done", detail: "没有可打开的已审核资料" });
      setPhase("done");
      finishAction();
      return;
    }

    const previousSpecificRequest = hasResourceTypeHint(request)
      ? undefined
      : [...messages]
          .reverse()
          .find((message) =>
            message.role === "user" &&
            message.kind === "text" &&
            isResourceOpenIntent(message.content) &&
            hasResourceTypeHint(message.content),
          )
          ?.content.trim();
    const planningRequest = previousSpecificRequest
      ? `${previousSpecificRequest}\n用户补充：${request}`
      : request;

    let action = fallbackResourceAction(planningRequest, candidates);
    if (mode === "live") {
      try {
        const planned = await resolveAgentResourceAction(planningRequest, candidates);
        action = planned.action === "open_resource"
          ? planned
          : fallbackResourceAction(planningRequest, candidates);
      } catch {
        // 后端动作规划不可用时仍只在真实候选中做确定性匹配，不回落到生成管线。
        action = fallbackResourceAction(planningRequest, candidates);
      }
    }
    if (!actionActive()) return;

    if (action.action === "open_resource" && action.resource_id) {
      const selected = candidates.find((resource) => resource.id === action.resource_id);
      if (selected) {
        setPendingSoftwareAction({
          id: ++softwareActionIdRef.current,
          type: "open_resource",
          resourceId: selected.id,
        });
        addMessageToConversation(
          ownerConversationId,
          "assistant",
          "text",
          action.reply?.trim() || `好的，已经为你打开《${selected.title}》。`,
          false,
        );
        setAgent("tutor", { status: "done", detail: `已打开《${selected.title}》` });
        setPhase("done");
        finishAction();
        return;
      }
    }

    addMessageToConversation(ownerConversationId, "assistant", "text", "没有找到与你的要求匹配且已通过审核的资料。我没有生成新资料，请换一个资料标题或类型再试。", false);
    setAgent("tutor", { status: "done", detail: "未找到匹配的已审核资料" });
    setPhase("done");
    finishAction();
  }, [addMessageToConversation, messages, mode, setAgent, syncRunningState]);

  const acknowledgeSoftwareAction = useCallback((actionId: number) => {
    setPendingSoftwareAction((current) => current?.id === actionId ? null : current);
  }, []);

  const send = useCallback(
    (
      text: string,
      attachments: TutorAttachment[] = [],
      pageContext?: TutorPageContext,
      responseMode: "text" | "voice" = "text",
    ) => {
      const trimmed = text.trim();
      if ((!trimmed && attachments.length === 0) || conversationRunning || mode === "checking") return;
      const question = trimmed || "请阅读这些附件并解答其中的问题，给出关键步骤、结论和必要的逐题解析。";
      if (responseMode === "voice") {
        if (mode === "offline") {
          addMessage("user", "text", question);
          addMessage("assistant", "text", "后端未连接，暂时无法进行语音答疑。" );
          return;
        }
        void runTutorLive(question, question, undefined, attachments, pageContext, "voice");
        return;
      }
      if (attachments.length > 0) {
        if (mode === "offline") {
          const messageId = addMessage("user", "text", question);
          patchMessage(messageId, {
            attachments: attachments.map(({ id, name, kind, media_type, size }) => ({ id, name, kind, media_type, size })),
          });
          addMessage("assistant", "text", "后端未连接，暂时无法解析附件。请启动本地后端后重新发送。" );
          return;
        }
        void runTutorLive(question, question, undefined, attachments, pageContext);
        return;
      }
      // “打开/查看/播放资料”是软件动作，优先级高于资料生成和普通答疑。
      if (isResourceOpenIntent(question)) {
        void runResourceOpenAction(question);
        return;
      }
      if (mode === "offline") {
        addMessage("user", "text", question);
        addMessage(
          "assistant",
          "text",
          "后端未连接，无法调用真实 AI。请在 backend 目录运行 uvicorn app.main:app --port 8000 后再发送。"
        );
        return;
      }
      // 找视频意图最优先：直接检索并打开内置浏览器
      if (wantsVideo(question)) {
        void runVideoSearch(question);
        return;
      }
      // 明确要生成资料才走多智能体资源管线；普通首轮问答也直接交给 /api/chat。
      const generate = wantsResource(question);
      if (generate && needsLearningBaseline(question)) {
        requestLearningPath(question);
      } else if (generate) void createPlanForRequest(question);
      else void runTutorLive(question, question, undefined, [], pageContext);
    },
    [addMessage, conversationRunning, createPlanForRequest, mode, patchMessage, requestLearningPath, runResourceOpenAction, runTutorLive, runVideoSearch]
  );

  /**
   * 停止当前请求：即时中断聊天 SSE，并向每个正在执行的资料规划发送真实取消请求。
   * 轨迹终态仍只接受后端事件，本函数不会伪造 cancelled span。
   */
  const stop = useCallback(async () => {
    if (!conversationRunning) return;
    const ownerConversationId = activeConversationIdRef.current;
    const currentPendingLearningPath = pendingLearningPathRef.current.get(ownerConversationId);
    const pendingBelongsToCurrent = Boolean(currentPendingLearningPath);
    if (pendingBelongsToCurrent) {
      learningPathRequestRef.current.delete(ownerConversationId);
      learningPathReviewAbortRef.current.get(ownerConversationId)?.abort();
      learningPathReviewAbortRef.current.delete(ownerConversationId);
    }

    // Keep the tutor SSE open after the real cancellation request so the
    // backend-authored cancelled root span and done event reach the inspector.
    let waitingForTutorTerminal = false;
    const tutorControl = tutorRunsRef.current.get(ownerConversationId);
    const tutorMessageId = tutorControl?.messageId;
    const tutorRunId = tutorMessageId
      ? messageRunBindingsRef.current.get(tutorMessageId)
      : undefined;
    if (tutorControl && tutorRunId) {
      try {
        await cancelAgentRun(tutorRunId);
        waitingForTutorTerminal = true;
      } catch {
        tutorControl.controller.abort();
        tutorRunsRef.current.delete(ownerConversationId);
        finishMessage(tutorControl.messageId, "本轮 AI 运行已停止。");
      }
    } else if (tutorControl) {
      tutorControl.controller.abort();
      tutorRunsRef.current.delete(ownerConversationId);
      finishMessage(tutorControl.messageId, "本轮 AI 运行已停止。");
    }

    const restoredPlanId = pendingBelongsToCurrent
      && currentPendingLearningPath?.stage === "planning"
      ? currentPendingLearningPath.planId
      : undefined;
    const activePlanIds = Array.from(new Set([
      ...Array.from(activePlanRunsRef.current).filter(
        (planId) => planConversationRef.current.get(planId) === ownerConversationId,
      ),
      ...(restoredPlanId ? [restoredPlanId] : []),
    ]));
    const cancellations = activePlanIds.map(async (planId) => {
      const plan = plansRef.current[planId]?.plan;
      if (!plan) return { planId, accepted: false };
      try {
        const record = await cancelResourcePlan(plan);
        storeAcceptedPlanSnapshot(record);
        return { planId, accepted: true };
      } catch {
        // Only disconnect the stream when the server could not accept the
        // cancellation request; otherwise keep it open for the real terminal.
        abortRef.current.get(planId)?.abort();
        return { planId, accepted: false };
      }
    });
    const planCancellationResults = await Promise.all(cancellations);
    const waitingForPlanTerminal = planCancellationResults.some((result) => result.accepted);

    if (!waitingForTutorTerminal && !waitingForPlanTerminal) {
      setMessages((previous) =>
        previous.map((message) =>
          message.streaming ? { ...message, streaming: false } : message,
        ),
      );
      conversationActivityRef.current.delete(ownerConversationId);
      syncRunningState();
    }
    if (pendingBelongsToCurrent) setPendingLearningPathForConversation(ownerConversationId, (current) => current?.stage === "planning"
      ? failPlanning(current, {
          code: "cancelled",
          message: "本次规划已停止，可点击重试继续。",
          retryable: true,
        })
      : current);
    if (!waitingForPlanTerminal) setPlanExecutingId("");
    setPhase("cancelled");
  }, [
    conversationRunning,
    finishMessage,
    setPendingLearningPathForConversation,
    storeAcceptedPlanSnapshot,
    syncRunningState,
  ]);

  const retryLast = useCallback(() => {
    if (conversationRunning || mode !== "live") return;
    const lastQuestion = [...messages]
      .reverse()
      .find((message) => message.role === "user" && message.kind === "text")
      ?.content.trim();
    if (lastQuestion) send(lastQuestion);
  }, [conversationRunning, messages, mode, send]);

  /**
   * 即时讲解：把一段内容（如某页 PPT / 某份资料）交给答疑智能体讲解，
   * 强制走 tutor 路线（不触发资源生成的意图判定），用于「调用对话进行实时讲解」。
   */
  const explain = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || conversationRunning || mode === "checking") return;
      if (mode === "offline") {
        addMessage(
          "assistant",
          "text",
          "后端未连接，无法进行实时讲解。请先启动本地后端后重试。"
        );
        return;
      }
      void runTutorLive(trimmed);
    },
    [addMessage, conversationRunning, mode, runTutorLive]
  );

  const recordTaskEvidence = useCallback(
    (
      key: string,
      content: string,
      kind: TaskEvidenceRecord["kind"] = "written_response",
      markComplete = true,
      passed = markComplete,
    ) => {
      const normalized = content.replace(/\s+/g, " ").trim();
      if (!key || normalized.length < 2) return;
      const completedAt = new Date().toISOString();
      setTaskEvidence((previous) => ({
        ...previous,
        [key]: { kind, content: normalized.slice(0, 2000), completedAt, passed },
      }));
      if (markComplete) {
        setCompletedMaterials((previous) =>
          previous.includes(key) ? previous : [...previous, key],
        );
      }
    },
    [],
  );

  const recordResourceStudy = useCallback(
    (resource: ResourceItem, learningTaskKey?: string) => {
      const summary = `已阅读《${resource.title}》到内容末尾，等待配套练习达标`;
      recordTaskEvidence(resourceCompletionKey(resource.id), summary, "resource_read", false, false);
      if (learningTaskKey) {
        recordTaskEvidence(learningTaskKey, summary, "resource_read", false, false);
      }
    },
    [recordTaskEvidence],
  );

  const recordPractice = useCallback(
    (resource: ResourceItem, submission: QuizSubmission, learningTaskKey?: string) => {
      const submittedAt = new Date().toISOString();
      const timestamp = Date.now();
      const attempt: PracticeAttempt = {
        ...submission,
        id: `attempt_${timestamp}`,
        resourceId: resource.id,
        title: resource.title,
        submittedAt,
      };
      const adjustment: PathAdjustment = {
        id: `adjustment_${timestamp}`,
        submittedAt,
        score: submission.score,
        text: buildPathAdjustment(resource.title, submission),
      };

      setPracticeAttempts((previous) => [attempt, ...previous].slice(0, 10));
      setAdjustments((previous) => [adjustment, ...previous].slice(0, 10));
      setProfile((previous) => applyPracticeProfile(previous, submission));
      markProfileUpdate("练习批改");
      const evidence = `已提交《${resource.title}》：${submission.correctCount}/${submission.total} 题正确，得分 ${submission.score}`;
      recordTaskEvidence(resourceCompletionKey(resource.id), evidence, "quiz_submission");

      let targetKey = learningTaskKey;
      if (!targetKey) {
        const candidates: { key: string; exact: boolean }[] = [];
        path.forEach((step, stageIndex) => {
          (step.steps ?? []).forEach((task, taskIndex) => {
            const key = taskCompletionKey(stageIndex, taskIndex);
            if (completedMaterials.includes(key)) return;
            const practiceTask =
              task.kind === "practice" ||
              task.resource_types.includes("quiz") ||
              /练习|测验|题/.test(task.title);
            if (!practiceTask) return;
            candidates.push({
              key,
              exact: Boolean(task.resources?.some((item) => item.id === resource.id)),
            });
          });
        });
        targetKey = candidates.find((candidate) => candidate.exact)?.key ?? candidates[0]?.key;
      }
      if (targetKey) recordTaskEvidence(targetKey, evidence, "quiz_submission");

      const stageMatch = targetKey?.match(/^(\d+):task:(\d+)$/);
      const stageIndex = stageMatch ? Number(stageMatch[1]) : -1;
      if (stageIndex >= 0 && path[stageIndex]) {
        const passed = submission.score >= QUIZ_PASS_SCORE;
        (path[stageIndex].steps ?? []).forEach((task, taskIndex) => {
          const isStudyTask =
            task.kind !== "practice" &&
            task.kind !== "review" &&
            !task.resource_types.includes("quiz");
          if (!isStudyTask) return;
          const studyKey = taskCompletionKey(stageIndex, taskIndex);
          const qualification = passed
            ? `配套练习《${resource.title}》得分 ${submission.score}，学习资料判定合格`
            : `配套练习《${resource.title}》得分 ${submission.score}，未达到 ${QUIZ_PASS_SCORE} 分，学习资料暂未合格`;
          recordTaskEvidence(
            studyKey,
            qualification,
            "quiz_submission",
            passed,
            passed,
          );
        });
      }
    },
    [completedMaterials, markProfileUpdate, path, recordTaskEvidence]
  );

  const recordCodePractice = useCallback((input: {
    title: string;
    score: number;
    passed: boolean;
    passedTests: number;
    totalTests: number;
    knowledgePoints: string[];
  }) => {
    const score = Math.max(0, Math.min(100, Math.round(input.score)));
    setProfile((previous) => previous.map((dimension) => {
      if (dimension.key !== "knowledge_level") return dimension;
      const value = Math.round(dimension.value * 0.65 + score * 0.35);
      return { ...dimension, value, delta: value - dimension.value };
    }));
    markProfileUpdate("代码挑战评分");
    setTags((previous) => {
      const points = input.knowledgePoints.map((item) => item.trim()).filter(Boolean);
      const retained = input.passed
        ? previous.filter((tag) => !points.some((point) => tag === `待巩固：${point}`))
        : previous;
      return Array.from(new Set([
        ...retained,
        "代码实战",
        ...(score === 100 ? ["代码题满分"] : []),
        ...(!input.passed && points[0] ? [`待巩固：${points[0]}`] : []),
      ])).slice(-20);
    });
  }, [markProfileUpdate]);

  /** 清空对话历史（保留资源、画像与路径），并允许下一条消息重新触发生成。 */
  const clearMessages = useCallback(() => {
    for (const controller of abortRef.current.values()) controller.abort();
    abortRef.current.clear();
    for (const run of tutorRunsRef.current.values()) run.controller.abort();
    tutorRunsRef.current.clear();
    conversationActivityRef.current.clear();
    learningPathRequestRef.current.clear();
    for (const controller of learningPathReviewAbortRef.current.values()) controller.abort();
    learningPathReviewAbortRef.current.clear();
    messageRunBindingsRef.current.clear();
    messageTraceSequenceRef.current.clear();
    replayedRunIdsRef.current.clear();
    setMessages([]);
    setAgentRunStore(createAgentRunStore());
    setFocusedRunByConversation({});
    pendingLearningPathRef.current.clear();
    setPendingLearningPaths({});
    setAgents(initialAgentState());
    setLogs([]);
    setHasRunMain(false);
    setRunning(false);
    setRunningConversationIds({});
    setPhase("idle");
    setActiveConversationUpdatedAt(Date.now());
  }, []);

  /** Switch the visible conversation without cancelling background plans. */
  const clearConversationSurface = useCallback(() => {
    messagesRef.current = [];
    setMessages([]);
    setHasRunMain(false);
    setActiveConversationUpdatedAt(Date.now());
  }, []);

  const archiveActiveConversation = useCallback(() => {
    if (messages.length === 0) return;
    const snapshot: ConversationSession = {
      id: activeConversationId,
      title:
        activeConversationTitle ||
        conversationTitle(messages, activeConversationKind, activeResourceTitle),
      updatedAt: activeConversationUpdatedAt,
      messages: conversationRunning
        ? messages.map((message) => ({ ...message }))
        : normalizeStoredMessages(messages),
      teacher: activeTeacher,
      kind: activeConversationKind,
      resourceId: activeResourceId,
      resourceTitle: activeResourceTitle,
      resourceContext: activeResourceContext,
    };
    setConversationHistory((history) => upsertConversation(history, snapshot));
  }, [
    activeConversationId,
    activeConversationKind,
    activeConversationTitle,
    activeConversationUpdatedAt,
    activeResourceContext,
    activeResourceId,
    activeResourceTitle,
    activeTeacher,
    conversationRunning,
    messages,
  ]);

  const askResourceQuestion = useCallback((request: ResourceConversationRequest): boolean => {
    const prompt = request.prompt.trim();
    const displayQuestion = request.displayQuestion.trim();
    if (!prompt || !displayQuestion || !request.resourceId || conversationRunning || mode === "checking") {
      return false;
    }

    const continueCurrent =
      activeConversationKind === "resource_qa" && activeResourceId === request.resourceId;
    if (!continueCurrent) {
      archiveActiveConversation();
      clearConversationSurface();
      const conversationId = createConversationId();
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
      setActiveConversationTitle("");
      setActiveConversationUpdatedAt(Date.now());
      setActiveConversationKind("resource_qa");
      setActiveResourceId(request.resourceId);
    }
    setActiveResourceTitle(request.resourceTitle.trim() || "学习资料");
    if (request.resourceContext?.trim()) {
      setActiveResourceContext(request.resourceContext.trim().slice(0, 2000));
    }

    if (mode === "offline") {
      addMessage("user", "text", displayQuestion);
      addMessage("assistant", "text", "后端未连接，无法进行资料问答。请先启动本地后端后重试。");
      return true;
    }
    void runTutorLive(prompt, displayQuestion, continueCurrent ? undefined : []);
    return true;
  }, [
    activeConversationKind,
    activeResourceId,
    addMessage,
    archiveActiveConversation,
    clearConversationSurface,
    conversationRunning,
    mode,
    runTutorLive,
  ]);

  const newConversation = useCallback((teacher: TeacherPersona = DEFAULT_TEACHER): string | undefined => {
    archiveActiveConversation();
    clearConversationSurface();
    setActiveTeacher(teacher);
    const conversationId = createConversationId();
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
    setActiveConversationTitle("");
    setActiveConversationUpdatedAt(Date.now());
    setActiveConversationKind("general");
    setActiveResourceId("");
    setActiveResourceTitle("");
    setActiveResourceContext("");
    return conversationId;
  }, [
    archiveActiveConversation,
    clearConversationSurface,
  ]);

  const openConversation = useCallback((conversationId: string) => {
    if (conversationId === activeConversationId) return;
    const target = conversationHistory.find((session) => session.id === conversationId);
    if (!target) return;
    archiveActiveConversation();
    clearConversationSurface();
    activeConversationIdRef.current = target.id;
    setActiveConversationId(target.id);
    setActiveConversationTitle(target.title);
    setActiveConversationUpdatedAt(target.updatedAt);
    setActiveTeacher(normalizeTeacherPersona(target.teacher));
    setActiveConversationKind(target.kind);
    setActiveResourceId(target.resourceId);
    setActiveResourceTitle(target.resourceTitle);
    setActiveResourceContext(target.resourceContext);
    const targetPendingLearningPath = pendingLearningPathRef.current.get(target.id);
    const targetHasLiveWork = target.messages.some((message) => message.streaming)
      || (
        targetPendingLearningPath
        && ["confirming", "planning"].includes(targetPendingLearningPath.stage)
      );
    const restoredMessages = reconcilePlanFailureMessages(
      targetHasLiveWork
        ? target.messages.map((message) => ({ ...message }))
        : normalizeStoredMessages(target.messages),
      Object.values(plansRef.current),
    );
    const targetMaxId = restoredMessages.reduce((maximum, message) => {
      const value = Number(String(message.id).replace(/^m/, ""));
      return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0);
    msgIdRef.current = Math.max(msgIdRef.current, targetMaxId);
    messagesRef.current = restoredMessages;
    setMessages(restoredMessages);
    setHasRunMain(target.messages.length > 0);
  }, [
    activeConversationId,
    archiveActiveConversation,
    clearConversationSurface,
    conversationHistory,
  ]);

  /** Delete one complete conversation while preserving shared learning outputs. */
  const deleteConversation = useCallback((conversationId: string) => {
    if (running) return;
    getConversationSync().deleteSession(conversationId);
    setConversationHistory((history) =>
      history.filter((session) => session.id !== conversationId),
    );
    if (conversationId !== activeConversationId) return;
    clearMessages();
    setPendingLearningPathForConversation(conversationId, null);
    setActiveConversationId(createConversationId());
    setActiveConversationTitle("");
    setActiveConversationUpdatedAt(Date.now());
    setActiveConversationKind("general");
    setActiveResourceId("");
    setActiveResourceTitle("");
    setActiveResourceContext("");
  }, [activeConversationId, clearMessages, running, setPendingLearningPathForConversation]);

  const renameConversation = useCallback((conversationId: string, title: string) => {
    const nextTitle = title.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!nextTitle) return;
    const updatedAt = Date.now();
    if (conversationId === activeConversationId) {
      setActiveConversationTitle(nextTitle);
      setActiveConversationUpdatedAt(updatedAt);
      return;
    }
    setConversationHistory((history) =>
      history.map((session) =>
        session.id === conversationId
          ? { ...session, title: nextTitle, updatedAt }
          : session,
      ),
    );
  }, [activeConversationId]);

  /** 删除单条消息。 */
  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setActiveConversationUpdatedAt(Date.now());
  }, []);

  /** 切换路径资料完成状态（键为 `${阶段下标}:${type}`）。 */
  const toggleMaterial = useCallback((key: string) => {
    setCompletedMaterials((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const appendResources = useCallback((items: ResourceItem[]) => {
    if (items.length === 0) return;
    setResources((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const item of items) byId.set(item.id, item);
      return Array.from(byId.values());
    });
  }, []);

  const recordReflection = useCallback(
    (
      resource: ResourceItem,
      taskKey: string,
      userContent: string,
      aiSupplement = "",
    ) => {
      appendResources([resource]);
      const evidence = [
        `已提交《${resource.title}》`,
        userContent.trim().slice(0, 1200),
        aiSupplement.trim() ? `AI 补充：${aiSupplement.trim().slice(0, 600)}` : "",
      ].filter(Boolean).join("；");
      recordTaskEvidence(taskKey, evidence, "written_response");
      setProfile((previous) =>
        previous.map((dimension) => {
          const increment =
            dimension.key === "error_profile"
              ? 4
              : dimension.key === "cognitive_style"
                ? 2
                : dimension.key === "goals"
                  ? 1
                  : 0;
          if (!increment) return dimension;
          return {
            ...dimension,
            value: Math.min(100, dimension.value + increment),
            delta: dimension.delta + increment,
          };
        }),
      );
      markProfileUpdate("学习复盘");
      setTags((previous) =>
        Array.from(
          new Set([
            ...previous,
            "主动复盘",
            ...(aiSupplement.trim() ? ["AI 协作复盘"] : []),
          ]),
        ),
      );
    },
    [appendResources, markProfileUpdate, recordTaskEvidence],
  );

  const clearResources = useCallback(() => {
    resourcesRef.current = [];
    setResources([]);
    setResourcePathAttachments({});
  }, []);

  const removeResource = useCallback(async (id: string): Promise<ResourceRemovalResult> => {
    if (!id.trim()) throw new Error("缺少要删除的资源 ID");
    if (mode === "checking") throw new Error("后端连接状态仍在检查，请稍后再试");

    const sessionItem = resourcesRef.current.find((item) => item.id === id);
    const persisted = (await listMaterials(mode)).find((item) => item.id === id);
    if (!sessionItem && !persisted) throw new Error("资源不存在或已经被删除");

    let removedPaper = false;
    if (persisted?.type === "quiz" && persisted.exam_id) {
      await deletePaper(mode, persisted.exam_id);
      removedPaper = true;
    }
    if (persisted) await deleteMaterial(mode, id);

    resourcesRef.current = resourcesRef.current.filter((item) => item.id !== id);
    setResources(resourcesRef.current);
    setResourcePathAttachments((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    return {
      id,
      removedFrom: persisted ? "library" : "session",
      removedPaper,
    };
  }, [mode]);

  const recordWatchedVideo = useCallback(
    (
      video: BilibiliVideoResult,
      options: { watchedSeconds?: number; summary?: string } = {}
    ) => {
      const watchedSeconds = options.watchedSeconds ?? 0;
      const record: WatchedVideoRecord = {
        ...video,
        embed_url:
          video.embed_url ??
          `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(video.bvid)}&autoplay=0`,
        watched_seconds: watchedSeconds,
        watched_at: new Date().toISOString(),
        learning_summary: options.summary ?? video.summary ?? "",
      };
      setWatchedVideos((prev) => [
        record,
        ...prev.filter((item) => item.bvid !== record.bvid),
      ].slice(0, 20));

      const videoStep = buildWatchedVideoStep(record, watchedSeconds);
      setPath((prev) => {
        const links = videoStep.links ?? [];
        if (prev.length === 0) {
          return [{ ...videoStep, state: "current" as const }];
        }
        if (prev.some((step) => step.links?.some((link) => link.bvid === record.bvid))) {
          return prev.map((step) => ({
            ...step,
            links: step.links?.map((link) =>
              link.bvid === record.bvid ? { ...link, watched_seconds: watchedSeconds } : link
            ),
          }));
        }
        return prev.map((step, index) =>
          index === 0 ? { ...step, links: [...(step.links ?? []), ...links] } : step
        );
      });
    },
    []
  );

  /** 把一次摸底结果应用到画像雷达与标签。 */
  const applyAssessment = useCallback(
    (input: { subject: string; level: MasteryLevel; gaps?: string[] }) => {
      const target = masteryTarget(input.level);
      setProfile((prev) =>
        prev.map((d) => {
          if (d.key === "knowledge_level") return { ...d, delta: target - d.value, value: target };
          if (d.key === "goals") {
            const v = Math.max(d.value, 82);
            return { ...d, delta: v - d.value, value: v };
          }
          if (d.key === "interests") {
            const v = Math.min(100, d.value + 12);
            return { ...d, delta: v - d.value, value: v };
          }
          return d;
        })
      );
      markProfileUpdate("学情摸底");
      setTags((prev) => mergeAssessmentTags(prev, input));
    },
    [markProfileUpdate]
  );

  const reset = useCallback(() => {
    for (const controller of abortRef.current.values()) controller.abort();
    abortRef.current.clear();
    for (const run of tutorRunsRef.current.values()) run.controller.abort();
    tutorRunsRef.current.clear();
    conversationActivityRef.current.clear();
    learningPathRequestRef.current.clear();
    for (const controller of learningPathReviewAbortRef.current.values()) controller.abort();
    learningPathReviewAbortRef.current.clear();
    messageRunBindingsRef.current.clear();
    messageTraceSequenceRef.current.clear();
    replayedRunIdsRef.current.clear();
    try {
      localStorage.removeItem(accountStorageKey(SESSION_KEY));
      sessionStorage.removeItem(accountStorageKey(PENDING_LEARNING_PATH_KEY));
    } catch {
      /* ignore */
    }
    workspaceSaveChainRef.current = workspaceSaveChainRef.current.then(async () => {
      await deleteLearnerWorkspaceState();
      workspaceVersionRef.current = 0;
    }).catch(() => undefined);
    setMessages([]);
    setConversationHistory([]);
    setActiveTeacher(DEFAULT_TEACHER);
    setActiveConversationId(createConversationId());
    setActiveConversationTitle("");
    setActiveConversationUpdatedAt(Date.now());
    setActiveConversationKind("general");
    setActiveResourceId("");
    setActiveResourceTitle("");
    setActiveResourceContext("");
    setAgentRunStore(createAgentRunStore());
    setFocusedRunByConversation({});
    pendingLearningPathRef.current.clear();
    setPendingLearningPaths({});
    setAgents(initialAgentState());
    setLogs([]);
    setResources([]);
    setProfile(PROFILE_BASE);
    setTags([]);
    setProfileUpdatedAt("");
    setProfileSources([]);
    setPath([]);
    setSubjectPathControls({});
    setResourcePathAttachments({});
    setPlanTasks([]);
    setPlanReason("");
    setPhase("idle");
    setRunning(false);
    setRunningConversationIds({});
    setHasRunMain(false);
    setPracticeAttempts([]);
    setAdjustments([]);
    setCompletedMaterials([]);
    setTaskEvidence({});
    setWatchedVideos([]);
    setPlans({});
    setPlanSavingId("");
    setPlanExecutingId("");
    setPlanErrors({});
    setResourceExecution(createResourcePhaseState());
  }, []);

  const conversations: ConversationSummary[] = [
    {
      id: activeConversationId,
      title:
        activeConversationTitle ||
        conversationTitle(messages, activeConversationKind, activeResourceTitle),
      updatedAt: activeConversationUpdatedAt,
      active: true,
      running: conversationRunning,
      teacher: activeTeacher,
      kind: activeConversationKind,
      resourceId: activeResourceId,
      resourceTitle: activeResourceTitle,
    },
    ...conversationHistory
      .filter((session) => session.id !== activeConversationId)
      .map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        active: false,
        running: session.messages.some(
          (message) => message.role === "assistant" && message.streaming,
        ) || Boolean(runningConversationIds[session.id]),
        teacher: normalizeTeacherPersona(session.teacher),
        kind: session.kind,
        resourceId: session.resourceId,
        resourceTitle: session.resourceTitle,
      })),
  ];
  const latestConversationRunId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && Boolean(message.runId))
    ?.runId;
  const focusedConversationRunId = focusedRunByConversation[activeConversationId];
  const activeConversationRunId = focusedConversationRunId
    && messages.some((message) => message.runId === focusedConversationRunId)
    ? focusedConversationRunId
    : latestConversationRunId;
  const activeAgentRun = activeConversationRunId
    ? agentRunStore.runs[activeConversationRunId]
    : undefined;
  const baseSubjectPaths = useMemo(
    () => buildSubjectLearningPaths({
      plans,
      fallbackPath: path,
      fallbackAnchor: pathScheduleAnchor,
      controls: subjectPathControls,
      completedKeys: completedMaterials,
    }),
    [completedMaterials, path, pathScheduleAnchor, plans, subjectPathControls],
  );
  const subjectPaths = useMemo(
    () => applyResourcePathAttachments(baseSubjectPaths, resourcePathAttachments),
    [baseSubjectPaths, resourcePathAttachments],
  );
  const attachResourceToPath = useCallback((
    resource: ResourceItem,
    subjectId: string,
    taskKey: string,
  ): ResourcePathAttachment => {
    const subject = subjectPaths.find((item) => item.id === subjectId);
    const targetExists = subject?.path.some((step) =>
      (step.steps ?? []).some((task) => task.completion_key === taskKey),
    );
    if (!subject || !targetExists) throw new Error("所选学习路径位置已经不存在，请重新选择");
    const attachment: ResourcePathAttachment = {
      resourceId: resource.id,
      resourceType: resource.type,
      resourceTitle: resource.title,
      subjectId,
      taskKey,
      attachedAt: Date.now(),
    };
    setResourcePathAttachments((current) => ({
      ...current,
      [resource.id]: attachment,
    }));
    return attachment;
  }, [subjectPaths]);
  const detachResourceFromPath = useCallback((resourceId: string) => {
    setResourcePathAttachments((current) => {
      if (!current[resourceId]) return current;
      const next = { ...current };
      delete next[resourceId];
      return next;
    });
  }, []);
  const masterLearningPath = useMemo(
    () => buildMasterLearningPath(subjectPaths),
    [subjectPaths],
  );
  const activateSubjectPath = useCallback((subjectId: string, activationDate: string) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(activationDate) ? activationDate : localDateKey();
    setSubjectPathControls((current) => ({
      ...current,
      [subjectId]: {
        ...current[subjectId],
        status: date > localDateKey() ? "scheduled" : "active",
        activationDate: date,
        updatedAt: Date.now(),
      },
    }));
  }, []);
  const pauseSubjectPath = useCallback((subjectId: string) => {
    setSubjectPathControls((current) => ({
      ...current,
      [subjectId]: {
        ...current[subjectId],
        status: "paused",
        activationDate: current[subjectId]?.activationDate,
        updatedAt: Date.now(),
      },
    }));
  }, []);
  const resumeSubjectPath = useCallback((subjectId: string) => {
    setSubjectPathControls((current) => ({
      ...current,
      [subjectId]: {
        ...current[subjectId],
        status: "active",
        activationDate: localDateKey(),
        updatedAt: Date.now(),
      },
    }));
  }, []);
  const replanSubjectPath = useCallback((subjectId: string, dailyMinutes: number) => {
    const subject = subjectPaths.find((item) => item.id === subjectId);
    const minutes = Math.max(10, Math.min(240, Math.round(dailyMinutes)));
    setSubjectPathControls((current) => {
      const existing = current[subjectId];
      return {
        ...current,
        [subjectId]: {
          ...existing,
          status: existing?.status && existing.status !== "deleted"
            ? existing.status
            : subject?.controlStatus ?? "ready",
          activationDate: existing?.activationDate ?? subject?.activationDate,
          dailyMinutes: minutes,
          updatedAt: Date.now(),
        },
      };
    });
  }, [subjectPaths]);
  const deleteSubjectPath = useCallback((subjectId: string) => {
    const subject = subjectPaths.find((item) => item.id === subjectId);
    const sourceIds = subject?.sourcePlanIds.length ? subject.sourcePlanIds : [subjectId];
    setSubjectPathControls((current) => sourceIds.reduce<Record<string, SubjectPathControl>>(
      (next, sourceId) => ({
        ...next,
        [sourceId]: {
          status: "deleted",
          updatedAt: Date.now(),
        },
      }),
      current,
    ));
    setResourcePathAttachments((current) => Object.fromEntries(
      Object.entries(current).filter(([, attachment]) => attachment.subjectId !== subjectId),
    ));
  }, [subjectPaths]);
  const importMarketPath = useCallback((
    listingId: string,
    authorName: string,
    snapshot: MarketPathSnapshot,
  ): boolean => {
    const planId = `market-${listingId}`;
    if (plansRef.current[planId]) return false;
    const record = createMarketPathRecord(listingId, authorName, snapshot);
    const next = { ...plansRef.current, [planId]: record };
    plansRef.current = next;
    setPlans(next);
    setSubjectPathControls((current) => ({
      ...current,
      [planId]: {
        status: "ready",
        dailyMinutes: Math.max(10, snapshot.dailyMinutes || 30),
        updatedAt: Date.now(),
      },
    }));
    return true;
  }, []);
  const canRetryLast =
    !conversationRunning &&
    mode === "live" &&
    messages.some((message) => message.role === "user" && message.kind === "text");
  const visiblePendingLearningPath = !pendingLearningPath?.conversationId
    || pendingLearningPath.conversationId === activeConversationId
    ? pendingLearningPath
    : null;

  return {
    mode,
    messages,
    conversations,
    activeConversationId,
    activeConversationKind,
    activeResourceId,
    activeResourceTitle,
    activeResourceContext,
    activeTeacher,
    newConversation,
    openConversation,
    renameConversation,
    deleteConversation,
    agentRunStore,
    activeAgentRun,
    focusMessageRun,
    agents,
    logs,
    resources,
    profile,
    tags,
    profileUpdatedAt,
    profileSources,
    path,
    pathScheduleAnchor,
    subjectPaths,
    resourcePathAttachments,
    masterPath: masterLearningPath.path,
    masterPathScheduleAnchor: masterLearningPath.anchorDate,
    masterLearningPath,
    activateSubjectPath,
    pauseSubjectPath,
    resumeSubjectPath,
    replanSubjectPath,
    attachResourceToPath,
    detachResourceFromPath,
    deleteSubjectPath,
    importMarketPath,
    planTasks,
    planReason,
    phase,
    running,
    conversationRunning,
    conversationSwitchLocked: false,
    hasRunMain,
    hydrated,
    practiceAttempts,
    adjustments,
    completedMaterials,
    taskEvidence,
    watchedVideos,
    plans,
    planSavingId,
    planExecutingId,
    planErrors,
    resourceExecution,
    pendingSoftwareAction,
    acknowledgeSoftwareAction,
    pendingLearningPath: visiblePendingLearningPath,
    recordLearningPathClarification,
    continueLearningPath,
    retryLearningPath,
    editLearningPath,
    openLearningPathKnowledgeBase,
    cancelLearningPath,
    recordPractice,
    recordCodePractice,
    recordTaskEvidence,
    recordResourceStudy,
    recordReflection,
    appendResources,
    patchResourceData,
    clearResources,
    removeResource,
    recordWatchedVideo,
    requestLearningPath,
    requestSubjectPathSupplement,
    send,
    stop,
    retryLast,
    canRetryLast,
    explain,
    askResourceQuestion,
    reset,
    clearMessages,
    deleteMessage,
    applyAssessment,
    toggleMaterial,
    savePlan,
    confirmResourcePlan,
    replanPlan,
    cancelPlan,
  };
}

