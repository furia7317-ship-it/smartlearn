"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Bookmark,
  BookOpen,
  Bot,
  Box,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Filter,
  GitBranch,
  PackageOpen,
  Search,
  Send,
  ShieldCheck,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";

import { MarketPublishDialog } from "@/components/market-publish-dialog";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link } from "@/components/shell-link";
import { importFromMarket, listMarket, type MarketFilter, type MarketListing } from "@/lib/learning-market";
import { listMaterials, type StoredMaterial } from "@/lib/library";
import { MATERIAL_TYPE_LABEL } from "@/lib/material-types";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ id: MarketFilter; label: string; icon: LucideIcon }> = [
  { id: "all", label: "精选", icon: Store },
  { id: "learning_path", label: "学习路径", icon: GitBranch },
  { id: "material", label: "单份资料", icon: FileText },
  { id: "bundle", label: "资源包", icon: PackageOpen },
  { id: "agent", label: "工作流", icon: Bot },
];

const KIND_LABEL: Record<MarketListing["kind"], string> = {
  learning_path: "学习路径",
  material: "单份资料",
  bundle: "资源包",
  agent: "智能体",
};

const MARKET_COVERS: Record<MarketListing["kind"], string> = {
  learning_path: "/brand/market/learning-path-ink.png",
  material: "/brand/market/algorithm-map-ink.png",
  bundle: "/brand/animals/resource-desk.webp",
  // 宣纸 + 金线轨道图，与市场既有水墨封面同一套底色；静态导出 + CSP 下必须走 public/ 本地资源。
  agent: "/brand/marketing/agent-orbits-v2.png",
};

const TYPE_LABELS: Record<string, string> = {
  reading: "PDF",
  practice: "DOCX",
  coding: "CODE",
  mindmap: "MAP",
  slides: "PPTX",
  voice: "AUDIO",
  image: "IMAGE",
  video: "VIDEO",
  learning_path: "PATH",
  // 智能体上架时预览项的 type 就是它的 output_type（9 种 ResourceType 之一）。
  explainer: "EXPLAIN",
  quiz: "QUIZ",
  solution: "SOLUTION",
  code: "CODE",
  courseware: "PPTX",
  interactive: "DEMO",
};

