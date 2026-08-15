import {
  buildDailyTaskResources,
  type DailyTaskItem,
  type DailyTaskResource,
} from "./daily-task-plan.ts";
import type { PathStep, ResourceItem, ResourceStatus } from "./types";

const RESOURCE_STATUS_PRIORITY: Record<ResourceStatus, number> = {
  ready: 0,
  review: 1,
  pending: 2,
  failed: 3,
  rejected: 4,
};

function isUsableResource(resource: ResourceItem): boolean {
  if (resource.status !== "ready") return false;
  // 持久资料列表会先返回轻量元数据，打开时再取详情；这种已过审记录仍可用。
  if (!resource.data) return true;
  const data = resource.data;
  switch (resource.type) {
    case "quiz":
      return Array.isArray(data.questions) && data.questions.some((question) => Boolean(question?.stem));
    case "explainer":
      return Boolean(data.overview || data.explanation || data.key_points?.length);
    case "mindmap":
      return Array.isArray(data.nodes) && data.nodes.length > 0;
    case "reading":
      return Boolean(data.content || data.key_terms?.length || data.discussion_questions?.length);
    case "code":
      return Boolean(data.code);
    case "video":
      return Boolean(data.narration?.length || data.params || data.video);
    case "courseware":
      return Array.isArray(data.slides) && data.slides.length > 0;
    case "interactive":
      // html 是沙箱唯一的必需字段：没有它就没有可渲染的演示。
      return Boolean(data.html);
    default:
      return false;
  }
}

function resourceRank(resource: ResourceItem): number {
  return RESOURCE_STATUS_PRIORITY[resource.status] * 100 - resource.version;
}

export function findBestAvailableResource(
  resources: ResourceItem[]
): ResourceItem | undefined {
  return resources
    .filter(isUsableResource)
    .sort((a, b) => resourceRank(a) - resourceRank(b))[0];
}

export function findResourceForTarget(
  target: DailyTaskResource | undefined,
  resources: ResourceItem[]
): ResourceItem | undefined {
  if (!target) return undefined;

  if (target.id) {
    return resources.find(
      (resource) => resource.id === target.id && isUsableResource(resource)
    );
  }

  return resources
    .filter((resource) => resource.type === target.type && isUsableResource(resource))
    .sort((a, b) => resourceRank(a) - resourceRank(b))[0];
}

export function findResourceForTask(
  task: DailyTaskItem,
  resources: ResourceItem[]
): ResourceItem | undefined {
  const primary = findResourceForTarget(task.resourceTarget, resources);
  if (primary) return primary;

  for (const target of task.resourceTargets) {
    const resource = findResourceForTarget(target, resources);
    if (resource) return resource;
  }

  return undefined;
}

export function resolveResourceForTaskTarget(
  target: DailyTaskResource,
  task: DailyTaskItem,
  resources: ResourceItem[]
): ResourceItem | undefined {
  if (target.id) return findResourceForTarget(target, resources);
  return findResourceForTarget(target, resources);
}

export function collectPathResourceTypes(
  path: PathStep[],
  resources: ResourceItem[]
): ResourceItem["type"][] {
  const linkedPlanIds = new Set<string>();
  const types: ResourceItem["type"][] = [];
  const seenTypes = new Set<ResourceItem["type"]>();
  const append = (type: ResourceItem["type"]) => {
    if (seenTypes.has(type)) return;
    seenTypes.add(type);
    types.push(type);
  };

  for (const step of path) {
    for (const task of step.steps ?? []) {
      task.resource_types.forEach(append);
      for (const target of task.resources ?? []) {
        append(target.type);
        const separator = target.id.indexOf(":");
        if (separator > 0) linkedPlanIds.add(target.id.slice(0, separator));
      }
    }
  }

  if (linkedPlanIds.size === 0) return types;

  for (const resource of resources) {
    const dataPlanId = resource.data?.plan_id;
    const belongsToPath =
      (typeof dataPlanId === "string" && linkedPlanIds.has(dataPlanId)) ||
      Array.from(linkedPlanIds).some((planId) => resource.id.startsWith(`${planId}:`));
    if (belongsToPath) append(resource.type);
  }

  return types;
}

export interface PathResourceCollectionItem {
  target: DailyTaskResource;
  item: ResourceItem;
  stageIndex: number;
  stageDay: string;
  stageTitle: string;
}

export interface PathResourceCollectionStage {
  key: string;
  stageIndex: number;
  day: string;
  title: string;
  desc: string;
  total: number;
  readyCount: number;
  resources: PathResourceCollectionItem[];
}

export interface PathResourceCollection {
  key: "learning-path";
  title: string;
  desc: string;
  total: number;
  readyCount: number;
  stages: PathResourceCollectionStage[];
  resources: PathResourceCollectionItem[];
}

export function buildPathResourceCollection(
  path: PathStep[],
  completedKeys: string[],
  resources: ResourceItem[]
): PathResourceCollection | undefined {
  const seenResourceIds = new Set<string>();
  const stages: PathResourceCollectionStage[] = path
    .map((step, stageIndex) => {
      const linkedResources = buildDailyTaskResources(step, stageIndex, completedKeys)
        .map((target) => {
          if (!target.id) return null;
          const item = findResourceForTarget(target, resources);
          if (!item || seenResourceIds.has(item.id)) return null;
          seenResourceIds.add(item.id);
          return {
            target,
            item,
            stageIndex,
            stageDay: step.day,
            stageTitle: step.title,
          };
        })
        .filter((entry): entry is PathResourceCollectionItem => entry !== null);

      return {
        key: `${step.day}-${stageIndex}`,
        stageIndex,
        day: step.day,
        title: step.title,
        desc: step.desc,
        total: linkedResources.length,
        readyCount: linkedResources.filter((entry) => entry.item.status === "ready").length,
        resources: linkedResources,
      };
    })
    .filter((stage) => stage.total > 0);
  const flattened = stages.flatMap((stage) => stage.resources);

  if (flattened.length === 0) return undefined;

  return {
    key: "learning-path",
    title: "学习路径资料合集",
    desc: "通过学习路径生成的所有资料统一收纳在这里。",
    total: flattened.length,
    readyCount: flattened.filter((entry) => entry.item.status === "ready").length,
    stages,
    resources: flattened,
  };
}

export function buildPathResourceCollections(
  path: PathStep[],
  completedKeys: string[],
  resources: ResourceItem[]
): PathResourceCollectionStage[] {
  return buildPathResourceCollection(path, completedKeys, resources)?.stages ?? [];
}
