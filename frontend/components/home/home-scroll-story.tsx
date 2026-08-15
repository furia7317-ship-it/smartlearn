"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";

import { HomeHero } from "@/components/home/home-hero";
import { HomeLearningBoard } from "@/components/home/home-learning-board";
import { HomeResourceFinale } from "@/components/home/home-resource-finale";
import { getDashboardInsights, getHomeModules } from "@/lib/session-insights";
import type { ResourceItem } from "@/lib/types";
import {
  advanceWheelGesture,
  easeSectionTransition,
  getSceneEntryIndex,
  HOME_SECTION_IDS,
  normalizeSectionIndex,
  type WheelGestureState,
} from "@/lib/web-motion";

export function HomeScrollStory({
  hasSession,
  hydrated,
  mode,
  pathReady,
  insights,
  modules,
  resources,
  studyTime,
}: {
  hasSession: boolean;
  hydrated: boolean;
  mode: "checking" | "live" | "offline";
  pathReady: boolean;
  insights: ReturnType<typeof getDashboardInsights>;
  modules: ReturnType<typeof getHomeModules>;
  resources: ResourceItem[];
  studyTime: {
    plannedMinutes: number;
    completedMinutes: number;
    days: Array<{ day: string; minutes: number; current: boolean }>;
  };
}) {
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const wheelGesture = useRef<WheelGestureState>({ sum: 0, triggered: false });
  const wheelResetTimer = useRef<number | undefined>(undefined);
  const scrollAnimation = useRef<number | undefined>(undefined);
  const animationTarget = useRef(0);
  const sceneActiveRef = useRef(0);
  const [active, setActive] = useState(0);
  const [sceneActive, setSceneActive] = useState(0);
  const { scrollYProgress } = useScroll({ container: rootRef });
  const smoothScrollProgress = useSpring(scrollYProgress, {
    stiffness: 150,
    damping: 32,
    mass: 0.32,
  });

  const revealScene = useCallback((index: number) => {
    if (sceneActiveRef.current === index) return;
    sceneActiveRef.current = index;
    setSceneActive(index);
  }, []);

  const moveTo = useCallback((index: number) => {
    const normalized = normalizeSectionIndex(index, HOME_SECTION_IDS.length);
    const root = rootRef.current;
    const section = sectionRefs.current[normalized];
    animationTarget.current = normalized;
    setActive(normalized);
    if (!root || !section) return;

    const targetTop = section.offsetTop;
    if (scrollAnimation.current !== undefined) {
      window.cancelAnimationFrame(scrollAnimation.current);
      scrollAnimation.current = undefined;
    }
    if (reducedMotion) {
      root.classList.remove("is-section-animating");
      root.scrollTop = targetTop;
      revealScene(normalized);
      return;
    }

    const startTop = root.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
      root.classList.remove("is-section-animating");
      root.scrollTop = targetTop;
      revealScene(normalized);
      return;
    }
    root.classList.add("is-section-animating");
    const duration = Math.min(680, Math.max(540, Math.abs(distance) * 0.86));
    const startedAt = window.performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const easedProgress = easeSectionTransition(progress);
      root.scrollTop = startTop + distance * easedProgress;
      revealScene(getSceneEntryIndex({
        progress: easedProgress,
        current: sceneActiveRef.current,
        target: normalized,
      }));
      if (progress < 1) {
        scrollAnimation.current = window.requestAnimationFrame(step);
      } else {
        root.scrollTop = targetTop;
        root.classList.remove("is-section-animating");
        scrollAnimation.current = undefined;
        setActive(normalized);
        revealScene(normalized);
      }
    };
    scrollAnimation.current = window.requestAnimationFrame(step);
  }, [reducedMotion, revealScene]);

  useEffect(() => {
    const root = rootRef.current;
    return () => {
      window.clearTimeout(wheelResetTimer.current);
      if (scrollAnimation.current !== undefined) {
        window.cancelAnimationFrame(scrollAnimation.current);
      }
      root?.classList.remove("is-section-animating");
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="home-scroll-story"
      tabIndex={0}
      aria-label="学习总览"
      onScroll={(event) => {
        if (scrollAnimation.current !== undefined) return;
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
        setActive((current) => (current === closest ? current : closest));
        revealScene(closest);
      }}
      onWheel={(event) => {
        if (reducedMotion) return;

        event.preventDefault();
        const scale = event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? event.currentTarget.clientHeight
            : 1;
        const result = advanceWheelGesture(
          wheelGesture.current,
          event.deltaY * scale,
          48
        );
        wheelGesture.current = result.state;
        window.clearTimeout(wheelResetTimer.current);
        wheelResetTimer.current = window.setTimeout(() => {
          wheelGesture.current = { sum: 0, triggered: false };
        }, 160);
        if (result.direction === 0) return;

        const base = scrollAnimation.current !== undefined
          ? animationTarget.current
          : active;
        moveTo(base + result.direction);
      }}
      onKeyDown={(event) => {
        if (["ArrowDown", "PageDown"].includes(event.key)) { event.preventDefault(); moveTo(animationTarget.current + 1); }
        if (["ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); moveTo(animationTarget.current - 1); }
        if (event.key === "Home") { event.preventDefault(); moveTo(0); }
        if (event.key === "End") { event.preventDefault(); moveTo(HOME_SECTION_IDS.length - 1); }
      }}
    >
      <motion.div
        aria-hidden
        className="home-scroll-progress"
        style={{ scaleX: reducedMotion ? 1 : smoothScrollProgress }}
      />
      <div ref={(node) => { sectionRefs.current[0] = node; }}>
        <HomeHero
          hasSession={hasSession}
          hydrated={hydrated}
          mode={mode}
          currentStage={insights.currentStage}
          pathReady={pathReady}
          scrollProgress={smoothScrollProgress}
        />
      </div>
      <div ref={(node) => { sectionRefs.current[1] = node; }}>
        <HomeLearningBoard
          insights={insights}
          modules={modules}
          studyTime={studyTime}
          isActive={sceneActive === 1}
        />
      </div>
      <div ref={(node) => { sectionRefs.current[2] = node; }}>
        <HomeResourceFinale
          resources={resources}
          scrollProgress={smoothScrollProgress}
          isActive={sceneActive === 2}
        />
      </div>

      <div className="home-story-dots" aria-label="首页章节">
        {HOME_SECTION_IDS.map((id, index) => (
          <button
            key={id}
            type="button"
            aria-label={`前往第 ${index + 1} 屏`}
            aria-current={active === index ? "step" : undefined}
            onClick={() => moveTo(index)}
            className={active === index ? "is-active" : undefined}
          />
        ))}
      </div>
    </div>
  );
}
