/** Shared, bounded intent rules for teacher-driven software actions. */

export interface AgentResourceCandidate {
  id: string;
  type: string;
  title: string;
  status: string;
}

export interface AgentResourceAction {
  action: "open_resource" | "none";
  resource_id?: string;
  label?: string;
  reply?: string;
}

const RESOURCE_TYPES = new Set([
  "video",
  "explainer",
  "quiz",
  "mindmap",
  "courseware",
  "code",
  "reading",
  "interactive",
]);

const TYPE_TERMS: Record<string, readonly string[]> = {
  video: ["视频", "动画", "短片"],
  explainer: ["讲义", "讲解", "文章"],
  quiz: ["题目", "练习", "测验", "题库"],
  mindmap: ["导图", "思维导图"],
  courseware: ["课件", "PPT", "ppt"],
  code: ["代码", "示例"],
  reading: ["阅读", "扩展资料", "拓展资料"],
  interactive: ["交互演示", "演示", "三维", "3D", "模型"],
};

const OPEN_VERBS = "打开|播放|看看|查看|调出|显示|阅读";
const RESOURCE_NOUNS = "资料|视频|讲义|题目|练习|导图|课件|代码|资源中心(?:里|里面)?(?:的)?(?:东西|内容|文件|资源)?";
const OPEN_RESOURCE_RE = new RegExp(
  `(?:${OPEN_VERBS}).{0,24}(?:${RESOURCE_NOUNS})|(?:${RESOURCE_NOUNS}).{0,16}(?:${OPEN_VERBS})`,
  "i",
);
const HOW_TO_OPEN_RE = new RegExp(`(?:如何|怎么|怎样).{0,18}(?:${OPEN_VERBS}).{0,18}(?:${RESOURCE_NOUNS})`, "i");

const GENERATION_KEYWORDS = [
  "生成", "出题", "给我出", "帮我出", "帮我生成", "来一份", "来一套",
  "整理一份", "资料包", "复习资料", "学习资料", "学习路径", "学习计划", "讲义", "笔记",
  "导图", "思维导图", "题库", "练习题", "热身题", "道题", "几道题",
  "代码案例", "动画演示", "课件", "PPT", "ppt",
] as const;

export function isResourceOpenIntent(raw: string): boolean {
  const text = raw.replace(/[\r\n]+/g, " ").trim();
  if (!text || HOW_TO_OPEN_RE.test(text)) return false;
  return OPEN_RESOURCE_RE.test(text);
}

export function wantsResourceGeneration(text: string): boolean {
  return !isResourceOpenIntent(text) && GENERATION_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function hasResourceTypeHint(text: string): boolean {
  return Object.values(TYPE_TERMS).some((terms) => terms.some((term) => text.includes(term)));
}

export function readyResourceCandidates(
  resources: readonly AgentResourceCandidate[],
): AgentResourceCandidate[] {
  return resources
    .filter((resource) =>
      resource.status === "ready" &&
      Boolean(resource.id.trim()) &&
      Boolean(resource.title.trim()) &&
      RESOURCE_TYPES.has(resource.type),
    )
    .slice(0, 100)
    .map((resource) => ({
      id: resource.id.slice(0, 200),
      type: resource.type.slice(0, 40),
      title: resource.title.slice(0, 240),
      status: "ready",
    }));
}

/** Deterministic fallback used when the action planner is unavailable. */
export function fallbackResourceAction(
  utterance: string,
  resources: readonly AgentResourceCandidate[],
): AgentResourceAction {
  if (!isResourceOpenIntent(utterance)) return { action: "none" };
  const safe = readyResourceCandidates(resources);
  const requestedType = Object.entries(TYPE_TERMS).find(([, terms]) =>
    terms.some((term) => utterance.includes(term)),
  )?.[0];
  const candidates = requestedType
    ? safe.filter((resource) => resource.type === requestedType)
    : safe;
  if (candidates.length === 0) return { action: "none" };

  const ignored = new Set(
    "请帮我把给打开播放看看查看调出显示阅读一下一个一份这个那个学习资料视频讲义题目练习导图课件代码".split(""),
  );
  const keywords = [...utterance].filter((character) =>
    !ignored.has(character) && !/[\s，。！？!?、]/.test(character),
  );
  const selected = candidates
    .map((resource, index) => ({
      resource,
      index,
      score: keywords.reduce(
        (score, character) => score + (resource.title.includes(character) ? 1 : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0].resource;

  return {
    action: "open_resource",
    resource_id: selected.id,
    label: `打开《${selected.title}》`,
    reply: `好的，已经为你打开《${selected.title}》。`,
  };
}
