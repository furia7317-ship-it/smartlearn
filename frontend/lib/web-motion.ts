export const HOME_SECTION_IDS = ["welcome", "workspace", "resources"] as const;

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export function normalizeSectionIndex(index: number, total: number) {
  return Math.min(Math.max(index, 0), Math.max(total - 1, 0));
}

export function getSectionIntent(input: {
  delta: number;
  threshold: number;
  current: number;
  total: number;
}) {
  if (Math.abs(input.delta) < input.threshold) return input.current;
  return normalizeSectionIndex(
    input.current + Math.sign(input.delta),
    input.total
  );
}

export type WheelGestureState = {
  sum: number;
  triggered: boolean;
};

export function advanceWheelGesture(
  state: WheelGestureState,
  delta: number,
  threshold: number
) {
  if (state.triggered) return { state, direction: 0 };
  const sum = state.sum + delta;
  if (Math.abs(sum) < threshold) {
    return { state: { sum, triggered: false }, direction: 0 };
  }
  return {
    state: { sum: 0, triggered: true },
    direction: Math.sign(sum),
  };
}

export function easeSectionTransition(progress: number) {
  const t = Math.min(Math.max(progress, 0), 1);
  return 1 - (1 - t) ** 3;
}

const HOME_SCENE_REVEAL_PROGRESS = 0.92;

export function getSceneEntryIndex(input: {
  progress: number;
  current: number;
  target: number;
}) {
  return input.progress >= HOME_SCENE_REVEAL_PROGRESS
    ? input.target
    : input.current;
}

export const WEB_EASE = [0.22, 1, 0.36, 1] as const;

export const WEB_PAGE_ENTER = { y: 18, scale: 0.992 };

export const WEB_REVEAL = {
  hidden: { y: 24 },
  visible: { y: 0 },
};

/* ── 桌面壳动效（与 web 壳共用节奏，令牌见 globals.css :root） ── */

export const DESKTOP_PAGE_DURATION = 0.14;

/** 左侧导航翻书过场：路由与合书并行，时长只负责视觉节奏，不再阻塞导航。 */
export const DESKTOP_BOOK_CLOSE_DURATION_MS = 160;
export const DESKTOP_BOOK_OPEN_DURATION_MS = 180;

/** 路由过场终态：只有 transform，永远不隐藏页面。 */
export const DESKTOP_PAGE_SETTLED = { x: 0, scale: 1 };

/** 常规桌面路由的入场起始态（横向轻推，呼应左侧栏导航方向）。 */
export const DESKTOP_PAGE_ENTER = { x: 8, scale: 0.999 };

/**
 * 位移敏感路由的入场起始态：只留一点点缩放。
 * - /desktop/studio 的 <webview> 是 position:fixed 挂在根层、不在 <main> 内，位移会让它错位；
 */
export const DESKTOP_PAGE_ENTER_STILL = { x: 0, scale: 0.9995 };

const DESKTOP_STILL_ROUTES = ["/desktop/studio"];

/** trailingSlash:true 会让 pathname 带尾斜杠，作为动画触发键前必须归一化。 */
export function normalizeRouteKey(pathname: string | null | undefined) {
  if (!pathname) return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function getDesktopPageEnter(pathname: string | null | undefined) {
  const key = normalizeRouteKey(pathname);
  const still = DESKTOP_STILL_ROUTES.some(
    (route) => key === route || key.startsWith(`${route}/`)
  );
  return still ? DESKTOP_PAGE_ENTER_STILL : DESKTOP_PAGE_ENTER;
}

/** 侧栏激活指示条的滑动时长，与 .desktop-rail-link 的 150ms 对齐。 */
export const DESKTOP_RAIL_INDICATOR_DURATION = 0.12;

/** 页内视图切换（tab 条件渲染）的时长。 */
export const DESKTOP_VIEW_SWAP_DURATION = 0.18;

/** 首页案卷分页的方向。1 表示向后翻，-1 表示向前翻。 */
export type DesktopPagerDirection = 1 | -1;

/**
 * 首页三页分页使用横向、可感知方向的过场；距离保持克制，避免数据图表在
 * Electron 窗口里产生大面积重绘。退出页与进入页方向相反，返回时自然反转。
 */
export function getDesktopPagerSwap(reduced: boolean) {
  const settled = { opacity: 1, x: 0, scale: 1 };
  if (reduced) {
    return {
      initial: () => settled,
      animate: settled,
      exit: () => settled,
      transition: { duration: 0 },
    };
  }
  return {
    initial: (direction: DesktopPagerDirection = 1) => ({
      opacity: 0,
      x: direction * 28,
      scale: 0.996,
    }),
    animate: settled,
    exit: (direction: DesktopPagerDirection = 1) => ({
      opacity: 0,
      x: direction * -20,
      scale: 0.997,
    }),
    transition: {
      duration: 0.24,
      ease: WEB_EASE,
    },
  };
}

/**
 * 页内视图切换的 AnimatePresence 属性。
 * reduced 时所有关键帧收敛到终态且时长为 0——CSS 的 !important 兜底管不到
 * framer-motion 写在 style 上的 inline transform，必须在 JS 侧显式降级。
 */
export function getDesktopViewSwap(reduced: boolean) {
  const settled = { opacity: 1, y: 0 };
  return {
    initial: reduced ? settled : { opacity: 0, y: 8 },
    animate: settled,
    exit: reduced ? settled : { opacity: 0, y: -6 },
    transition: {
      duration: reduced ? 0 : DESKTOP_VIEW_SWAP_DURATION,
      ease: WEB_EASE,
    },
  };
}
