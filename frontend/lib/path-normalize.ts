import type { PathStep } from "./types";

const STAGE_SUFFIX_ALIASES = [
  { suffix: "基础定位", aliases: ["基础定位", "础定位"] },
  { suffix: "核心框架", aliases: ["核心框架", "心框架"] },
  { suffix: "方法拆解", aliases: ["方法拆解", "法拆解"] },
  { suffix: "实战应用", aliases: ["实战应用", "战应用"] },
  { suffix: "综合检测", aliases: ["综合检测", "合检测"] },
];

function findStageSuffix(text: string): string {
  return STAGE_SUFFIX_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => text.includes(alias))
  )?.suffix ?? "";
}

function stripStageSuffix(text: string): string {
  let next = text;
  for (const { aliases } of STAGE_SUFFIX_ALIASES) {
    for (const alias of aliases) {
      next = next.replace(new RegExp(`${alias}$`), "");
    }
  }
  return next.trim();
}

function extractTopic(text: string): string | null {
  const explicit = text.match(
    /(?:帮我|给我|请|麻烦|来一份|来一套|一份|一套|生成|整理|做|出)\s*(?:生成|整理|做|出)?\s*([A-Za-z0-9+#\u4e00-\u9fff]{2,30}?)的?(?:学习路径|学习计划|学习资料|复习资料|资料包|讲义|笔记|题库)/
  );
  if (explicit) return explicit[1].replace(/^的|的$/g, "").trim() || null;

  for (const segment of text.split(/[\s，。；,;]+/)) {
    const direct = segment.match(
      /^([A-Za-z0-9+#\u4e00-\u9fff]{2,30}?)的?(?:学习路径|学习计划|学习资料|复习资料|资料包)/
    );
    if (direct) return direct[1].replace(/^的|的$/g, "").trim() || null;
  }
  return null;
}

export function normalizePathTitle(title: string, context = title): string {
  const suffix = findStageSuffix(context);
  const topic = extractTopic(context) ?? extractTopic(title);
  if (topic) return `${topic}${suffix}`;

  const cleaned = title
    .replace(/告诉我.*$|怎么学习.*$|怎么学.*$|不要.*$/g, "")
    .replace(/学习路径|学习计划|学习资料|复习资料|资料包/g, "")
    .replace(/^的|的$/g, "")
    .trim();
  if (suffix) return `${stripStageSuffix(cleaned)}${suffix}`;
  return cleaned || title;
}

function normalizePathText(text: string | undefined, oldTitle: string, newTitle: string): string | undefined {
  if (!text) return text;
  const normalized = text
    .replace(/「[^」]*(?:学习路径|学习计划|告诉我|怎么学习|不要)[^」]*」/g, `「${newTitle}」`)
    .replace(/「([^」]*(?:基础定位|础定位|核心框架|心框架|方法拆解|法拆解|实战应用|战应用|综合检测|合检测))」/g, (_, inner: string) => `「${normalizePathTitle(inner, inner)}」`)
    .replace(`「${oldTitle}」`, `「${newTitle}」`);

  if (oldTitle.length <= 4 && newTitle.startsWith(oldTitle)) return normalized;
  return normalized.replace(oldTitle, newTitle);
}

function normalizeTaskTitle(title: string): string {
  const separator = title.indexOf("：");
  if (separator < 0) return normalizePathTitle(title);
  const prefix = title.slice(0, separator + 1);
  const rest = title.slice(separator + 1);
  return `${prefix}${normalizePathTitle(rest)}`;
}

export function normalizePathSteps(path: PathStep[]): PathStep[] {
  return path.map((step) => {
    const context = [
      step.title,
      step.desc,
      step.objective,
      ...(step.steps?.map((task) => task.title) ?? []),
    ].filter(Boolean).join(" ");
    const normalizedTitle = normalizePathTitle(step.title, context);
    const firstTaskTitle = step.steps?.[0]?.title
      ?.replace(/^(?:学习|练习|复盘)[：:]/, "")
      .trim();
    const title =
      (normalizedTitle.length <= 2 || ["通过", "学习", "完成"].includes(normalizedTitle)) &&
      firstTaskTitle
        ? normalizePathTitle(firstTaskTitle)
        : normalizedTitle;
    return {
      ...step,
      title,
      desc: normalizePathText(step.desc, step.title, title) ?? step.desc,
      objective: normalizePathText(step.objective, step.title, title),
      steps: step.steps?.map((task) => ({
        ...task,
        title: normalizeTaskTitle(task.title),
      })),
    };
  });
}
