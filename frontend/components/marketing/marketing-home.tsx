"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookCheck,
  BookOpen,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Code2,
  Download,
  FileStack,
  FileText,
  FileQuestion,
  Goal,
  ListChecks,
  Map,
  MonitorDown,
  Network,
  RotateCcw,
  Route,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  Video,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import {
  advanceWheelGesture,
  easeSectionTransition,
  normalizeSectionIndex,
  type WheelGestureState,
} from "@/lib/web-motion";

import styles from "./marketing-home.module.css";

const SECTIONS = ["hero", "agents", "resources", "loop", "start"] as const;
const SECTION_LABELS = ["认识学枢", "智能体协作", "学习材料", "学习闭环", "开始体验"];
const FREE_TRIAL_HREF = "/login?next=/app";
const DESKTOP_DOWNLOAD_HREF =
  process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL ||
  "/downloads/学枢-一体安装版-0.1.14.exe";

const AGENTS = [
  { label: "学习画像", detail: "汇总测验与代码评分", icon: UserRoundSearch, position: "agentTopLeft" },
  { label: "路径规划", detail: "拆解目标与学习节奏", icon: Route, position: "agentTopRight" },
  { label: "概念讲解", detail: "把知识讲得更易懂", icon: FileText, position: "agentMiddleLeft" },
  { label: "思维导图", detail: "重建知识之间的关系", icon: Network, position: "agentMiddleRight" },
  { label: "题库训练", detail: "围绕弱点定向命题", icon: ListChecks, position: "agentBottomLeft" },
  { label: "质量审核", detail: "逐条核验内容与来源", icon: ShieldCheck, position: "agentBottomRight" },
] as const;

const RESOURCES = [
  { label: "讲义", detail: "通俗讲解与要点", icon: FileText },
  { label: "导图", detail: "结构化知识网络", icon: Map },
  { label: "题库", detail: "针对性训练与评分", icon: ClipboardCheck },
  { label: "题目解析", detail: "题目、答案与逐题讲解", icon: FileQuestion },
  { label: "代码挑战", detail: "AI 出题、运行与画像联动", icon: Code2 },
  { label: "视频", detail: "动画分镜与讲解", icon: Video },
  { label: "课件", detail: "可复用课程大纲", icon: FileStack },
] as const;

const LOOP_STAGES = [
  { label: "诊断", detail: "评估现状与薄弱点", icon: BrainCircuit, note: "画像已更新", position: "loopOne" },
  { label: "学习", detail: "精讲内容与资源", icon: BookOpen, note: "6 份资料", position: "loopTwo" },
  { label: "练习", detail: "测验与代码挑战反馈", icon: BookCheck, note: "评分写入画像", position: "loopThree" },
  { label: "复习", detail: "按遗忘曲线回顾", icon: RotateCcw, note: "明日复习", position: "loopFour" },
] as const;

function Brand() {
  return (
    <button className={styles.brand} type="button" aria-label="回到首页第一屏">
      <span className={styles.brandMark}>
        <Image src="/brand/xueshu-app-icon-128.webp" alt="" width={36} height={36} priority />
      </span>
      <span><strong>学枢</strong><small>XUESHU</small></span>
    </button>
  );
}

