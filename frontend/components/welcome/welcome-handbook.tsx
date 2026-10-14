"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PageFlip } from "page-flip";
import { GUIDE_CHAPTERS } from "@/lib/welcome";
import { playDesktopPageTurn } from "@/lib/desktop-sounds";
import styles from "./handbook.module.css";

const PAGE_COUNT = 16;
const numerals = "壹贰叁肆伍陆";
const chapterImages = ["/brand/path/path-learning-landscape-v1.webp", "/brand/resources/resource-center-hero-v3.webp", "/brand/market/algorithm-map-ink.png", "/brand/resources/resource-entry-kb-engraving-v1.webp", "/brand/profile/profile-scholar-desk.png", "/brand/market/learning-path-ink.png"];
const coaching = [
  "这是你的入门手册。像翻一本书一样，先认识学枢，再建立属于自己的学习档案。",
  "点击右侧的“下一页”翻阅，也可以拖动书页的外侧边角。左侧按钮可以翻回上一页。",
  "随时点击“目录”回到内容导读，也可以直接点击目录中的章节，跳到想了解的内容。",
  "了解之后，点击“建立学习档案”。年级、专业、学习偏好和目标，之后都可以继续调整。",
];

function ChapterPreview({ index }: { index: number }) {
  if (index === 2) return <div className={styles.codePreview}><div>实训工作台 <span>Python</span></div><pre><span># 把理解写成代码</span>{"\ndef reverse(items):\n    return items[::-1]\n\nprint(reverse([1, 2, 3]))"}</pre><footer>运行结果 <strong>[3, 2, 1]</strong></footer></div>;
  if (index === 4) return <div className={styles.graphPreview} aria-label="知识点关联示意"><svg viewBox="0 0 300 190" aria-hidden><path d="M150 95 60 40M150 95 248 40M150 95 60 153M150 95 250 150" fill="none" stroke="#8b9d76" strokeDasharray="3 4" /><circle cx="150" cy="95" r="35" fill="#f7eedc" stroke="#ac7840"/><circle cx="60" cy="40" r="28"/><circle cx="248" cy="40" r="28"/><circle cx="60" cy="153" r="28"/><circle cx="250" cy="150" r="28"/><text x="150" y="99">数据结构</text><text x="60" y="44">线性表</text><text x="248" y="44">树</text><text x="60" y="157">栈与队列</text><text x="250" y="154">图</text></svg><p>每个知识点，都有自己的学习轨迹。</p></div>;
  if (index === 5) return <div className={styles.conversation}><p>我知道递归的定义，但写代码时总找不到终止条件。</p><p>我们从一个小例子开始：当问题已经小到可以直接回答时，就可以停止递归了。</p><span>带着你正在思考的问题来。</span></div>;
  return <div className={styles.pathPreview}>{(index === 0 ? ["确定学习目标", "安排课程路径", "练习与复盘"] : index === 1 ? ["今日安排", "学习分析", "成长记录"] : ["生成一份资料", "收进资源书架", "随时翻开复习"]).map((text, i) => <div key={text}><span>{String(i + 1).padStart(2, "0")}</span><strong>{text}</strong></div>)}</div>;
}

