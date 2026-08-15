import type { AgentId, AgentMeta, AgentRuntime } from "./types";

/**
 * 与后端 app/agents/* 一一对应的智能体花名册。
 * 配色按职能收敛为四类：青黛=调度管理，赭石=内容生成，朱=质检批改，墨绿=辅导。
 */
const INK_BLUE = "#5f7e9e"; // 青黛
const OCHRE = "#9a7d5c"; // 赭石
const VERMILION = "#c25d49"; // 朱
const INK_GREEN = "#5f8472"; // 墨绿

export const AGENTS: AgentMeta[] = [
  { id: "profiler", name: "学情画像师", duty: "对话中抽取 6 维学习特征", color: INK_BLUE },
  { id: "outliner", name: "大纲规划师", duty: "确认学习安排 · 拆分章节大纲", color: INK_BLUE },
  { id: "supervisor", name: "总控调度官", duty: "任务分诊 · 编排生成管线", color: INK_BLUE },
  { id: "explainer", name: "概念讲解官", duty: "图解讲义 · 生活类比", color: OCHRE },
  { id: "mindmap", name: "导图架构师", duty: "知识结构可视化", color: OCHRE },
  { id: "quiz", name: "题库命题官", duty: "个性化练习与组卷", color: OCHRE },
  { id: "solution", name: "题目解析官", duty: "题目、答案与逐题讲解", color: OCHRE },
  { id: "reading", name: "拓展阅读官", duty: "延伸材料精选", color: OCHRE },
  { id: "code", name: "代码教练", duty: "可运行实操案例", color: OCHRE },
  { id: "video", name: "动画导演", duty: "Manim 教学短片", color: OCHRE },
  { id: "courseware", name: "课件设计师", duty: "结构化 PPT 课件", color: OCHRE },
  { id: "interactive", name: "交互演示官", duty: "可操作的三维/公式/算法演示", color: OCHRE },
  { id: "reviewer", name: "质检审核官", duty: "防幻觉 · 知识库比对", color: VERMILION },
  { id: "integrator", name: "资料整合官", duty: "按章节统一归档生成结果", color: VERMILION },
  { id: "planner", name: "路径规划师", duty: "动态学习路径编排", color: INK_BLUE },
  { id: "tutor", name: "答疑辅导师", duty: "即时多模态答疑", color: INK_GREEN },
];

export const AGENT_MAP: Record<AgentId, AgentMeta> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a])
) as Record<AgentId, AgentMeta>;

/** 本轮演示中参与并行生成的工作智能体（supervisor 分诊结果）。 */
export const WORKER_IDS: AgentId[] = [
  "explainer",
  "mindmap",
  "quiz",
  "reading",
  "code",
  "video",
];

export function initialAgentState(): Record<AgentId, AgentRuntime> {
  return Object.fromEntries(
    AGENTS.map((a) => [a.id, { status: "idle", progress: 0, detail: "" }])
  ) as Record<AgentId, AgentRuntime>;
}
