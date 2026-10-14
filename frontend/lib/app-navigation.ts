import catalog from "./app-guide.json" with { type: "json" };

export type AppDestination = (typeof catalog.entries)[number];
export const APP_DESTINATIONS: readonly AppDestination[] = catalog.entries;
export const APP_NAVIGATION_EVENT = "xueshu:app-navigation";
export const TEACHER_TOOL_EVENT = "xueshu:teacher-tool";

export function appDestination(id: unknown): AppDestination | undefined {
  return typeof id === "string" ? APP_DESTINATIONS.find((entry) => entry.id === id) : undefined;
}

export function appFeatureSelection<T extends string>(href: string, pathname: string, parameter: string, allowed: readonly T[]): T | null {
  const url = new URL(href, "http://app.local");
  if (url.pathname.replace(/\/$/, "") !== pathname.replace(/\/$/, "")) return null;
  const value = url.searchParams.get(parameter);
  return value && allowed.includes(value as T) ? value as T : null;
}

const normalize = (value: string) => value.replace(/[\s，。！？!?、：:]/g, "").toLowerCase();
const EXPLAIN_ONLY = /怎么|如何|怎样|哪里|在哪|能否|是否|能不能|不要|别|不想|不能|无法|没有|打不开|如果|假如|比如|例如|假设|解释|说明|[「」“”"`]/;

export function isAppNavigationRequest(question: string): boolean {
  if (parseAppNavigation(question)) return true;
  if (/不要|别|不想|不用|无需|不能|无法|打不开|如果|假如|例如|比如|假设|[「」“”"`]/.test(question)) return false;
  return /^(?:(?:请|麻烦|帮我|给我|带我|我想|我要|现在|直接|你可以|你能|可以|能帮我|能给我))*(?:打开|进入|前往|切换到|跳转到|跳到|回到|返回|去|看一下|查看)/.test(normalize(question));
}

export function isAppPageRequest(question: string): boolean {
  if (parseAppNavigation(question)) return true;
  return isAppNavigationRequest(question) && /(?:资源中心|资料中心|课程知识库|错题本|练习与错题|资源生成|资源创作)(?:的?(?:页面|功能|界面))?(?:$|[，。！？!?]|并|然后|好吗|吗)/.test(question);
}

/** Only a direct, single request executes locally. Mixed/ambiguous input goes to the agent. */
export function parseAppNavigation(raw: string): AppDestination | null {
  if (raw.length > 100 || EXPLAIN_ONLY.test(raw)) return null;
  let text = normalize(raw).replace(/^(?:(?:请|麻烦|帮我|给我|带我|我想|我要|现在|直接|你可以|你能|可以|能帮我|能给我))+/u, "");
  text = text.replace(/(?:可以吗|好吗|行吗|一下|看看|吧|吗)+$/u, "");
  const match = text.match(/^(?:打开|进入|前往|切换到|跳转到|跳到|回到|返回|去|看一下|查看)(.+)$/u)
    ?? text.match(/^(.+?)(?:给我|帮我)?(?:打开|调出来)$/u);
  if (!match) return null;
  const target = match[1].replace(/^一下/u, "");
  const find = (value: string) => APP_DESTINATIONS.find((entry) => [entry.title, ...entry.aliases].some((name) => normalize(name) === value));
  return find(target) ?? find(target.replace(/(?:这个|的)?(?:页面|界面|功能|模块|页)$/u, "")) ?? null;
}

/** Navigate only through known IDs: model output is never used as a URL. */
export function navigateToAppTarget(id: unknown, router: { push: (href: string) => void }): boolean {
  const target = appDestination(id);
  if (!target) return false;
  if (target.window && window.location.pathname.startsWith("/desktop/")) {
    window.dispatchEvent(new CustomEvent(TEACHER_TOOL_EVENT, { detail: target.window }));
  } else {
    router.push(target.href);
    // Also activates a tab if the destination page is already mounted.
    window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: target.id }));
  }
  return true;
}

export function appHelpAnswer(question: string): string | null {
  if (isAppNavigationRequest(question)) return null;
  if (!/怎么|如何|怎样|哪里|在哪|使用方法|操作方法|使用说明|使用指南|不会用/.test(question)) return null;
  if (/软件|学枢|这个系统|这个平台/.test(question) && !APP_DESTINATIONS.some((item) => question.includes(item.title))) {
    return "学枢的主要入口在左侧：\n\n- 首页：今日任务、最近学习和学习分析。\n- 学习路径：路径总览、课程管理、学习计划和考试测评。\n- 实训中心：选择任务、编写运行代码、查看实训档案。\n- 资源中心：打开书本查看资料，或进入 AI 生成资料、课程知识库。\n- 发现：互动教学和学习市场。\n\n练习与错题可从首页快捷入口进入；个人主页和设置在左下角账号菜单。右下角智能教师支持问答和附件。你可以直接说“打开错题本”或“打开资源中心”，我会带你进入。";
  }
  const terms = normalize(question);
  let matches = APP_DESTINATIONS.filter((item) => [item.title, ...item.aliases].some((name) => terms.includes(normalize(name))));
  if (/严谨模式|协作模式|生成模式/.test(question)) matches = [appDestination("create")!];
  if (/上传.*(?:文件|文档|pdf|图片|附件)|附件.*上传/i.test(question)) matches = [appDestination("teacher")!];
  if (!matches.length) return null;
  // Prefer the named feature over a parent page mentioned in the same question.
  const matchLength = (item: AppDestination) => Math.max(0,
    ...[item.title, ...item.aliases].filter(name => terms.includes(normalize(name))).map(name => name.length));
  const selected = matches.sort((a, b) => matchLength(b) - matchLength(a)).slice(0, 2);
  return selected.map(item => `**${item.title}**\n\n入口：${item.location}。\n\n${item.content}`).join("\n\n");
}