export function WelcomeHandbook({ onContinue, onClose, returning = false }: { onContinue: () => void; onClose?: () => void; returning?: boolean }) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PageFlip | null>(null);
  const pageRef = useRef(0);
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [turning, setTurning] = useState(false);
  const [coach, setCoach] = useState<number | null>(returning ? null : 0);
  const reducedMotion = useReducedMotion();

  const turn = useCallback((target: number | "next" | "prev") => {
    const engine = engineRef.current;
    if (!engine || engine.getState() !== "read") return;
    playDesktopPageTurn(target === "prev" || (typeof target === "number" && target < pageRef.current) ? "closing" : "opening");
    if (reducedMotion) {
      if (target === "next") engine.turnToNextPage();
      else if (target === "prev") engine.turnToPrevPage();
      else engine.turnToPage(target);
    } else if (target === "next") engine.flipNext("bottom");
    else if (target === "prev") engine.flipPrev("bottom");
    else engine.flip(target, "bottom");
  }, [reducedMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    const source = sourceRef.current;
    if (!mount || !source) return;
    let disposed = false;
    let timer = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    let destroy = () => {};
    const initialize = () => {
      if (disposed) return;
      const bounds = mount.getBoundingClientRect();
      // The replay lives inside a native dialog, whose layout starts after showModal().
      if (bounds.width < 1 || bounds.height < 1) return;
      if (Math.abs(bounds.width - lastWidth) < 2 && Math.abs(bounds.height - lastHeight) < 2) return;
      lastWidth = bounds.width; lastHeight = bounds.height;
      destroy();
      const portrait = bounds.width < 700;
      const width = Math.min(bounds.width / (portrait ? 1 : 2), bounds.height * .75);
      const height = width / .75;
      const host = document.createElement("div");
      host.className = styles.flipHost;
      host.style.setProperty("--page-font", `${Math.max(11, width / 480 * 14)}px`);
      host.style.setProperty("--cover-shift", portrait ? "0px" : `${width / 2}px`);
      mount.appendChild(host);
      const pages = Array.from(source.children).map((element) => element.cloneNode(true) as HTMLElement);
      pages.forEach((element) => host.appendChild(element));
      const engine = new PageFlip(host, { width, height, size: "fixed", showCover: true, usePortrait: portrait, autoSize: false, drawShadow: true, maxShadowOpacity: .24, flippingTime: reducedMotion ? 1 : 800, mobileScrollSupport: false, clickEventForward: true, useMouseEvents: !reducedMotion, showPageCorners: !reducedMotion, disableFlipByClick: true, startPage: pageRef.current });
      engineRef.current = engine;
      const update = (index: number) => {
        if (disposed) return;
        pageRef.current = index;
        setPage(index);
        host.dataset.cover = index === 0 ? "front" : index === PAGE_COUNT - 1 ? "back" : "open";
        pages.forEach((element, i) => {
          const visible = i === index || (!portrait && index > 0 && index < PAGE_COUNT - 1 && i === index + 1);
          element.inert = !visible;
          element.setAttribute("aria-hidden", String(!visible));
        });
      };
      engine.on<number>("flip", (event) => update(event.data));
      engine.on("init", () => { if (!disposed) { update(engine.getCurrentPageIndex()); setReady(true); setTurning(false); } });
      engine.on<string>("changeState", (event) => { if (!disposed) setTurning(event.data !== "read"); });
      const click = (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-jump]");
        if (target) { event.preventDefault(); turn(Number(target.dataset.jump)); }
      };
      host.addEventListener("click", click);
      let dragged = false;
      const pointerDown = () => { dragged = false; };
      const pointerMove = (event: PointerEvent) => { if (event.buttons && !dragged && engine.getState() === "user_fold") { dragged = true; playDesktopPageTurn("opening"); } };
      host.addEventListener("pointerdown", pointerDown);
      host.addEventListener("pointermove", pointerMove);
      engine.loadFromHTML(pages);
      update(pageRef.current);
      destroy = () => {
        host.removeEventListener("click", click);
        host.removeEventListener("pointerdown", pointerDown);
        host.removeEventListener("pointermove", pointerMove);
        engine.off("init"); engine.off("flip"); engine.off("changeState");
        engine.destroy();
        if (engineRef.current === engine) engineRef.current = null;
      };
    };
    initialize();
    const observer = new ResizeObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(initialize, 160); });
    observer.observe(mount);
    return () => { disposed = true; observer.disconnect(); window.clearTimeout(timer); destroy(); };
  }, [reducedMotion, turn]);

  const chapter = Math.max(0, Math.min(GUIDE_CHAPTERS.length - 1, Math.floor((page - 3) / 2)));
  const pageLabel = page === 0 ? "封面 · 点击翻开手册" : page === 1 || page === 2 ? "目录 · 认识学枢" : page === PAGE_COUNT - 1 ? "合卷 · 准备出发" : `第${numerals[chapter]}章 · ${GUIDE_CHAPTERS[chapter].title}`;

  return <section className={styles.handbook} aria-labelledby="handbook-title">
    <header className={styles.header}><div><span className={styles.seal}>学枢</span><div><p>新生入学 · 第一卷</p><h1 id="handbook-title">使用指南</h1></div></div><div className={styles.headerActions}><button type="button" onClick={() => setCoach(0)}>操作说明</button>{onClose && <button type="button" onClick={onClose}>关闭手册</button>}</div></header>
    <div className={styles.bookArea}>
      <div className={styles.sideControls}><button type="button" aria-label="上一页" disabled={!ready || turning || page === 0} onClick={() => turn("prev")}>‹<span>上一页</span></button><button type="button" data-coached={coach === 2} disabled={!ready || turning} onClick={() => turn(1)}>目<span>目录</span></button></div>
      <div className={styles.bookStage} ref={mountRef} aria-label="可翻阅的入门手册" />
      <div className={styles.sideControls}><button type="button" data-coached={coach === 1} aria-label={page === 0 ? "翻开手册" : "下一页"} disabled={!ready || turning || page === PAGE_COUNT - 1} onClick={() => turn("next")}>›<span>{page === 0 ? "翻开" : "下一页"}</span></button><button type="button" data-coached={coach === 3} aria-label={returning ? "开始入口引导" : "建立学习档案"} onClick={onContinue}>启<span>下一步</span></button></div>
    </div>
    <div className={styles.progress}><span aria-live="polite" aria-atomic="true">{pageLabel}</span><div aria-hidden>{Array.from({ length: 8 }, (_, i) => <i key={i} data-active={Math.min(7, Math.ceil(page / 2)) === i} />)}</div><span>{String(page + 1).padStart(2, "0")} / {PAGE_COUNT}</span></div>
    <AnimatePresence mode="wait">{coach !== null ? <motion.aside key="coach" className={styles.coach} initial={reducedMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} aria-label="手册操作引导"><div className={styles.coachTitle}><span>入学向导</span><small>{coach + 1} / 4</small></div><p key={coach} aria-live="polite">{coaching[coach]}</p><div><button type="button" onClick={() => setCoach(null)}>跳过提示</button><button type="button" className={styles.coachNext} onClick={() => setCoach(coach === 3 ? null : coach + 1)}>{coach === 3 ? "开始阅读" : "继续了解"} <span aria-hidden>→</span></button></div></motion.aside> : <motion.footer key="continue" className={styles.footer} initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div><strong>{returning ? "需要时，随时回来翻一翻" : "读过这一卷，就从自己的目标出发"}</strong><p>可拖动页角翻阅，也可通过目录直接选择章节。</p></div><button type="button" onClick={onContinue}>{returning ? "开始入口引导" : "建立学习档案"} <span aria-hidden>→</span></button></motion.footer>}</AnimatePresence>

    <div ref={sourceRef} hidden aria-hidden="true">
      <div className={`${styles.page} ${styles.cover}`} data-density="hard"><div className={styles.coverFrame}><p>学枢 · 新生入学</p><span className={styles.coverSeal}>学</span><h2>学习之旅<br />从此开卷</h2><div className={styles.coverRule} /><p>入门手册</p><small>知有所循 · 学有所成</small></div></div>
      <div className={styles.page}><div className={styles.paper}><div className={styles.runningHead}>内容导读 <span>CONTENTS</span></div><h2>开卷有序</h2><p className={styles.subtitle}>找到你想了解的那一页。</p><nav className={styles.contents} aria-label="入门手册目录">{GUIDE_CHAPTERS.map((entry, index) => <button key={entry.title} type="button" data-jump={3 + index * 2}><span>{numerals[index]}</span><strong>{entry.title}</strong><i /><small>{String(4 + index * 2).padStart(2, "0")}</small></button>)}</nav><p className={styles.note}>不用一次记住所有功能。<br />有需要时，随时回来翻一翻。</p><footer>学枢 · 入门手册 <span>02</span></footer></div></div>
      <div className={styles.page}><div className={`${styles.paper} ${styles.preface}`}><div className={styles.runningHead}>写在开始之前 <span>WELCOME</span></div><h2>欢迎来到<br />你的学习书房</h2><div className={styles.prefaceLandscape} /><p>每个人的基础、节奏和目标都不同。<br />从你的实际情况开始，慢慢找到适合自己的学习方法。</p><blockquote>先理解，再练习。<br />让知识在一次次使用中，<br />真正成为自己的能力。</blockquote><footer>从一个小问题开始 <span>03</span></footer></div></div>
      {GUIDE_CHAPTERS.map((entry, index) => <Fragment key={entry.title}><div className={styles.page}><div className={`${styles.paper} ${styles.illustration}`}><div className={styles.runningHead}>第{numerals[index]}章 <span>功能导读</span></div><div className={styles.chapterArt} style={{ backgroundImage: `linear-gradient(180deg, #f5eddd00 40%, #f5eddd), url('${chapterImages[index]}')` }} /><span className={styles.chapterNumeral}>{numerals[index]}</span><h2>{entry.title}</h2><p className={styles.subtitle}>{entry.subtitle}</p><ChapterPreview index={index} /><footer>功能示意 · 从这里认识学枢 <span>{String(4 + index * 2).padStart(2, "0")}</span></footer></div></div><div className={styles.page}><div className={styles.paper}><div className={styles.runningHead}>学枢 · 使用指南 <span>第{numerals[index]}章</span></div><h2>{entry.title}</h2><p className={styles.subtitle}>{entry.subtitle}</p><p className={styles.body}>{entry.body}</p><ol className={styles.points}>{entry.points.map((point, i) => <li key={point}><span>{String(i + 1).padStart(2, "0")}</span><p>{point}</p></li>)}</ol><aside className={styles.note}>{entry.note}</aside><footer>循序而学 · 温故而知新 <span>{String(5 + index * 2).padStart(2, "0")}</span></footer></div></div></Fragment>)}
      <div className={`${styles.page} ${styles.cover}`} data-density="hard"><div className={styles.coverFrame}><span className={styles.coverSeal}>启</span><h2>下一页<br />写下你的目标</h2><div className={styles.coverRule} /><p>建立学习档案，开始第一段旅程。</p><small>学枢 · 与你一同求知</small></div></div>
    </div>
  </section>;
}
