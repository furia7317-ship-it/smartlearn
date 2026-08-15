"use client";

import { useEffect, useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import {
  AlertCircle,
  BookText,
  Check,
  Database,
  Download,
  FileText,
  Globe,
  GraduationCap,
  Loader2,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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

function DocList() {
  const total = KB_DOCS.reduce((s, d) => s + d.chunks, 0);
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">《数据结构》文档集</h2>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {KB_DOCS.length} 篇 · {total} 片段
        </span>
      </div>
      <div className="mt-2 divide-y divide-border/70">
        {KB_DOCS.map((d) => (
          <div key={d.name} className="flex items-center gap-2.5 py-2">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{d.name}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {d.chunks} 片段
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Database className="size-3" />
        全部已向量化（ChromaDB）。生成内容必须引用本库片段。
      </p>
    </section>
  );
}

/** 最相关命中分数低于此值，视为知识库里没有这门科目（分数 = 1 - 余弦距离/2） */
const KB_RELEVANCE = 0.71;

/* ── 知识库未命中 → 询问下载哪一版教材（类 Claude 单选 ask） ── */

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
    <div
      className={cn(
        "rounded-lg border bg-card p-2.5",
        b.recommended && "border-primary/40"
      )}
    >
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
          知识库里还没有「<b>{subject}</b>」的教材。我帮你找了几个主流版本，
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
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [hits, setHits] = useState<KbHit[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);
  const [subject, setSubject] = useState("");

  const run = async () => {
    const q = query.trim();
    if (!q || state === "loading") return;
    setState("loading");
    setHits([]);
    setNotFound(false);
    setOffline(false);
    try {
      const results = await kbSearch(q);
      // RAG 总会返回 top-k 最近邻，所以"没这门科目"要看相关度而非条数：
      // 最相关命中低于阈值（≈ 余弦距离 0.58）即视为知识库里没有该科目。
      const best = results.reduce((m, h) => Math.max(m, h.score ?? 0), 0);
      if (results.length && best >= KB_RELEVANCE) {
        setHits(results);
      } else {
        // 后端在线但知识库没有这门科目 → 询问下载哪一版教材
        setSubject(q);
        setNotFound(true);
      }
    } catch {
      setOffline(true);
    }
    setState("done");
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">检索示例</h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        智能体生成资源前的第一步：语义检索知识库；没有的科目会帮你找教材并询问下哪一版
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="试试：动态规划 / 操作系统"
          className="h-9 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button size="sm" className="h-9 gap-1.5 px-3.5" onClick={run} disabled={state === "loading"}>
          {state === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ScanSearch className="size-3.5" />
          )}
          检索
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {state === "idle" && (
          <p className="rounded-lg border border-dashed px-3 py-5 text-center text-[11px] text-muted-foreground">
            输入主题后回车，查看真实的 RAG 命中过程
          </p>
        )}
        {state === "loading" && (
          <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-5 font-mono text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            向量检索中 · top_k=5 · 阈值 0.75
          </p>
        )}

        {state === "done" && notFound && <BookEditionAsk subject={subject} />}

        {state === "done" && offline && (
          <p className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-[11px] text-muted-foreground">
            <AlertCircle className="size-3.5 shrink-0" />
            后端未连接，无法实时检索。请确认后端已启动（在线模式）后重试。
          </p>
        )}

        {state === "done" &&
          !notFound &&
          !offline &&
          hits.map((h, i) => (
            <motion.div
              key={`${h.doc}-${h.section}-${i}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-lg border bg-surface-2/60 px-3.5 py-2.5"
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-mono text-xs font-medium">{h.doc}</span>
                {h.section && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">{h.section}</span>
                )}
                {h.score !== null && (
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-success">
                    {h.score.toFixed(2)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                {h.text}
              </p>
            </motion.div>
          ))}
        {state === "done" && !notFound && !offline && hits.length > 0 && (
          <p className="text-center text-[11px] text-muted-foreground">
            ChromaDB 实时命中 {hits.length} 个片段 → 注入生成上下文，正文以 [来源n] 角标引用
          </p>
        )}
      </div>
    </section>
  );
}

/* ── 书皮封面（按标题确定性取色） ── */

const COVERS: [string, string][] = [
  ["#3b4252", "#262b36"],
  ["#9a4b3f", "#7a3a30"],
  ["#52614b", "#3d4a38"],
  ["#8a6a3b", "#6a5029"],
  ["#3f5a6b", "#2e4452"],
  ["#574a6b", "#423854"],
];

function coverOf(s: string): [string, string] {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
}

function BookCover({ title }: { title: string }) {
  const [c1, c2] = coverOf(title);
  const short = title.replace(/[_\-—|·（(].*$/, "").trim().slice(0, 20) || title.slice(0, 20);
  return (
    <div
      className="relative h-[106px] w-[76px] shrink-0 overflow-hidden rounded-l-[3px] rounded-r-md shadow-md"
      style={{ background: `linear-gradient(140deg, ${c1}, ${c2})` }}
    >
      <span className="absolute inset-y-0 left-0 w-[5px] bg-black/25" />
      <span className="absolute inset-y-0 left-[5px] w-px bg-white/15" />
      <span
        className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10.5px] font-semibold leading-snug text-white/95"
        style={{ fontFamily: "var(--font-display, serif)" }}
      >
        <span className="line-clamp-4">{short}</span>
      </span>
    </div>
  );
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
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1 px-2.5 text-[11px]"
      onClick={onImport}
    >
      <Download className="size-3" />
      {label}
    </Button>
  );
}

/* ── 智能荐书（学情来自全局「设置」） ── */

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
      // 顺序执行，避免同时打爆博查 / 后端
      await importOne(b);
    }
    setAllRunning(false);
  };

  const doneCount = books.filter((b) => {
    const st = status[b.title];
    return st !== undefined && typeof st === "object" && "imported" in st;
  }).length;

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">智能荐书</h2>
        <span className="text-[11px] text-muted-foreground">
          按你的学情自动判别核心教材，一键找资料入库，不用一本本搜
        </span>
      </div>

      {/* 学情来自全局「设置」 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {major ? (
          <>
            <span className="flex items-center gap-1.5 rounded-lg border bg-surface-2/60 px-3 py-1.5 text-[12px]">
              <GraduationCap className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{major}</span>
              <span className="text-muted-foreground">·</span>
              <span>{grade || "大二"}</span>
            </span>
            <Link href="/settings" className="text-[11px] text-primary hover:underline">
              去设置改
            </Link>
            <Button
              size="sm"
              className="ml-auto h-9 gap-1.5 px-3.5"
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
        <p className="mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
          点「生成书单」，AI 一键列出该阶段核心教材
        </p>
      )}
    </section>
  );
}

/* ── 联网找教材 ── */

function WebResultCard({
  r,
  status,
  onImport,
}: {
  r: WebResult;
  status: ImportState;
  onImport: (r: WebResult) => void;
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
        <div className="mt-auto flex items-center justify-end pt-1.5">
          <ImportStatus status={status} label="下载嵌入" onImport={() => onImport(r)} />
        </div>
      </div>
    </div>
  );
}

function WebFind() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [results, setResults] = useState<WebResult[]>([]);
  const [status, setStatus] = useState<Record<string, ImportState>>({});
  const [err, setErr] = useState("");

  const run = async () => {
    if (!query.trim() || state === "loading") return;
    setState("loading");
    setErr("");
    setResults([]);
    setStatus({});
    try {
      const r = await webSearch(query.trim());
      setResults(r);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "联网搜索失败，请稍后重试。");
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
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <BookText className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">联网找教材</h2>
        <span className="text-[11px] text-muted-foreground">
          博查搜索（国内可达）→ 抓取正文 → 向量化进「我的资料」库
        </span>
        <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          web_kb · 不进精编库
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="搜教材 / 资料，如：红黑树 原理 详解"
          className="h-9 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button size="sm" className="h-9 gap-1.5 px-3.5" onClick={run} disabled={state === "loading"}>
          {state === "loading" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ScanSearch className="size-3.5" />
          )}
          搜索
        </Button>
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
          联网检索中…
        </p>
      )}

      {state === "done" && results.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {results.map((r) => (
            <WebResultCard key={r.id} r={r} status={status[r.url]} onImport={importOne} />
          ))}
        </div>
      )}

      {state === "done" && results.length === 0 && !err && (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
          没找到结果，换个关键词试试
        </p>
      )}

      {state === "idle" && (
        <p className="mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
          输入教材/资料关键词，搜索结果以书目卡片呈现，点「下载嵌入」即并入你的知识库
        </p>
      )}
    </section>
  );
}

export default function KbPage() {
  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="课程知识库"
          desc="系统输入的初始知识库 · 所有生成内容的事实校验依据"
        />
        <SmartRecommend />
        <WebFind />
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <DocList />
          <SearchDemo />
        </div>
      </div>
    </div>
  );
}
