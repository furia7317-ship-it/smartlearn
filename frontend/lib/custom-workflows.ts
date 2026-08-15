export type WorkflowNodeKind =
  | "start"
  | "agent"
  | "knowledge"
  | "condition"
  | "review"
  | "end";

export type WorkflowTone = "green" | "blue" | "violet" | "amber" | "rose" | "slate";

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  description: string;
  x: number;
  y: number;
  width: number;
  tone: WorkflowTone;
  agentKey?: string;
  model?: string;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface CustomWorkflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: "draft" | "published";
  updatedAt: string;
}

export const CUSTOM_WORKFLOW_STORAGE_KEY = "sl_custom_workflows_v2";

const BASE_TIME = "2026-07-28T09:00:00.000Z";

export const DEFAULT_WORKFLOW: CustomWorkflow = {
  id: "learning-material-generator",
  name: "学习资料生成器",
  description: "从课程主题出发，检索知识库并协作生成讲解、例题和动画脚本。",
  status: "draft",
  updatedAt: BASE_TIME,
  nodes: [
    {
      id: "start",
      kind: "start",
      title: "开始",
      description: "接收课程主题、学习目标与难度",
      x: 48,
      y: 302,
      width: 150,
      tone: "green",
    },
    {
      id: "outline-agent",
      kind: "agent",
      title: "大纲讲解师",
      description: "拆解知识结构与讲解顺序",
      x: 242,
      y: 82,
      width: 170,
      tone: "violet",
      model: "学枢大模型",
    },
    {
      id: "knowledge-search",
      kind: "knowledge",
      title: "知识库检索",
      description: "从个人资料与课程库召回内容",
      x: 242,
      y: 282,
      width: 170,
      tone: "blue",
    },
    {
      id: "example-agent",
      kind: "agent",
      title: "例题生成师",
      description: "生成分层例题与解析",
      x: 242,
      y: 482,
      width: 170,
      tone: "amber",
      model: "学枢大模型",
    },
    {
      id: "animation-condition",
      kind: "condition",
      title: "是否需要动画",
      description: "根据概念抽象度选择分支",
      x: 466,
      y: 282,
      width: 178,
      tone: "amber",
    },
    {
      id: "animation-agent",
      kind: "agent",
      title: "动画导演",
      description: "生成分镜、节奏与画面提示",
      x: 694,
      y: 112,
      width: 170,
      tone: "rose",
      model: "学枢视觉模型",
    },
    {
      id: "quality-review",
      kind: "review",
      title: "质量审核",
      description: "事实、难度与表达三重校验",
      x: 694,
      y: 520,
      width: 170,
      tone: "blue",
    },
    {
      id: "end",
      kind: "end",
      title: "结束",
      description: "汇总并写入学习资源",
      x: 912,
      y: 520,
      width: 146,
      tone: "slate",
    },
  ],
  edges: [
    { id: "edge-start-outline", from: "start", to: "outline-agent" },
    { id: "edge-start-knowledge", from: "start", to: "knowledge-search" },
    { id: "edge-start-example", from: "start", to: "example-agent" },
    { id: "edge-outline-condition", from: "outline-agent", to: "animation-condition" },
    { id: "edge-knowledge-condition", from: "knowledge-search", to: "animation-condition" },
    { id: "edge-example-condition", from: "example-agent", to: "animation-condition" },
    {
      id: "edge-condition-animation",
      from: "animation-condition",
      to: "animation-agent",
      label: "需要",
    },
    {
      id: "edge-condition-review",
      from: "animation-condition",
      to: "quality-review",
      label: "不需要",
    },
    { id: "edge-animation-review", from: "animation-agent", to: "quality-review" },
    { id: "edge-review-end", from: "quality-review", to: "end" },
  ],
};

function cloneWorkflow(workflow: CustomWorkflow): CustomWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({ ...node })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
  };
}

function isWorkflow(value: unknown): value is CustomWorkflow {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CustomWorkflow>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges)
  );
}

export function loadCustomWorkflows(storage?: Pick<Storage, "getItem">): CustomWorkflow[] {
  if (!storage) return [cloneWorkflow(DEFAULT_WORKFLOW)];
  try {
    const raw = storage.getItem(CUSTOM_WORKFLOW_STORAGE_KEY);
    if (!raw) return [cloneWorkflow(DEFAULT_WORKFLOW)];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [cloneWorkflow(DEFAULT_WORKFLOW)];
    const workflows = parsed.filter(isWorkflow).map(cloneWorkflow);
    return workflows.length > 0 ? workflows : [cloneWorkflow(DEFAULT_WORKFLOW)];
  } catch {
    return [cloneWorkflow(DEFAULT_WORKFLOW)];
  }
}

export function persistCustomWorkflow(
  workflow: CustomWorkflow,
  storage?: Pick<Storage, "getItem" | "setItem">,
): CustomWorkflow[] {
  const nextWorkflow = {
    ...cloneWorkflow(workflow),
    updatedAt: new Date().toISOString(),
  };
  const workflows = loadCustomWorkflows(storage);
  const index = workflows.findIndex((item) => item.id === nextWorkflow.id);
  if (index >= 0) workflows[index] = nextWorkflow;
  else workflows.unshift(nextWorkflow);
  storage?.setItem(CUSTOM_WORKFLOW_STORAGE_KEY, JSON.stringify(workflows));
  return workflows;
}

export function createStarterWorkflow(): CustomWorkflow {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: `workflow-${Date.now()}-${suffix}`,
    name: "未命名工作流",
    description: "拖入节点并连接端口，搭建属于你的学习工作流。",
    status: "draft",
    updatedAt: new Date().toISOString(),
    nodes: [
      {
        id: `start-${suffix}`,
        kind: "start",
        title: "开始",
        description: "定义工作流输入",
        x: 120,
        y: 286,
        width: 150,
        tone: "green",
      },
      {
        id: `end-${suffix}`,
        kind: "end",
        title: "结束",
        description: "输出最终结果",
        x: 700,
        y: 286,
        width: 146,
        tone: "slate",
      },
    ],
    edges: [],
  };
}
