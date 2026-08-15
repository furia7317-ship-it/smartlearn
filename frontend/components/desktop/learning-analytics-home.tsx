"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Clock3,
  Compass,
  Gauge,
  GraduationCap,
  MessageSquareText,
  RefreshCw,
  Route,
  Sparkles,
  Target,
} from "lucide-react";

import type {
  LearningAnalytics,
  SubjectBalanceState,
} from "@/lib/learning-analytics";

interface LearningAnalyticsHomeProps {
  analytics: LearningAnalytics;
  loading?: boolean;
}

const BALANCE_LABELS: Record<SubjectBalanceState, string> = {
  high_effort_low_mastery: "高投入 · 待突破",
  underinvested: "投入不足",
  strong: "优势区",
  balanced: "均衡",
  unknown: "证据不足",
};

const ANALYTICS_INDEX = [
  { index: 2, title: "学习偏科分析", subtitle: "投入与掌握", href: "#analytics-balance", Icon: BarChart3 },
  { index: 4, title: "学习行为画像", subtitle: "习惯与节律", href: "#analytics-style", Icon: Compass },
  { index: 5, title: "知识遗忘预测", subtitle: "记忆与曲线", href: "#analytics-forgetting", Icon: RefreshCw },
  { index: 6, title: "学习路径进度", subtitle: "任务与里程碑", href: "#analytics-path", Icon: Route },
  { index: 7, title: "学习瓶颈诊断", subtitle: "难点与突破口", href: "#analytics-bottlenecks", Icon: Target },
  { index: 8, title: "学习效率分析", subtitle: "方法与产出", href: "#analytics-efficiency", Icon: Clock3 },
  { index: 9, title: "AI 教师观察日志", subtitle: "互动与建议", href: "#analytics-observations", Icon: MessageSquareText },
  { index: 10, title: "同阶段对比", subtitle: "班级与群体", href: "#analytics-peers", Icon: GraduationCap },
] as const;

