"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import s from "./desktop-kb.module.css";
import { ShellLink as Link } from "@/components/shell-link";
import {
  AlertCircle,
  BookOpen,
  Lightbulb,
  Search,
  Settings,
  Check,
  Database,
  Download,
  FileText,
  Globe,
  GraduationCap,
  Loader2,
  Library,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
import {
  autoImport,
  kbSearch,
  recommendBooks,
  recommendEditions,
  webImport,
  webSearch,
  type BookEdition,
  type KbHit,
  type RecommendedBook,
  type WebResult,
} from "@/lib/api";
import { getUserSettings, onUserSettingsChange } from "@/lib/user-settings";
import { cn } from "@/lib/utils";
import { KB_DOCS } from "@/lib/knowledge-catalog";
import { DesktopBookshelf } from "@/components/desktop/desktop-bookshelf";
import { ResourceCenterBackButton } from "@/components/desktop/resource-center-back-button";
import { readBookshelf, shelfBookFromResult, writeBookshelf, type ShelfBook } from "@/lib/bookshelf";

/**
 * 桌面专属「课程知识库」——完全独立于 web 的 /kb（自有布局，不用 web-route-frame）。
 * 所有子组件均为本文件内部副本；仅共用数据层 lib/api、lib/user-settings 与 Button。
 */

function DocList() {
  const total = KB_DOCS.reduce((sum, doc) => sum + doc.chunks, 0);
  return <section className={`${s.panel} ${s.documents}`} aria-labelledby="kb-documents-title">
    <div className={s.sectionHeading}><BookOpen /><h2 id="kb-documents-title">《数据结构》文档集</h2><span className={s.count}>{KB_DOCS.length} 篇 · {total} 片段</span></div>
    <ul className={s.documentList}>{KB_DOCS.map(doc => <li key={doc.name}><FileText /><span title={doc.name}>{doc.name}</span><small>{doc.chunks} 片段</small></li>)}</ul>
    <p className={s.catalogNote}><Database />云模型嵌入 · 重排序检索，为学习资源提供相关知识片段</p>
  </section>;
}

function EditionCard({
  b,
  status,
  onPick,
}: {
  b: BookEdition;
  status: ImportState;
  onPick: (b: BookEdition) => void;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-2.5", b.recommended && "border-primary/40")}>
      <div className="flex gap-2.5">
        <BookCover title={b.title} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold" title={b.title}>
              《{b.title}》
            </span>
            {b.recommended && (
              <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                最推荐
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {b.author && <span className="truncate">{b.author}</span>}
            {b.edition && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">
                {b.edition}
              </span>
            )}
            {b.publisher && <span className="truncate">{b.publisher}</span>}
          </div>
          {b.note && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {b.note}
            </p>
          )}
          <div className="mt-auto flex items-center justify-end pt-1.5">
            <ImportStatus status={status} label="下载这一版" onImport={() => onPick(b)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BookEditionAsk({ subject }: { subject: string }) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [editions, setEditions] = useState<BookEdition[]>([]);
  const [status, setStatus] = useState<Record<string, ImportState>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    setState("loading");
    setStatus({});
    recommendEditions(subject)
      .then((e) => {
        if (!on) return;
        setEditions(e);
        setState("done");
      })
      .catch((e) => {
        if (!on) return;
        setErr(e instanceof Error ? e.message : "版本推荐失败");
        setState("error");
      });
    return () => {
      on = false;
    };
  }, [subject]);

  const pick = async (b: BookEdition) => {
    setStatus((s) => ({ ...s, [b.title]: "loading" }));
    try {
      const q = [b.title, b.author, b.edition].filter(Boolean).join(" ");
      const res = await autoImport(q, b.title);
      setStatus((s) => ({ ...s, [b.title]: { imported: res.imported } }));
    } catch (e) {
      setStatus((s) => ({
        ...s,
        [b.title]: { error: e instanceof Error ? e.message : "未找到资料" },
      }));
    }
  };

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/[0.05] p-3.5">
      <div className="flex items-start gap-1.5 text-[12px] leading-relaxed">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>
          可以为「<b>{subject}</b>」补充相关教材，看看下面有哪些合适的版本。
          <b>要下载哪一版？</b>
        </span>
      </div>

      {state === "loading" && (
        <p className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-5 font-mono text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          正在为「{subject}」匹配教材版本…
        </p>
      )}

      {state === "error" && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] text-danger">
          <AlertCircle className="size-3.5 shrink-0" />
          需要后端在线（在线模式）才能荐书选版本。{err}
        </p>
      )}

      {state === "done" && editions.length > 0 && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {editions.map((b) => (
            <EditionCard key={b.title} b={b} status={status[b.title]} onPick={pick} />
          ))}
        </div>
      )}

      {state === "done" && editions.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-5 text-center text-[11px] text-muted-foreground">
          没找到该科目的版本，换个更具体的科目名试试（如「操作系统」「线性代数」）
        </p>
      )}
    </div>
  );
}

