"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, Check, ChevronRight, ClipboardCheck, History, LoaderCircle, LockKeyhole, Pause, Play, RefreshCw, Search } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import type { OrchestratorMode } from "@/hooks/use-orchestrator";
import { requestErrorMessage } from "@/lib/api-error";
import {
  preferredSkillVersion, skillDateLabel, skillValidationView, skillVersionActions,
  SKILL_RESOURCE_LABELS, SKILL_STATUS_LABELS,
  type SkillDetail, type SkillStatus, type SkillSummary, type SkillVersion,
} from "@/lib/procedure-skill-model";
import { procedureSkills } from "@/lib/procedure-skills";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: SkillStatus }) {
  return <span className={cn(
    "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
    status === "active" || status === "passed" ? "border-success/25 bg-success/10 text-success" :
      status === "rejected" ? "border-warning/30 bg-warning/10 text-foreground" : "border-border bg-surface-2 text-muted-foreground",
  )}>{SKILL_STATUS_LABELS[status]}</span>;
}

function MethodHeader() {
  return <div className="flex items-start gap-3">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><BookOpenCheck className="size-5" aria-hidden /></span>
    <div>
      <h2 className="text-base font-semibold">教学方法</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">查看智能教师积累的方法，检查后选择是否使用。</p>
    </div>
  </div>;
}

export function ProcedureSkillSettings({ mode }: { mode: OrchestratorMode }) {
  const { user, loading } = useAuth();
  if (loading || !user || mode !== "live") {
    return <section className="space-y-5 rounded-xl border bg-card p-5">
      <MethodHeader />
      <p className="rounded-lg bg-surface-2/50 p-4 text-sm text-muted-foreground" role="status">
        {loading ? "正在确认账户…" : !user ? "登录后可查看属于你的教学方法。" : "连接学习服务后，即可查看和管理教学方法。"}
      </p>
    </section>;
  }
  // Account changes unmount all selections, pending requests and personal content.
  return <ProcedureSkillWorkspace key={user.id} />;
}

