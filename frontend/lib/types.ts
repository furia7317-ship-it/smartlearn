/** 与后端 SSE 协议对齐的领域类型（core/sse.py: plan / progress / content / review / done）。 */

export type AgentId =
  | "profiler"
  | "outliner"
  | "supervisor"
  | "explainer"
  | "mindmap"
  | "quiz"
  | "solution"
  | "reading"
  | "code"
  | "video"
  | "courseware"
  | "interactive"
  | "reviewer"
  | "integrator"
  | "planner"
  | "tutor";

export type AgentStatus =
  | "idle"
  | "working"
  | "done"
  | "rework"
  | "blocked"
  | "skipped";

export interface AgentRuntime {
  status: AgentStatus;
  /** 0-100，仅生成类智能体使用。 */
  progress: number;
  /** 当前动作的一句话描述。 */
  detail: string;
}

export interface AgentMeta {
  id: AgentId;
  /** 角色名（中文）。 */
  name: string;
  /** 职责一句话。 */
  duty: string;
  /** 主题色（hex），用于内联样式，避免动态 Tailwind 类名失效。 */
  color: string;
}

export type LogLevel = "info" | "ok" | "warn";

export interface LogLine {
  id: number;
  ts: string;
  agent: AgentId;
  text: string;
  level: LogLevel;
}

export type ResourceType =
  | "explainer"
  | "mindmap"
  | "quiz"
  | "solution"
  | "reading"
  | "code"
  | "video"
  | "courseware"
  | "interactive";

export type ResourceStatus =
  | "pending" // 排队/生成中
  | "review" // 已生成，待审核
  | "rejected" // 审核驳回，重做中
  | "failed" // 生成或传输失败，可重试
  | "ready"; // 已过审

export interface ResourceItem {
  id: string;
  type: ResourceType;
  title: string;
  subtitle: string;
  meta: string[];
  status: ResourceStatus;
  /** 重做版本号，>1 时展示 v2 徽标。 */
  version: number;
  /** 引用来源数（防幻觉角标）。 */
  sources: number;
  /** 生成器产出的完整内容载荷（点开查看 / 答题用），与后端 content 事件 data 同构。 */
  data?: ResourceData;
  /** quiz 资料在持久资料库中关联的真实试卷 ID。 */
  exam_id?: string | null;
}

/** 各生成器的内容载荷（与 backend/app/agents/*.py 输出对齐）。 */

export interface QuizQuestion {
  id?: string;
  /** mcq | blank | judge */
  type?: string;
  stem: string;
  /** 形如 ["A. 选项", "B. 选项"]，blank 题可为空。 */
  options?: string[];
  /** 正确答案：字母（"A"）或填空文本。 */
  answer?: string;
  explanation?: string;
}

export interface MindmapNode {
  id?: string;
  label: string;
  children?: MindmapNode[];
}

export interface KeyTerm {
  term: string;
  definition: string;
}

export interface CodeVariation {
  description: string;
  code: string;
}

export interface Slide {
  slide_num?: number;
  title: string;
  content?: string[];
  layout?: string;
}

export interface NarrationLine {
  text: string;
  duration?: number;
  title?: string;
}

export interface VideoScene {
  id?: string;
  title?: string;
  purpose?: "hook" | "concept" | "example" | "pitfall" | "application" | "recap" | string;
  narration?: string;
  text?: string;
  duration?: number;
  visual_template?: string;
  visual_params?: Record<string, unknown>;
  focus_terms?: string[];
  visual_search_terms?: string[];
}

/** 资源内容载荷（按 type 取对应字段，渲染时安全访问）。 */
export interface ResourceData {
  title?: string;
  // explainer
  overview?: string;
  explanation?: string;
  analogy?: string;
  key_points?: string[];
  sources?: unknown[];
  // mindmap
  nodes?: MindmapNode[];
  // quiz
  questions?: QuizQuestion[];
  // reading
  content?: string;
  key_terms?: KeyTerm[];
  references?: string[];
  discussion_questions?: string[];
  // code
  language?: string;
  code?: string;
  output?: string;
  variations?: CodeVariation[];
  // video
  template?: string;
  params?: Record<string, unknown>;
  narration?: NarrationLine[];
  scenes?: VideoScene[];
  hook?: string;
  key_takeaways?: string[];
  chapters?: { title: string; start: number }[];
  target_duration_seconds?: number;
  // courseware
  slides?: Slide[];
  total_slides?: number;
  // interactive（交互演示，载荷契约见 lib/sandbox-runtime.ts）
  summary?: string;
  html?: string;
  css?: string;
  js?: string;
  runtime?: string[];
  interactions?: string[];
  [key: string]: unknown;
}

export interface PathTask {
  title: string;
  detail: string;
  minutes: number;
  resource_types: ResourceType[];
  /** Stable across master-path reordering and subject activation changes. */
  completion_key?: string;
  subject_id?: string;
  subject_title?: string;
  /** 后端编排出的真实学习动作，旧存档可缺省。 */
  kind?: "resource" | "study" | "practice" | "review";
  /** 没有独立题库时，直接展示在路径里的主动回忆/复盘问题。 */
  prompts?: string[];
  /** 完成状态必须由哪类真实学习证据触发。 */
  completion_kind?: "resource_read" | "quiz_submission" | "written_response";
  resources?: {
    id: string;
    type: ResourceType;
    title: string;
  }[];
}