function SearchDemo() {
  const [query, setQuery] = useDesktopModuleStringState<string>("resources", "knowledge.search", "");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [hits, setHits] = useState<KbHit[]>([]);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [findEditions, setFindEditions] = useState(false);
  const run = async (value = query) => {
    const q = value.trim();
    if (!q || state === "loading") return;
    setQuery(q); setState("loading"); setHits([]); setError(""); setSubject(q); setFindEditions(false);
    try { setHits(await kbSearch(q)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "检索暂时不可用，请稍后重试。"); }
    setState("done");
  };
  return <section className={`${s.panel} ${s.retrieval}`} aria-labelledby="kb-retrieval-title">
    <div className={s.sectionHeading}><Lightbulb /><h2 id="kb-retrieval-title">检索示例</h2></div>
    <p className={s.description}>试着搜索一个知识点，看看知识库中有哪些内容可以帮助你。</p>
    <form className={s.searchRow} onSubmit={event => { event.preventDefault(); void run(); }}>
      <label className={s.searchInput}><Search /><input aria-label="检索知识库" value={query} onChange={event => setQuery(event.target.value)} placeholder="试试：动态规划 / 操作系统" /></label>
      <button className={s.searchButton} disabled={!query.trim() || state === "loading"}>{state === "loading" ? <Loader2 className="animate-spin" /> : <Search />}搜索</button>
    </form>
    <div className={s.hotSearch}><span>示例：</span>{["时间复杂度", "二叉树遍历", "哈希表", "动态规划", "文件系统", "进程调度"].map(word => <button type="button" key={word} disabled={state === "loading"} onClick={() => void run(word)}>{word}</button>)}</div>
    <div className={s.searchResults} aria-live="polite" aria-busy={state === "loading"}>
      {state === "idle" && <div className={s.retrievalEmpty}><Image src="/brand/knowledge/retrieval-book-v1.webp" fill sizes="(max-width: 900px) 100vw, 50vw" alt="" /><div><strong>输入主题后回车，查看真实的 RAG 命中过程</strong><p>AI 将检索你的知识库，返回相关片段</p></div></div>}
      {state === "loading" && <div className={s.loading}><Loader2 className="animate-spin" /><span>正在检索并重排序相关内容…</span></div>}
      {error && <p className={s.error} role="alert"><AlertCircle />{error}</p>}
      {state === "done" && !error && hits.length === 0 && <div className={s.noResults}><p>暂时没有找到“{subject}”的相关片段，可以补充教材后再试。</p><button type="button" onClick={() => setFindEditions(true)} disabled={findEditions}>帮我找相关教材</button>{findEditions && <BookEditionAsk subject={subject} />}</div>}
      {state === "done" && !error && hits.map((hit, index) => <motion.article key={`${hit.doc}-${index}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }} className={s.hit}>
        <header><FileText /><h3>{hit.doc}</h3>{hit.score !== null && <span title="相关度分数，不表示回答正确率">相关度 {hit.score.toFixed(2)}</span>}</header>
        {hit.section && <h4>{hit.section}</h4>}<p>{hit.text}</p>
      </motion.article>)}
      {state === "done" && !error && hits.length > 0 && <p className={s.resultNote}>找到 {hits.length} 个相关片段，可用于补充生成内容的知识依据</p>}
    </div>
  </section>;
}

function BookCover({ title }: { title: string }) {
  return <div className={s.smallCover}><Image src="/brand/knowledge/textbook-cover-v1.webp" fill sizes="76px" alt="" /><span>{title.replace(/[_\-—|·（(].*$/, "").trim().slice(0, 12)}</span></div>;
}

type ImportState = "loading" | { imported: number } | { error: string } | undefined;

function ImportStatus({
  status,
  label,
  onImport,
}: {
  status: ImportState;
  label: string;
  onImport: () => void;
}) {
  if (status === "loading")
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {label}中…
      </span>
    );
  if (status && "imported" in status)
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-success">
        <Check className="size-3" />
        已入库 {status.imported} 片段
      </span>
    );
  if (status && "error" in status)
    return (
      <span className="flex items-center gap-1 text-[11px] text-danger" title={status.error}>
        <AlertCircle className="size-3" />
        {status.error.length > 14 ? status.error.slice(0, 14) + "…" : status.error}
      </span>
    );
  return (
    <Button size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px]" onClick={onImport}>
      <Download className="size-3" />
      {label}
    </Button>
  );
}

function RecBookCard({
  b,
  status,
  onImport,
}: {
  b: RecommendedBook;
  status: ImportState;
  onImport: (b: RecommendedBook) => void;
}) {
  return (
    <div className="flex gap-3 rounded-xl border bg-card p-3">
      <BookCover title={b.title} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold" title={b.title}>
          《{b.title}》
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {b.author && <span className="truncate">{b.author}</span>}
          {b.course && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">
              {b.course}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
          {b.reason}
        </p>
        <div className="mt-auto flex items-center justify-end pt-1.5">
          <ImportStatus status={status} label="找资料并入库" onImport={() => onImport(b)} />
        </div>
      </div>
    </div>
  );
}

function SmartRecommend() {
  const [major, setMajor] = useState("");
  const [grade, setGrade] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [books, setBooks] = useState<RecommendedBook[]>([]);
  const [status, setStatus] = useState<Record<string, ImportState>>({});
  const [err, setErr] = useState("");
  const [allRunning, setAllRunning] = useState(false);

  useEffect(() => {
    const sync = () => {
      const s = getUserSettings();
      setMajor(s.major);
      setGrade(s.grade);
    };
    sync();
    return onUserSettingsChange(sync);
  }, []);

  const run = async () => {
    if (!major.trim() || state === "loading") return;
    setState("loading");
    setErr("");
    setBooks([]);
    setStatus({});
    try {
      setBooks(await recommendBooks(major.trim(), grade || "大二"));
    } catch {
      setErr("智能荐书需要后端在线（在线模式）。请确认后端已启动且联网。");
    }
    setState("done");
  };

  const importOne = async (b: RecommendedBook) => {
    setStatus((s) => ({ ...s, [b.title]: "loading" }));
    try {
      const res = await autoImport(`${b.title} ${b.author}`.trim(), b.title);
      setStatus((s) => ({ ...s, [b.title]: { imported: res.imported } }));
    } catch (e) {
      setStatus((s) => ({
        ...s,
        [b.title]: { error: e instanceof Error ? e.message : "未找到资料" },
      }));
    }
  };

  const importAll = async () => {
    if (allRunning) return;
    setAllRunning(true);
    for (const b of books) {
      const st = status[b.title];
      if (st && typeof st === "object" && "imported" in st) continue;
      await importOne(b);
    }
    setAllRunning(false);
  };

  const doneCount = books.filter((b) => {
    const st = status[b.title];
    return st !== undefined && typeof st === "object" && "imported" in st;
  }).length;

  return (
    <section className={`${s.panel} ${s.recommendation}`} aria-label="智能荐书">
      <div className={s.sectionHeading}><GraduationCap /><h2>智能荐书</h2><p>根据你的专业与年级推荐相关教材，一键找资料入库</p></div>

      <div className={s.recommendActions}>
        {major ? (
          <>
            <span className={s.profileChip}>
              <GraduationCap className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{major}</span>
              <span className="text-muted-foreground">·</span>
              <span>{grade || "大二"}</span>
            </span>
            <Link href="/settings" className={s.settingsLink}>
              <Settings size={18} />去设置 ›
            </Link>
            <Button
              size="sm"
              className={s.generateBooks}
              onClick={run}
              disabled={state === "loading"}
            >
              {state === "loading" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              生成书单
            </Button>
          </>
        ) : (
          <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-[12px] text-muted-foreground">
            还没填学情。
            <Link href="/settings" className="text-primary hover:underline">
              去「设置」填写专业 / 年级 →
            </Link>
          </p>
        )}
      </div>

      {err && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] text-danger">
          <AlertCircle className="size-3.5 shrink-0" />
          {err}
        </p>
      )}

      {state === "loading" && (
        <p className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-6 font-mono text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          正在按学情推荐核心教材…
        </p>
      )}

      {state === "done" && books.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              共 {books.length} 本 · 已入库 {doneCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 gap-1 px-2.5 text-[11px]"
              onClick={importAll}
              disabled={allRunning || doneCount === books.length}
            >
              {allRunning ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  全部导入中 {doneCount}/{books.length}
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  一键导入全部
                </>
              )}
            </Button>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {books.map((b) => (
              <RecBookCard key={b.title} b={b} status={status[b.title]} onImport={importOne} />
            ))}
          </div>
        </>
      )}

      {state === "done" && books.length === 0 && !err && (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
          没生成书单，换个专业/年级再试
        </p>
      )}

      {state === "idle" && major && (
        <p className={s.recommendEmpty}>点击「生成书单」，AI 为你列出适合当前阶段的教材</p>
      )}
    </section>
  );
}

function WebResultCard({
  r,
  status,
  onImport,
  onAdd,
  inShelf,
}: {
  r: WebResult;
  status: ImportState;
  onImport: (r: WebResult) => void;
  onAdd: (r: WebResult) => void;
  inShelf: boolean;
}) {
  let host = r.site;
  try {
    if (!host) host = new URL(r.url).hostname;
  } catch {
    /* ignore */
  }
  return (
    <div className="flex gap-3 rounded-xl border bg-card p-3">
      <BookCover title={r.title} />
      <div className="flex min-w-0 flex-1 flex-col">
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-[13px] font-semibold hover:underline"
          title={r.title}
        >
          {r.title}
        </a>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Globe className="size-3 shrink-0" />
          <span className="truncate">{host}</span>
          {r.date && <span className="ml-auto shrink-0 font-mono tabular-nums">{r.date}</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
          {r.summary || r.snippet}
        </p>
        <div className="mt-auto flex items-center justify-end gap-2 pt-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={inShelf} onClick={() => onAdd(r)}>
            {inShelf ? <Check className="size-3" /> : <Library className="size-3" />}
            {inShelf ? "已在书架" : "加入书架"}
          </Button>
          <ImportStatus status={status} label="下载嵌入" onImport={() => onImport(r)} />
        </div>
      </div>
    </div>
  );
}

function WebFind({ onAddBook, shelfUrls }: { onAddBook: (result: WebResult) => void; shelfUrls: Set<string> }) {
  const [query, setQuery] = useDesktopModuleStringState<string>(
    "resources",
    "knowledge.webQuery",
    ""
  );
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [results, setResults] = useState<WebResult[]>([]);
  const [status, setStatus] = useState<Record<string, ImportState>>({});
  const [err, setErr] = useState("");

  const run = async (value = query) => {
    const q = value.trim();
    if (!q || state === "loading") return;
    setQuery(q);
    setState("loading");
    setErr("");
    setResults([]);
    setStatus({});
    try {
      const r = await webSearch(q);
      setResults(r);
    } catch (error) {
      const message = error instanceof Error ? error.message : "联网搜索失败，请稍后重试。";
      setErr(message.includes("BOCHA_API_KEY") ? "联网搜索暂未启用，请先配置联网搜索服务。" : message);
    }
    setState("done");
  };

  const importOne = async (r: WebResult) => {
    setStatus((s) => ({ ...s, [r.url]: "loading" }));
    try {
      const res = await webImport(r.url, r.title);
      setStatus((s) => ({ ...s, [r.url]: { imported: res.imported } }));
    } catch (e) {
      setStatus((s) => ({
        ...s,
        [r.url]: { error: e instanceof Error ? e.message : "导入失败" },
      }));
    }
  };

  return (
    <section className={`${s.panel} ${s.webFind}`} aria-label="联网找教材">
      <div className={s.sectionHeading}><Database /><h2>联网找教材</h2><p>搜索教材与学习资料，保存书籍或将正文导入知识库</p><span className={s.scope}>网页与书籍 · 不限语言</span></div>
      <form className={s.searchRow} onSubmit={event => { event.preventDefault(); void run(); }}>
        <label className={s.searchInput}><Search /><input aria-label="搜索教材与资料" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索教材 / 资料，如：红黑树 原理 详解" /></label>
        <button className={s.searchButton} disabled={!query.trim() || state === "loading"}>{state === "loading" ? <Loader2 className="animate-spin" /> : <Search />}搜索</button>
      </form>
      <div className={s.hotSearch}><span>热门搜索：</span>{["数据结构", "操作系统", "计算机网络", "软件工程", "人工智能", "机器学习"].map(word => <button type="button" key={word} disabled={state === "loading"} onClick={() => void run(word)}>{word}</button>)}</div>

      {err && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] text-danger">
          <AlertCircle className="size-3.5 shrink-0" />
          {err}
        </p>
      )}

      {state === "loading" && (
        <p className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-6 font-mono text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          联网检索中…
        </p>
      )}

      {state === "done" && results.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {results.map((r) => (
            <WebResultCard key={r.id} r={r} status={status[r.url]} onImport={importOne} onAdd={onAddBook} inShelf={shelfUrls.has(r.url)} />
          ))}
        </div>
      )}

      {state === "done" && results.length === 0 && !err && (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
          没找到结果，换个关键词试试
        </p>
      )}

    </section>
  );
}

export default function DesktopKb() {
  const [books, setBooks] = useState<ShelfBook[]>([]);

  useEffect(() => setBooks(readBookshelf()), []);

  const updateBooks = (next: ShelfBook[]) => {
    setBooks(next);
    writeBookshelf(next);
  };

  const addBook = (result: WebResult) => {
    if (books.some((book) => book.url === result.url)) return;
    updateBooks([shelfBookFromResult(result), ...books]);
  };

  return (
    <div className={`${s.page} thin-scroll`}>
      <div className={s.frame}>
        <header className={s.pageHeader}>
          <ResourceCenterBackButton />
          <div><h1>课程知识库</h1><p>整合课程相关知识，让学习资源的生成有据可循</p></div>
          <p className={s.verse}>博学而笃志<br />切问而近思</p>
        </header>
        <DesktopBookshelf books={books} onChange={updateBooks} />
        <SmartRecommend />
        <WebFind onAddBook={addBook} shelfUrls={new Set(books.map((book) => book.url))} />
        <div className={s.bottomGrid}><DocList /><SearchDemo /></div>
        <footer className={s.pageFooter}><span>格物致知 · 知行合一</span><span>以知识为舟，赴求索之旅</span></footer>
      </div>
    </div>
  );
}
