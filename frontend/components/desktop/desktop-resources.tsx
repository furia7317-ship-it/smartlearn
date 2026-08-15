"use client";

import { type FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  Download,
  Drama,
  FileSearch,
  GitBranch,
  Library,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Video,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { MarketPublishDialog } from "@/components/market-publish-dialog";
import { ResourcePathAttachmentDialog } from "@/components/resource-path-attachment-dialog";
import { ResourceViewer } from "@/components/resource-viewer";
import { downloadText, materialsToMarkdown } from "@/lib/export-materials";
import {
  clearMaterials,
  getMaterialData,
  listMaterials,
  type StoredMaterial,
} from "@/lib/library";
import { buildPathResourceCollection } from "@/lib/path-resource-links";
import {
  applyResourceFilters,
  getResourceStatusCounts,
  getResourceTypeCounts,
  RESOURCE_STATUS_FILTERS,
  RESOURCE_TYPE_FILTERS,
  type ResourceStatusFilter,
  type ResourceTypeFilter,
} from "@/lib/session-insights";
import type { ResourceData, ResourceItem, ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

const RESOURCE_LABELS: Record<ResourceType, string> = {
  explainer: "讲义",
  mindmap: "导图",
  quiz: "练习",
  solution: "题目解析",
  reading: "阅读",
  code: "代码",
  video: "视频",
  courseware: "课件",
  interactive: "交互演示",
};

function isResourceTypeFilter(value: string): value is ResourceTypeFilter {
  return RESOURCE_TYPE_FILTERS.some((item) => item.id === value);
}

function isResourceStatusFilter(value: string): value is ResourceStatusFilter {
  return RESOURCE_STATUS_FILTERS.some((item) => item.id === value);
}

function previewText(data: ResourceData | undefined): string {
  if (!data) return "正文尚未载入。选择资源后会从真实资料库读取完整内容。";
  const record = data as Record<string, unknown>;
  const paragraphs: string[] = [];
  for (const key of ["overview", "summary", "explanation", "content", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) paragraphs.push(value.trim());
  }
  if (Array.isArray(record.key_points)) {
    paragraphs.push(
      record.key_points
        .filter((value): value is string => typeof value === "string")
        .slice(0, 5)
        .map((value, index) => `${index + 1}. ${value}`)
        .join("\n")
    );
  }
  if (Array.isArray(record.questions)) {
    const questions = record.questions
      .slice(0, 4)
      .map((value, index) => {
        if (!value || typeof value !== "object") return "";
        const stem = (value as Record<string, unknown>).stem;
        return typeof stem === "string" ? `${index + 1}. ${stem}` : "";
      })
      .filter(Boolean);
    if (questions.length) paragraphs.push(questions.join("\n"));
  }
  if (typeof record.code === "string" && record.code.trim()) {
    paragraphs.push(record.code.trim());
  }
  return paragraphs.filter(Boolean).join("\n\n") || "资料已过审，但没有可显示的文本摘要；可打开查看结构化内容。";
}

function createdAt(resource: ResourceItem): string {
  const raw = (resource as StoredMaterial).created_at;
  if (!raw) return "当前会话";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "当前会话";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DesktopResourcesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = (searchParams.get("q") ?? "").trim();
  const rawType = searchParams.get("type") ?? "all";
  const rawStatus = searchParams.get("status") ?? "all";
  const selectedType = isResourceTypeFilter(rawType) ? rawType : "all";
  const selectedStatus = isResourceStatusFilter(rawStatus) ? rawStatus : "all";
  const session = useOrchestratorContext();
  const [searchDraft, setSearchDraft] = useState(query);
  const [library, setLibrary] = useState<StoredMaterial[]>([]);
  const [selectedItem, setSelectedItem] = useState<ResourceItem | null>(null);
  const [openItem, setOpenItem] = useState<ResourceItem | null>(null);
  const [attachItem, setAttachItem] = useState<ResourceItem | null>(null);
  const [pathCollectionOpen, setPathCollectionOpen] = useState(false);
  const [loadingId, setLoadingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [clearing, setClearing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [marketSelecting, setMarketSelecting] = useState(false);
  const [marketSelectedIds, setMarketSelectedIds] = useState<string[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);

  useEffect(() => setSearchDraft(query), [query]);

  const refreshLibrary = async () => {
    if (session.mode === "checking") return;
    const items = await listMaterials(session.mode);
    setLibrary(items);
  };

  useEffect(() => {
    if (session.mode === "checking") return;
    let cancelled = false;
    setError("");
    listMaterials(session.mode)
      .then((items) => {
        if (!cancelled) setLibrary(items);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "资源列表加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.mode]);

  const combined = useMemo(() => {
    const seen = new Set<string>();
    const out: ResourceItem[] = [];
    for (const resource of [...library, ...session.resources]) {
      if (resource.status !== "ready" || seen.has(resource.id)) continue;
      seen.add(resource.id);
      out.push(resource);
    }
    return out;
  }, [library, session.resources]);

  const pathCollectionSource = useMemo(
    () => session.subjectPaths.flatMap((subject) =>
      subject.path.map((step) => ({
        ...step,
        title: `${subject.title} · ${step.title}`,
      })),
    ),
    [session.subjectPaths],
  );
  const pathCollection = useMemo(
    () => buildPathResourceCollection(pathCollectionSource, session.completedMaterials, combined),
    [pathCollectionSource, session.completedMaterials, combined]
  );
  const pathResourceIds = useMemo(
    () => new Set(pathCollection?.resources.map((entry) => entry.item.id) ?? []),
    [pathCollection]
  );
  const typeCounts = useMemo(() => getResourceTypeCounts(combined), [combined]);
  const statusCounts = useMemo(() => getResourceStatusCounts(combined), [combined]);
  const visibleResources = useMemo(
    () => applyResourceFilters(combined, {
      query,
      type: selectedType,
      status: selectedStatus,
    }),
    [combined, query, selectedStatus, selectedType],
  );

  useEffect(() => {
    if (visibleResources.length === 0) {
      setSelectedItem(null);
      return;
    }
    setSelectedItem((current) =>
      current && visibleResources.some((resource) => resource.id === current.id)
        ? current
        : visibleResources[0]
    );
  }, [visibleResources]);

  const navigateFilters = ({
    q = query,
    type = selectedType,
    status = selectedStatus,
  }: {
    q?: string;
    type?: ResourceTypeFilter;
    status?: ResourceStatusFilter;
  }) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type !== "all") params.set("type", type);
    if (status !== "all") params.set("status", status);
    const suffix = params.toString();
    router.push(suffix ? `/desktop/resources?${suffix}` : "/desktop/resources");
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateFilters({ q: searchDraft });
  };

  const selectForMarket = (resource: ResourceItem) => {
    if (!marketSelecting) {
      void selectResource(resource);
      return;
    }
    setMarketSelectedIds((current) => current.includes(resource.id)
      ? current.filter((id) => id !== resource.id)
      : [...current, resource.id]);
  };

  const ensureData = async (resource: ResourceItem): Promise<ResourceItem | null> => {
    if (resource.data) return resource;
    if (session.mode !== "live") {
      setError("离线缓存中没有这份资料的正文。请在设置中恢复学习服务连接后重试。");
      return null;
    }
    setLoadingId(resource.id);
    setError("");
    try {
      const data = await getMaterialData(session.mode, resource.id);
      if (!data) {
        setError("资料正文暂时不可用。请确认后端资料服务正常后再试。");
        return null;
      }
      const hydrated = { ...resource, data };
      setSelectedItem((current) => (current?.id === resource.id ? hydrated : current));
      setLibrary((items) =>
        items.map((item) => (item.id === resource.id ? { ...item, data } : item))
      );
      return hydrated;
    } finally {
      setLoadingId("");
    }
  };

  const selectResource = async (resource: ResourceItem) => {
    setSelectedItem(resource);
    setError("");
    if (!resource.data && session.mode === "live") await ensureData(resource);
  };

  const openResource = async (resource: ResourceItem) => {
    const hydrated = await ensureData(resource);
    if (hydrated) setOpenItem(hydrated);
  };

  const exportResource = async (resource: ResourceItem) => {
    const hydrated = await ensureData(resource);
    if (!hydrated) return;
    downloadText(`${hydrated.title || "学习资料"}.md`, materialsToMarkdown([hydrated]));
    setFeedback(`已导出「${hydrated.title}」`);
  };

  const deleteResource = async (resource: ResourceItem) => {
    if (!window.confirm(`确定删除「${resource.title}」吗？此操作会同步移除持久化资料与当前会话引用。`)) {
      return;
    }
    setDeletingId(resource.id);
    setError("");
    setFeedback("");
    try {
      await session.removeResource(resource.id);
      await refreshLibrary();
      setSelectedItem((current) => (current?.id === resource.id ? null : current));
      setOpenItem((current) => (current?.id === resource.id ? null : current));
      setAttachItem((current) => (current?.id === resource.id ? null : current));
      setFeedback(`已删除「${resource.title}」`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除资源失败");
    } finally {
      setDeletingId("");
    }
  };

  const clearAllResources = async () => {
    if (combined.length === 0 || clearing) return;
    if (!window.confirm(`确定清空 ${combined.length} 项已过审资源吗？清空后不能撤销。`)) return;
    setClearing(true);
    setError("");
    setFeedback("");
    try {
      await clearMaterials(session.mode);
      setLibrary([]);
      session.clearResources();
      setSelectedItem(null);
      setOpenItem(null);
      setAttachItem(null);
      setFeedback("资源中心已清空");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "清空资源失败");
    } finally {
      setClearing(false);
    }
  };

  const selectedPreview = selectedItem ? previewText(selectedItem.data) : "";
  const filtersActive = Boolean(query) || selectedType !== "all" || selectedStatus !== "all";

  return (
    <div className="desktop-resource-center thin-scroll h-full overflow-y-auto">
      <div className="desktop-resource-center__frame">
        <header className="desktop-resource-center__header">
          <div>
            <span>已审核资料库</span>
            <h1>资源中心</h1>
          </div>
        </header>

        <section className="desktop-resource-toolbar" aria-label="资源筛选与批量操作">
          <form role="search" onSubmit={submitSearch}>
            <Search aria-hidden className="size-4" />
            <label htmlFor="resource-search" className="sr-only">搜索资源</label>
            <input
              id="resource-search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="搜索标题、知识点或类型"
            />
            <button type="submit">搜索</button>
          </form>
          <label>
            <span className="sr-only">资源类型</span>
            <select
              value={selectedType}
              onChange={(event) => navigateFilters({ type: event.target.value as ResourceTypeFilter })}
            >
              {RESOURCE_TYPE_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}（{typeCounts[item.id]}）</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">审核状态</span>
            <select
              value={selectedStatus}
              onChange={(event) => navigateFilters({ status: event.target.value as ResourceStatusFilter })}
            >
              {RESOURCE_STATUS_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}（{statusCounts[item.id]}）</option>
              ))}
            </select>
          </label>
          <Link href="/desktop/studio" className="desktop-toolbar-primary">
            <BookOpen aria-hidden className="size-3.5" /> 让教师生成资料
          </Link>
          <Link href="/desktop/kb" className="desktop-toolbar-link">
            <BookMarked aria-hidden className="size-3.5" /> 知识来源
          </Link>
          <Link href="/desktop/video-learning" className="desktop-toolbar-link">
            <Video aria-hidden className="size-3.5" /> 视频学习
          </Link>
          <span className="desktop-resource-gate"><ShieldCheck aria-hidden className="size-3.5" /> 持久化门禁已启用</span>
          <button
            type="button"
            className="desktop-toolbar-link"
            onClick={() => {
              if (marketSelecting && marketSelectedIds.length > 0) setMarketOpen(true);
              else setMarketSelecting((current) => !current);
            }}
          >
            <Share2 aria-hidden className="size-3.5" />
            {marketSelecting && marketSelectedIds.length > 0
              ? `发布所选（${marketSelectedIds.length}）`
              : marketSelecting ? "退出选择" : "发布到学习市场"}
          </button>
          <button
            type="button"
            className="desktop-toolbar-link"
            onClick={() => {
              setMarketSelectedIds([]);
              setMarketOpen(true);
            }}
          >
            <GitBranch aria-hidden className="size-3.5" /> 发布学习路径
          </button>
          {filtersActive && (
            <button type="button" className="desktop-toolbar-link" onClick={() => router.push("/desktop/resources")}>
              清空筛选
            </button>
          )}
          <button
            type="button"
            className="desktop-toolbar-danger"
            data-testid="clear-resource-center"
            onClick={clearAllResources}
            disabled={clearing || combined.length === 0}
            title={combined.length === 0 ? "没有可清空的已过审资源" : "清空资源中心"}
          >
            <Trash2 aria-hidden className="size-3.5" /> {clearing ? "清空中" : "清空"}
          </button>
        </section>

        {pathCollection && (
          <section className="desktop-path-collection" data-testid="learning-path-collection">
            <button
              type="button"
              onClick={() => setPathCollectionOpen((open) => !open)}
              aria-expanded={pathCollectionOpen}
            >
              <GitBranch aria-hidden className="size-4" />
              <strong>学习路径合集</strong>
              <span>{pathCollection.readyCount}/{pathCollection.total} 份资料已过审</span>
              <em>{pathCollectionOpen ? "收起" : "展开"}</em>
            </button>
            {pathCollectionOpen && (
              <div>
                {pathCollection.stages.map((stage) => (
                  <section key={stage.key}>
                    <span>{stage.day}</span>
                    <strong>{stage.title}</strong>
                    <small>{stage.readyCount}/{stage.total}</small>
                    <div>
                      {stage.resources.map(({ item }) => (
                        <button key={item.id} type="button" onClick={() => selectResource(item)}>
                          {item.title}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        )}

        {(feedback || error) && (
          <div
            className={cn("desktop-resource-feedback", error && "is-error")}
            role={error ? "alert" : "status"}
            aria-live="polite"
          >
            {error || feedback}
          </div>
        )}

        {!session.hydrated ? (
          <div className="desktop-resource-loading">正在恢复资源会话…</div>
        ) : visibleResources.length === 0 ? (
          <div className="desktop-resource-empty">
            <Library aria-hidden className="size-6" />
            <div>
              <strong>{filtersActive ? "当前筛选没有匹配资源" : "还没有已过审资源"}</strong>
              <p>
                {filtersActive
                  ? "清空筛选或更换关键词。未通过审核的版本不会出现在结果中。"
                  : "先生成学习资料；只有通过结构、证据、事实、可执行和持久化门禁的版本才会发布。"}
              </p>
            </div>
            <Link href={filtersActive ? "/desktop/resources" : "/desktop/studio"}>
              {filtersActive ? "清空筛选" : "找智能教师生成"}
            </Link>
          </div>
        ) : (
          <div className="desktop-resource-workspace">
            <section className="desktop-resource-list" aria-label="资源列表">
              <div className="desktop-resource-list__head">
                <strong>{query ? `“${query}” 的结果` : "全部已过审资源"}</strong>
                <span>{marketSelecting ? `已选 ${marketSelectedIds.length} 项` : `${visibleResources.length} 项`}</span>
              </div>
              <div className="thin-scroll">
                {visibleResources.map((resource) => (
                  <button
                    key={resource.id}
                    type="button"
                    onClick={() => selectForMarket(resource)}
                    aria-pressed={marketSelecting ? marketSelectedIds.includes(resource.id) : selectedItem?.id === resource.id}
                    className={cn(
                      selectedItem?.id === resource.id && !marketSelecting && "is-selected",
                      marketSelecting && marketSelectedIds.includes(resource.id) && "is-selected",
                    )}
                  >
                    {marketSelecting && (
                      <span className="grid size-5 shrink-0 place-items-center rounded border border-current text-[11px]">
                        {marketSelectedIds.includes(resource.id) ? "✓" : ""}
                      </span>
                    )}
                    <span className="desktop-resource-type">{RESOURCE_LABELS[resource.type]}</span>
                    <span className="desktop-resource-copy">
                      <strong>{resource.title}</strong>
                      <small>{resource.subtitle || resource.meta.join(" · ") || "已过审学习资料"}</small>
                    </span>
                    <span className="desktop-resource-row-meta">
                      {pathResourceIds.has(resource.id) && <em>路径资料</em>}
                      <small>{resource.sources} 引用 · {createdAt(resource)}</small>
                    </span>
                    <CheckCircle2 aria-hidden className="size-4 text-success" />
                  </button>
                ))}
              </div>
            </section>

            <aside className="desktop-resource-preview" aria-label="真实资源预览">
              {selectedItem ? (
                <>
                  <div className="desktop-resource-preview__head">
                    <div>
                      <span>{RESOURCE_LABELS[selectedItem.type]} · 已过审</span>
                      <h2>{selectedItem.title}</h2>
                      <p>{selectedItem.subtitle || selectedItem.meta.join(" · ")}</p>
                    </div>
                    <ShieldCheck aria-hidden className="size-5 text-success" />
                  </div>
                  <div className="desktop-resource-preview__facts">
                    <span>证据引用 <strong>{selectedItem.sources}</strong></span>
                    <span>版本 <strong>v{selectedItem.version}</strong></span>
                    <span>更新 <strong>{createdAt(selectedItem)}</strong></span>
                  </div>
                  <div className="desktop-resource-preview__body" aria-busy={loadingId === selectedItem.id}>
                    <span><FileSearch aria-hidden className="size-4" /> 内容预览</span>
                    <p>{loadingId === selectedItem.id ? "正在读取完整正文…" : selectedPreview}</p>
                  </div>
                  <div className="desktop-resource-preview__actions">
                    <button
                      type="button"
                      onClick={() => openResource(selectedItem)}
                      disabled={loadingId === selectedItem.id || (!selectedItem.data && session.mode !== "live")}
                      title={!selectedItem.data && session.mode !== "live" ? "离线缓存没有正文；请在设置中恢复学习服务后重试" : undefined}
                    >
                      <BookOpen aria-hidden className="size-4" />
                      {selectedItem.type === "quiz" ? "开始答题" : "打开资料"}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push(`/desktop/theater?resource=${encodeURIComponent(selectedItem.id)}`)}
                    >
                      <Drama aria-hidden className="size-4" /> 剧场讲解
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttachItem(selectedItem)}
                      title={session.resourcePathAttachments[selectedItem.id] ? "查看或修改挂载位置" : "挂载到科目学习路径"}
                    >
                      <GitBranch aria-hidden className="size-4" />
                      {session.resourcePathAttachments[selectedItem.id] ? "已挂载" : "挂载到路径"}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportResource(selectedItem)}
                      disabled={loadingId === selectedItem.id || (!selectedItem.data && session.mode !== "live")}
                      title={!selectedItem.data && session.mode !== "live" ? "离线缓存没有正文；请在设置中恢复学习服务后重试" : undefined}
                    >
                      <Download aria-hidden className="size-4" /> 导出 Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMarketSelectedIds([selectedItem.id]);
                        setMarketOpen(true);
                      }}
                    >
                      <Share2 aria-hidden className="size-4" /> 发布到市场
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => deleteResource(selectedItem)}
                      disabled={deletingId === selectedItem.id}
                    >
                      <Trash2 aria-hidden className="size-4" />
                      {deletingId === selectedItem.id ? "删除中" : "删除"}
                    </button>
                  </div>
                  {!selectedItem.data && session.mode !== "live" && (
                    <p className="desktop-resource-dependency-note">
                      当前离线缓存只有资源摘要，完整预览与导出已禁用。请在设置中启动后端服务并等待顶部显示“服务正常”。
                    </p>
                  )}
                </>
              ) : (
                <div className="desktop-resource-preview__empty">
                  <FileSearch aria-hidden className="size-6" />
                  <p>从左侧选择一份资料，查看真实正文摘要与审核信息。</p>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      <ResourceViewer item={openItem} onClose={() => setOpenItem(null)} />
      <ResourcePathAttachmentDialog
        item={attachItem}
        onClose={() => setAttachItem(null)}
        onAttached={setFeedback}
      />
      <MarketPublishDialog
        open={marketOpen}
        resources={combined}
        initialResourceIds={marketSelectedIds}
        onClose={() => setMarketOpen(false)}
        onPublished={(listing) => {
          setFeedback(`《${listing.title}》已发布到学习市场。`);
          setMarketSelecting(false);
          setMarketSelectedIds([]);
        }}
      />
    </div>
  );
}

export default function DesktopResources() {
  return (
    <Suspense fallback={<div className="desktop-resource-loading">正在载入资源中心…</div>}>
      <DesktopResourcesInner />
    </Suspense>
  );
}
