import type { ProfileDim } from "./types";

export const STARTER_PROMPTS = [
  {
    label: "考前冲刺",
    text: "我是大二软件工程专业的学生，下周就要考《数据结构》了，动态规划那一章完全没思路，递归也学得一般。我平时更喜欢看动画、动手敲代码来学习。",
  },
  {
    label: "多模态讲解",
    text: "动态规划的状态转移方程总是列不出来，能不能用动画和图解帮我建立直觉？",
  },
  {
    label: "个性化题库",
    text: "帮我出一套动态规划的专属练习题，最好结合我的薄弱点，带代码补全题。",
  },
];

export const PROFILE_BASE: ProfileDim[] = [
  { key: "knowledge_level", label: "知识基础", value: 50, delta: 0 },
  { key: "cognitive_style", label: "认知匹配", value: 50, delta: 0 },
  { key: "goals", label: "目标清晰", value: 50, delta: 0 },
  { key: "error_profile", label: "易错管理", value: 50, delta: 0 },
  { key: "pace", label: "学习节奏", value: 50, delta: 0 },
  { key: "interests", label: "兴趣投入", value: 50, delta: 0 },
];

export const STUDIO_STARTER_PROMPT = STARTER_PROMPTS[0].text;
