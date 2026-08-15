import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileText,
  Route,
  Target,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { getDashboardInsights, getHomeModules } from "@/lib/session-insights";
import { WEB_EASE } from "@/lib/web-motion";

const MODULE_ICONS = {
  resources: FileText,
  practice: CheckCircle2,
  wrongbook: BookOpenCheck,
  path: Route,
  profile: Target,
  kb: BookOpenCheck,
};

export function HomeLearningBoard({
  insights,
  modules,
  studyTime,
  isActive,
}: {
  insights: ReturnType<typeof getDashboardInsights>;
  modules: ReturnType<typeof getHomeModules>;
  studyTime: {
    plannedMinutes: number;
    completedMinutes: number;
    days: Array<{ day: string; minutes: number; current: boolean }>;
  };
  isActive: boolean;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <section
      className="home-story-section home-workspace"
      data-section="workspace"
      data-scene-active={isActive}
    >
      <motion.div
        className="home-section-heading"
        initial={false}
        animate={isActive ? { y: 0, scale: 1 } : { y: 56, scale: 0.985 }}
        transition={{ duration: reducedMotion ? 0 : 0.62, ease: WEB_EASE }}
      >
        <div>
          <span className="paper-kicker"><span /> 学习进度</span>
          <h2>把今天要做的事，放在一张学习桌上</h2>
          <p>数据来自当前学习会话，不用在不同工具之间重复整理。</p>
        </div>
        <Image
          src="/brand/animals/red-panda-plan.webp"
          alt="小熊猫正在规划学习路径"
          width={178}
          height={222}
          className="home-heading-mascot"
        />
      </motion.div>

      <div className="home-workspace__grid">
        <motion.div
          className="web-paper-panel learning-ledger"
          initial={false}
          animate={isActive ? { y: 0, scale: 1 } : { y: 42, scale: 0.988 }}
          transition={{
            duration: reducedMotion ? 0 : 0.58,
            delay: reducedMotion || !isActive ? 0 : 0.08,
            ease: WEB_EASE,
          }}
        >
          <div className="learning-ledger__head">
            <div>
              <span>当前主线</span>
              <strong>{insights.currentStage}</strong>
            </div>
            <Link href="/path/study">进入学习 <ArrowRight className="size-3.5" /></Link>
          </div>
          <div className="learning-ledger__metrics">
            <div><strong>{insights.profileAverage}</strong><span>画像均值</span></div>
            <div><strong>{insights.readyResources}/{insights.generatedResources}</strong><span>已过审资料</span></div>
            <div><strong>{insights.citationCount}</strong><span>知识库引用</span></div>
            <div><strong>{insights.pathStages}</strong><span>路径阶段</span></div>
          </div>
          <div className="learning-ledger__rows">
            {modules.slice(0, 5).map((module, index) => {
              const Icon = MODULE_ICONS[module.id as keyof typeof MODULE_ICONS] ?? FileText;
              return (
                <motion.div
                  key={module.id}
                  initial={false}
                  animate={isActive ? { x: 0 } : { x: -28 }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.38,
                    delay: reducedMotion || !isActive ? 0 : 0.14 + index * 0.045,
                    ease: WEB_EASE,
                  }}
                >
                  <span className={`module-mark module-mark--${module.tone}`}><Icon className="size-4" /></span>
                  <div><strong>{module.title}</strong><small>{module.desc}</small></div>
                  <span className="learning-ledger__value">{module.value}</span>
                  <Link href={module.href} aria-label={`打开${module.title}`}><ArrowRight className="size-4" /></Link>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        <motion.aside
          className="home-note-column"
          initial={false}
          animate={isActive ? { x: 0, rotate: 0 } : { x: 48, rotate: 0.8 }}
          transition={{
            duration: reducedMotion ? 0 : 0.64,
            delay: reducedMotion || !isActive ? 0 : 0.12,
            ease: WEB_EASE,
          }}
        >
          <div className="paper-note paper-note--ochre">
            <span>今日建议</span>
            <h3>{insights.weakTags.length > 0 ? "先复盘薄弱知识点" : "完成一轮小测验"}</h3>
            <p>
              {insights.weakTags.length > 0
                ? insights.weakTags.join("、")
                : "用 10 分钟验证当前章节，再决定下一步。"}
            </p>
            <Link href="/practice">去练习 <ArrowRight className="size-3.5" /></Link>
          </div>
          <div className="paper-note paper-note--teal">
            <span>资料状态</span>
            <h3>{insights.readyResources} 项可以直接学习</h3>
            <p>已过审资料保留知识库引用，可在资源中心逐条核对。</p>
            <Link href="/resources">查看资源 <ArrowRight className="size-3.5" /></Link>
          </div>
        </motion.aside>
      </div>

      <motion.div
        className="home-study-time"
        initial={false}
        animate={isActive ? { y: 0, scale: 1 } : { y: 32, scale: 0.99 }}
        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion || !isActive ? 0 : 0.18, ease: WEB_EASE }}
      >
        <div className="home-study-time__summary">
          <span>每天学习时间</span>
          <strong>{studyTime.plannedMinutes} 分钟</strong>
          <small>今日已完成 {studyTime.completedMinutes} 分钟</small>
        </div>
        <div className="home-study-time__days" aria-label="总学习路径每日计划时长">
          {studyTime.days.length > 0 ? studyTime.days.map((item) => {
            const max = Math.max(1, ...studyTime.days.map((day) => day.minutes));
            return (
              <div key={item.day} className={item.current ? "is-current" : undefined}>
                <span>{item.day}</span>
                <i><b style={{ height: `${Math.max(12, (item.minutes / max) * 100)}%` }} /></i>
                <strong>{item.minutes}</strong>
              </div>
            );
          }) : (
            <p>启用科目路径后显示每日计划时长</p>
          )}
        </div>
        <Link href="/path">调整路径 <ArrowRight className="size-3.5" /></Link>
      </motion.div>
    </section>
  );
}
