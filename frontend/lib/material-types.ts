/** 生成资料表单可选的资料类型 —— 复用既有 7 个生成器与查看器。 */

import type { ResourceType } from "./types";

export interface MaterialTypeOption {
  id: ResourceType;
  /** 面向用户的友好名 */
  label: string;
  /** 一句话说明 */
  desc: string;
}

/** 用户在 /create 表单勾选的资料类型（id 直通后端 forced_modules）。 */
export const MATERIAL_TYPES: MaterialTypeOption[] = [
  { id: "explainer", label: "讲义文档", desc: "概念讲解 + 生活类比 + 要点总结" },
  { id: "mindmap", label: "思维导图", desc: "知识结构树，可折叠跳转" },
  { id: "quiz", label: "练习题库", desc: "按知识点命题，自动存入试题库" },
  { id: "solution", label: "题目解析", desc: "题目、参考答案与逐题解析一体保存" },
  { id: "reading", label: "扩展阅读", desc: "课本外延伸知识 + 联网来源 + 思考题" },
  { id: "code", label: "代码示例", desc: "可运行示例 + 逐行解释 + 变体" },
  { id: "video", label: "讲解视频", desc: "章节动画内容 + 旁白讲解" },
  { id: "courseware", label: "课件 PPT", desc: "结构化幻灯片大纲，可导出 PPTX" },
  { id: "interactive", label: "交互演示", desc: "可上手操作的三维模型 / 公式推演 / 算法动画" },
];

export const FORM_MATERIAL_TYPES: MaterialTypeOption[] = MATERIAL_TYPES.filter(
  (type) => type.id !== "mindmap"
);

export const MATERIAL_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  MATERIAL_TYPES.map((t) => [t.id, t.label])
);

/**
 * 资源生成表单不预选类型：用户点击的第一种资料就是实际发送给后端的类型。
 * 这也避免“点击一个已默认选中的按钮”反而把它取消、只生成另一种默认资料。
 */
export function createInitialMaterialTypeSelection(): Set<ResourceType> {
  return new Set<ResourceType>();
}

export function toggleMaterialTypeSelection(
  selected: ReadonlySet<ResourceType>,
  type: ResourceType,
): Set<ResourceType> {
  const next = new Set(selected);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  return next;
}

/** 保持产品定义顺序，生成稳定且可核验的请求 material_types。 */
export function materialTypesForRequest(
  selected: ReadonlySet<ResourceType>,
): ResourceType[] {
  return MATERIAL_TYPES.filter((type) => selected.has(type.id)).map((type) => type.id);
}

/** 掌握度档位（摸底用，前后端一致）。 */
export const MASTERY_LEVELS = ["基础", "进阶", "完全掌握"] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];
