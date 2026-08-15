import type { PathStep, ProfileDim, ResourceItem, ResourceType } from "./types";
import type { PracticeAttempt } from "./practice-feedback";

const RESOURCE_TYPE_NAMES: Record<ResourceType, string> = {
  explainer: "讲义 概念讲解",
  mindmap: "思维导图 导图",
  quiz: "练习 题库 测验",
  solution: "题目解析 答案 详解",
  reading: "拓展阅读 阅读",
  code: "代码 案例",
  video: "动画 视频 短片",
  courseware: "课件 PPT",
  interactive: "交互演示 三维 动画 公式 可视化",
};

export const RESOURCE_TYPE_FILTERS: { id: "all" | ResourceType; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "explainer", label: "讲义" },
  { id: "mindmap", label: "导图" },
  { id: "quiz", label: "题库" },
  { id: "solution", label: "题目解析" },
  { id: "reading", label: "阅读" },
  { id: "code", label: "代码" },
  { id: "video", label: "视频" },
  { id: "courseware", label: "课件" },
  { id: "interactive", label: "交互演示" },
];

export type ResourceTypeFilter = (typeof RESOURCE_TYPE_FILTERS)[number]["id"];
/** Resource centers only publish reviewed deliverables. */
export type ResourceStatusFilter = "all" | "ready";

export interface ResourceCenterDisplayInput {
  totalResourceCount: number;
  standaloneResourceCount: number;
  hasPathCollection: boolean;
  filtersActive: boolean;
}

export interface ResourceCenterDisplayState {
  hasAnyResources: boolean;
  hasStandaloneResources: boolean;
  showStandaloneContent: boolean;
}

export const RESOURCE_STATUS_FILTERS: { id: ResourceStatusFilter; label: string }[] = [
  { id: "all", label: "全部状态" },
  { id: "ready", label: "已过审" },
];

/** Safely ignore old query/local-state filters that exposed internal states. */
export function normalizeResourceStatusFilter(value: string | undefined): ResourceStatusFilter {
  return RESOURCE_STATUS_FILTERS.some((item) => item.id === value)
    ? (value as ResourceStatusFilter)
    : "all";
}

export function getResourceCenterDisplayState({
  totalResourceCount,
  standaloneResourceCount,
  hasPathCollection,
  filtersActive,
}: ResourceCenterDisplayInput): ResourceCenterDisplayState {
  const hasAnyResources = totalResourceCount > 0 || hasPathCollection;
  const hasStandaloneResources = standaloneResourceCount > 0;
  return {
    hasAnyResources,
    hasStandaloneResources,
    showStandaloneContent:
      !hasAnyResources || hasStandaloneResources || filtersActive,
  };
}

export interface SessionPresenceInput {
  hasRunMain: boolean;
  tags: string[];
  resources: ResourceItem[];
  path: PathStep[];
}

export interface SessionInsightInput {
  profile: ProfileDim[];
  tags: string[];
  resources: ResourceItem[];
  path: PathStep[];
  practiceAttempts?: PracticeAttempt[];
}

export interface HomeModule {
  id: "resources" | "practice" | "wrongbook" | "path" | "profile" | "kb";
  title: string;
  desc: string;
  href: string;
  value: string;
  tone: "primary" | "success" | "warning" | "danger" | "muted";
}

export function hasLearningSession(input: SessionPresenceInput): boolean {
  return (
    input.hasRunMain ||
    input.tags.length > 0 ||
    input.resources.length > 0 ||
    input.path.length > 0
  );
}

export function findQuizResource(resources: ResourceItem[]): ResourceItem | undefined {
  return resources.find(
    (resource) =>
      resource.type === "quiz" &&
      resource.status === "ready" &&
      Array.isArray(resource.data?.questions) &&
      resource.data.questions.length > 0
  );
}

export function visibleManagedResources(resources: ResourceItem[]): ResourceItem[] {
  return resources.filter((resource) => resource.status === "ready");
}

export function filterResources(resources: ResourceItem[], query: string): ResourceItem[] {
  const managed = visibleManagedResources(resources);
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return managed;

  return managed.filter((resource) => {
    const searchable = [
      resource.title,
      resource.subtitle,
      resource.meta.join(" "),
      RESOURCE_TYPE_NAMES[resource.type],
    ]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return searchable.includes(normalized);
  });
}

