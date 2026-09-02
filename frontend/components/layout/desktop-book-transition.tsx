"use client";

import Image from "next/image";

export type DesktopBookTransitionPhase = "idle" | "closing" | "closed" | "opening";

export function DesktopBookTransition({
  phase,
  label,
}: {
  phase: DesktopBookTransitionPhase;
  label: string;
}) {
  if (phase === "idle") return null;

  return (
    <div
      className="desktop-book-transition"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-label={`正在打开${label}`}
    >
      <div className="desktop-book-transition__stage" aria-hidden>
        <div className="desktop-book-transition__left-page">
          <div className="desktop-book-transition__page-copy">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="desktop-book-transition__turning-cover">
          <div className="desktop-book-transition__page-face">
            <div className="desktop-book-transition__page-copy">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="desktop-book-transition__cover-face">
            <Image
              src="/brand/xueshu-app-icon-128.webp"
              alt=""
              width={44}
              height={44}
              priority
            />
            <strong>学枢</strong>
            <small>XUESHU</small>
          </div>
        </div>
        <span className="desktop-book-transition__spine" />
      </div>
      <p>
        {phase === "closing" || phase === "closed" ? "收起当前章节" : `打开${label}`}
      </p>
    </div>
  );
}
