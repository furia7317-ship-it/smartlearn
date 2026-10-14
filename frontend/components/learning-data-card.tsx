"use client";

import { useOrchestratorContext } from "@/components/orchestrator-provider";

export function LearningDataCard() {
  const { data, error, refresh, refreshing } = useOrchestratorContext((state) => ({
    data: state.learningData, error: state.learningDataError,
    refresh: state.refreshLearningData, refreshing: state.refreshingLearningData,
  }));
  return <section className="rounded-md border border-border bg-background/60 p-4 text-xs leading-relaxed" aria-label="学习数据管家">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-sm font-semibold">学习数据管家</h2>
      <span className="text-muted-foreground">{data?.revision ? `已发布第 ${data.revision} 版` : "等待首次整理"}</span>
    </div>
    <p className="mt-2 text-muted-foreground">统一整理测评、实训、学习记录与对话，为画像、知识图谱和智能教师提供学情参考。</p>
    <p className="mt-2">{data?.pendingCount ? `${data.pendingCount} 组新证据待整理，当前画像保持不变。` : data?.revision ? "已发布的学情可供资料生成与问答使用。" : "正在读取学情档案…"}</p>
    {data?.updatedAt && <p className="mt-1 text-muted-foreground">上次整理：{new Date(data.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
    {data?.nextReviewAt && <p className="mt-1 text-muted-foreground">预计最晚整理：{new Date(data.nextReviewAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 左右</p>}
    {error && <p className="mt-2 text-destructive" role="status">{error}</p>}
    {data?.policy && <details className="mt-3 border-t border-border pt-2">
      <summary className="cursor-pointer text-primary">查看权重与更新规则</summary>
      <p className="mt-2 text-muted-foreground">新增证据至少 {data.policy.minimumBatch} 组、权重累计达到 {data.policy.minimumWeight} 后批量整理；两次自动更新至少间隔 {data.policy.cooldownSeconds / 60} 分钟。少量数据最多等待 {data.policy.maximumWaitSeconds / 60} 分钟。</p>
      <table className="mt-2 w-full text-left" aria-label="学习证据权重"><thead><tr><th className="py-1 font-medium">来源</th><th className="text-right font-medium">权重</th></tr></thead><tbody>
        {Object.entries(data.policy.sources).map(([key, source]) => <tr key={key} className="border-t border-border/60"><td className="py-1">{source.label}{source.objective ? " · 可评估掌握度" : " · 辅助参考"}</td><td className="text-right tabular-nums">{source.weight.toFixed(2)}</td></tr>)}
      </tbody></table>
      <p className="mt-2 text-muted-foreground">同一任务反复提交只取最新结果。对话、浏览和普通运行不会直接提高掌握度；自评与实际测评分开判断。</p>
    </details>}
    <button type="button" onClick={() => void refresh()} disabled={refreshing} className="mt-3 rounded border border-border px-3 py-1.5 text-primary hover:bg-muted disabled:opacity-50">{refreshing ? "正在整理…" : "现在整理"}</button>
  </section>;
}
