"use client";

import dynamic from "next/dynamic";
import {
  type CSSProperties,
  type FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronsRight,
  CirclePlay,
  Copy,
  Download,
  Drama,
  ExternalLink,
  FilePlus2,
  FileSearch,
  Film,
  Filter,
  Folder,
  FolderPlus,
  GitBranch,
  Library,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Search,
  Share2,
  ShieldCheck,
  Square,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ResourceBookFlip } from "@/components/desktop/resource-book-flip";
import { API_BASE } from "@/lib/api";
import { BROWSER_URL_KEY, openInBrowser } from "@/lib/browser-bus";
import { downloadText, materialsToMarkdown } from "@/lib/export-materials";
import {
  clearMaterials,
  getMaterialData,
  listMaterials,
  type ExternalVideoSummary,
  type StoredMaterial,
} from "@/lib/library";
import { buildPathResourceCollection } from "@/lib/path-resource-links";
import {
  readResourceCenterView,
  saveResourceCenterView,
  type ResourceCenterStableBookState,
} from "@/lib/resource-center-view";
import {
  createResourceCollection,
  deleteResourceCollection,
  listResourceCollections,
  updateResourceCollection,
  type ResourceCollection,
} from "@/lib/resource-collections";
import {
  applyResourceFilters,
  RESOURCE_STATUS_FILTERS,
  RESOURCE_TYPE_FILTERS,
  type ResourceStatusFilter,
  type ResourceTypeFilter,
} from "@/lib/session-insights";
import type { ResourceData, ResourceItem, ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

const MarketPublishDialog = dynamic(
  () => import("@/components/market-publish-dialog").then((module) => module.MarketPublishDialog),
  { ssr: false },
);

const ResourcePathAttachmentDialog = dynamic(
  () => import("@/components/resource-path-attachment-dialog").then((module) => module.ResourcePathAttachmentDialog),
  { ssr: false },
);

const ResourceViewer = dynamic(
  () => import("@/components/resource-viewer").then((module) => module.ResourceViewer),
  { ssr: false },
);

const RESOURCE_LABELS: Record<ResourceType, string> = {
  explainer: "讲义",
  mindmap: "导图",
  quiz: "练习",
  solution: "题目解析",
  reading: "阅读",
  code: "代码",
  video: "生成视频",
  courseware: "课件",
  interactive: "交互演示",
};

type CatalogCategory = "all" | "materials" | "generated-video" | "external-video";
type OriginFilter = "all" | "generated" | "video" | "web" | "referenced";
type SortFilter = "recent" | "title";
type ResourceBookState = "open" | "closing" | "closed" | "opening";

const RESOURCE_ENTRY_EXIT_MS = 420;
const RESOURCE_BOOK_MIN_HEIGHT = 648;
const RESOURCE_BOOK_MAX_WIDE_HEIGHT = 720;

const ORIGIN_FILTERS: { id: OriginFilter; label: string }[] = [
  { id: "all", label: "全部来源" },
  { id: "generated", label: "AI 生成" },
  { id: "video", label: "视频来源" },
  { id: "web", label: "联网页面" },
  { id: "referenced", label: "有知识引用" },
];

const RESOURCE_ACTIVITY_ITEMS: { icon: LucideIcon; label: string; time: string }[] = [
  { icon: FilePlus2, label: "生成了《二叉树遍历复盘讲义》", time: "8/16 10:24" },
  { icon: BookOpen, label: "继续阅读《错题复盘：树遍历与哈希冲突》至 68%", time: "8/14 02:48" },
  { icon: Star, label: "收藏《栈、队列与树的知识导图》到学习路径合集", time: "7/29 04:48" },
  { icon: Link2, label: "从知识库引用 6 条资料", time: "8/12 02:48" },
  { icon: CheckCircle2, label: "完成《归并排序：从递归到实现》复习", time: "8/12 02:48" },
];

const STUDIO_PANELS_STATE_KEY = "sl_studio_panels_v3";

interface ExternalVideoLink extends ExternalVideoSummary {
  id: string;
  updatedAt: string;
  sourceResource: ResourceItem;
}

type CatalogEntry =
  | { kind: "resource"; key: string; resource: ResourceItem }
  | { kind: "external-video"; key: string; video: ExternalVideoLink };

function isResourceTypeFilter(value: string): value is ResourceTypeFilter {
  return RESOURCE_TYPE_FILTERS.some((item) => item.id === value);
}

function isResourceStatusFilter(value: string): value is ResourceStatusFilter {
  return RESOURCE_STATUS_FILTERS.some((item) => item.id === value);
}

function isCatalogCategory(value: string): value is CatalogCategory {
  return ["all", "materials", "generated-video", "external-video"].includes(value);
}

function isOriginFilter(value: string): value is OriginFilter {
  return ORIGIN_FILTERS.some((item) => item.id === value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
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
        const item = asRecord(value);
        return typeof item?.stem === "string" ? `${index + 1}. ${item.stem}` : "";
      })
      .filter(Boolean);
    if (questions.length) paragraphs.push(questions.join("\n"));
  }
  if (typeof record.code === "string" && record.code.trim()) paragraphs.push(record.code.trim());
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

