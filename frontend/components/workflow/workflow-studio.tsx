"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Boxes,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  GitBranch,
  Info,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";

import { CustomAgentWorkspace } from "@/components/custom-agent-workspace";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import {
  customAgentMonogram,
  listCustomAgents,
  type CustomAgent,
} from "@/lib/custom-agents";
import {
  persistCustomWorkflow,
  type CustomWorkflow,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowTone,
} from "@/lib/custom-workflows";
import { cn } from "@/lib/utils";

import styles from "./workflow-studio.module.css";

const NODE_HEIGHT = 84;
const STAGE_WIDTH = 1120;
const STAGE_HEIGHT = 760;

const BUILTIN_NODES: Array<{
  kind: WorkflowNodeKind;
  title: string;
  description: string;
  tone: WorkflowTone;
}> = [
  {
    kind: "agent",
    title: "智能体",
    description: "调用一个自建或内置智能体",
    tone: "violet",
  },
  {
    kind: "knowledge",
    title: "知识库检索",
    description: "从资料库召回相关内容",
    tone: "blue",
  },
  {
    kind: "condition",
    title: "条件分支",
    description: "按规则决定后续路径",
    tone: "amber",
  },
  {
    kind: "review",
    title: "质量审核",
    description: "检查事实、难度与表达",
    tone: "blue",
  },
  {
    kind: "end",
    title: "结束",
    description: "整理并输出工作流结果",
    tone: "slate",
  },
];

function nodeIcon(kind: WorkflowNodeKind, className = "size-3.5") {
  switch (kind) {
    case "start":
      return <Play className={className} fill="currentColor" />;
    case "agent":
      return <Bot className={className} />;
    case "knowledge":
      return <Database className={className} />;
    case "condition":
      return <GitBranch className={className} />;
    case "review":
      return <ShieldCheck className={className} />;
    case "end":
      return <CircleDot className={className} />;
  }
}

function edgePath(edge: WorkflowEdge, nodes: WorkflowNode[]): string {
  const source = nodes.find((node) => node.id === edge.from);
  const target = nodes.find((node) => node.id === edge.to);
  if (!source || !target) return "";
  if (Math.abs(source.x - target.x) < 24 && target.y > source.y) {
    const startX = source.x + source.width / 2;
    const startY = source.y + NODE_HEIGHT;
    const endX = target.x + target.width / 2;
    const endY = target.y;
    const middleY = (startY + endY) / 2;
    return `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`;
  }
  const startX = source.x + source.width;
  const startY = source.y + NODE_HEIGHT / 2;
  const endX = target.x;
  const endY = target.y + NODE_HEIGHT / 2;
  const gap = Math.max(44, Math.abs(endX - startX) * 0.46);
  return `M ${startX} ${startY} C ${startX + gap} ${startY}, ${endX - gap} ${endY}, ${endX} ${endY}`;
}

function edgeLabelPosition(edge: WorkflowEdge, nodes: WorkflowNode[]) {
  const source = nodes.find((node) => node.id === edge.from);
  const target = nodes.find((node) => node.id === edge.to);
  if (!source || !target) return { x: 0, y: 0 };
  return {
    x: (source.x + source.width + target.x) / 2,
    y: (source.y + target.y) / 2 + NODE_HEIGHT / 2 - 7,
  };
}

function makeNodeId(kind: WorkflowNodeKind) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

interface WorkflowStudioProps {
  initialWorkflow: CustomWorkflow;
  onBack: () => void;
  onSaved?: (workflow: CustomWorkflow) => void;
}

interface DragState {
  id: string;
  offsetX: number;
  offsetY: number;
}

