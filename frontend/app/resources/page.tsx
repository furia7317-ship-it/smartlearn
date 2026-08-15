"use client";

import { ShellLink as Link } from "@/components/shell-link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GitBranch, Library } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ResourceCard } from "@/components/resource-card";
import { ResourcePathAttachmentDialog } from "@/components/resource-path-attachment-dialog";
import { ResourceViewer } from "@/components/resource-viewer";
import { getMaterialData, listMaterials, type StoredMaterial } from "@/lib/library";
import {
  applyResourceFilters,
  getResourceStatusCounts,
  getResourceTypeCounts,
  RESOURCE_STATUS_FILTERS,
  RESOURCE_TYPE_FILTERS,
  type ResourceStatusFilter,
  type ResourceTypeFilter,
} from "@/lib/session-insights";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

function isResourceTypeFilter(value: string): value is ResourceTypeFilter {
  return RESOURCE_TYPE_FILTERS.some((item) => item.id === value);
}

function isResourceStatusFilter(value: string): value is ResourceStatusFilter {
  return RESOURCE_STATUS_FILTERS.some((item) => item.id === value);
}

function ResourcesInner() {
  const sp = useSearchParams();
  const q = (sp.get("q") ?? "").trim();
  const rawType = sp.get("type") ?? "all";
  const rawStatus = sp.get("status") ?? "all";
  const selectedType = isResourceTypeFilter(rawType) ? rawType : "all";
  const selectedStatus = isResourceStatusFilter(rawStatus) ? rawStatus : "all";
  const session = useOrchestratorContext();
  const { hydrated, mode, resources } = session;
  const [openItem, setOpenItem] = useState<ResourceItem | null>(null);
  const [attachItem, setAttachItem] = useState<ResourceItem | null>(null);
  const [library, setLibrary] = useState<StoredMaterial[]>([]);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");

  // 资源中心 = 持久化资料库（跨会话/重置常驻）+ 当前会话资源（去重）
  useEffect(() => {
    if (mode === "checking") return;
    setLoadError("");
    listMaterials(mode)
      .then(setLibrary)
      .catch((error) =>
        setLoadError(
          error instanceof Error ? error.message : "资源列表加载失败"
        )
      );
  }, [mode]);

  const combined = useMemo(() => {
    const seen = new Set<string>();
    const out: ResourceItem[] = [];
    for (const r of [...library, ...resources]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }, [library, resources]);

  // live 列表项不含 data，点开时按需拉取完整内容
  const openResource = async (item: ResourceItem) => {
    if (item.status !== "ready") return;
    if (item.data || mode !== "live") {
      setOpenItem(item);
      return;
    }
    setOpenItem(item);
    const data = await getMaterialData(mode, item.id);
    if (data) setOpenItem((cur) => (cur && cur.id === item.id ? { ...cur, data } : cur));
  };

  const typeCounts = getResourceTypeCounts(combined);
  const statusCounts = getResourceStatusCounts(combined);
  const visibleResources = applyResourceFilters(combined, {
    query: q,
    type: selectedType,
    status: selectedStatus,
  });
  const hasManagedResources = typeCounts.all > 0;
  const filtersActive = Boolean(q) || selectedType !== "all" || selectedStatus !== "all";

  const filterHref = ({
    type = selectedType,
    status = selectedStatus,
  }: {
    type?: ResourceTypeFilter;
    status?: ResourceStatusFilter;
  }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type !== "all") params.set("type", type);
    if (status !== "all") params.set("status", status);
    const query = params.toString();
    return query ? `/resources?${query}` : "/resources";
  };

  const activeFilterText = [
    q ? `关键词「${q}」` : "",
    selectedType !== "all"
      ? RESOURCE_TYPE_FILTERS.find((item) => item.id === selectedType)?.label
      : "",
    selectedStatus !== "all"
      ? RESOURCE_STATUS_FILTERS.find((item) => item.id === selectedStatus)?.label
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="资源中心"
          desc="多智能体生成的个性化多模态资源在此汇总 · 驳回重做的版本不会进入资源库"
        />

        {loadError && (
          <div
            role="alert"
            className="rounded-lg border border-danger/35 bg-danger/[0.06] px-3 py-2 text-[12px] text-danger"
          >
            资源列表加载失败：{loadError}
          </div>
        )}

        {feedback && (
          <div role="status" className="rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-[12px] text-success">
            {feedback}
          </div>
        )}

        {hydrated && hasManagedResources && (
          <section className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <h2 className="text-[13px] font-semibold">资源分类管理</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  按资源类型和质检状态管理已生成内容
                </p>
              </div>
              <div className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                可管理 {typeCounts.all} 项
              </div>
            </div>

            <div className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">按类型</div>
                <div className="flex flex-wrap gap-1.5">
                  {RESOURCE_TYPE_FILTERS.map((item) => {
                    const active = item.id === selectedType;
                    return (
                      <Link
                        key={item.id}
                        href={filterHref({ type: item.id })}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-surface-2/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                      >
                        <span>{item.label}</span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 text-[10px]",
                            active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                          )}
                        >
                          {typeCounts[item.id]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">按状态</div>
                <div className="flex flex-wrap gap-1.5">
                  {RESOURCE_STATUS_FILTERS.map((item) => {
                    const active = item.id === selectedStatus;
                    return (
                      <Link
                        key={item.id}
                        href={filterHref({ status: item.id })}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-surface-2/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                      >
                        <span>{item.label}</span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 text-[10px]",
                            active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                          )}
                        >
                          {statusCounts[item.id]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {!hydrated ? (
          <div className="rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
            正在恢复资源会话…
          </div>
        ) : visibleResources.length === 0 ? (
          <EmptyState
            icon={Library}
            mascot="alligator"
            title={
              filtersActive
                ? "当前筛选没有可显示资源"
                : hasManagedResources
                  ? "当前分类下暂无资源"
                  : "资源库还是空的"
            }
            desc={
              filtersActive
                ? `未找到${activeFilterText ? `「${activeFilterText}」` : "当前条件"}匹配的资源。已驳回重做的版本会被自动隐藏。`
                : hasManagedResources
                  ? "切换上方类型或状态筛选，查看当前学习会话中已生成的资源。"
                  : "去 AI 答疑描述你的学习需求，多智能体会生成讲义、导图、题库、代码、视频与课件，质检通过后在这里汇总。"
            }
            cta={
              filtersActive
                ? { href: "/resources", label: "清空筛选" }
                : { href: "/studio", label: "去 AI 答疑生成" }
            }
          />
        ) : (
          <>
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>{activeFilterText || "当前学习会话"}</span>
              <span>{visibleResources.length} 项资源</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleResources.map((resource) => (
                <div key={resource.id} className="space-y-1.5">
                  <ResourceCard item={resource} onOpen={openResource} />
                  {resource.status === "ready" && (
                    <button
                      type="button"
                      onClick={() => setAttachItem(resource)}
                      className="ml-auto flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent"
                    >
                      <GitBranch className="size-3" />
                      {session.resourcePathAttachments[resource.id] ? "调整挂载" : "挂载到学习路径"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <ResourceViewer item={openItem} onClose={() => setOpenItem(null)} />
      <ResourcePathAttachmentDialog
        item={attachItem}
        onClose={() => setAttachItem(null)}
        onAttached={setFeedback}
      />
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={null}>
      <ResourcesInner />
    </Suspense>
  );
}
