import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, Map, MessageCircle } from "lucide-react";
import { motion, useReducedMotion, useTransform, type MotionValue } from "framer-motion";

import { WEB_EASE } from "@/lib/web-motion";

export function HomeHero({
  hasSession,
  hydrated,
  mode,
  currentStage,
  pathReady,
  scrollProgress,
}: {
  hasSession: boolean;
  hydrated: boolean;
  mode: "checking" | "live" | "offline";
  currentStage: string;
  pathReady: boolean;
  scrollProgress: MotionValue<number>;
}) {
  const reducedMotion = useReducedMotion();
  const artY = useTransform(scrollProgress, [0, 0.34], [0, 76]);
  const artScale = useTransform(scrollProgress, [0, 0.34], [1.025, 1.075]);
  const enter = (delay: number) => ({
    initial: reducedMotion ? false : { y: 30 },
    animate: { y: 0 },
    transition: { duration: reducedMotion ? 0 : 0.62, delay, ease: WEB_EASE },
  });

  return (
    <section className="home-story-section home-hero" data-section="welcome">
      <motion.div
        className="home-hero__art"
        aria-hidden
        style={reducedMotion ? undefined : { y: artY, scale: artScale }}
      >
        <Image
          src="/brand/animals/hero-study.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </motion.div>
      <div className="home-hero__wash" aria-hidden />
      <div className="home-hero__copy">
        <motion.div {...enter(0.05)} className="paper-kicker">
          <span /> 继续学习
        </motion.div>
        <motion.h1 {...enter(0.12)}>从哪里继续学习？</motion.h1>
        <motion.p {...enter(0.19)} className="home-hero__subtitle">
          {pathReady ? `当前阶段 · ${currentStage}` : "从真实目标生成你的学习主线"}
        </motion.p>
        <motion.p {...enter(0.25)} className="home-hero__summary">
          {hasSession
            ? `当前主线：${currentStage}。资料、练习与学习路径已经接入同一份学习记录。`
            : hydrated
              ? "从一次真实的答疑或学习路径开始，学习记录会在这里自然积累。"
              : "正在恢复你的学习记录，稍后即可继续。"}
        </motion.p>
        <motion.div {...enter(0.31)} className="home-hero__actions">
          <Link href={pathReady ? "/path/study" : "/studio"} className="web-primary-action">
            <MessageCircle className="size-4" />
            {hasSession ? "继续学习" : "开始学习"}
            <ArrowRight className="size-4" />
          </Link>
          <Link href="/path" className="web-secondary-action">
            <Map className="size-4" />
            查看学习路径
          </Link>
        </motion.div>
        <motion.div {...enter(0.38)} className="home-hero__status">
          <span className={`status-dot status-dot--${mode}`} />
          {mode === "live" ? "学习服务已连接" : mode === "offline" ? "学习服务未连接" : "正在检测学习服务"}
        </motion.div>
      </div>
      <div className="home-scroll-cue" aria-hidden>
        <ArrowDown className="size-4" />
        <span>向下滚动，查看学习进度</span>
      </div>
    </section>
  );
}