export interface PathStep {
  day: string;
  title: string;
  desc: string;
  types: ResourceType[];
  state: "current" | "todo";
  /** Knowledge points and prerequisite labels are used to render the desktop path as a dependency graph. */
  knowledge_points?: string[];
  prerequisites?: string[];
  subject_ids?: string[];
  subject_titles?: string[];
  objective?: string;
  minutes?: number;
  steps?: PathTask[];
  links?: {
    type: "bilibili";
    title: string;
    url: string;
    bvid: string;
    embed_url: string;
    watched_seconds: number;
  }[];
}

export interface ProfileDim {
  key: string;
  /** 雷达图轴名。 */
  label: string;
  value: number;
  delta: number;
}

export type MessageKind = "text" | "plan" | "resources" | "path" | "plan_review";

export type AgentRunTerminalStatus = "completed" | "failed" | "blocked" | "cancelled";
export type AgentRunStatus = "pending" | "running" | AgentRunTerminalStatus;
export type AgentRunEventType =
  | "operation"
  | "reasoning"
  | "tool"
  | "delegate"
  | "verification"
  | "result";
export type AgentReasoningSource =
  | "provider_summary"
  | "provider_reasoning"
  | "model_narration"
  | "runtime";
export type AgentEventVisibility = "normal" | "verbose" | "summary";

export interface AgentToolPolicy {
  effect?: "read" | "write" | "external" | string;
  destructive?: boolean;
  open_world?: boolean;
  approval?: "auto" | "ask" | "forbidden" | string;
}

/**
 * 后端公开执行事件归并后的 span 视图。字段使用统一 run-scoped 协议；
 * 这里只保存可公开摘要与证据引用，不保存原始工具 JSON 或模型私密思维文本。
 */
export interface AgentTraceStep {
  schema_version: string;
  run_id: string;
  event_id: string;
  sequence: number;
  span_id: string;
  parent_span_id: string | null;
  agent_id: string;
  task_id?: string;
  attempt: number;
  event_type: AgentRunEventType;
  action_type: string;
  status: AgentRunStatus;
  input_summary?: string;
  observation_summary?: string;
  decision_summary?: string;
  evidence_ids: string[];
  started_at?: string;
  ended_at?: string;
  usage?: Record<string, unknown>;
  error_code?: string;
  retryable?: boolean;
  /** 面向学生的动作标题，不参与身份或去重。 */
  title: string;
  phase?: string;
  detail?: string;
  chapter_id?: string;
  source_count?: number;
  response_id?: string;
  from_agent?: string;
  to_agent?: string;
  improvement_actions?: string[];
  acceptance_check?: string;
  /** Provider 公开摘要或模型主动写出的行动说明；不是原始私密思维链。 */
  reasoning_text?: string;
  /** 流式公开摘要的单个增量，仅用于合并到 reasoning_text。 */
  reasoning_delta?: string;
  reasoning_source?: AgentReasoningSource;
  segment_index?: number;
  visibility?: AgentEventVisibility;
  tool_policy?: AgentToolPolicy;
}

export type ResourcePhaseId =
  | "understanding"
  | "planning"
  | "generation"
  | "review"
  | "integration"
  | "delivery";

export interface ResourceExecutionPhase {
  id: ResourcePhaseId;
  label: string;
  status: "pending" | "running" | "completed" | "error";
  progress: number;
  detail?: string;
}

export interface ResourceTaskProgress {
  task_id: string;
  title?: string;
  agent?: string;
  status: string;
  progress?: number;
  approved?: boolean;
  score?: number;
  issues?: string[];
  retry_count?: number;
}

export interface ResourcePhaseState {
  phases: ResourceExecutionPhase[];
  tasks: Record<string, ResourceTaskProgress>;
  taskTotal: number;
  autoExecute: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  kind: MessageKind;
  content: string;
  streaming: boolean;
  /** Wall-clock lifetime of this assistant response, kept across route changes and reloads. */
  processingStartedAt?: number;
  processingEndedAt?: number;
  /** 公开处理过程（检索、工具调用、生成阶段），不包含模型私密推理。 */
  reasoning?: string;
  /** 绑定本次消息对应的真实后端 run；重新打开会话时由事件库回放。 */
  runId?: string;
  /** 旧存档迁移兼容；新运行不再把轨迹数组写进消息。 */
  trace?: AgentTraceStep[];
  planId?: string;
  /** Public metadata only; extracted text and image bytes are never persisted in chat history. */
  attachments?: ChatAttachmentMeta[];
}

export type ChatAttachmentKind =
  | "image"
  | "pdf"
  | "document"
  | "presentation"
  | "spreadsheet"
  | "text";

export interface ChatAttachmentMeta {
  id: string;
  name: string;
  kind: ChatAttachmentKind;
  media_type: string;
  size: number;
}

export interface TutorAttachment extends ChatAttachmentMeta {
  extracted_text: string;
  image_data: string;
  recognition_status: "recognized" | "parsed" | "fallback";
  recognition_provider: string;
  recognition_notice: string;
}

export type Phase =
  | "idle"
  | "profiling"
  | "planning"
  | "generating"
  | "reviewing"
  | "pathing"
  | "tutoring"
  | "blocked"
  | "cancelled"
  | "failed"
  | "done";

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "待命中",
  profiling: "构建学习画像",
  planning: "检索知识库 · 任务分诊",
  generating: "多智能体并行生成",
  reviewing: "质检审核 · 防幻觉校验",
  pathing: "规划个性化学习路径",
  tutoring: "智能辅导答疑",
  blocked: "等待知识库处理",
  cancelled: "本轮已停止",
  failed: "本轮执行失败",
  done: "本轮协同完成",
};