function mergeResources(library: StoredMaterial[], sessionResources: ResourceItem[]): ResourceItem[] {
  const byId = new Map<string, ResourceItem>();
  for (const item of [...library, ...sessionResources]) {
    if (item.status === "ready") byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function formatSaves(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function listingCountLabel(listing: MarketListing) {
  if (listing.kind === "learning_path") return `${Math.max(1, listing.item_count)} 个阶段`;
  if (listing.kind === "agent") return `${Math.max(1, listing.item_count)} 项能力`;
  return `${Math.max(1, listing.item_count)} 份资料`;
}

/** 智能体导入落在 custom_agents，不产生资料，卡片/抽屉的按钮文案要区分开。 */
function importActionLabel(kind: MarketListing["kind"]) {
  if (kind === "learning_path") return "添加学习路径";
  if (kind === "agent") return "添加到我的智能体";
  return "添加到资源中心";
}

export default function DesktopMarket() {
  const session = useOrchestratorContext();
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [library, setLibrary] = useState<StoredMaterial[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [sortBy, setSortBy] = useState<"latest" | "popular">("latest");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const resources = useMemo(() => mergeResources(library, session.resources), [library, session.resources]);
  const orderedListings = useMemo(() => {
    const next = [...listings];
    if (sortBy === "popular") next.sort((left, right) => right.saves - left.saves);
    return next;
  }, [listings, sortBy]);
  const selected = selectedId ? listings.find((item) => item.id === selectedId) ?? null : null;

  const refresh = async () => {
    if (session.mode === "checking") return;
    setLoading(true);
    setError("");
    try {
      const [marketItems, materialItems] = await Promise.all([
        listMarket(session.mode, { q: query, kind: filter }),
        listMaterials(session.mode),
      ]);
      setListings(marketItems);
      setLibrary(materialItems);
      setSelectedId((current) => marketItems.some((item) => item.id === current) ? current : marketItems[0]?.id ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "学习市场加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // refresh is intentionally keyed only by the server query inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, query, session.mode]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(queryDraft.trim());
  };

  const addListing = async (listing: MarketListing) => {
    if (importingId || listing.already_imported) return;
    setImportingId(listing.id);
    setFeedback("");
    setError("");
    try {
      const result = await importFromMarket(session.mode, listing.id);
      if (result.kind === "learning_path" && result.path_snapshot) {
        session.importMarketPath(listing.id, listing.author_name, result.path_snapshot);
      }
      // agent 导入建的是一个自建智能体（custom_agents），不会产生 generated_materials：
      // 再去 listMaterials 重拉只会让 appendResources 收到空数组，用户得不到任何反馈。
      if (result.kind !== "agent") {
        const refreshedMaterials = await listMaterials(session.mode);
        setLibrary(refreshedMaterials);
        session.appendResources(refreshedMaterials.filter((item) => result.target_ids.includes(item.id)));
      }
      setListings((current) => current.map((item) => item.id === listing.id
        ? { ...item, already_imported: true, saves: result.listing.saves }
        : item));
      setFeedback(result.kind === "agent"
        ? `已把《${listing.title}》添加到我的智能体；在可编辑计划里把任务指派给它即可执行。`
        : result.kind === "learning_path"
          ? `已把《${listing.title}》作为独立路径添加；现有路径未被替换。`
          : `已把《${listing.title}》添加到资源中心。`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "添加失败，请稍后重试。");
    } finally {
      setImportingId("");
    }
  };

  return (
    <main className="desktop-market-page thin-scroll h-full overflow-y-auto bg-[#f8f3e8] text-[#2c261f]">
      <div className="desktop-market-frame">
        <header className="desktop-market-header">
          <div className="font-serif">
            <span>学习者社区</span>
            <h1>学习市场</h1>
            <p>发现来自学习者社区的优质内容</p>
          </div>
        </header>

        <div className="desktop-market-layout">
        <section className="min-w-0 pb-7">
          <header>
            <div className="mt-5 flex items-center justify-between gap-3">
              <form onSubmit={submitSearch} role="search" className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-md border border-[#cfc2ad] bg-[#fbf8f0] px-4 text-[#8c8173] focus-within:border-[#9f6a3a] focus-within:ring-2 focus-within:ring-[#9f6a3a]/10">
                <Search className="size-[18px] shrink-0" />
                <input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="搜索路径、资料、资源包或智能体" className="min-w-0 flex-1 bg-transparent font-serif text-sm tracking-[0.04em] text-[#3e372e] outline-none placeholder:text-[#9a8f81]" />
                <button type="submit" className="sr-only">搜索</button>
              </form>
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="desktop-market-publish shrink-0"
              >
                <Send className="size-[18px]" />发布资源
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#d9cebd] pb-4">
              <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((item) => {
                  const Icon = item.icon;
                  return <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={cn("inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 font-serif text-sm font-semibold tracking-[0.05em] transition", filter === item.id ? "bg-[#355f43] text-[#fffdf5] shadow-sm" : "text-[#574d40] hover:bg-[#eee4d3]")}><Icon className="size-4" />{item.label}</button>;
                })}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="relative inline-flex h-9 items-center rounded-md border border-[#cfc2ad] bg-[#fbf8f0] pl-4 pr-9 font-serif text-sm text-[#4f463a]">
                  <span className="sr-only">排序方式</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "latest" | "popular")} className="appearance-none bg-transparent pr-1 outline-none">
                    <option value="latest">最新发布</option>
                    <option value="popular">最多收藏</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 size-4" />
                </label>
                <button type="button" onClick={() => setFilter("all")} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cfc2ad] bg-[#fbf8f0] px-4 font-serif text-sm text-[#4f463a] hover:bg-[#f2eadc]"><Filter className="size-4" />筛选</button>
              </div>
            </div>
          </header>

          {(feedback || error) && <div role={error ? "alert" : "status"} className={cn("mt-4 rounded-md border px-4 py-3 text-sm", error ? "border-[#d7a28c] bg-[#fff1e9] text-[#8a3f28]" : "border-[#aab98e] bg-[#f2f6e9] text-[#526638]")}>{error || feedback}</div>}

          <div className="relative mt-5 min-h-[178px] overflow-hidden rounded-md border border-[#cfbea2] bg-[#efe3cf] bg-cover bg-center shadow-[0_8px_22px_rgba(81,59,35,0.06)]" style={{ backgroundImage: "url('/brand/market/market-hero-ink.png')" }}>
            <div className="relative z-10 max-w-[56%] px-6 py-6 font-serif">
              <span className="inline-flex rounded bg-[#355f43] px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-[#fffdf5]">社区精选合集</span>
              <h2 className="mt-4 text-[28px] font-semibold tracking-[0.08em] text-[#2b2721]">期末冲刺 · 高分必备</h2>
              <p className="mt-2 text-sm leading-6 tracking-[0.08em] text-[#5e5549]">来自学长学姐的精选资源，助你高效复习，稳步提升。</p>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2" aria-hidden>
              <span className="size-2 rounded-full bg-[#3f6b4c]" /><span className="size-2 rounded-full bg-[#b9ad98]" /><span className="size-2 rounded-full bg-[#b9ad98]" /><span className="size-2 rounded-full bg-[#b9ad98]" />
            </div>
          </div>

          {loading ? (
            <div className="mt-6 grid min-h-72 place-items-center border-y border-[#d8cbb8] font-serif text-sm text-[#806d57]">正在读取学习市场…</div>
          ) : orderedListings.length === 0 ? (
            <div className="mt-6 grid min-h-72 place-items-center rounded-md border border-dashed border-[#cdb99a] bg-[#fbf8f0] px-6 text-center">
              <div><Store className="mx-auto size-9 text-[#9b6a31]" /><h3 className="mt-3 font-serif text-lg font-semibold">市场里还没有匹配的分享</h3><p className="mt-2 text-sm leading-6 text-[#806d57]">发布资源中心里的优质资料或学习路径，成为第一个分享者。</p><button type="button" onClick={() => setPublishOpen(true)} className="mt-5 rounded-md bg-[#b83b2d] px-4 py-2 font-serif text-sm text-white">发布第一份资源</button></div>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              {orderedListings.map((listing) => {
                const active = selected?.id === listing.id;
                return <article
                  key={listing.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  onClick={() => setSelectedId(listing.id)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(listing.id); }}
                  className={cn("group relative cursor-pointer rounded-md border bg-[#fbf8f0] p-3 shadow-[0_5px_18px_rgba(72,51,28,0.05)] outline-none transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(72,51,28,0.10)] focus-visible:ring-2 focus-visible:ring-[#a64132]", active ? "border-[#c14a34] ring-1 ring-[#c14a34]/20" : "border-[#d6c9b6]")}
                >
                  {active && <span className="absolute -right-2 -top-2 z-20 grid size-7 place-items-center rounded-full bg-[#b83b2d] text-white shadow"><CheckCircle2 className="size-[18px]" /></span>}
                  <div className="relative aspect-[1.64/1] overflow-hidden rounded-sm border border-[#d8cbb8] bg-[#ece2d2]">
                    <Image src={MARKET_COVERS[listing.kind]} alt="" fill sizes="(min-width: 1536px) 290px, 42vw" className="object-cover transition duration-300 group-hover:scale-[1.02]" />
                    <span className={cn("absolute left-2 top-2 rounded px-2.5 py-1 font-serif text-xs font-semibold tracking-[0.08em] text-white", listing.kind === "learning_path" ? "bg-[#476b4e]" : listing.kind === "agent" ? "bg-[#b83b2d]" : listing.kind === "bundle" ? "bg-[#a75325]" : "bg-[#b28731]")}>{KIND_LABEL[listing.kind]}</span>
                  </div>
                  <div className="px-1 pb-1 pt-3">
                    <div className="flex items-center gap-2 text-xs text-[#655a4d]">
                      <Image src="/brand/xueshu-app-icon.png" alt="" width={28} height={28} className="size-7 rounded-full border border-[#d2c4af] object-cover" />
                      <span>{listing.author_name}</span><ShieldCheck className="size-3.5 fill-[#2f7047] text-[#2f7047]" /><span className="text-[#2f7047]">已验证</span>
                    </div>
                    <h3 className="mt-3 line-clamp-2 font-serif text-[19px] font-semibold leading-7 tracking-[0.03em] text-[#27231e]">{listing.title}</h3>
                    <div className="mt-2 flex items-center gap-5 text-xs text-[#665c50]"><span className="inline-flex items-center gap-1.5"><BookOpen className="size-3.5" />{listingCountLabel(listing)}</span></div>
                    <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-[#736758]">{listing.description || "发布者暂未填写说明。"}</p>
                    <div className="mt-4 flex items-center justify-between border-t border-[#e2d7c6] pt-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#695e51]"><Bookmark className="size-4" />{formatSaves(listing.saves)} 人保存</span>
                      <button type="button" onClick={(event) => { event.stopPropagation(); void addListing(listing); }} disabled={listing.already_imported || importingId === listing.id} className={cn("rounded-md border px-3 py-2 font-serif text-xs font-semibold", listing.already_imported ? "border-[#9ca98b] bg-[#edf0e6] text-[#607049]" : listing.kind === "learning_path" ? "border-[#45694d] text-[#355f43] hover:bg-[#edf2e9]" : listing.kind === "agent" ? "border-[#c05a45] text-[#b33427] hover:bg-[#fff0e8]" : "border-[#b9802f] text-[#9b5c1e] hover:bg-[#f6ebdb]")}>{listing.already_imported ? "已添加" : importingId === listing.id ? "添加中…" : importActionLabel(listing.kind)}</button>
                    </div>
                  </div>
                </article>;
              })}
            </div>
          )}
        </section>

        <aside className="desktop-market-detail min-w-0 border-l border-[#d7cbb9] bg-[#fbf8f0] px-6 py-7 shadow-[-8px_0_26px_rgba(72,51,28,0.035)]">
          {selected ? <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex rounded-md border border-[#c65a32] px-2.5 py-1 font-serif text-xs font-semibold tracking-[0.08em] text-[#a84528]">{KIND_LABEL[selected.kind]}</span>
                <h2 className="mt-4 font-serif text-[27px] font-semibold leading-9 tracking-[0.06em] text-[#27231e]">{selected.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedId("")} aria-label="关闭资源详情" className="grid size-9 shrink-0 place-items-center rounded-full text-[#665c50] hover:bg-[#eee5d6]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 flex items-center gap-2 text-sm text-[#655a4d]">
              <Image src="/brand/xueshu-app-icon.png" alt="" width={36} height={36} className="size-9 rounded-full border border-[#d2c4af] object-cover" />
              <span>{selected.author_name}</span><ShieldCheck className="size-4 fill-[#2f7047] text-[#2f7047]" /><span className="text-xs text-[#2f7047]">已验证</span>
            </div>
            <div className="mt-4 flex items-center gap-6 text-sm text-[#665c50]"><span className="inline-flex items-center gap-2"><FileText className="size-4" />{listingCountLabel(selected)}</span><span className="inline-flex items-center gap-2"><Bookmark className="size-4" />{formatSaves(selected.saves)} 人保存</span></div>
            <p className="mt-4 text-sm leading-7 text-[#655a4d]">{selected.description || "这份分享还没有补充说明。"}</p>

            {selected.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selected.tags.map((tag) => <span key={tag} className="rounded-full border border-[#d5c2a5] px-2.5 py-1 text-[11px] text-[#72563a]">#{tag}</span>)}</div>}

            <button type="button" onClick={() => void addListing(selected)} disabled={selected.already_imported || importingId === selected.id} className={cn("mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border font-serif text-[15px] font-semibold tracking-[0.08em]", selected.already_imported ? "border-[#9ca98b] bg-[#edf0e6] text-[#607049]" : "border-[#b83b2d] text-[#b33427] hover:bg-[#fff0e8]")}>{selected.already_imported ? <><CheckCircle2 className="size-4" />已经添加</> : <><Download className="size-4" />{importActionLabel(selected.kind)}</>}</button>

            <div className="mt-5 border-t border-[#d9cebd] pt-5">
              <h3 className="font-serif text-sm font-semibold tracking-[0.08em] text-[#5d5346]">{selected.kind === "agent" ? "智能体职责与产出" : "包含的内容"}（{selected.item_count}）</h3>
              <div className="mt-4 space-y-3">
                {(selected.preview_items.length > 0 ? selected.preview_items : [{ type: selected.kind === "learning_path" ? "learning_path" : "reading", title: selected.title }]).slice(0, 5).map((item, index) => (
                  <div key={`${item.title}-${index}`} className="flex items-center gap-3 rounded-md border border-[#d8cbb8] bg-[#fffdf7] px-3 py-3">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded text-white", item.type === "practice" ? "bg-[#b45b20]" : item.type === "coding" ? "bg-[#315f7a]" : item.type === "learning_path" ? "bg-[#476b4e]" : selected.kind === "agent" ? "bg-[#b83b2d]" : "bg-[#a6362d]")}>{selected.kind === "agent" ? <Bot className="size-[18px]" /> : <FileText className="size-[18px]" />}</span>
                    <span className="min-w-0 flex-1"><strong className="block truncate font-serif text-sm font-semibold text-[#3b342b]">{item.title}</strong><small className="mt-1 block text-[11px] text-[#8a7d6c]">{selected.kind === "agent" ? `自建智能体 · 产出${MATERIAL_TYPE_LABEL[item.type] ?? String(item.type)}` : "社区精选内容"}</small></span>
                    <span className="text-[11px] text-[#8a7d6c]">{TYPE_LABELS[item.type] || String(item.type).toUpperCase()}</span>
                  </div>
                ))}
              </div>
              {selected.kind === "agent" && <p className="mt-4 rounded-md border border-[#e0d2bd] bg-[#fdf7ec] px-3 py-3 text-xs leading-6 text-[#6f5c45]">导入后会在「我的智能体」里新建一份副本；在可编辑计划里把任务指派给它，它就用自己的提示词产出上面这种类型的资料。</p>}
              <div className="mt-4 flex items-center justify-center gap-2 font-serif text-sm text-[#655a4d]">{selected.kind === "learning_path" ? "查看完整学习路径" : selected.kind === "agent" ? "查看智能体职责说明" : `查看全部 ${selected.item_count} 份资料`}<ChevronDown className="size-4" /></div>
            </div>

            {selected.kind === "learning_path" && selected.already_imported && <Link href="/path" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#355f43] px-4 py-3 font-serif text-sm font-semibold text-white">打开已添加的学习路径</Link>}
          </> : <div className="grid min-h-[70vh] place-items-center text-center"><div><Box className="mx-auto size-9 text-[#9b6a31]" /><p className="mt-3 font-serif text-sm text-[#806d57]">选择一份分享查看详情</p></div></div>}
        </aside>
      </div>

      <MarketPublishDialog open={publishOpen} resources={resources} onClose={() => setPublishOpen(false)} onPublished={(listing) => { setListings((current) => [listing, ...current]); setSelectedId(listing.id); setFeedback(`《${listing.title}》已发布到学习市场。`); }} />
      </div>
    </main>
  );
}