function ProcedureSkillWorkspace() {
  const [items, setItems] = useState<SkillSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState<"evaluate" | "activate" | "disable" | "">("");
  const mutation = useRef<AbortController | null>(null);

  useEffect(() => () => mutation.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    void procedureSkills.list(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setItems(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setListError(requestErrorMessage(error, "暂时无法读取教学方法，请重试。"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    void procedureSkills.detail(selectedId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setDetail(next);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetailError(requestErrorMessage(error, "暂时无法读取方法详情，请重试。"));
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, revision]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return items.filter((item) =>
      (scope === "all" || (scope === "personal" ? !item.read_only : scope === "candidate" ? item.latest_version_status === "candidate" : item.read_only)) &&
      (!term || `${item.name} ${item.description} ${item.resource_types.map((type) => SKILL_RESOURCE_LABELS[type] ?? type).join(" ")}`.toLocaleLowerCase().includes(term)),
    );
  }, [items, query, scope]);
  const version = detail ? preferredSkillVersion(detail, versionId) : undefined;

  const runAction = async (action: "evaluate" | "activate" | "disable") => {
    if (!detail || !version || mutation.current || detail.read_only) return;
    const allowed = skillVersionActions(detail, version);
    if (!allowed[action]) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(action);
    setNotice("");
    setDetailError("");
    try {
      const next = action === "disable"
        ? await procedureSkills.disable(detail.id, controller.signal)
        : await procedureSkills[action](detail.id, version.id, controller.signal);
      if (controller.signal.aborted) return;
      setDetail(next);
      setItems((current) => current.map((item) => item.id === next.id ? next : item));
      const checked = next.versions.find((item) => item.id === version.id);
      setNotice(action === "evaluate"
        ? checked?.status === "passed" ? "方法检查已通过。你可以查看结果，再决定是否启用。" : "检查已结束，此版本暂未达到启用要求。请查看下方结果。"
        : action === "activate" ? `已启用第 ${version.version} 版，之后的新任务会按需使用。` : "已停用，之后的新任务不再使用此方法。已有任务保留原先使用的版本。");
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(requestErrorMessage(error, "操作未完成，请刷新查看最新状态。"));
    } finally {
      if (!controller.signal.aborted) setBusy("");
      if (mutation.current === controller) mutation.current = null;
    }
  };

  return <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-5" aria-busy={Boolean(busy)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <MethodHeader />
      <Button type="button" size="sm" variant="outline" onClick={() => { setRevision((value) => value + 1); setNotice(""); }} disabled={loading || Boolean(busy)}>
        <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />刷新
      </Button>
    </div>
    <div className="rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-3 text-xs leading-6 text-muted-foreground">
      新积累的方法会先保存为候选，经检查并启用后才会用于后续任务。个人方法仅用于你的学习。
      <span className="block">在「记忆与隐私」中关闭「启用长期记忆」，可暂停自动提炼；已有方法和手动管理仍可使用。</span>
      <strong className="block font-medium text-foreground">方法检查通过不代表教学收益已经得到验证，实际效果仍需结合后续练习与学习反馈判断。</strong>
    </div>
    <div className="flex flex-wrap gap-2">
      <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border px-3">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索方法或资料类型" aria-label="搜索教学方法" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <select aria-label="筛选教学方法" value={scope} onChange={(event) => setScope(event.target.value)} className="h-10 rounded-lg border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <option value="all">全部方法</option><option value="personal">我的方法</option><option value="candidate">待检查</option><option value="system">系统内置</option>
      </select>
    </div>
    {listError && <p role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">{listError}</p>}
    {loading && items.length === 0 ? <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden />正在读取教学方法…</p> :
      !items.length && !listError ? <div className="rounded-xl border border-dashed p-8 text-center"><BookOpenCheck className="mx-auto size-7 text-muted-foreground" aria-hidden /><h3 className="mt-3 text-sm font-medium">还没有教学方法</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">继续生成学习资料或进行错题辅导。遇到值得保留的经验时，智能教师会整理为候选方法。</p></div> :
      items.length > 0 && <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2" aria-label="教学方法列表">
          <p className="px-1 text-xs text-muted-foreground">共 {visible.length} 个方法</p>
          {!visible.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">没有匹配的方法，试试其他关键词。</p>}
          {visible.map((item) => <button key={item.id} type="button" disabled={Boolean(busy)} aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); setVersionId(""); setNotice(""); }} className={cn("w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait", selectedId === item.id ? "border-primary/40 bg-primary/[0.05]" : "hover:bg-accent/40")}>
            <span className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words text-sm font-medium">{item.name}</strong><ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden /></span>
            <span className="mt-2 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.description}</span>
            <span className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={item.status} /><span className="text-[11px] text-muted-foreground">{item.read_only ? "系统内置" : "我的方法"} · 第 {item.latest_version} 版</span></span>
            {item.active_version_id && item.latest_version_id !== item.active_version_id && <span className="mt-2 block text-[11px] text-muted-foreground">{item.disabled ? "停用前使用" : "当前使用"}第 {item.active_version} 版 · 新版本{SKILL_STATUS_LABELS[item.latest_version_status]}</span>}
          </button>)}
        </div>
        <div className="min-w-0 space-y-3" aria-label="教学方法详情">
          {detailError && <p role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">{detailError}</p>}
          {notice && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-6">{notice}</p>}
          {detailLoading ? <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden />正在读取方法详情…</p> : detail && version &&
            <MethodDetail skill={detail} version={version} busy={busy} onVersion={(id) => { setVersionId(id); setNotice(""); }} onAction={runAction} />}
        </div>
      </div>}
  </section>;
}

function MethodDetail({ skill, version, busy, onVersion, onAction }: {
  skill: SkillDetail; version: SkillVersion; busy: string;
  onVersion: (value: string) => void;
  onAction: (action: "evaluate" | "activate" | "disable") => Promise<void>;
}) {
  const actions = skillVersionActions(skill, version);
  return <article className="overflow-hidden rounded-xl border">
    <div className="space-y-4 border-b p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><h3 className="break-words text-base font-semibold">{version.definition.name}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{version.definition.description}</p></div>
        <StatusBadge status={actions.active ? "active" : version.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {version.definition.resource_types.map((type) => <span key={type} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted-foreground">{SKILL_RESOURCE_LABELS[type] ?? "学习资料"}</span>)}
        <span className="text-xs text-muted-foreground">{skill.read_only ? "系统内置" : "仅用于我的学习"}</span>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><History className="size-3.5" aria-hidden /><span>查看版本</span><select value={version.id} onChange={(event) => onVersion(event.target.value)} disabled={Boolean(busy)} aria-label="查看方法版本" className="h-9 min-w-0 max-w-full rounded-lg border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{skill.versions.map((item) => <option key={item.id} value={item.id}>第 {item.version} 版 · {SKILL_STATUS_LABELS[item.status]}{item.id === skill.active_version_id ? skill.disabled ? " · 已停用" : " · 使用中" : ""}</option>)}</select><span>{skillDateLabel(version.created_at)}</span></label>
      {skill.read_only ? <p className="flex items-center gap-2 rounded-lg bg-surface-2/50 p-3 text-xs text-muted-foreground"><LockKeyhole className="size-3.5 shrink-0" aria-hidden />系统内置方法可查看，个人账户不能修改。</p> :
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy) || !actions.evaluate} onClick={() => void onAction("evaluate")}>{busy === "evaluate" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <ClipboardCheck className="size-3.5" aria-hidden />}{busy === "evaluate" ? "正在检查…" : version.status === "candidate" ? "检查此版本" : "重新检查"}</Button>
            <Button type="button" size="sm" disabled={Boolean(busy) || !actions.activate} onClick={() => void onAction("activate")}>{busy === "activate" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}{actions.active ? "此版本已启用" : actions.activationLabel}</Button>
            {actions.disable && <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void onAction("disable")}>{busy === "disable" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}停用此方法</Button>}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{busy === "evaluate" ? "正在检查方法与示例任务，可能需要约一分钟。检查结束后仍需选择是否启用。" : version.status !== "passed" ? "此版本通过检查后才能启用；其他已启用版本继续保留。" : "启用、停用或切回旧版本均对之后的新任务生效。"}</p>
        </div>}
    </div>
    <div className="space-y-6 p-4 sm:p-5">
      <MethodList title="适用情况" values={version.definition.triggers} />
      <MethodList title="教学步骤" values={version.definition.steps} ordered />
      <MethodList title="完成时要确认" values={version.definition.checks} />
      <ValidationResult version={version} builtin={skill.read_only} />
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">{[
        { value: skill.usage_summary.total, label: "使用次数" },
        { value: skill.usage_summary.approved, label: "产出通过审核" },
        { value: skill.usage_summary.failed, label: "产出未通过审核" },
      ].map((item) => <div key={item.label} className="rounded-lg bg-surface-2/40 px-3 py-2.5"><strong className="text-lg font-semibold tabular-nums">{item.value}</strong><p className="mt-0.5 text-xs text-muted-foreground">{item.label}</p></div>)}</div>
      <p className="-mt-3 text-xs leading-5 text-muted-foreground">以上统计汇总该方法的所有版本，只反映任务执行情况。</p>
      <div className="border-t pt-4 text-xs leading-6 text-muted-foreground"><h4 className="font-medium text-foreground">方法来源</h4><p>{skill.read_only ? "系统预置的教学流程。" : version.source_run_id ? "根据学习任务中值得保留的经验整理。" : "在个人学习过程中提交的候选方法。"}</p>{version.source_run_id && <details className="mt-1"><summary className="cursor-pointer">查看来源记录编号</summary><p className="mt-1 break-all rounded-md bg-surface-2/50 px-2 py-1 font-mono text-[11px]">{version.source_run_id}</p></details>}</div>
    </div>
  </article>;
}

function MethodList({ title, values, ordered = false }: { title: string; values: string[]; ordered?: boolean }) {
  return <section><h4 className="text-sm font-semibold">{title}</h4><ol className="mt-3 space-y-3">{values.map((value, index) => <li key={`${index}:${value}`} className="flex items-start gap-3 text-sm leading-6"><span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px]", ordered ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground")}>{ordered ? index + 1 : <Check className="size-3" aria-hidden />}</span><span className="min-w-0 break-words">{value}</span></li>)}</ol></section>;
}