export function getResourceTypeCounts(resources: ResourceItem[]): Record<ResourceTypeFilter, number> {
  const managed = visibleManagedResources(resources);
  const counts = Object.fromEntries(RESOURCE_TYPE_FILTERS.map((item) => [item.id, 0])) as Record<
    ResourceTypeFilter,
    number
  >;
  counts.all = managed.length;
  for (const resource of managed) {
    counts[resource.type] += 1;
  }
  return counts;
}

export function getResourceStatusCounts(
  resources: ResourceItem[]
): Record<ResourceStatusFilter, number> {
  const managed = visibleManagedResources(resources);
  const counts: Record<ResourceStatusFilter, number> = {
    all: managed.length,
    ready: 0,
  };
  counts.ready = managed.length;
  return counts;
}

export function applyResourceFilters(
  resources: ResourceItem[],
  filters: {
    type?: ResourceTypeFilter;
    status?: ResourceStatusFilter;
    query?: string;
  }
): ResourceItem[] {
  const type = filters.type ?? "all";
  const status = normalizeResourceStatusFilter(filters.status);
  return filterResources(resources, filters.query ?? "").filter((resource) => {
    if (type !== "all" && resource.type !== type) return false;
    if (status !== "all" && resource.status !== status) return false;
    return true;
  });
}

export function getPathProgress(path: PathStep[]) {
  const currentIndex = path.findIndex((step) => step.state === "current");
  const currentPosition = currentIndex >= 0 ? currentIndex + 1 : 0;
  return {
    currentIndex,
    currentPosition,
    total: path.length,
    ratio: path.length > 0 ? currentPosition / path.length : 0,
  };
}

export function getDashboardInsights(input: SessionInsightInput) {
  const managedResources = visibleManagedResources(input.resources);
  const generated = managedResources.filter((resource) => resource.status !== "pending");
  const ready = generated.filter((resource) => resource.status === "ready");
  const quiz = findQuizResource(managedResources);
  const profileTotal = input.profile.reduce((sum, dimension) => sum + dimension.value, 0);

  return {
    profileAverage: input.profile.length ? Math.round(profileTotal / input.profile.length) : 0,
    generatedResources: generated.length,
    readyResources: ready.length,
    citationCount: generated.reduce((sum, resource) => sum + resource.sources, 0),
    pathStages: input.path.length,
    currentStage: input.path.find((step) => step.state === "current")?.title ?? "尚未开始",
    weakTags: input.tags.filter((tag) => tag.includes("薄弱")),
    quizQuestions: quiz?.data?.questions?.length ?? 0,
  };
}

export function getHomeModules(input: SessionInsightInput): HomeModule[] {
  const insights = getDashboardInsights(input);
  const latestAttempt = input.practiceAttempts?.[0];
  const wrongCount = latestAttempt?.wrongQuestions.length ?? 0;

  return [
    {
      id: "resources",
      title: "生成资料",
      desc: "选类型 + 填知识点，一键生成讲义/导图/题库/视频，存入资源中心。",
      href: "/create",
      value: `${insights.readyResources}/${insights.generatedResources}`,
      tone: insights.readyResources > 0 ? "success" : "muted",
    },
    {
      id: "practice",
      title: "智能练习",
      desc: "题库命题官按画像组卷，提交后即时评分。",
      href: "/practice",
      value: latestAttempt ? `最近 ${latestAttempt.score} 分` : `${insights.quizQuestions} 题`,
      tone: latestAttempt ? (latestAttempt.score >= 60 ? "success" : "danger") : "primary",
    },
    {
      id: "wrongbook",
      title: "错题本",
      desc: "错题按提交结果自动归档，并联动路径复盘。",
      href: "/practice",
      value: `${wrongCount} 道`,
      tone: wrongCount > 0 ? "warning" : "success",
    },
    {
      id: "path",
      title: "总学习路径",
      desc: "统筹已启用科目的每日学习安排。",
      href: "/path",
      value: `${insights.pathStages} 阶段`,
      tone: insights.pathStages > 0 ? "primary" : "muted",
    },
    {
      id: "profile",
      title: "学习画像",
      desc: "六维画像随对话和测验持续更新。",
      href: "/profile",
      value: `${input.tags.length} 标签`,
      tone: input.tags.length > 0 ? "primary" : "muted",
    },
    {
      id: "kb",
      title: "课程知识库",
      desc: "当前课程资料检索、荐书和入库入口。",
      href: "/kb",
      value: "数据结构",
      tone: "muted",
    },
  ];
}