function createdAtTime(resource: ResourceItem): number {
  const raw = (resource as StoredMaterial).created_at;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function resourceOrigin(resource: ResourceItem): string {
  const storedOrigin = (resource as Partial<StoredMaterial>).source;
  if (storedOrigin) return storedOrigin;
  const data = resource.data as Record<string, unknown> | undefined;
  if (asRecord(data?.video)) return "video";
  return "generated";
}

function resourceMatchesOrigin(resource: ResourceItem, origin: OriginFilter): boolean {
  if (origin === "all") return true;
  if (origin === "referenced") return resource.sources > 0;
  const source = resourceOrigin(resource);
  if (origin === "generated") return !["video", "web"].includes(source);
  return source === origin;
}

function externalVideoFromResource(resource: ResourceItem): ExternalVideoLink | null {
  const stored = resource as Partial<StoredMaterial>;
  const dataVideo = asRecord((resource.data as Record<string, unknown> | undefined)?.video);
  const summary = stored.external_video ?? (dataVideo as unknown as ExternalVideoSummary | null);
  if (!summary) return null;
  const bvid = String(summary.bvid ?? "").trim();
  const url = String(summary.url ?? "").trim() || (bvid ? `https://www.bilibili.com/video/${bvid}/` : "");
  if (!url) return null;
  const embedUrl = String(summary.embed_url ?? "").trim() || (bvid ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=0` : "");
  return {
    id: bvid || url,
    bvid,
    title: String(summary.title ?? resource.title).trim() || resource.title,
    url,
    embed_url: embedUrl,
    author: String(summary.author ?? "").trim(),
    duration: String(summary.duration ?? "").trim(),
    summary: String(summary.summary ?? resource.subtitle ?? "").trim(),
    updatedAt: createdAt(resource),
    sourceResource: resource,
  };
}

function absoluteMediaUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const path = value.trim();
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function resourceTopicStem(title: string): string {
  return title
    .split(/[：:｜|·]/, 1)[0]
    .replace(/[《》\s]/g, "")
    .trim();
}

function DesktopResourcesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resourceScrollRef = useRef<HTMLDivElement | null>(null);
  const bookShellRef = useRef<HTMLDivElement | null>(null);
  const restoredSelectedKeyRef = useRef("");
  const restoredScrollTopRef = useRef(0);
  const selectedKeyRef = useRef("");
  const stableBookStateRef = useRef<ResourceCenterStableBookState>("open");
  const bookHeightRef = useRef(RESOURCE_BOOK_MIN_HEIGHT);
  const bookTransitionLockRef = useRef(false);
  const bookTransitionSequenceRef = useRef(0);
  const entryExitTimerRef = useRef<number | null>(null);
  const resourceHrefRef = useRef("/desktop/resources");
  const viewRestoredRef = useRef(false);
  const query = (searchParams.get("q") ?? "").trim();
  const rawType = searchParams.get("type") ?? "all";
  const rawStatus = searchParams.get("status") ?? "all";
  const rawCategory = searchParams.get("category") ?? "all";
  const rawOrigin = searchParams.get("origin") ?? "all";
  const rawSort = searchParams.get("sort") ?? "recent";
  const selectedCollectionId = searchParams.get("collection") ?? "";
  const selectedType = isResourceTypeFilter(rawType) ? rawType : "all";
  const selectedStatus = isResourceStatusFilter(rawStatus) ? rawStatus : "all";
  const selectedCategory = isCatalogCategory(rawCategory) ? rawCategory : "all";
  const selectedOrigin = isOriginFilter(rawOrigin) ? rawOrigin : "all";
  const selectedSort: SortFilter = rawSort === "title" ? "title" : "recent";
  const session = useOrchestratorContext();
  const [searchDraft, setSearchDraft] = useState(query);
  const [library, setLibrary] = useState<StoredMaterial[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null);
  const [openItem, setOpenItem] = useState<ResourceItem | null>(null);
  const [resourceViewerActivated, setResourceViewerActivated] = useState(false);
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
  const [moreOpen, setMoreOpen] = useState(true);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [bookState, setBookState] = useState<ResourceBookState>("open");
  const [bookTransitionId, setBookTransitionId] = useState(0);
  const [bookHeight, setBookHeight] = useState(RESOURCE_BOOK_MIN_HEIGHT);
  const [bookFlipReady, setBookFlipReady] = useState(false);
  const [entryExitActive, setEntryExitActive] = useState(false);
  const [viewRestored, setViewRestored] = useState(false);
  const [collections, setCollections] = useState<ResourceCollection[]>([]);
  const [collectionEditorOpen, setCollectionEditorOpen] = useState(false);
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [collectionDraftName, setCollectionDraftName] = useState("");
  const [collectionDraftIds, setCollectionDraftIds] = useState<string[]>([]);
  const [collectionTargetIds, setCollectionTargetIds] = useState<string[]>([]);
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [collectionDeleteArmed, setCollectionDeleteArmed] = useState(false);

  useEffect(() => {
    const restored = readResourceCenterView();
    restoredSelectedKeyRef.current = restored.selectedKey;
    restoredScrollTopRef.current = restored.scrollTop;
    selectedKeyRef.current = restored.selectedKey;
    stableBookStateRef.current = restored.bookState;
    bookHeightRef.current = restored.bookHeight;
    setBookState(restored.bookState);
    setBookHeight(restored.bookHeight);
    viewRestoredRef.current = true;
    setViewRestored(true);

    return () => {
      if (!viewRestoredRef.current) return;
      saveResourceCenterView({
        href: resourceHrefRef.current,
        bookState: stableBookStateRef.current,
        bookHeight: bookHeightRef.current,
        selectedKey: selectedKeyRef.current,
        scrollTop: resourceScrollRef.current?.scrollTop ?? restoredScrollTopRef.current,
      });
    };
  }, []);

  useEffect(() => () => {
    if (entryExitTimerRef.current !== null) window.clearTimeout(entryExitTimerRef.current);
  }, []);

  const resourceQueryString = searchParams.toString();

  useEffect(() => {
    if (!viewRestored) return;
    const href = resourceQueryString
      ? `/desktop/resources?${resourceQueryString}`
      : "/desktop/resources";
    resourceHrefRef.current = href;
    saveResourceCenterView({
      href,
    });
  }, [resourceQueryString, viewRestored]);

  useEffect(() => {
    if (!viewRestored || (bookState !== "open" && bookState !== "closed")) return;
    stableBookStateRef.current = bookState;
    bookTransitionLockRef.current = false;
    saveResourceCenterView({ bookState });
  }, [bookState, viewRestored]);

  useEffect(() => {
    if (!viewRestored || bookState !== "open") return;
    const workspace = bookShellRef.current?.querySelector<HTMLElement>(".desktop-resource-workspace");
    if (!workspace) return;
    const measure = () => {
      const bounds = workspace.getBoundingClientRect();
      const measured = Math.max(
        RESOURCE_BOOK_MIN_HEIGHT,
        Math.min(RESOURCE_BOOK_MAX_WIDE_HEIGHT, Math.ceil(bounds.width / 2))
      );
      if (Math.abs(measured - bookHeightRef.current) <= 1) return;
      bookHeightRef.current = measured;
      setBookHeight(measured);
      saveResourceCenterView({ bookHeight: measured });
    };
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bookState, viewRestored]);

  useEffect(() => {
    if (!viewRestored || !selectedEntry) return;
    selectedKeyRef.current = selectedEntry.key;
    saveResourceCenterView({ selectedKey: selectedEntry.key });
  }, [selectedEntry, viewRestored]);

  useEffect(() => {
    if (!viewRestored || bookState !== "open") return;
    const frame = window.requestAnimationFrame(() => {
      const node = resourceScrollRef.current;
      if (node) node.scrollTop = restoredScrollTopRef.current;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bookState, library.length, viewRestored]);

  useEffect(() => setSearchDraft(query), [query]);

  const refreshLibrary = async () => {
    if (session.mode === "checking") return;
    setLibrary(await listMaterials(session.mode));
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
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "资源列表加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [session.mode]);

  useEffect(() => {
    if (session.mode === "checking") return;
    let cancelled = false;
    listResourceCollections(session.mode)
      .then((items) => {
        if (!cancelled) setCollections(items);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "资源集合加载失败");
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

  const externalVideos = useMemo(() => {
    const seen = new Set<string>();
    const links: ExternalVideoLink[] = [];
    for (const resource of combined) {
      const video = externalVideoFromResource(resource);
      if (!video) continue;
      const key = video.bvid || video.url;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(video);
    }
    return links;
  }, [combined]);

  const pathCollectionSource = useMemo(
    () => session.subjectPaths.flatMap((subject) =>
      subject.path.map((step) => ({ ...step, title: `${subject.title} · ${step.title}` }))
    ),
    [session.subjectPaths]
  );
  const pathCollection = useMemo(
    () => buildPathResourceCollection(pathCollectionSource, session.completedMaterials, combined),
    [pathCollectionSource, session.completedMaterials, combined]
  );
  const pathResourceIds = useMemo(
    () => new Set(pathCollection?.resources.map((entry) => entry.item.id) ?? []),
    [pathCollection]
  );
  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId]
  );
  const selectedCollectionResourceIds = useMemo(
    () => new Set(selectedCollection?.resource_ids ?? []),
    [selectedCollection]
  );
  const learningCount = useMemo(() => combined.filter((item) => item.type !== "video").length, [combined]);
  const generatedVideoCount = useMemo(() => combined.filter((item) => item.type === "video").length, [combined]);

  const visibleEntries = useMemo(() => {
    let resources = applyResourceFilters(combined, {
      query,
      type: selectedType,
      status: selectedStatus,
    }).filter((resource) => resourceMatchesOrigin(resource, selectedOrigin));

    if (selectedCategory === "materials") resources = resources.filter((item) => item.type !== "video");
    if (selectedCategory === "generated-video") resources = resources.filter((item) => item.type === "video");
    if (selectedCategory === "external-video") resources = [];
    if (selectedCollection) resources = resources.filter((item) => selectedCollectionResourceIds.has(item.id));

    const entries: CatalogEntry[] = resources.map((resource) => ({
      kind: "resource",
      key: `resource:${resource.id}`,
      resource,
    }));
    const allowExternal =
      (selectedCategory === "all" || selectedCategory === "external-video") &&
      (!selectedCollection || selectedCollectionResourceIds.size > 0) &&
      selectedType === "all" &&
      (selectedStatus === "all" || selectedStatus === "ready") &&
      ["all", "video", "referenced"].includes(selectedOrigin);
    if (allowExternal) {
      const normalizedQuery = query.toLocaleLowerCase("zh-CN");
      for (const video of externalVideos) {
        if (selectedCollection && !selectedCollectionResourceIds.has(video.sourceResource.id)) continue;
        const haystack = `${video.title} ${video.summary} ${video.author} ${video.bvid}`.toLocaleLowerCase("zh-CN");
        if (normalizedQuery && !haystack.includes(normalizedQuery)) continue;
        entries.push({ kind: "external-video", key: `external:${video.id}`, video });
      }
    }
    entries.sort((a, b) => {
      const aTitle = a.kind === "resource" ? a.resource.title : a.video.title;
      const bTitle = b.kind === "resource" ? b.resource.title : b.video.title;
      if (selectedSort === "title") return aTitle.localeCompare(bTitle, "zh-CN");
      const aTime = a.kind === "resource" ? createdAtTime(a.resource) : createdAtTime(a.video.sourceResource);
      const bTime = b.kind === "resource" ? createdAtTime(b.resource) : createdAtTime(b.video.sourceResource);
      return bTime - aTime;
    });
    return entries;
  }, [combined, externalVideos, query, selectedCategory, selectedCollection, selectedCollectionResourceIds, selectedOrigin, selectedSort, selectedStatus, selectedType]);

  const recentEntries = useMemo(() => {
    const entries: CatalogEntry[] = [
      ...combined.map((resource): CatalogEntry => ({ kind: "resource", key: `resource:${resource.id}`, resource })),
      ...externalVideos.map((video): CatalogEntry => ({ kind: "external-video", key: `external:${video.id}`, video })),
    ];
    return entries
      .sort((a, b) => {
        const aResource = a.kind === "resource" ? a.resource : a.video.sourceResource;
        const bResource = b.kind === "resource" ? b.resource : b.video.sourceResource;
        return createdAtTime(bResource) - createdAtTime(aResource);
      })
      .slice(0, 3);
  }, [combined, externalVideos]);

  useEffect(() => {
    if (visibleEntries.length === 0) {
      setSelectedEntry(null);
      return;
    }
    setSelectedEntry((current) => {
      const match = current && visibleEntries.find((entry) => entry.key === current.key);
      if (!match) {
        const restored = visibleEntries.find((entry) => entry.key === restoredSelectedKeyRef.current);
        if (restored) restoredSelectedKeyRef.current = "";
        return restored ?? visibleEntries[0];
      }
      if (current.kind === "resource" && current.resource.data && match.kind === "resource" && !match.resource.data) return current;
      return match;
    });
  }, [visibleEntries]);

  const navigateFilters = ({
    q = query,
    type = selectedType,
    status = selectedStatus,
    category = selectedCategory,
    origin = selectedOrigin,
    sort = selectedSort,
    collection = selectedCollectionId,
  }: {
    q?: string;
    type?: ResourceTypeFilter;
    status?: ResourceStatusFilter;
    category?: CatalogCategory;
    origin?: OriginFilter;
    sort?: SortFilter;
    collection?: string;
  }) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type !== "all") params.set("type", type);
    if (status !== "all") params.set("status", status);
    if (category !== "all") params.set("category", category);
    if (origin !== "all") params.set("origin", origin);
    if (sort !== "recent") params.set("sort", sort);
    if (collection) params.set("collection", collection);
    const suffix = params.toString();
    router.push(suffix ? `/desktop/resources?${suffix}` : "/desktop/resources");
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateFilters({ q: searchDraft });
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
      setSelectedEntry((current) =>
        current?.kind === "resource" && current.resource.id === resource.id
          ? { ...current, resource: hydrated }
          : current
      );
      setLibrary((items) => items.map((item) => (item.id === resource.id ? { ...item, data } : item)));
      return hydrated;
    } finally {
      setLoadingId("");
    }
  };

  const selectEntry = async (entry: CatalogEntry) => {
    setSelectedEntry(entry);
    setError("");
    if (entry.kind === "resource" && !entry.resource.data && session.mode === "live") await ensureData(entry.resource);
  };

  const selectForMarket = (entry: CatalogEntry) => {
    if (entry.kind === "external-video") {
      void selectEntry(entry);
      return;
    }
    if (!marketSelecting) {
      void selectEntry(entry);
      return;
    }
    setMarketSelectedIds((current) =>
      current.includes(entry.resource.id)
        ? current.filter((id) => id !== entry.resource.id)
        : [...current, entry.resource.id]
    );
  };

  const openResource = async (resource: ResourceItem) => {
    const hydrated = await ensureData(resource);
    if (hydrated) {
      setResourceViewerActivated(true);
      setOpenItem(hydrated);
    }
  };

  const exportResource = async (resource: ResourceItem) => {
    const hydrated = await ensureData(resource);
    if (!hydrated) return;
    downloadText(`${hydrated.title || "学习资料"}.md`, materialsToMarkdown([hydrated]));
    setFeedback(`已导出「${hydrated.title}」`);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback(`${label}已复制`);
    } catch {
      setError("复制失败，请手动选择链接复制。");
    }
  };

  const openExternalInBrowser = (url: string) => {
    try {
      const rawState = localStorage.getItem(STUDIO_PANELS_STATE_KEY);
      const parsedState = rawState ? JSON.parse(rawState) as unknown : null;
      const currentState = parsedState && typeof parsedState === "object"
        ? parsedState as Record<string, unknown>
        : {};
      const currentRightWidth = typeof currentState.rightW === "number" ? currentState.rightW : 720;
      localStorage.setItem(BROWSER_URL_KEY, url);
      localStorage.setItem(STUDIO_PANELS_STATE_KEY, JSON.stringify({
        version: 3,
        open: "browser",
        leftOpen: typeof currentState.leftOpen === "boolean" ? currentState.leftOpen : true,
        rightOpen: true,
        leftW: typeof currentState.leftW === "number" ? currentState.leftW : 240,
        rightW: Math.max(720, currentRightWidth),
      }));
    } catch {
      /* keep navigation functional when storage is unavailable */
    }
    openInBrowser(url);
  };

  const deleteResource = async (resource: ResourceItem) => {
    if (!window.confirm(`确定删除「${resource.title}」吗？此操作会同步移除持久化资料与当前会话引用。`)) return;
    setDeletingId(resource.id);
    setError("");
    setFeedback("");
    try {
      await session.removeResource(resource.id);
      await refreshLibrary();
      setSelectedEntry((current) => current?.kind === "resource" && current.resource.id === resource.id ? null : current);
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
      setSelectedEntry(null);
      setOpenItem(null);
      setAttachItem(null);
      setFeedback("资源中心已清空");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "清空资源失败");
    } finally {
      setClearing(false);
    }
  };

  const runBookTransition = (direction: "closing" | "opening") => {
    if (
      bookTransitionLockRef.current ||
      bookState === "closing" ||
      bookState === "opening" ||
      (direction === "opening" && bookState !== "closed") ||
      (direction === "closing" && bookState !== "open")
    ) return;
    bookTransitionLockRef.current = true;
    const nextTransitionId = bookTransitionSequenceRef.current + 1;
    bookTransitionSequenceRef.current = nextTransitionId;
    setBookTransitionId(nextTransitionId);
    setBookFlipReady(false);
    if (direction === "opening" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEntryExitActive(true);
      setBookState("opening");
      entryExitTimerRef.current = window.setTimeout(() => {
        entryExitTimerRef.current = null;
        setEntryExitActive(false);
      }, RESOURCE_ENTRY_EXIT_MS);
      return;
    }
    setBookState(direction);
  };

  const openCollectionEditor = (collection?: ResourceCollection, seedIds: string[] = []) => {
    const availableIds = new Set(combined.map((resource) => resource.id));
    setEditingCollectionId(collection?.id ?? "");
    setCollectionDraftName(collection?.name ?? "");
    setCollectionDraftIds(collection
      ? collection.resource_ids.filter((resourceId) => availableIds.has(resourceId))
      : [...new Set(seedIds.filter((resourceId) => availableIds.has(resourceId)))]);
    setCollectionDeleteArmed(false);
    setCollectionPickerOpen(false);
    setCollectionEditorOpen(true);
  };

  const closeCollectionEditor = (force = false) => {
    if (collectionSaving && !force) return;
    setCollectionEditorOpen(false);
    setEditingCollectionId("");
    setCollectionDraftName("");
    setCollectionDraftIds([]);
    setCollectionDeleteArmed(false);
  };

  const toggleCollectionDraftResource = (resourceId: string) => {
    setCollectionDraftIds((current) => current.includes(resourceId)
      ? current.filter((id) => id !== resourceId)
      : [...current, resourceId]);
  };

  const saveCollectionEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = collectionDraftName.trim();
    if (!name) {
      setError("请输入集合名称");
      return;
    }
    setCollectionSaving(true);
    setError("");
    try {
      const input = { name, resource_ids: collectionDraftIds };
      const saved = editingCollectionId
        ? await updateResourceCollection(session.mode, editingCollectionId, input)
        : await createResourceCollection(session.mode, input);
      setCollections((current) => editingCollectionId
        ? current.map((collection) => collection.id === saved.id ? saved : collection)
        : [saved, ...current]);
      setFeedback(editingCollectionId ? `已更新集合「${saved.name}」` : `已创建集合「${saved.name}」`);
      closeCollectionEditor(true);
      navigateFilters({ category: "all", collection: saved.id });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "集合保存失败");
    } finally {
      setCollectionSaving(false);
    }
  };

  const addTargetsToCollection = async (collection: ResourceCollection) => {
    if (collectionTargetIds.length === 0) return;
    setCollectionSaving(true);
    setError("");
    try {
      const availableIds = new Set(combined.map((resource) => resource.id));
      const resourceIds = [...new Set([
        ...collection.resource_ids.filter((resourceId) => availableIds.has(resourceId)),
        ...collectionTargetIds,
      ])];
      const saved = await updateResourceCollection(session.mode, collection.id, {
        name: collection.name,
        resource_ids: resourceIds,
      });
      setCollections((current) => current.map((item) => item.id === saved.id ? saved : item));
      setCollectionPickerOpen(false);
      setMarketSelecting(false);
      setMarketSelectedIds([]);
      setFeedback(`已将 ${collectionTargetIds.length} 项资料加入「${saved.name}」`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加入集合失败");
    } finally {
      setCollectionSaving(false);
    }
  };

  const removeCollection = async () => {
    if (!editingCollectionId) return;
    if (!collectionDeleteArmed) {
      setCollectionDeleteArmed(true);
      return;
    }
    setCollectionSaving(true);
    setError("");
    try {
      await deleteResourceCollection(session.mode, editingCollectionId);
      setCollections((current) => current.filter((collection) => collection.id !== editingCollectionId));
      if (selectedCollectionId === editingCollectionId) navigateFilters({ collection: "" });
      setFeedback("集合已删除，资料本身仍保留在资源中心");
      closeCollectionEditor(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除集合失败");
    } finally {
      setCollectionSaving(false);
    }
  };

  const selectedItem = selectedEntry?.kind === "resource" ? selectedEntry.resource : null;
  const selectedExternal = selectedEntry?.kind === "external-video" ? selectedEntry.video : null;
  const selectedPreview = selectedItem ? previewText(selectedItem.data) : "";
  const selectedData = selectedItem?.data as Record<string, unknown> | undefined;
  const mediaFileUrl = absoluteMediaUrl(selectedData?.media_file_url);
  const linkedExternal = selectedItem
    ? externalVideoFromResource(selectedItem) ?? externalVideos.find((video) => {
        const stem = resourceTopicStem(selectedItem.title);
        return stem.length >= 4 && resourceTopicStem(video.title).includes(stem);
      }) ?? null
    : null;
  useEffect(() => setVideoPlaying(false), [selectedItem?.id]);
  const filtersActive = Boolean(query) || selectedType !== "all" || selectedStatus !== "all" || selectedCategory !== "all" || selectedOrigin !== "all" || selectedSort !== "recent" || Boolean(selectedCollectionId);
  const topicCount = useMemo(() => {
    const topics = new Set<string>();
    for (const resource of combined) {
      const text = (resource as Partial<StoredMaterial>).knowledge_points || resource.meta.join("、");
      text.split(/[、,，·]/).map((item) => item.trim()).filter(Boolean).forEach((item) => topics.add(item));
    }
    return topics.size;
  }, [combined]);
  const catalogSections: Array<{
    id: CatalogCategory;
    label: string;
    count: number;
    Icon: LucideIcon;
  }> = [
    { id: "materials", label: "学习资料", count: learningCount, Icon: BookMarked },
    { id: "generated-video", label: "生成视频", count: generatedVideoCount, Icon: Film },
    { id: "external-video", label: "外部视频链接", count: externalVideos.length, Icon: Link2 },
  ];
  const activeBookTransitionId = bookTransitionId;
  const resourceToolbar = (withBookToggle = false) => (
    <section className={cn("desktop-resource-toolbar", withBookToggle && "has-book-toggle")} aria-label="资源筛选与批量操作">
      {withBookToggle && (
        <button
          type="button"
          className="desktop-resource-book-toggle"
          aria-label="收起书页"
          title="合上资源典藏"
          onClick={() => runBookTransition("closing")}
        >
          <ChevronsRight aria-hidden className="size-4" />
        </button>
      )}
      <form role="search" onSubmit={submitSearch}>
        <Search aria-hidden className="size-4" />
        <label htmlFor="resource-search" className="sr-only">搜索资源</label>
        <input id="resource-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索标题、知识点或类型" />
        <button type="submit">搜索</button>
      </form>
      <label><span className="desktop-resource-filter-label">类型：</span><select aria-label="资源类型" value={selectedType} onChange={(event) => navigateFilters({ type: event.target.value as ResourceTypeFilter })}>{RESOURCE_TYPE_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span className="desktop-resource-filter-label">状态：</span><select aria-label="审核状态" value={selectedStatus} onChange={(event) => navigateFilters({ status: event.target.value as ResourceStatusFilter })}>{RESOURCE_STATUS_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span className="desktop-resource-filter-label">来源：</span><select aria-label="知识来源" value={selectedOrigin} onChange={(event) => navigateFilters({ origin: event.target.value as OriginFilter })}>{ORIGIN_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span className="desktop-resource-filter-label">排序：</span><select aria-label="排序" value={selectedSort} onChange={(event) => navigateFilters({ sort: event.target.value as SortFilter })}><option value="recent">最近更新</option><option value="title">标题排序</option></select></label>
      <button type="button" className="desktop-toolbar-link" aria-label="清空筛选" title="清空筛选" onClick={() => router.push("/desktop/resources")}><Filter aria-hidden className="size-3.5" /><span>清空筛选</span></button>
    </section>
  );

  return (
    <div
      ref={resourceScrollRef}
      className="desktop-resource-center thin-scroll h-full overflow-y-auto"
      onScroll={(event) => {
        restoredScrollTopRef.current = event.currentTarget.scrollTop;
      }}
    >
      <div className="desktop-resource-center__frame">
        <header className="desktop-resource-center__header">
          <div>
            <h1>资源中心</h1>
            <span>典籍所藏，学识致用</span>
            <p>共 {learningCount + generatedVideoCount + externalVideos.length} 项馆藏 · 涉及 {topicCount} 个知识主题 · 最近更新 8/16</p>
          </div>
          <div className="desktop-resource-center__header-actions">
            <details className="desktop-resource-more" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
              <summary><MoreHorizontal aria-hidden className="size-4" /> 更多操作</summary>
              <div>
                <button type="button" onClick={() => setMarketOpen(true)}><GitBranch aria-hidden className="size-4" /> 发布学习路径</button>
                <button type="button" data-testid="clear-resource-center" onClick={clearAllResources} disabled={clearing || combined.length === 0}><Trash2 aria-hidden className="size-4" /> {clearing ? "清空中" : "清空资源中心"}</button>
              </div>
            </details>
          </div>
        </header>

        {recentEntries.length > 0 && (
          <section className="desktop-resource-recent" aria-label="最近学习">
            <div className="desktop-resource-recent__title"><strong>最近学习</strong><button type="button" onClick={() => { navigateFilters({ category: "all" }); if (bookState === "closed") runBookTransition("opening"); }}>查看全部</button></div>
            <div>
              {recentEntries.map((entry, index) => {
                const title = entry.kind === "resource" ? entry.resource.title : entry.video.title;
                const category = entry.kind === "resource" ? RESOURCE_LABELS[entry.resource.type] : "外部视频";
                const updatedAt = entry.kind === "resource" ? createdAt(entry.resource) : entry.video.updatedAt;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className={cn("desktop-resource-recent__card", `is-tone-${(index % 3) + 1}`)}
                    onClick={() => { void selectEntry(entry); if (bookState === "closed") runBookTransition("opening"); }}
                    aria-label={`继续学习：${title}；${category}；更新于 ${updatedAt}`}
                    title={title}
                  >
                    <span className="desktop-resource-recent__spine" aria-hidden />
                    {entry.kind === "external-video" ? <Film aria-hidden /> : <BookMarked aria-hidden />}
                    <span className="desktop-resource-recent__copy">
                      <strong>{title}</strong>
                      <small>{category} · {updatedAt}</small>
                    </span>
                    <span className="desktop-resource-recent__status" aria-hidden>继续</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {(feedback || error) && <div className={cn("desktop-resource-feedback", error && "is-error")} role={error ? "alert" : "status"} aria-live="polite">{error || feedback}</div>}

        {!session.hydrated ? (
          <>{resourceToolbar()}<div className="desktop-resource-loading">正在恢复资源会话…</div></>
        ) : combined.length === 0 ? (
          <>{resourceToolbar()}<div className="desktop-resource-empty"><Library aria-hidden className="size-6" /><div><strong>{filtersActive ? "当前筛选没有匹配资源" : "还没有已过审资源"}</strong><p>{filtersActive ? "清空筛选或更换关键词。" : "先让智能教师生成资料，通过审核后会自动进入这里。"}</p></div>{filtersActive ? <Link href="/desktop/resources">清空筛选</Link> : <TeacherOpenButton context={{ module: "resources", title: "资源中心", detail: "当前没有已过审资料，请帮助规划并生成新的学习资料。" }}>生成新资料</TeacherOpenButton>}</div></>
        ) : (
          <div
            ref={bookShellRef}
            className={cn("desktop-resource-book-shell", `is-${bookState}`, entryExitActive && "is-entry-exiting", bookFlipReady && "has-book-flip-overlay")}
            style={{ "--resource-book-content-height": `${bookHeight}px` } as CSSProperties}
          >
            {(bookState === "closed" || entryExitActive || (bookState === "opening" && !bookFlipReady)) && (
              <section className="desktop-resource-closed-workbench" aria-labelledby="resource-workbench-title" aria-hidden={entryExitActive} inert={entryExitActive}>
                <div className="desktop-resource-closed-workbench__primary">
                  <header>
                    <h2 id="resource-workbench-title">资源工作台</h2>
                    <p>选择一种方式，开始构建学习资源</p>
                  </header>
                  <div className="desktop-resource-closed-workbench__entrances">
                    <Link href="/desktop/create" className="desktop-resource-closed-entry is-ai">
                      <img src="/brand/resources/resource-entry-ai-engraving-v1.webp" alt="" />
                      <span className="desktop-resource-closed-entry__copy">
                        <strong>AI 生成资料</strong>
                        <small>输入主题与要求，生成学习资料、讲义与练习</small>
                      </span>
                    </Link>
                    <Link href="/desktop/kb" className="desktop-resource-closed-entry is-kb">
                      <img src="/brand/resources/resource-entry-kb-engraving-v1.webp" alt="" />
                      <span className="desktop-resource-closed-entry__copy">
                        <strong>进入知识库</strong>
                        <small>管理供 AI 检索、引用与回答的知识来源</small>
                      </span>
                    </Link>
                  </div>
                </div>
                <section className="desktop-resource-closed-activity" aria-labelledby="resource-activity-title">
                  <header>
                    <h3 id="resource-activity-title">我的学习动态</h3>
                    <button type="button" onClick={() => router.push("/desktop/profile")}>查看全部动态</button>
                  </header>
                  <ol>
                    {RESOURCE_ACTIVITY_ITEMS.map(({ icon: Icon, label, time }) => (
                      <li key={label}>
                        <Icon aria-hidden />
                        <span>{label}</span>
                        <time>{time}</time>
                      </li>
                    ))}
                  </ol>
                </section>
              </section>
            )}
            {(bookState === "closed" || (bookState === "opening" && !bookFlipReady)) && (
              <button
                type="button"
                className="desktop-resource-book-closed"
                onClick={() => runBookTransition("opening")}
                aria-label="展开资源典藏"
                disabled={entryExitActive}
                tabIndex={bookState === "opening" || entryExitActive ? -1 : 0}
              >
                <img src="/brand/resources/resource-book-cover-v3.webp" alt="" />
                <span><strong>资源典藏</strong><small>点击展开书页</small></span>
              </button>
            )}
            {bookState !== "closed" && (
              <>
          <div className="desktop-resource-workspace" aria-label="资源典藏书页" aria-hidden={bookState !== "open"} inert={bookState !== "open"}>
            <section className="desktop-resource-left-page" aria-label="资源目录与列表">
              {resourceToolbar(true)}
              <div className="desktop-resource-left-page__body">
                <aside className="desktop-resource-catalog" aria-label="典藏索引">
              <div className="desktop-resource-catalog__head"><strong>典藏索引</strong><button type="button" onClick={() => openCollectionEditor()}><FolderPlus aria-hidden className="size-3.5" />新建集合</button></div>
              <nav>
                {catalogSections.map(({ id, label, count, Icon }) => (
                  <button key={id} type="button" className={!selectedCollection && selectedCategory === id ? "is-active" : undefined} onClick={() => navigateFilters({ category: id, collection: "" })}><Icon aria-hidden className="size-4" /><span>{label}</span><em>{count}</em></button>
                ))}
              </nav>
              <section className="desktop-resource-catalog__collections" aria-label="我的集合">
                <div><strong>我的集合</strong><small>{collections.length}</small></div>
                {collections.length === 0 ? (
                  <button type="button" className="is-empty" onClick={() => openCollectionEditor()}><FolderPlus aria-hidden className="size-3.5" />创建第一个集合</button>
                ) : collections.map((collection) => (
                  <div key={collection.id} className={selectedCollectionId === collection.id ? "is-active" : undefined}>
                    <button type="button" onClick={() => navigateFilters({ category: "all", collection: collection.id })}><Folder aria-hidden className="size-3.5" /><span>{collection.name}</span><small>{collection.resource_ids.length}</small></button>
                    <button type="button" aria-label={`管理集合 ${collection.name}`} title="管理集合" onClick={() => openCollectionEditor(collection)}><Pencil aria-hidden className="size-3" /></button>
                  </div>
                ))}
              </section>
              {pathCollection && (
                <section className="desktop-resource-catalog__paths" data-testid="learning-path-collection">
                  <button type="button" onClick={() => setPathCollectionOpen((open) => !open)} aria-expanded={pathCollectionOpen}><GitBranch aria-hidden className="size-4" /><span><strong>学习路径合集</strong><small>{pathCollection.readyCount}/{pathCollection.total} 份资料已过审</small></span><ChevronDown aria-hidden className={cn("size-3.5", pathCollectionOpen && "is-open")} /></button>
                  {pathCollectionOpen && <div>{pathCollection.stages.map((stage) => <section key={stage.key}><strong>{stage.title}</strong><small>{stage.readyCount}/{stage.total}</small>{stage.resources.map(({ item }) => <button key={item.id} type="button" onClick={() => void selectEntry({ kind: "resource", key: `resource:${item.id}`, resource: item })}>{item.title}</button>)}</section>)}</div>}
                </section>
              )}
                </aside>

                <section className="desktop-resource-list" aria-label="资源列表">
              <div className="desktop-resource-list__batch">
                <button type="button" onClick={() => { setMarketSelecting((current) => !current); if (marketSelecting) setMarketSelectedIds([]); }}><Square aria-hidden className="size-3.5" />{marketSelecting ? "退出批量" : "批量选择"}</button>
                <span>{marketSelecting ? `已选 ${marketSelectedIds.length} 项` : `共 ${visibleEntries.length} 项`}</span>
                <button
                  type="button"
                  disabled={marketSelecting ? marketSelectedIds.length === 0 : !selectedItem}
                  onClick={() => {
                    const targetIds = marketSelecting ? marketSelectedIds : selectedItem ? [selectedItem.id] : [];
                    setCollectionTargetIds(targetIds);
                    if (collections.length === 0) openCollectionEditor(undefined, targetIds);
                    else setCollectionPickerOpen(true);
                  }}
                ><FolderPlus aria-hidden className="size-3.5" />加入集合</button>
                <button type="button" disabled={marketSelecting ? marketSelectedIds.length === 0 : !selectedItem} onClick={() => { if (!marketSelecting && selectedItem) setMarketSelectedIds([selectedItem.id]); setMarketOpen(true); }}><Share2 aria-hidden className="size-3.5" />发布所选</button>
              </div>
              <div className="desktop-resource-list__head">
                <strong>{query ? `“${query}” 的结果` : "类型 / 标题"}</strong>
                <span className="desktop-resource-list__head-topic">知识主题</span>
                <span className="desktop-resource-list__head-status">状态</span>
                <span className="desktop-resource-list__head-count">{marketSelecting ? `已选 ${marketSelectedIds.length} 项` : `${visibleEntries.length} 项`}</span>
              </div>
              <div className="thin-scroll">
                {visibleEntries.length === 0 && (
                  <div className="desktop-resource-list__empty"><Folder aria-hidden className="size-5" /><strong>{selectedCollection ? `「${selectedCollection.name}」还没有资料` : "当前筛选没有匹配资料"}</strong><small>{selectedCollection ? "点击“管理集合”选择已有资料，或退出筛选查看全部。" : "更换筛选条件或清空筛选后重试。"}</small></div>
                )}
                {visibleEntries.map((entry) => {
                  const isExternal = entry.kind === "external-video";
                  const resource = entry.kind === "resource" ? entry.resource : null;
                  const title = entry.kind === "resource" ? entry.resource.title : entry.video.title;
                  const subtitle = entry.kind === "resource"
                    ? entry.resource.subtitle || entry.resource.meta.join(" · ") || "已过审学习资料"
                    : entry.video.summary || entry.video.author || "外部学习视频";
                  const selected = selectedEntry?.key === entry.key;
                  return (
                    <button key={entry.key} type="button" onClick={() => selectForMarket(entry)} aria-pressed={marketSelecting && resource ? marketSelectedIds.includes(resource.id) : selected} className={cn(marketSelecting && "is-batch", selected && !marketSelecting && "is-selected", marketSelecting && resource && marketSelectedIds.includes(resource.id) && "is-selected")}>
                      {marketSelecting && <span className={cn("desktop-resource-selectbox", resource && marketSelectedIds.includes(resource.id) && "is-selected")} aria-hidden>{resource && marketSelectedIds.includes(resource.id) ? "✓" : ""}</span>}
                      <span className={cn("desktop-resource-type", isExternal && "is-external", resource?.type === "video" && "is-video")}>{isExternal ? "外部链接" : RESOURCE_LABELS[resource!.type]}</span>
                      <span className="desktop-resource-copy"><strong>{title}</strong><small>{subtitle}</small></span>
                      <span className="desktop-resource-row-meta">{resource && pathResourceIds.has(resource.id) && <em>路径资料</em>}<small>{isExternal ? `${entry.video.bvid || "视频链接"} · ${entry.video.updatedAt}` : `${resource!.sources} 引用 · ${createdAt(resource!)}`}</small></span>
                      {isExternal ? <ExternalLink aria-hidden className="size-4" /> : <CheckCircle2 aria-hidden className="size-4 text-success" />}
                    </button>
                  );
                })}
              </div>
                </section>
              </div>
            </section>

            <aside className="desktop-resource-preview" aria-label="真实资源预览">
              {selectedExternal ? (
                <>
                  <div className="desktop-resource-preview__folio-nav"><button type="button" onClick={() => setSelectedEntry(null)}><ArrowLeft aria-hidden className="size-3.5" />返回列表</button><div className="desktop-resource-preview__tools"><button type="button" onClick={() => void copyText(selectedExternal.url, "视频链接")} title="复制视频链接"><Copy aria-hidden className="size-4" /></button><button type="button" onClick={() => openExternalInBrowser(selectedExternal.url)} title="在内置浏览器打开"><ExternalLink aria-hidden className="size-4" /></button><details className="desktop-resource-preview__tool-menu"><summary title="更多视频操作"><MoreHorizontal aria-hidden className="size-4" /></summary><div><button type="button" onClick={() => openResource(selectedExternal.sourceResource)}>打开学习总结</button><button type="button" onClick={() => setAttachItem(selectedExternal.sourceResource)}>挂载到路径</button></div></details></div></div>
                  <div className="desktop-resource-preview__head"><div><span>外部视频链接 · 可学习</span><h2>{selectedExternal.title}</h2><p>{selectedExternal.author || selectedExternal.bvid || "哔哩哔哩"}</p></div><ExternalLink aria-hidden className="size-5 text-success" /></div>
                  <div className="desktop-resource-video">{selectedExternal.embed_url ? <iframe src={selectedExternal.embed_url} title={selectedExternal.title} allow="fullscreen; autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <div className="desktop-resource-video__poster"><img src="/brand/resources/merge-sort-video-poster-v1.png" alt="归并排序分治过程讲解视频封面" /></div>}</div>
                  <section className="desktop-resource-link-block"><strong>原始视频链接</strong><div><code>{selectedExternal.url}</code><button type="button" onClick={() => void copyText(selectedExternal.url, "视频链接")}><Copy aria-hidden className="size-3.5" />复制</button></div><button type="button" onClick={() => openExternalInBrowser(selectedExternal.url)}><ExternalLink aria-hidden className="size-4" />在内置浏览器打开</button></section>
                  <div className="desktop-resource-provenance"><ShieldCheck aria-hidden className="size-4" /><span>该链接由“视频学习”保存，AI 总结与复盘题仍作为独立学习资料留在资源中心。</span></div>
                  <div className="desktop-resource-preview__actions"><button type="button" onClick={() => openResource(selectedExternal.sourceResource)}><BookOpen aria-hidden className="size-4" />打开学习总结</button><button type="button" onClick={() => setAttachItem(selectedExternal.sourceResource)}><GitBranch aria-hidden className="size-4" />挂载到路径</button></div>
                </>
              ) : selectedItem ? (
                <>
                  <div className="desktop-resource-preview__folio-nav"><button type="button" onClick={() => setSelectedEntry(null)}><ArrowLeft aria-hidden className="size-3.5" />返回列表</button><div className="desktop-resource-preview__tools"><button type="button" onClick={() => openResource(selectedItem)} title="打开资料"><BookOpen aria-hidden className="size-4" /></button><button type="button" onClick={() => setAttachItem(selectedItem)} title="挂载到学习路径"><GitBranch aria-hidden className="size-4" /></button><details className="desktop-resource-preview__tool-menu"><summary title="更多资料操作"><MoreHorizontal aria-hidden className="size-4" /></summary><div><button type="button" onClick={() => exportResource(selectedItem)}>导出 Markdown</button><button type="button" onClick={() => { setMarketSelectedIds([selectedItem.id]); setMarketOpen(true); }}>发布到市场</button><button type="button" className="is-danger" disabled={deletingId === selectedItem.id} onClick={() => deleteResource(selectedItem)}>{deletingId === selectedItem.id ? "删除中" : "删除资料"}</button></div></details></div></div>
                  {selectedItem.type === "video" ? (
                    <div className="desktop-resource-preview__head is-video"><div className="desktop-resource-preview__title-row"><h2>{selectedItem.title}</h2><span>{mediaFileUrl ? "已过审 · MP4 已完成" : "已过审 · 待生成成片"}</span></div></div>
                  ) : (
                    <div className="desktop-resource-preview__head"><div><span>{RESOURCE_LABELS[selectedItem.type]} · 已过审</span><h2>{selectedItem.title}</h2><p>{selectedItem.subtitle || selectedItem.meta.join(" · ")}</p></div><ShieldCheck aria-hidden className="size-5 text-success" /></div>
                  )}
                  {selectedItem.type === "video" ? (
                    <>
                      <div className="desktop-resource-video">{mediaFileUrl ? <><video ref={videoRef} controls preload="metadata" poster="/brand/resources/merge-sort-video-poster-v1.png" src={mediaFileUrl} onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} />{!videoPlaying && <button type="button" className="desktop-resource-video__play" onClick={() => void videoRef.current?.play()} aria-label="播放归并排序讲解视频"><Play aria-hidden className="size-7" /></button>}</> : <div className="desktop-resource-video__poster"><img src="/brand/resources/merge-sort-video-poster-v1.png" alt="归并排序分治过程讲解视频封面" /><button type="button" onClick={() => openResource(selectedItem)} aria-label="打开资料并生成成片"><Play aria-hidden className="size-7" /></button></div>}</div>
                      <section className="desktop-resource-link-block"><strong>本地成片链接</strong><div className="desktop-resource-link-block__row"><div className="desktop-resource-link-block__value"><code>{typeof selectedData?.media_file_url === "string" ? selectedData.media_file_url : "尚未生成 MP4；打开资料即可开始生成"}</code>{mediaFileUrl && <button type="button" aria-label="复制成片链接" title="复制成片链接" onClick={() => void copyText(mediaFileUrl, "成片链接")}><Copy aria-hidden className="size-3.5" /></button>}</div><div className="desktop-resource-link-block__actions"><button type="button" disabled={!mediaFileUrl} onClick={() => void videoRef.current?.play()}><CirclePlay aria-hidden className="size-4" />播放</button>{mediaFileUrl && <a href={mediaFileUrl} download><Download aria-hidden className="size-4" />下载 MP4</a>}</div></div></section>
                    </>
                  ) : (
                    <><div className="desktop-resource-preview__facts"><span>证据引用 <strong>{selectedItem.sources}</strong></span><span>版本 <strong>v{selectedItem.version}</strong></span><span>更新 <strong>{createdAt(selectedItem)}</strong></span></div><div className="desktop-resource-preview__body" aria-busy={loadingId === selectedItem.id}><span><FileSearch aria-hidden className="size-4" /> 内容预览</span><p>{loadingId === selectedItem.id ? "正在读取完整正文…" : selectedPreview}</p></div></>
                  )}
                  {linkedExternal && <section className="desktop-resource-link-block is-external"><strong>关联外部视频</strong><div className="desktop-resource-link-block__row"><div className="desktop-resource-link-block__value"><code>{linkedExternal.url}</code><button type="button" aria-label="复制外部视频链接" title="复制外部视频链接" onClick={() => void copyText(linkedExternal.url, "外部视频链接")}><Copy aria-hidden className="size-3.5" /></button></div><button type="button" onClick={() => openExternalInBrowser(linkedExternal.url)}><ExternalLink aria-hidden className="size-4" />内置浏览器打开</button></div></section>}
                  <div className="desktop-resource-provenance"><BookMarked aria-hidden className="size-4" /><span>AI 生成依据：课程知识库 · {selectedItem.sources} 条引用</span><button type="button" onClick={() => openResource(selectedItem)}>查看引用</button></div>
                  <div className="desktop-resource-preview__actions">
                    <button type="button" onClick={() => openResource(selectedItem)} disabled={loadingId === selectedItem.id || (!selectedItem.data && session.mode !== "live")} title={!selectedItem.data && session.mode !== "live" ? "离线缓存没有正文；请在设置中恢复学习服务后重试" : undefined}><BookOpen aria-hidden className="size-4" />{selectedItem.type === "quiz" ? "开始答题" : "打开资料"}</button>
                    <button type="button" onClick={() => router.push(`/desktop/theater?resource=${encodeURIComponent(selectedItem.id)}`)}><Drama aria-hidden className="size-4" />剧场讲解</button>
                    <button type="button" onClick={() => setAttachItem(selectedItem)}><GitBranch aria-hidden className="size-4" />{session.resourcePathAttachments[selectedItem.id] ? "已挂载" : "挂载路径"}</button>
                    <button type="button" onClick={() => exportResource(selectedItem)} disabled={loadingId === selectedItem.id || (!selectedItem.data && session.mode !== "live")}><Download aria-hidden className="size-4" />导出 Markdown</button>
                  </div>
                  {!selectedItem.data && session.mode !== "live" && <p className="desktop-resource-dependency-note">当前离线缓存只有资源摘要，完整预览与导出已禁用。请在设置中启动后端服务并等待顶部显示“服务正常”。</p>}
                </>
              ) : <div className="desktop-resource-preview__empty"><FileSearch aria-hidden className="size-6" /><p>从目录中选择一份资料或视频，查看真实内容与链接。</p></div>}
            </aside>
          </div>
          {(bookState === "closing" || bookState === "opening") && (
            <ResourceBookFlip
              key={activeBookTransitionId}
              direction={bookState}
              onReady={() => {
                if (
                  activeBookTransitionId > 0 &&
                  activeBookTransitionId === bookTransitionSequenceRef.current
                ) {
                  setBookFlipReady(true);
                }
              }}
              onComplete={() => {
                if (
                  activeBookTransitionId <= 0 ||
                  activeBookTransitionId !== bookTransitionSequenceRef.current
                ) return;
                bookTransitionLockRef.current = false;
                setEntryExitActive(false);
                setBookFlipReady(false);
                setBookState(bookState === "closing" ? "closed" : "open");
              }}
            />
          )}
              </>
            )}
          </div>
        )}
        <nav className="desktop-resource-bookshelf" aria-label="书架功能入口">
          <div className="desktop-resource-shelf-books">
            <Link
              href="/desktop/practice"
              className="desktop-resource-shelf-book is-practice"
              aria-label="进入练习模块"
              title="进入练习模块"
            >
              <img src="/brand/resources/shelf-book-practice-original-v1.webp" alt="" draggable={false} />
              <strong className="desktop-resource-shelf-book__label" aria-hidden>练习</strong>
            </Link>
            <span className="desktop-resource-shelf-book is-reserved is-pine" aria-hidden>
              <img src="/brand/resources/shelf-book-pine-original-v1.webp" alt="" draggable={false} />
            </span>
            <span className="desktop-resource-shelf-book is-reserved is-ochre" aria-hidden>
              <img src="/brand/resources/shelf-book-ochre-original-v1.webp" alt="" draggable={false} />
            </span>
          </div>
        </nav>
      </div>
      {collectionPickerOpen && (
        <div className="desktop-resource-collection-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !collectionSaving) setCollectionPickerOpen(false); }}>
          <section className="desktop-resource-collection-picker" role="dialog" aria-modal="true" aria-labelledby="collection-picker-title">
            <header><div><strong id="collection-picker-title">加入集合</strong><small>将 {collectionTargetIds.length} 项已有资料归入集合</small></div><button type="button" aria-label="关闭" onClick={() => setCollectionPickerOpen(false)}><X aria-hidden className="size-4" /></button></header>
            <div className="desktop-resource-collection-picker__list">
              {collections.map((collection) => (
                <button key={collection.id} type="button" disabled={collectionSaving} onClick={() => void addTargetsToCollection(collection)}><Folder aria-hidden className="size-4" /><span><strong>{collection.name}</strong><small>当前 {collection.resource_ids.length} 项</small></span><ChevronsRight aria-hidden className="size-4" /></button>
              ))}
            </div>
            <button type="button" className="desktop-resource-collection-picker__new" onClick={() => openCollectionEditor(undefined, collectionTargetIds)}><FolderPlus aria-hidden className="size-4" />新建集合并加入</button>
          </section>
        </div>
      )}
      {collectionEditorOpen && (
        <div className="desktop-resource-collection-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeCollectionEditor(); }}>
          <section className="desktop-resource-collection-editor" role="dialog" aria-modal="true" aria-labelledby="collection-editor-title">
            <form onSubmit={saveCollectionEditor}>
              <header><div><strong id="collection-editor-title">{editingCollectionId ? "管理集合" : "新建集合"}</strong><small>集合只整理现有资料，不会复制或修改原内容</small></div><button type="button" aria-label="关闭" onClick={() => closeCollectionEditor()} disabled={collectionSaving}><X aria-hidden className="size-4" /></button></header>
              <label className="desktop-resource-collection-editor__name"><span>集合名称</span><input autoFocus value={collectionDraftName} onChange={(event) => setCollectionDraftName(event.target.value)} maxLength={40} placeholder="例如：期末复习重点" /></label>
              <div className="desktop-resource-collection-editor__selection-head"><span>选择已有资料 <strong>{collectionDraftIds.length}</strong> / {combined.length}</span><div><button type="button" onClick={() => setCollectionDraftIds(combined.map((resource) => resource.id))}>全选</button><button type="button" onClick={() => setCollectionDraftIds([])}>清空</button></div></div>
              <div className="desktop-resource-collection-editor__resources thin-scroll">
                {combined.map((resource) => (
                  <label key={resource.id}>
                    <input type="checkbox" checked={collectionDraftIds.includes(resource.id)} onChange={() => toggleCollectionDraftResource(resource.id)} />
                    <span className="desktop-resource-type">{RESOURCE_LABELS[resource.type]}</span>
                    <span><strong>{resource.title}</strong><small>{resource.subtitle || resource.meta.join(" · ") || "已过审资料"}</small></span>
                  </label>
                ))}
              </div>
              <footer>
                {editingCollectionId && <button type="button" className={cn("is-danger", collectionDeleteArmed && "is-armed")} onClick={() => void removeCollection()} disabled={collectionSaving}><Trash2 aria-hidden className="size-4" />{collectionDeleteArmed ? "再次点击确认删除" : "删除集合"}</button>}
                <span />
                <button type="button" onClick={() => closeCollectionEditor()} disabled={collectionSaving}>取消</button>
                <button type="submit" disabled={collectionSaving || !collectionDraftName.trim()}>{collectionSaving ? "保存中…" : editingCollectionId ? "保存集合" : "创建集合"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {resourceViewerActivated ? <ResourceViewer item={openItem} onClose={() => setOpenItem(null)} /> : null}
      {attachItem ? (
        <ResourcePathAttachmentDialog item={attachItem} onClose={() => setAttachItem(null)} onAttached={setFeedback} />
      ) : null}
      {marketOpen ? (
        <MarketPublishDialog open resources={combined} initialResourceIds={marketSelectedIds} onClose={() => setMarketOpen(false)} onPublished={(listing) => { setFeedback(`《${listing.title}》已发布到学习市场。`); setMarketSelecting(false); setMarketSelectedIds([]); }} />
      ) : null}
    </div>
  );
}

export default function DesktopResources() {
  return <Suspense fallback={<div className="desktop-resource-loading">正在载入资源中心…</div>}><DesktopResourcesInner /></Suspense>;
}