function EmptyEvidence({ children = "继续学习后，这里会根据真实记录形成判断。" }: { children?: string }) {
  return <p className="desktop-analytics-empty">{children}</p>;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function minutesLabel(value: number): string {
  if (value < 60) return `${Math.round(value)} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function moduleHeader(
  index: number,
  title: string,
  subtitle: string,
  Icon: typeof Activity,
) {
  return (
    <header className="desktop-analytics-card__head">
      <span><Icon aria-hidden />{String(index).padStart(2, "0")}</span>
      <div><h3>{title}</h3><p>{subtitle}</p></div>
    </header>
  );
}

export function LearningAnalyticsHome({ analytics, loading = false }: LearningAnalyticsHomeProps) {
  const { evidence } = analytics;
  const evidenceCount = evidence.activityEvents
    + evidence.masteryMeasurements
    + evidence.practiceAttempts
    + evidence.taskRecords;
  const healthScore = analytics.health.score ?? 0;

  return (
    <section className="desktop-learning-analytics" aria-labelledby="learning-feedback-title">
      <header className="desktop-learning-analytics__title">
        <div>
          <span>学习反馈</span>
          <h2 id="learning-feedback-title">从投入到掌握，看见真实学习状态</h2>
          <p>依据资料活跃时长、练习、摸底、路径和任务记录实时计算，不用学习时长替代掌握程度。</p>
        </div>
        <div className="desktop-learning-analytics__evidence" aria-live="polite">
          {loading ? <RefreshCw aria-hidden className="animate-spin" /> : <Activity aria-hidden />}
          <span><strong>{evidenceCount}</strong> 条学习证据</span>
          <small>近 {analytics.rangeDays} 天 · 有效投入 {minutesLabel(evidence.activeMinutes)}</small>
        </div>
      </header>

      <div className="desktop-analytics-grid">
        <article id="analytics-health" className="desktop-analytics-card desktop-analytics-card--health">
          {moduleHeader(1, "学习健康度", "连续性、练习、掌握、完成与复习", Gauge)}
          <div className="desktop-health-layout">
            <div
              className="desktop-health-score"
              style={{ "--health-score": `${healthScore * 3.6}deg` } as React.CSSProperties}
              aria-label={analytics.health.score === null ? "暂无学习健康度" : `学习健康度 ${analytics.health.score} 分`}
            >
              <span>{analytics.health.score ?? "—"}</span>
              <small>/ 100</small>
            </div>
            <div className="desktop-health-factors">
              {analytics.health.factors.map((factor) => (
                <div key={factor.id}>
                  <span>{factor.label}<em>{percent(factor.score)}</em></span>
                  <i><b style={{ width: `${factor.score ?? 0}%` }} /></i>
                </div>
              ))}
            </div>
          </div>
          {analytics.health.availability === "insufficient" && <EmptyEvidence />}
        </article>

        <article id="analytics-summary" className="desktop-analytics-card desktop-analytics-card--summary">
          {moduleHeader(3, "今日 AI 学习总结", "发生了什么、为什么、下一步做什么", Sparkles)}
          {analytics.dailySummary.availability === "ready" ? (
            <div className="desktop-daily-summary">
              <p>{analytics.dailySummary.narrative}</p>
              <dl>
                <div><dt>今日投入</dt><dd>{minutesLabel(analytics.dailySummary.activeMinutes)}</dd></div>
                <div><dt>完成任务</dt><dd>{analytics.dailySummary.completedTasks} 项</dd></div>
                <div><dt>练习</dt><dd>{analytics.dailySummary.practiceAttempts} 次</dd></div>
                <div><dt>主动提问</dt><dd>{analytics.dailySummary.questions} 次</dd></div>
              </dl>
              {analytics.dailySummary.topics.length > 0 && (
                <div className="desktop-analytics-tags">
                  {analytics.dailySummary.topics.slice(0, 3).map((topic) => <span key={topic}>{topic}</span>)}
                </div>
              )}
            </div>
          ) : <EmptyEvidence>今天还没有形成可总结的学习证据。</EmptyEvidence>}
        </article>

        <nav className="desktop-analytics-index" aria-label="学习全景洞察">
          <strong>学习全景洞察</strong>
          {ANALYTICS_INDEX.map(({ index, title, subtitle, href, Icon }) => (
            <a key={href} href={href}>
              <Icon aria-hidden />
              <span><b>{String(index).padStart(2, "0")} · {title}</b><small>{subtitle}</small></span>
            </a>
          ))}
        </nav>

        <article id="analytics-balance" className="desktop-analytics-card desktop-analytics-card--wide">
          {moduleHeader(2, "学习偏科分析", "投入时间 × 掌握程度 × 计划权重", BarChart3)}
          {analytics.subjectBalance.items.length > 0 ? (
            <div className="desktop-subject-balance">
              <div className="desktop-subject-balance__legend"><span>实际投入</span><span>掌握度</span><span>判断</span></div>
              {analytics.subjectBalance.items.slice(0, 8).map((item) => (
                <div className={`desktop-subject-row is-${item.state}`} key={item.subject}>
                  <strong>{item.subject}</strong>
                  <div><i><b style={{ width: `${item.investmentShare}%` }} /></i><span>{Math.round(item.investmentShare)}%</span></div>
                  <div><i><b style={{ width: `${item.mastery ?? 0}%` }} /></i><span>{percent(item.mastery)}</span></div>
                  <em>{BALANCE_LABELS[item.state]}</em>
                </div>
              ))}
              {analytics.subjectBalance.findings.length > 0 && (
                <p className="desktop-analytics-finding">{analytics.subjectBalance.findings[0]}</p>
              )}
            </div>
          ) : <EmptyEvidence>至少阅读两个科目的资料后，首页会开始比较投入比例。</EmptyEvidence>}
        </article>

        <article id="analytics-style" className="desktop-analytics-card">
          {moduleHeader(4, "学习行为画像", "识别更适合你的学习方式", Compass)}
          {analytics.learningStyle.items.length > 0 ? (
            <div className="desktop-style-profile">
              {analytics.learningStyle.items.map((item) => (
                <div key={item.channel}>
                  <span>{item.label}<em>{Math.round(item.share)}%</em></span>
                  <i><b style={{ width: `${item.share}%` }} /></i>
                </div>
              ))}
              <p>当前更常采用：<strong>{analytics.learningStyle.items.find((item) => item.channel === analytics.learningStyle.dominant)?.label ?? "尚未形成偏好"}</strong></p>
            </div>
          ) : <EmptyEvidence>使用讲义、视频、代码和练习后才能识别学习方式。</EmptyEvidence>}
        </article>

        <article id="analytics-forgetting" className="desktop-analytics-card">
          {moduleHeader(5, "知识遗忘预测", "根据掌握度、间隔与复习次数预警", RefreshCw)}
          {analytics.forgetting.items.length > 0 ? (
            <ol className="desktop-risk-list">
              {analytics.forgetting.items.slice(0, 5).map((item) => (
                <li key={`${item.subject}-${item.knowledgePoint}`} className={`is-${item.level}`}>
                  <span><strong>{item.knowledgePoint}</strong><small>{item.subject || "未归类"} · {item.daysSinceStudy} 天未复习</small></span>
                  <em>{Math.round(item.risk)}%</em>
                </li>
              ))}
            </ol>
          ) : <EmptyEvidence>完成一次摸底并产生后续复习记录后才能预测遗忘。</EmptyEvidence>}
        </article>

        <article id="analytics-path" className="desktop-analytics-card">
          {moduleHeader(6, "学习路径进度", "当前阻塞点与剩余任务", Route)}
          {analytics.pathProgress.items.length > 0 ? (
            <div className="desktop-path-progress-list">
              {analytics.pathProgress.items.slice(0, 5).map((item) => (
                <div key={item.id}>
                  <span><strong>{item.title}</strong><em>{Math.round(item.progress)}%</em></span>
                  <i><b style={{ width: `${item.progress}%` }} /></i>
                  <small>{item.completedTasks}/{item.totalTasks} 项 · 约剩 {minutesLabel(item.remainingMinutes)}</small>
                </div>
              ))}
              <Link href="/desktop/path">查看完整路径 <ArrowRight aria-hidden /></Link>
            </div>
          ) : <EmptyEvidence>建立并启用学习路径后显示进度。</EmptyEvidence>}
        </article>

        <article id="analytics-bottlenecks" className="desktop-analytics-card">
          {moduleHeader(7, "学习瓶颈诊断", "定位高投入、低掌握的具体原因", Target)}
          {analytics.bottlenecks.items.length > 0 ? (
            <ol className="desktop-bottleneck-list">
              {analytics.bottlenecks.items.slice(0, 4).map((item) => (
                <li key={`${item.subject}-${item.topic}`}>
                  <span>{Math.round(item.severity)}</span>
                  <div><strong>{item.topic}</strong><p>{item.reasons.join("；")}</p></div>
                </li>
              ))}
            </ol>
          ) : <EmptyEvidence>当前没有足够证据定位瓶颈，或尚未发现明显异常。</EmptyEvidence>}
        </article>

        <article id="analytics-efficiency" className="desktop-analytics-card desktop-analytics-card--wide">
          {moduleHeader(8, "学习效率分析", "找到专注度与结果更好的时间段", Clock3)}
          {analytics.efficiency.hours.length > 0 ? (
            <div className="desktop-efficiency">
              <div className="desktop-efficiency__chart" aria-label="各小时有效学习时长">
                {analytics.efficiency.hours.map((item) => {
                  const maximum = Math.max(...analytics.efficiency.hours.map((hour) => hour.activeMinutes), 1);
                  return (
                    <div key={item.hour} className={item.hour === analytics.efficiency.goldenHour ? "is-golden" : undefined}>
                      <span style={{ height: `${Math.max(5, (item.activeMinutes / maximum) * 100)}%` }} />
                      <small>{String(item.hour).padStart(2, "0")}:00</small>
                    </div>
                  );
                })}
              </div>
              <p><Clock3 aria-hidden />黄金学习时段：<strong>{analytics.efficiency.goldenHour === null ? "尚未形成" : `${String(analytics.efficiency.goldenHour).padStart(2, "0")}:00–${String((analytics.efficiency.goldenHour + 1) % 24).padStart(2, "0")}:00`}</strong></p>
            </div>
          ) : <EmptyEvidence>分时段产生有效学习记录后显示效率分布。</EmptyEvidence>}
        </article>

        <article id="analytics-observations" className="desktop-analytics-card">
          {moduleHeader(9, "AI 教师观察日志", "把行为变化翻译成可执行建议", MessageSquareText)}
          {analytics.teacherObservations.items.length > 0 ? (
            <ol className="desktop-observation-list">
              {analytics.teacherObservations.items.slice(0, 5).map((item) => (
                <li key={item.id} className={`is-${item.tone}`}>
                  <span aria-hidden />
                  <div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.evidence} 条证据</small></div>
                </li>
              ))}
            </ol>
          ) : <EmptyEvidence>积累多类学习证据后，智能教师会给出可追溯观察。</EmptyEvidence>}
        </article>

        <article id="analytics-peers" className="desktop-analytics-card">
          {moduleHeader(10, "同阶段对比", "只看成长机会，不做排名", GraduationCap)}
          {analytics.peerComparison.items.length > 0 ? (
            <div className="desktop-peer-list">
              {analytics.peerComparison.items.slice(0, 5).map((item) => (
                <div key={item.subject}>
                  <span><strong>{item.subject}</strong><small>{item.sampleSize} 名同阶段学习者</small></span>
                  <p>你 {Math.round(item.learnerMastery)}% <em>{item.delta >= 0 ? "+" : ""}{Math.round(item.delta)}</em> 同阶段 {Math.round(item.peerMastery)}%</p>
                </div>
              ))}
            </div>
          ) : <EmptyEvidence>尚无满足匿名聚合门槛的同阶段样本，因此不生成比较结论。</EmptyEvidence>}
        </article>
      </div>

      <footer className="desktop-learning-analytics__footer">
        <BookOpenCheck aria-hidden />
        <span>所有判断都来自可追溯学习证据；当证据不足时，首页会明确留空。</span>
        <Link href="/desktop/profile">查看个人学习画像 <ArrowRight aria-hidden /></Link>
      </footer>
    </section>
  );
}
