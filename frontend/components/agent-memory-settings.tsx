"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Download,
  LoaderCircle,
  Power,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLearnerPreferences } from "@/hooks/use-learner-preferences";
import type { OrchestratorMode } from "@/hooks/use-orchestrator";
import {
  clearLongTermAgentMemory,
  forgetSemanticMemoryFact,
  listMemoryEpisodes,
  listSemanticMemoryFacts,
  type MemoryEpisode,
  type SemanticMemoryFact,
} from "@/lib/agent-memory";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  identity: "学习身份",
  preference: "学习偏好",
  pace: "学习节奏",
  goal: "学习目标",
  weakness: "薄弱点",
};

function factText(fact: SemanticMemoryFact): string {
  const statement = fact.value?.statement;
  if (typeof statement === "string" && statement.trim()) return statement.trim();
  return Object.entries(fact.value || {})
    .map(([key, value]) => `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("；") || fact.evidence || fact.key;
}

function episodeDate(episode: MemoryEpisode): string {
  if (episode.occurred_at > 0) return new Date(episode.occurred_at).toLocaleDateString("zh-CN");
  return "较早对话";
}

function lastUpdatedLabel(facts: SemanticMemoryFact[], episodes: MemoryEpisode[]): string {
  const timestamps = [
    ...facts.map((fact) => Date.parse(fact.updated_at)),
    ...episodes.map((episode) => episode.occurred_at),
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (timestamps.length === 0) return "尚无长期记忆";
  return `最近更新 ${new Date(Math.max(...timestamps)).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function AgentMemorySettings({ mode }: { mode: OrchestratorMode }) {
  const [facts, setFacts] = useState<SemanticMemoryFact[]>([]);
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgettingId, setForgettingId] = useState("");
  const [clearing, setClearing] = useState(false);
  const {
    preferences,
    loading: preferencesLoading,
    saving: preferencesSaving,
    error: preferencesError,
    updatePreferences,
  } = useLearnerPreferences();

  const refresh = useCallback(async () => {
    if (mode !== "live") {
      setFacts([]);
      setEpisodes([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [nextFacts, nextEpisodes] = await Promise.all([
        listSemanticMemoryFacts(),
        listMemoryEpisodes(),
      ]);
      setFacts(nextFacts);
      setEpisodes(nextEpisodes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取智能体记忆失败");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const forget = async (fact: SemanticMemoryFact) => {
    if (forgettingId || !window.confirm(`确认让智能教师忘记“${factText(fact)}”吗？`)) return;
    setForgettingId(fact.id);
    setError("");
    try {
      await forgetSemanticMemoryFact(fact.id);
      setFacts((current) => current.filter((item) => item.id !== fact.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除记忆失败");
    } finally {
      setForgettingId("");
    }
  };

  const exportMemory = () => {
    if (facts.length === 0 && episodes.length === 0) return;
    const blob = new Blob([JSON.stringify({
      exported_at: new Date().toISOString(),
      semantic_facts: facts,
      episodic_memories: episodes,
    }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `xueshu-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const clearMemory = async () => {
    if (clearing || (facts.length === 0 && episodes.length === 0)) return;
    if (!window.confirm("确认清空全部长期记忆吗？当前会话和学习资料不会被删除，此操作无法撤销。")) return;
    setClearing(true);
    setError("");
    try {
      await clearLongTermAgentMemory();
      setFacts([]);
      setEpisodes([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清空长期记忆失败");
    } finally {
      setClearing(false);
    }
  };

  const hasLongTermMemory = facts.length > 0 || episodes.length > 0;

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <BrainCircuit className="mt-0.5 size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">智能体三重记忆</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            工作记忆服务当前对话，情景记忆保存压缩经历，语义记忆保存稳定学情。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={exportMemory}
          disabled={!hasLongTermMemory}
        >
          <Download className="size-3.5" />
          导出记忆
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? "收起管理" : "管理记忆"}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-surface-2/25 p-3.5">
        <Power className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold">启用长期记忆</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            关闭后停止写入和召回情景、语义记忆；已有内容会保留，仍可导出或清空。
          </p>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {preferences.long_term_memory_enabled ? "正在使用" : "已暂停"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={preferences.long_term_memory_enabled}
          disabled={preferencesLoading || preferencesSaving || mode !== "live"}
          onClick={() => void updatePreferences({
            long_term_memory_enabled: !preferences.long_term_memory_enabled,
          })}
          className={cn(
            "relative h-7 w-12 rounded-full transition-colors disabled:opacity-50",
            preferences.long_term_memory_enabled ? "bg-primary" : "bg-muted",
          )}
        >
          <span className={cn(
            "absolute top-1 size-5 rounded-full bg-white shadow-sm transition-transform",
            preferences.long_term_memory_enabled ? "translate-x-6" : "translate-x-1",
          )} />
          <span className="sr-only">{preferences.long_term_memory_enabled ? "暂停长期记忆" : "启用长期记忆"}</span>
        </button>
      </div>

      {preferencesError && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground" role="status">
          {preferencesError}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          { label: "工作记忆", value: "当前会话", detail: "即时上下文", Icon: Clock3 },
          { label: "情景记忆", value: episodes.length, detail: "压缩摘要", Icon: Database },
          { label: "语义记忆", value: facts.length, detail: "有效事实", Icon: ShieldCheck },
        ].map(({ label, value, detail, Icon }) => (
          <div key={label} className="rounded-lg border bg-surface-2/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="size-3.5" />
              {label}
            </div>
            <strong className="mt-1 block text-sm">{value}</strong>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2/45 px-3 py-2 text-xs text-muted-foreground">
        <span>{lastUpdatedLabel(facts, episodes)}</span>
        <span>仅召回与当前问题相关、预算范围内的内容</span>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground" role="status">
          {error}
        </p>
      )}

      {expanded && (
        <div className="mt-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold">长期记忆管理</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">可逐条遗忘、导出备份，或清空全部情景与语义记忆。</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void refresh()} disabled={loading || mode !== "live"}>
                {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                刷新
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => void clearMemory()}
                disabled={!hasLongTermMemory || clearing || mode !== "live"}
              >
                {clearing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                清空长期记忆
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">智能教师记住的学情</h3>
                <span className="text-xs text-muted-foreground">可逐条遗忘</span>
              </div>
              <div className="mt-2 space-y-2">
                {facts.length > 0 ? facts.map((fact) => (
                  <article key={fact.id} className="group rounded-lg border bg-surface-2/20 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {CATEGORY_LABELS[fact.category] || fact.category}
                          </span>
                          <span className="text-xs text-muted-foreground">置信度 {Math.round(fact.confidence * 100)}%</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed">{factText(fact)}</p>
                        {fact.evidence && fact.evidence !== factText(fact) && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">依据：{fact.evidence}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`忘记：${factText(fact)}`}
                        title="让智能教师忘记这条事实"
                        onClick={() => void forget(fact)}
                        disabled={Boolean(forgettingId)}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-70 hover:bg-danger/10 hover:text-danger disabled:opacity-30 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        {forgettingId === fact.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </button>
                    </div>
                  </article>
                )) : (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    {loading ? "正在读取…" : "还没有提取出稳定学情。"}
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">已压缩的对话经历</h3>
                <span className="text-xs text-muted-foreground">情景记忆</span>
              </div>
              <div className="mt-2 space-y-2">
                {episodes.length > 0 ? episodes.slice(0, 5).map((episode) => (
                  <article key={episode.id} className="rounded-lg border bg-surface-2/20 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{episodeDate(episode)}</span>
                      <span>{episode.source_message_count} 条消息 · 约 {episode.estimated_tokens} tokens</span>
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs leading-relaxed">
                      {episode.summary.replace(/^较早对话压缩摘要：\s*/, "")}
                    </p>
                  </article>
                )) : (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    {loading ? "正在读取…" : "对话变长后，较早内容会自动压缩到这里。"}
                  </p>
                )}
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="size-3" />
            清空长期记忆不会删除当前会话、学习资料、目标或练习记录。
          </p>
        </div>
      )}
    </section>
  );
}