export function WorkflowStudio({
  initialWorkflow,
  onBack,
  onSaved,
}: WorkflowStudioProps) {
  const { mode } = useOrchestratorContext();
  const reduceMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const [workflow, setWorkflow] = useState<CustomWorkflow>(initialWorkflow);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialWorkflow.nodes.find((node) => node.id === "outline-agent")?.id ??
      initialWorkflow.nodes[0]?.id ??
      null,
  );
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentManagerOpen, setAgentManagerOpen] = useState(false);
  const [agentManagerKey, setAgentManagerKey] = useState(0);
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [running, setRunning] = useState(false);
  const [runningNodeIds, setRunningNodeIds] = useState<string[]>([]);
  const [completedNodeIds, setCompletedNodeIds] = useState<string[]>([]);
  const [activeEdgeIds, setActiveEdgeIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const refreshAgents = useCallback(() => {
    if (mode === "checking") return;
    setAgentsLoading(true);
    listCustomAgents(mode)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [mode]);

  useEffect(refreshAgents, [refreshAgents, agentManagerKey]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      setWorkflow((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === dragging.id
            ? {
                ...node,
                x: Math.max(
                  18,
                  Math.min(
                    STAGE_WIDTH - node.width - 18,
                    (event.clientX - rect.left) / zoom - dragging.offsetX,
                  ),
                ),
                y: Math.max(
                  18,
                  Math.min(
                    STAGE_HEIGHT - NODE_HEIGHT - 18,
                    (event.clientY - rect.top) / zoom - dragging.offsetY,
                  ),
                ),
              }
            : node,
        ),
      }));
    };
    const stop = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, zoom]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2100);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedNode =
    workflow.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const visibleBuiltinNodes = useMemo(() => {
    const query = paletteQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return BUILTIN_NODES;
    return BUILTIN_NODES.filter(
      (node) =>
        node.title.toLocaleLowerCase("zh-CN").includes(query) ||
        node.description.toLocaleLowerCase("zh-CN").includes(query),
    );
  }, [paletteQuery]);

  const visibleAgents = useMemo(() => {
    const query = paletteQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return agents;
    return agents.filter(
      (agent) =>
        agent.name.toLocaleLowerCase("zh-CN").includes(query) ||
        agent.duty.toLocaleLowerCase("zh-CN").includes(query),
    );
  }, [agents, paletteQuery]);

  const updateNode = (patch: Partial<WorkflowNode>) => {
    if (!selectedNodeId) return;
    setWorkflow((current) => ({
      ...current,
      status: "draft",
      nodes: current.nodes.map((node) =>
        node.id === selectedNodeId ? { ...node, ...patch } : node,
      ),
    }));
  };

  const addNode = (
    input: Pick<WorkflowNode, "kind" | "title" | "description" | "tone"> &
      Partial<Pick<WorkflowNode, "agentKey" | "model">>,
  ) => {
    const id = makeNodeId(input.kind);
    const offset = workflow.nodes.length % 5;
    const node: WorkflowNode = {
      id,
      kind: input.kind,
      title: input.title,
      description: input.description,
      tone: input.tone,
      agentKey: input.agentKey,
      model: input.model,
      x: 420 + offset * 34,
      y: 116 + offset * 94,
      width: input.kind === "condition" ? 178 : 170,
    };
    setWorkflow((current) => ({
      ...current,
      status: "draft",
      nodes: [...current.nodes, node],
    }));
    setSelectedNodeId(id);
    setPaletteOpen(false);
    setNotice(`已添加「${input.title}」节点`);
  };

  const removeSelectedNode = () => {
    if (!selectedNode || selectedNode.kind === "start" || selectedNode.kind === "end") {
      return;
    }
    setWorkflow((current) => ({
      ...current,
      status: "draft",
      nodes: current.nodes.filter((node) => node.id !== selectedNode.id),
      edges: current.edges.filter(
        (edge) => edge.from !== selectedNode.id && edge.to !== selectedNode.id,
      ),
    }));
    setSelectedNodeId(null);
    setNotice("节点已移除");
  };

  const connectTo = (targetId: string) => {
    if (!linkingFromId || linkingFromId === targetId) return;
    const exists = workflow.edges.some(
      (edge) => edge.from === linkingFromId && edge.to === targetId,
    );
    if (!exists) {
      setWorkflow((current) => ({
        ...current,
        status: "draft",
        edges: [
          ...current.edges,
          {
            id: `edge-${linkingFromId}-${targetId}-${Date.now()}`,
            from: linkingFromId,
            to: targetId,
          },
        ],
      }));
      setNotice("连线已创建");
    }
    setLinkingFromId(null);
  };

  const startDragging = (
    event: ReactPointerEvent<HTMLDivElement>,
    node: WorkflowNode,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select")) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setSelectedNodeId(node.id);
    setDragging({
      id: node.id,
      offsetX: (event.clientX - rect.left) / zoom - node.x,
      offsetY: (event.clientY - rect.top) / zoom - node.y,
    });
  };

  const clearRunTimers = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  };

  const runWorkflow = () => {
    clearRunTimers();
    const existingNodeIds = new Set(workflow.nodes.map((node) => node.id));
    const existingEdgeIds = new Set(workflow.edges.map((edge) => edge.id));
    const stages = [
      {
        nodes: ["start"],
        edges: ["edge-start-outline", "edge-start-knowledge", "edge-start-example"],
      },
      {
        nodes: ["outline-agent", "knowledge-search", "example-agent"],
        edges: [
          "edge-outline-condition",
          "edge-knowledge-condition",
          "edge-example-condition",
        ],
      },
      {
        nodes: ["animation-condition"],
        edges: ["edge-condition-animation", "edge-condition-review"],
      },
      {
        nodes: ["animation-agent", "quality-review"],
        edges: ["edge-animation-review"],
      },
      { nodes: ["quality-review"], edges: ["edge-review-end"] },
      { nodes: ["end"], edges: [] },
    ].map((stage) => ({
      nodes: stage.nodes.filter((id) => existingNodeIds.has(id)),
      edges: stage.edges.filter((id) => existingEdgeIds.has(id)),
    }));

    if (stages.every((stage) => stage.nodes.length === 0)) {
      stages.splice(
        0,
        stages.length,
        ...workflow.nodes.map((node, index) => ({
          nodes: [node.id],
          edges: workflow.edges
            .filter((edge) => edge.from === node.id || (index === 0 && edge.to === node.id))
            .map((edge) => edge.id),
        })),
      );
    }

    setRunning(true);
    setCompletedNodeIds([]);
    setRunningNodeIds([]);
    setActiveEdgeIds([]);
    setNotice("工作流开始传输数据");

    const stageDuration = reduceMotion ? 430 : 940;
    const completed = new Set<string>();
    stages.forEach((stage, index) => {
      const timer = window.setTimeout(() => {
        if (index > 0) {
          for (const nodeId of stages[index - 1].nodes) completed.add(nodeId);
        }
        setCompletedNodeIds([...completed]);
        setRunningNodeIds(stage.nodes);
        setActiveEdgeIds(stage.edges);
      }, index * stageDuration);
      timersRef.current.push(timer);
    });

    const finishTimer = window.setTimeout(() => {
      setRunning(false);
      setRunningNodeIds([]);
      setActiveEdgeIds([]);
      setCompletedNodeIds(workflow.nodes.map((node) => node.id));
      setNotice("试运行完成，所有数据已成功送达");
    }, stages.length * stageDuration);
    timersRef.current.push(finishTimer);
  };

  const saveWorkflow = () => {
    const savedWorkflow: CustomWorkflow = {
      ...workflow,
      status: "published",
      updatedAt: new Date().toISOString(),
    };
    persistCustomWorkflow(savedWorkflow, window.localStorage);
    setWorkflow(savedWorkflow);
    onSaved?.(savedWorkflow);
    setNotice("工作流已发布并保存");
  };

  const closeAgentManager = () => {
    setAgentManagerOpen(false);
    setAgentManagerKey((value) => value + 1);
  };

  return (
    <div className={styles.studio}>
      <div className={styles.main}>
        <header className={styles.toolbar}>
          <button
            type="button"
            className={styles.backButton}
            onClick={onBack}
            aria-label="返回高级设置"
            title="返回高级设置"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className={styles.toolbarIdentity}>
            <div className={styles.breadcrumbs}>
              <span>高级设置</span>
              <ChevronRight className="size-3" />
              <span>智能体与工作流</span>
            </div>
            <input
              className={styles.titleInput}
              value={workflow.name}
              aria-label="工作流名称"
              onChange={(event) =>
                setWorkflow((current) => ({
                  ...current,
                  name: event.target.value,
                  status: "draft",
                }))
              }
            />
          </div>
          <span className={styles.statusPill} data-running={running}>
            {running ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : workflow.status === "published" ? (
              <Check className="size-3" />
            ) : (
              <CircleDot className="size-3" />
            )}
            {running ? "数据传输中" : workflow.status === "published" ? "已发布" : "草稿"}
          </span>
          <button
            type="button"
            className={styles.toolbarAction}
            onClick={runWorkflow}
            disabled={running}
          >
            <Play className="size-3.5" fill="currentColor" />
            {running ? "运行中" : "试运行"}
          </button>
          <button type="button" className={styles.publishButton} onClick={saveWorkflow}>
            <Save className="size-3.5" />
            发布
          </button>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.tools} aria-label="工作流工具">
            <button
              type="button"
              className={styles.toolButton}
              data-active={paletteOpen}
              onClick={() => setPaletteOpen((value) => !value)}
              title="添加节点"
              aria-label="添加节点"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              data-active={!paletteOpen}
              onClick={() => setPaletteOpen(false)}
              title="选择和拖动节点"
              aria-label="选择和拖动节点"
            >
              <MousePointer2 className="size-4" />
            </button>
            <div className={styles.toolDivider} />
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => setAgentManagerOpen(true)}
              title="管理智能体"
              aria-label="管理智能体"
            >
              <Bot className="size-4" />
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => setNotice("已整理画布视图")}
              title="整理画布"
              aria-label="整理画布"
            >
              <Maximize2 className="size-4" />
            </button>
          </aside>

          <section className={styles.canvasShell} aria-label="工作流画布">
            <div className={styles.canvasScroll}>
              <div
                ref={stageRef}
                className={styles.canvasStage}
                style={{ transform: `scale(${zoom})` }}
                onClick={() => {
                  setSelectedNodeId(null);
                  setLinkingFromId(null);
                }}
              >
                <svg
                  className={styles.edgeLayer}
                  viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
                  aria-label="节点连接线"
                >
                  <defs>
                    <marker
                      id="workflow-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#9b9286" />
                    </marker>
                  </defs>
                  {workflow.edges.map((edge) => {
                    const path = edgePath(edge, workflow.nodes);
                    const active = activeEdgeIds.includes(edge.id);
                    const label = edgeLabelPosition(edge, workflow.nodes);
                    return (
                      <g key={edge.id}>
                        <path
                          d={path}
                          className={styles.edgeBase}
                          markerEnd="url(#workflow-arrow)"
                        />
                        {active && (
                          <>
                            <path d={path} className={styles.edgeActiveGlow} />
                            <path d={path} className={styles.edgeActive} />
                            {!reduceMotion && (
                              <circle r="4.2" className={styles.edgePulse}>
                                <animateMotion
                                  dur="0.95s"
                                  repeatCount="indefinite"
                                  path={path}
                                />
                              </circle>
                            )}
                          </>
                        )}
                        {edge.label && (
                          <text
                            x={label.x}
                            y={label.y}
                            textAnchor="middle"
                            className={styles.edgeLabel}
                          >
                            {edge.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {workflow.nodes.map((node) => {
                  const status = runningNodeIds.includes(node.id)
                    ? "running"
                    : completedNodeIds.includes(node.id)
                      ? "completed"
                      : "idle";
                  return (
                    <div
                      key={node.id}
                      className={styles.node}
                      data-selected={node.id === selectedNodeId}
                      data-status={status}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: node.width,
                      }}
                      onPointerDown={(event) => startDragging(event, node)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedNodeId(node.id);
                      }}
                    >
                      {node.kind !== "start" && (
                        <button
                          type="button"
                          className={cn(styles.port, styles.portIn)}
                          data-linking={Boolean(linkingFromId)}
                          onClick={(event) => {
                            event.stopPropagation();
                            connectTo(node.id);
                          }}
                          title={
                            linkingFromId
                              ? `连接到「${node.title}」`
                              : "先点击另一个节点的输出端口"
                          }
                          aria-label={`连接到${node.title}`}
                        />
                      )}
                      {node.kind !== "end" && (
                        <button
                          type="button"
                          className={cn(styles.port, styles.portOut)}
                          data-linking={linkingFromId === node.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setLinkingFromId((current) =>
                              current === node.id ? null : node.id,
                            );
                            setSelectedNodeId(node.id);
                          }}
                          title="从这里创建连线"
                          aria-label={`从${node.title}创建连线`}
                        />
                      )}
                      <div className={styles.nodeHeader}>
                        <span className={styles.nodeIcon} data-tone={node.tone}>
                          {nodeIcon(node.kind)}
                        </span>
                        <strong className={styles.nodeTitle}>{node.title}</strong>
                        {status === "running" ? (
                          <LoaderCircle className="size-3.5 animate-spin text-[#377df1]" />
                        ) : status === "completed" ? (
                          <span className={styles.nodeStatus}>
                            <Check className="size-3.5" />
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.nodeBody}>{node.description}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {paletteOpen && (
              <aside className={styles.palette} aria-label="添加节点面板">
                <header className={styles.paletteHeader}>
                  <Boxes className="size-4 text-primary" />
                  <strong>添加节点</strong>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => setPaletteOpen(false)}
                    aria-label="关闭节点面板"
                  >
                    <X className="size-3.5" />
                  </button>
                </header>
                <label className={styles.paletteSearch}>
                  <Search className="size-3.5" />
                  <input
                    value={paletteQuery}
                    placeholder="搜索节点或智能体"
                    onChange={(event) => setPaletteQuery(event.target.value)}
                  />
                </label>
                <div className={styles.paletteBody}>
                  <section className={styles.paletteSection}>
                    <div className={styles.paletteLabel}>基础节点</div>
                    {visibleBuiltinNodes.map((item) => (
                      <button
                        key={`${item.kind}-${item.title}`}
                        type="button"
                        className={styles.paletteItem}
                        onClick={() =>
                          addNode({
                            ...item,
                            model: item.kind === "agent" ? "学枢大模型" : undefined,
                          })
                        }
                      >
                        <span className={styles.paletteItemIcon}>
                          {nodeIcon(item.kind, "size-4")}
                        </span>
                        <span className={styles.paletteItemText}>
                          <strong>{item.title}</strong>
                          <span>{item.description}</span>
                        </span>
                        <Plus className="size-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </section>

                  <section className={styles.paletteSection}>
                    <div className={styles.paletteLabel}>我的智能体</div>
                    {agentsLoading ? (
                      <div className={styles.paletteItem}>
                        <span className={styles.paletteItemIcon}>
                          <LoaderCircle className="size-4 animate-spin" />
                        </span>
                        <span className={styles.paletteItemText}>
                          <strong>正在同步智能体</strong>
                          <span>连接学习服务并获取配置</span>
                        </span>
                      </div>
                    ) : visibleAgents.length > 0 ? (
                      visibleAgents.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          className={styles.paletteItem}
                          onClick={() =>
                            addNode({
                              kind: "agent",
                              title: agent.name,
                              description: agent.duty || "自建智能体",
                              tone: "violet",
                              agentKey: agent.agent_key,
                              model: "自建智能体",
                            })
                          }
                        >
                          <span className={styles.paletteItemIcon}>
                            <span aria-hidden>{customAgentMonogram(agent.name)}</span>
                          </span>
                          <span className={styles.paletteItemText}>
                            <strong>{agent.name}</strong>
                            <span>{agent.duty || "自建智能体"}</span>
                          </span>
                          <Plus className="size-3.5 text-muted-foreground" />
                        </button>
                      ))
                    ) : (
                      <div className={styles.paletteItem}>
                        <span className={styles.paletteItemIcon}>
                          <Bot className="size-4" />
                        </span>
                        <span className={styles.paletteItemText}>
                          <strong>还没有自建智能体</strong>
                          <span>
                            {mode === "live" ? "创建后即可拖入工作流" : "连接服务后即可创建"}
                          </span>
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.createAgent}
                      onClick={() => setAgentManagerOpen(true)}
                    >
                      <Sparkles className="size-3.5" />
                      创建新智能体
                    </button>
                  </section>
                </div>
              </aside>
            )}

            {notice && (
              <div className={styles.toast} role="status">
                {running ? (
                  <LoaderCircle className="size-3.5 animate-spin text-[#377df1]" />
                ) : (
                  <Check className="size-3.5 text-success" />
                )}
                {notice}
              </div>
            )}

            <div className={styles.minimap} aria-hidden />
            <div className={styles.canvasControls} aria-label="画布缩放">
              <button
                type="button"
                className={styles.zoomButton}
                onClick={() => setZoom((value) => Math.max(0.75, value - 0.1))}
                aria-label="缩小画布"
              >
                <Minus className="size-3.5" />
              </button>
              <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className={styles.zoomButton}
                onClick={() => setZoom((value) => Math.min(1.2, value + 0.1))}
                aria-label="放大画布"
              >
                <ZoomIn className="size-3.5" />
              </button>
              <button
                type="button"
                className={styles.zoomButton}
                onClick={() => setZoom(1)}
                aria-label="恢复默认缩放"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          </section>

          <aside className={styles.inspector} aria-label="节点配置">
            {selectedNode ? (
              <>
                <header className={styles.inspectorHeader}>
                  <span className={styles.nodeIcon} data-tone={selectedNode.tone}>
                    {nodeIcon(selectedNode.kind)}
                  </span>
                  <strong>{selectedNode.title}</strong>
                  <Settings2 className="size-4 text-muted-foreground" />
                </header>
                <div className={styles.inspectorBody}>
                  <label className={styles.field}>
                    <span>节点名称</span>
                    <input
                      value={selectedNode.title}
                      onChange={(event) => updateNode({ title: event.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>节点说明</span>
                    <textarea
                      value={selectedNode.description}
                      onChange={(event) =>
                        updateNode({ description: event.target.value })
                      }
                    />
                  </label>
                  {selectedNode.kind === "agent" && (
                    <>
                      <label className={styles.field}>
                        <span>执行模型</span>
                        <select
                          value={selectedNode.model ?? "学枢大模型"}
                          onChange={(event) => updateNode({ model: event.target.value })}
                        >
                          <option>学枢大模型</option>
                          <option>学枢视觉模型</option>
                          <option>自建智能体</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>输出格式</span>
                        <select defaultValue="structured">
                          <option value="structured">结构化内容</option>
                          <option value="markdown">Markdown</option>
                          <option value="json">JSON 数据</option>
                        </select>
                      </label>
                    </>
                  )}
                  <div className={styles.inspectorHint}>
                    <Info className="mt-0.5 size-3.5 shrink-0 text-[#377df1]" />
                    <span>
                      点击节点右侧端口，再点击目标节点左侧端口即可创建连接。试运行时，蓝色脉冲会沿连线展示数据传输方向。
                    </span>
                  </div>
                  <div className={styles.inspectorActions}>
                    {selectedNode.kind === "agent" && (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => setAgentManagerOpen(true)}
                      >
                        <Bot className="size-3.5" />
                        管理智能体
                      </button>
                    )}
                    {selectedNode.kind !== "start" && selectedNode.kind !== "end" && (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={removeSelectedNode}
                      >
                        <Trash2 className="size-3.5" />
                        删除此节点
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.emptyInspector}>
                <div>
                  <Braces className="mx-auto size-7 text-muted-foreground" />
                  <strong>选择一个节点</strong>
                  <p>点击画布中的节点以查看配置，或从左侧添加新的节点。</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {agentManagerOpen && (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={styles.agentModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-agent-manager-title"
          >
            <header className={styles.agentModalHeader}>
              <Bot className="size-4 text-primary" />
              <strong id="workflow-agent-manager-title">我的智能体</strong>
              <button
                type="button"
                className={styles.iconButton}
                onClick={closeAgentManager}
                aria-label="关闭智能体管理"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className={styles.agentModalBody}>
              <CustomAgentWorkspace key={agentManagerKey} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