function ValidationResult({ version, builtin }: { version: SkillVersion; builtin: boolean }) {
  const result = skillValidationView(version.validation);
  if (builtin && version.validation.origin === "builtin") {
    const note = typeof version.validation.note === "string" ? version.validation.note.slice(0, 800) : "教学效果待实际学习数据验证。";
    return <section className="rounded-lg border bg-surface-2/20 p-3.5"><h4 className="text-sm font-semibold">内置方法说明</h4><p className="mt-2 text-xs leading-6 text-muted-foreground">此版本由系统预置和维护，未经过候选方法的独立案例评估。</p><p className="text-xs leading-6 text-muted-foreground">{note}</p></section>;
  }
  return <section className="rounded-lg border bg-surface-2/20 p-3.5">
    <div className="flex flex-wrap items-center gap-2"><ClipboardCheck className="size-4 text-primary" aria-hidden /><h4 className="text-sm font-semibold">方法检查结果</h4><StatusBadge status={version.status} /></div>
    <p className="mt-2 text-xs leading-6 text-muted-foreground">{result.summary || (version.status === "candidate" ? "尚未完成检查。检查会评估内容是否完整、是否遵守应用规则，以及能否用于示例任务。" : version.status === "passed" ? "此版本已达到方法检查要求。实际教学效果仍待后续学习数据验证。" : "此版本未达到方法检查要求，暂时不能启用。")}</p>
    {result.unavailable && <p className="mt-2 text-xs leading-6 text-muted-foreground">检查服务暂不可用，此版本保持未启用。服务恢复后可重新检查。</p>}
    {(result.checks.length > 0 || result.cases.length > 0) && <div className="mt-3 space-y-2">
      {result.checks.map((check, index) => <div key={`${check.id}:${index}`} className="text-xs leading-6"><span className={cn("mr-2 font-medium", check.passed ? "text-success" : "text-warning")}>{check.passed ? "通过" : "未通过"}</span><span>{check.label}</span>{check.detail && <p className="text-muted-foreground">{check.detail}</p>}</div>)}
      {result.cases.map((scenario, index) => <details key={`${scenario.id}:${index}`} className="rounded-md border bg-card px-3 py-2 text-xs leading-6"><summary className="cursor-pointer"><span className={cn("mr-2 font-medium", scenario.passed ? "text-success" : "text-warning")}>{scenario.passed ? "通过" : "未通过"}</span>{scenario.title}</summary><ul className="mt-2 space-y-2">{scenario.checks.map((check, checkIndex) => <li key={`${check.id}:${checkIndex}`}><span className="font-medium">{check.label} · {check.passed ? "通过" : "未通过"}</span>{check.detail && <p className="text-muted-foreground">{check.detail}</p>}</li>)}</ul></details>)}
    </div>}
    {result.limitations.length > 0 && <ul className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">{result.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul>}
    {result.evaluatedAt && <p className="mt-3 text-[11px] text-muted-foreground">检查时间：{skillDateLabel(result.evaluatedAt)}</p>}
  </section>;
}