function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className={styles.sectionHeading}>
      <span className={styles.eyebrow}><Sparkles aria-hidden />{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

export function MarketingHome() {
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const animationFrame = useRef<number | undefined>(undefined);
  const wheelResetTimer = useRef<number | undefined>(undefined);
  const transitionTimer = useRef<number | undefined>(undefined);
  const animationTarget = useRef(0);
  const wheelGesture = useRef<WheelGestureState>({ sum: 0, triggered: false });
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState(1);
  const [transitioning, setTransitioning] = useState(false);

  const moveTo = useCallback((nextIndex: number) => {
    const root = rootRef.current;
    const index = normalizeSectionIndex(nextIndex, SECTIONS.length);
    const section = sectionRefs.current[index];
    const nextDirection = index >= animationTarget.current ? 1 : -1;
    animationTarget.current = index;
    setDirection(nextDirection);
    setActive(index);
    if (!root || !section) return;

    window.clearTimeout(transitionTimer.current);
    if (animationFrame.current !== undefined) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = undefined;
    }

    const targetTop = section.offsetTop;
    if (reducedMotion) {
      root.scrollTop = targetTop;
      setTransitioning(false);
      return;
    }

    const startTop = root.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
      setTransitioning(false);
      return;
    }

    setTransitioning(true);
    const startedAt = window.performance.now();
    const duration = 820;
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      root.scrollTop = startTop + distance * easeSectionTransition(progress);
      if (progress < 1) {
        animationFrame.current = window.requestAnimationFrame(step);
      } else {
        root.scrollTop = targetTop;
        animationFrame.current = undefined;
        transitionTimer.current = window.setTimeout(() => setTransitioning(false), 120);
      }
    };
    animationFrame.current = window.requestAnimationFrame(step);
  }, [reducedMotion]);

  useEffect(() => () => {
    window.clearTimeout(wheelResetTimer.current);
    window.clearTimeout(transitionTimer.current);
    if (animationFrame.current !== undefined) window.cancelAnimationFrame(animationFrame.current);
  }, []);

  const navItems = [
    { label: "产品能力", index: 1 },
    { label: "学习方式", index: 3 },
    { label: "资源案例", index: 2 },
    { label: "桌面端", index: 4 },
  ];

  const sceneMotion = (index: number) => reducedMotion ? {} : {
    opacity: active === index ? 1 : 0.68,
    scale: active === index ? 1 : 0.982,
    y: active === index ? 0 : (index > active ? 24 : -24),
  };

  return (
    <div
      ref={rootRef}
      className={styles.story}
      tabIndex={0}
      aria-label="学枢产品介绍"
      onScroll={(event) => {
        if (animationFrame.current !== undefined) return;
        const top = event.currentTarget.scrollTop;
        let closest = 0;
        let distance = Number.POSITIVE_INFINITY;
        sectionRefs.current.forEach((section, index) => {
          if (!section) return;
          const nextDistance = Math.abs(section.offsetTop - top);
          if (nextDistance < distance) {
            distance = nextDistance;
            closest = index;
          }
        });
        animationTarget.current = closest;
        setActive(closest);
      }}
      onWheel={(event) => {
        if (reducedMotion || window.matchMedia("(max-width: 820px)").matches) return;
        event.preventDefault();
        const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
        const result = advanceWheelGesture(wheelGesture.current, event.deltaY * scale, 48);
        wheelGesture.current = result.state;
        window.clearTimeout(wheelResetTimer.current);
        wheelResetTimer.current = window.setTimeout(() => {
          wheelGesture.current = { sum: 0, triggered: false };
        }, 220);
        if (result.direction === 0) return;
        moveTo(animationTarget.current + result.direction);
      }}
      onKeyDown={(event) => {
        if (["ArrowDown", "PageDown"].includes(event.key)) { event.preventDefault(); moveTo(animationTarget.current + 1); }
        if (["ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); moveTo(animationTarget.current - 1); }
        if (event.key === "Home") { event.preventDefault(); moveTo(0); }
        if (event.key === "End") { event.preventDefault(); moveTo(SECTIONS.length - 1); }
      }}
    >
      <header className={styles.navbar}>
        <div onClick={() => moveTo(0)}><Brand /></div>
        <nav aria-label="宣传页导航">
          {navItems.map((item) => (
            <button key={item.label} type="button" onClick={() => moveTo(item.index)}>{item.label}</button>
          ))}
        </nav>
        <div className={styles.navActions}>
          <Link href={FREE_TRIAL_HREF} className={styles.loginLink}>登录</Link>
          <Link href={FREE_TRIAL_HREF} className={styles.navTrial}>免费体验<ArrowRight aria-hidden /></Link>
        </div>
      </header>

      <AnimatePresence>
        {transitioning && !reducedMotion && (
          <motion.div
            className={styles.transitionVeil}
            initial={{ opacity: 0, scaleY: 0.08 }}
            animate={{ opacity: [0, 0.2, 0], scaleY: [0.08, 1, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.76, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: direction > 0 ? "bottom" : "top" }}
          />
        )}
      </AnimatePresence>

      <motion.section
        ref={(node) => { sectionRefs.current[0] = node; }}
        className={`${styles.section} ${styles.hero}`}
        id="hero"
        animate={sceneMotion(0)}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className={styles.heroArt}
          animate={reducedMotion ? undefined : { scale: active === 0 ? 1.025 : 1.08, x: active === 0 ? 0 : 18 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image
            src="/brand/marketing/learning-journey.png"
            alt="学习资料汇聚成一条通向远方的个性化学习路径"
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
          />
        </motion.div>
        <motion.div
          className={styles.heroCopy}
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className={styles.eyebrow}><Sparkles aria-hidden />多智能体个性化学习平台</span>
          <h1>把难学的，<br />讲成你能学的</h1>
          <p>说出目标和卡住你的地方，AI 教研团队会分析学情、生成资料，并规划一条真正适合你的学习路径。</p>
          <div className={styles.heroActions}>
            <Link href={FREE_TRIAL_HREF} className={styles.primaryAction}>免费体验<ArrowRight aria-hidden /></Link>
            <a href={DESKTOP_DOWNLOAD_HREF} className={styles.secondaryAction} download><Download aria-hidden />下载桌面端</a>
          </div>
          <div className={styles.heroProof}>
            <span><CheckCircle2 aria-hidden />SQLite 三重记忆</span>
            <span><CheckCircle2 aria-hidden />图片 / PDF / 文档答疑</span>
            <span><CheckCircle2 aria-hidden />代码挑战联动画像</span>
          </div>
        </motion.div>
        <motion.aside
          className={styles.heroTarget}
          initial={reducedMotion ? false : { opacity: 0, rotate: 1.8, y: 28 }}
          animate={{ opacity: active === 0 ? 1 : 0.45, rotate: active === 0 ? -1.4 : 1.2, y: active === 0 ? 0 : 20 }}
          transition={{ duration: 0.85, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <span>学习目标</span>
          <strong>理解数据结构<br />与基本概念</strong>
          <ul>
            <li><CheckCircle2 aria-hidden />掌握基本定义</li>
            <li><CheckCircle2 aria-hidden />梳理知识关系</li>
            <li><CheckCircle2 aria-hidden />会解释应用场景</li>
          </ul>
          <small>AI 已拆解为 14 天学习路径</small>
        </motion.aside>
        <button className={styles.scrollCue} type="button" onClick={() => moveTo(1)}>
          滚动探索产品能力<ChevronDown aria-hidden />
        </button>
      </motion.section>

      <motion.section
        ref={(node) => { sectionRefs.current[1] = node; }}
        className={`${styles.section} ${styles.agentsSection}`}
        id="agents"
        animate={sceneMotion(1)}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={`${styles.sectionFrame} ${styles.agentLayout}`}>
          <motion.div
            animate={active === 1 ? { opacity: 1, x: 0 } : { opacity: 0.42, x: -22 }}
            transition={{ duration: 0.55 }}
          >
            <SectionHeading
              eyebrow="多智能体协作"
              title="一句目标，一支 AI 教研团队"
              copy="画像、规划、讲解、导图、题库与审核围绕同一个学习目标协作，把模糊需求变成可以执行、可以复盘的学习方案。"
            />
            <div className={styles.agentOutcome}>
              <span><Bot aria-hidden />教研结果</span>
              <strong>14 天学习路径</strong>
              <small>6 类资料 · 28 个任务 · 全程审核</small>
            </div>
          </motion.div>
          <div className={styles.agentNetwork}>
            <motion.div
              className={styles.agentNetworkArt}
              animate={reducedMotion ? undefined : { opacity: active === 1 ? 0.95 : 0.32, scale: active === 1 ? 1 : 0.94 }}
              transition={{ duration: 0.75 }}
            >
              <Image src="/brand/marketing/agent-orbits-v2.png" alt="六个 AI 智能体围绕学习目标协作的关系网络" fill sizes="70vw" />
            </motion.div>
            <motion.div
              className={styles.agentCore}
              animate={active === 1 && !reducedMotion ? { scale: [0.88, 1.04, 1], opacity: 1 } : { scale: 0.9, opacity: 0.42 }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            >
              <Goal aria-hidden />
              <span>学习目标</span>
              <strong>理解数据结构<br />与基本概念</strong>
              <small>正在协同拆解</small>
            </motion.div>
            {AGENTS.map((agent, index) => {
              const Icon = agent.icon;
              return (
                <motion.article
                  key={agent.label}
                  className={`${styles.agentCard} ${styles[agent.position]}`}
                  initial={false}
                  animate={active === 1
                    ? { opacity: 1, scale: 1, x: 0, y: 0 }
                    : { opacity: 0.22, scale: 0.78, x: index % 2 === 0 ? 28 : -28, y: index < 2 ? 26 : -18 }}
                  transition={{ duration: 0.5, delay: active === 1 ? 0.12 + index * 0.075 : 0 }}
                >
                  <span><Icon aria-hidden /></span>
                  <div><strong>{agent.label}</strong><small>{agent.detail}</small></div>
                  <i>{index === 5 ? "复核中" : "已就绪"}</i>
                </motion.article>
              );
            })}
          </div>
        </div>
      </motion.section>

      <motion.section
        ref={(node) => { sectionRefs.current[2] = node; }}
        className={`${styles.section} ${styles.resourcesSection}`}
        id="resources"
        animate={sceneMotion(2)}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={styles.sectionFrame}>
          <motion.div animate={active === 2 ? { opacity: 1, x: 0 } : { opacity: 0.42, x: -22 }} transition={{ duration: 0.55 }}>
            <SectionHeading
              eyebrow="多模态学习材料"
              title="不只回答，直接交付学习材料"
              copy="图片、PDF 和文档可以直接拖入智能教师；讲义负责讲懂，整书图谱负责串联，题目与逐题解析成组保存，代码挑战负责把练习结果写回画像。"
            />
            <div className={styles.resourceProof}><CheckCircle2 aria-hidden /><span><strong>8 类学习资料</strong><small>统一审核 · 自动归档 · 可持续追问</small></span></div>
            <div className={styles.latestCapabilities}>
              <span>附件拖入答疑</span>
              <span>题目解析成组保存</span>
              <span>代码评分写入画像</span>
            </div>
          </motion.div>
          <div className={styles.resourceShowcase}>
            <motion.div
              className={styles.resourceArtwork}
              animate={active === 2 && !reducedMotion ? { rotate: -0.6, scale: 1, y: 0 } : { rotate: 0.4, scale: 0.94, y: 18 }}
              transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className={styles.latestMaterialBoard}>
                <figure className={styles.latestMaterialMain}>
                  <Image src="/brand/animals/dashboard-path-mascot.webp" alt="小熊猫规划一个月学习路径" fill sizes="32vw" />
                  <figcaption><strong>30 天路径</strong><small>学习记录持续累积</small></figcaption>
                </figure>
                <figure>
                  <Image src="/brand/animals/dashboard-plan-mascot.webp" alt="小熊猫指出下一项学习任务" fill sizes="18vw" />
                  <figcaption><strong>每日任务</strong><small>下一步清楚可做</small></figcaption>
                </figure>
                <figure>
                  <Image src="/brand/animals/dashboard-review-mascot.webp" alt="扬子鳄审核学习资料" fill sizes="18vw" />
                  <figcaption><strong>质量门禁</strong><small>资料审核后交付</small></figcaption>
                </figure>
              </div>
              <span className={styles.artworkSeal}>本轮新增 · 已上线</span>
            </motion.div>
            <div className={styles.resourceGrid}>
              {RESOURCES.map((resource, index) => {
                const Icon = resource.icon;
                return (
                  <motion.article
                    key={resource.label}
                    className={styles.resourceCard}
                    initial={false}
                    animate={active === 2
                      ? { opacity: 1, x: 0, rotate: index % 2 === 0 ? -0.4 : 0.5 }
                      : { opacity: 0.24, x: 34, rotate: 2 }}
                    transition={{ duration: 0.45, delay: active === 2 ? 0.14 + index * 0.065 : 0 }}
                    whileHover={reducedMotion ? undefined : { x: -6, rotate: 0, transition: { duration: 0.18 } }}
                  >
                    <span><Icon aria-hidden /></span>
                    <div><strong>{resource.label}</strong><small>{resource.detail}</small></div>
                    <ArrowRight aria-hidden />
                  </motion.article>
                );
              })}
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        ref={(node) => { sectionRefs.current[3] = node; }}
        className={`${styles.section} ${styles.loopSection}`}
        id="loop"
        animate={sceneMotion(3)}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={styles.sectionFrame}>
          <motion.div animate={active === 3 ? { opacity: 1, y: 0 } : { opacity: 0.42, y: -18 }} transition={{ duration: 0.5 }}>
            <SectionHeading
              eyebrow="个性化学习闭环"
              title="从看懂，到真正掌握"
              copy="系统根据练习结果持续更新画像、调整路径，并在合适的时间安排复习，让学习形成真正的循环。"
            />
          </motion.div>
          <div className={styles.loopScene}>
            <motion.div
              className={styles.loopArtwork}
              animate={reducedMotion ? undefined : { clipPath: active === 3 ? "inset(0 0% 0 0)" : "inset(0 88% 0 0)", opacity: active === 3 ? 1 : 0.28 }}
              transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            >
              <Image src="/brand/marketing/learning-loop-v2.png" alt="诊断、学习、练习与复习构成的连续学习路径" fill sizes="92vw" />
            </motion.div>
            {LOOP_STAGES.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <motion.article
                  key={stage.label}
                  className={`${styles.loopNode} ${styles[stage.position]}`}
                  initial={false}
                  animate={active === 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0.2, scale: 0.72, y: 24 }}
                  transition={{ duration: 0.48, delay: active === 3 ? 0.22 + index * 0.14 : 0 }}
                >
                  <span className={styles.loopIndex}>0{index + 1}</span>
                  <span className={styles.loopIcon}><Icon aria-hidden /></span>
                  <h3>{stage.label}</h3>
                  <p>{stage.detail}</p>
                  <strong><CheckCircle2 aria-hidden />{stage.note}</strong>
                </motion.article>
              );
            })}
          </div>
          <motion.div
            className={styles.loopSummary}
            animate={active === 3 ? { opacity: 1, y: 0 } : { opacity: 0.28, y: 16 }}
            transition={{ duration: 0.55, delay: active === 3 ? 0.7 : 0 }}
          >
            <div><span>连续学习</span><strong>30 天</strong></div>
            <div><span>已审核资料</span><strong>8 类</strong></div>
            <div><span>路径完成度</span><strong>86%</strong></div>
            <div><span>代码挑战</span><strong>最高 100 分</strong></div>
          </motion.div>
        </div>
      </motion.section>

      <motion.section
        ref={(node) => { sectionRefs.current[4] = node; }}
        className={`${styles.section} ${styles.startSection}`}
        id="start"
        animate={sceneMotion(4)}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className={styles.startArt}
          animate={reducedMotion ? undefined : { scale: active === 4 ? 1.03 : 1.1, x: active === 4 ? 0 : 22 }}
          transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image src="/brand/marketing/learning-journey.png" alt="延伸至远方的个性化学习路径" fill sizes="100vw" className={styles.startImage} />
        </motion.div>
        <motion.div
          className={styles.startCopy}
          animate={active === 4 ? { opacity: 1, x: 0 } : { opacity: 0.36, x: -24 }}
          transition={{ duration: 0.62 }}
        >
          <span className={styles.eyebrow}><Goal aria-hidden />你的学习，从此开始</span>
          <h2>现在，开始你的学习路径</h2>
          <p>登录后体验附件答疑、整书知识图谱、题目解析与代码挑战；学习结果会写入 SQLite 画像与三重记忆，长期路径由桌面端持续承载。</p>
          <div className={styles.startActions}>
            <Link href={FREE_TRIAL_HREF} className={styles.primaryAction}>免费体验<ArrowRight aria-hidden /></Link>
            <a href={DESKTOP_DOWNLOAD_HREF} className={styles.secondaryAction} download><MonitorDown aria-hidden />下载桌面端</a>
          </div>
          <small>免费体验将先进入登录页面</small>
        </motion.div>
        <footer className={styles.footer}>
          <span><ShieldCheck aria-hidden />安全可信</span>
          <span><CheckCircle2 aria-hidden />内容经过审核</span>
          <span>© 2026 学枢 Xueshu</span>
        </footer>
      </motion.section>

      <aside className={styles.dots} aria-label="首页章节">
        {SECTIONS.map((section, index) => (
          <button
            key={section}
            type="button"
            className={active === index ? styles.activeDot : undefined}
            aria-current={active === index ? "step" : undefined}
            aria-label={`前往第 ${index + 1} 屏：${SECTION_LABELS[index]}`}
            onClick={() => moveTo(index)}
          ><span>0{index + 1}</span><i>{SECTION_LABELS[index]}</i></button>
        ))}
      </aside>
    </div>
  );
}
