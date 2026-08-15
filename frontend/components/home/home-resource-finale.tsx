import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  FilePlus2,
  Library,
} from "lucide-react";
import { motion, useReducedMotion, useTransform, type MotionValue } from "framer-motion";

import type { ResourceItem } from "@/lib/types";
import { WEB_EASE } from "@/lib/web-motion";

const ACTIONS = [
  { href: "/studio", label: "继续答疑", desc: "带着上下文继续提问", icon: BookOpen },
  { href: "/create", label: "生成资料", desc: "讲义、导图与题库", icon: FilePlus2 },
  { href: "/diagnostic", label: "学情摸底", desc: "更新画像与学习建议", icon: ClipboardCheck },
];

export function HomeResourceFinale({
  resources,
  scrollProgress,
  isActive,
}: {
  resources: ResourceItem[];
  scrollProgress: MotionValue<number>;
  isActive: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const artY = useTransform(scrollProgress, [0.58, 1], [48, -18]);

  return (
    <section
      className="home-story-section home-finale"
      data-section="resources"
      data-scene-active={isActive}
    >
      <motion.div
        className="home-finale__art"
        aria-hidden
        initial={false}
        animate={isActive
          ? { x: 0, rotate: -0.6, scale: 1 }
          : { x: -64, rotate: -1.4, scale: 0.975 }}
        transition={{ duration: reducedMotion ? 0 : 0.72, ease: WEB_EASE }}
        style={reducedMotion ? undefined : { y: artY }}
      >
        <Image src="/brand/animals/resource-desk.webp" alt="" fill sizes="46vw" className="object-cover" />
      </motion.div>
      <motion.div
        className="home-finale__content"
        initial={false}
        animate={isActive ? { y: 0, scale: 1 } : { y: 52, scale: 0.985 }}
        transition={{
          duration: reducedMotion ? 0 : 0.68,
          delay: reducedMotion || !isActive ? 0 : 0.08,
          ease: WEB_EASE,
        }}
      >
        <span className="paper-kicker"><span /> 最近资源</span>
        <h2>把学过的内容，留成可以再次使用的材料</h2>
        <p>讲义、练习、视频笔记和学习路径都在同一个资源脉络里。</p>

        <div className="web-paper-panel recent-resource-list">
          <div className="recent-resource-list__head">
            <strong>最近生成</strong>
            <Link href="/resources">查看全部 <ArrowRight className="size-3.5" /></Link>
          </div>
          {resources.length > 0 ? (
            resources.slice(0, 4).map((resource) => (
              <Link key={resource.id} href="/resources" className="recent-resource-row">
                <Library className="size-4" />
                <span><strong>{resource.title}</strong><small>{resource.subtitle}</small></span>
                <em>{resource.status === "ready" ? "已过审" : resource.status === "review" ? "待审核" : "生成中"}</em>
                <ArrowRight className="size-4" />
              </Link>
            ))
          ) : (
            <div className="recent-resource-empty">还没有生成资料，先从一次答疑或课程知识点开始。</div>
          )}
        </div>

        <div className="home-action-strip">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link href={action.href} key={action.href}>
                <Icon className="size-5" />
                <span><strong>{action.label}</strong><small>{action.desc}</small></span>
                <ArrowRight className="size-4" />
              </Link>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
}
