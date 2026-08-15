import type { ResourceItem } from "./types";

export function finalizeGeneratedResources(
  resources: ResourceItem[],
  failed: boolean
): ResourceItem[] {
  return resources.map((resource) =>
    resource.status === "pending"
      ? {
          ...resource,
          status: "failed",
          subtitle: failed
            ? "生成失败，未保存任何候选内容"
            : "未收到审核批准版本，资料没有保存",
        }
      : resource
  );
}

/** 失败或驳回候选只保留在内部诊断中，不作为用户可选择的资料卡出现。 */
export function visibleGenerationResources(resources: ResourceItem[]): ResourceItem[] {
  return resources.filter(
    (resource) => resource.status !== "failed" && resource.status !== "rejected",
  );
}
