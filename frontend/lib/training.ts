import { isCodeLanguage, type CodeLanguage } from "./code-languages.ts";

export type TrainingKind = "implementation" | "completion" | "debugging";

export const TRAINING_KINDS: Record<TrainingKind, { label: string; description: string; action: string }> = {
  implementation: { label: "完整编写", description: "从函数签名出发，独立完成核心实现。", action: "理解要求，再完成实现" },
  completion: { label: "代码补全", description: "阅读已有骨架，补上关键逻辑与边界处理。", action: "阅读骨架，补全 TODO" },
  debugging: { label: "Bug 排查", description: "复现异常、定位原因，修复已有代码中的错误。", action: "先复现问题，再定位修复" },
};

export interface TrainingSource {
  path_signature: string;
  node_index: number;
  node_title: string;
  node_day: string;
  course: string;
}

export interface TrainingTask {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  course: string;
  difficulty: "基础" | "进阶";
  minutes: number;
  tags: string[];
  description: string;
  requirements: string[];
  steps: { title: string; description: string }[];
  starterCode: string;
  examples: { input: string; output: string }[];
  tests: { label: string; expression: string; expected: string }[];
  kind?: TrainingKind;
  source?: TrainingSource;
  testCount?: number;
  createdAt?: string;
}

export const TRAINING_TASKS: TrainingTask[] = [
  {
    id: "circular-queue",
    number: "01",
    title: "循环队列：让数据有序流转",
    subtitle: "用有限的空间，处理不断到来的数据。",
    course: "数据结构",
    difficulty: "进阶",
    minutes: 45,
    tags: ["队列", "数组", "边界处理"],
    description: "模拟一个容量固定的任务队列。通过入队、出队和索引回绕，理解循环队列如何重复利用已经释放的空间。",
    requirements: [
      "实现 solve(capacity, operations)，capacity 为正整数；operations 仅包含 ['enqueue', 整数] 和 ['dequeue']。",
      "按先进先出的顺序处理操作，返回一个列表，依次记录每次 dequeue 的结果；入队操作不产生返回项。",
      "队列为空时出队，记录 None；队列已满时忽略该次入队。",
      "使用长度为 capacity 的数组以及首尾索引实现；用取模处理回绕，避免 pop(0)。公开自测验证输入输出，实现方式需自行复核。",
    ],
    steps: [
      { title: "理解操作约定", description: "用纸笔推演入队、出队，明确空队列和满队列的行为。" },
      { title: "实现循环存储", description: "维护数组、索引和有效元素个数，完成基本操作。" },
      { title: "检查边界情况", description: "运行公开自测，验证空队列、容量为 1 和索引回绕。" },
      { title: "复盘实现", description: "解释如何区分队空与队满，以及取模运算的作用。" },
    ],
    starterCode: "def solve(capacity, operations):\n    # 用固定长度的数组保存队列中的元素\n    queue = [None] * capacity\n    results = []\n    # TODO: 实现入队、出队和索引回绕\n    return results\n\n\nprint(solve(2, [['enqueue', 10], ['enqueue', 20], ['dequeue']]))\n",
    examples: [
      { input: "solve(2, [['enqueue', 10], ['enqueue', 20], ['dequeue']])", output: "[10]" },
      { input: "solve(1, [['dequeue'], ['enqueue', 3], ['enqueue', 4], ['dequeue']])", output: "[None, 3]" },
    ],
    tests: [
      { label: "先进先出", expression: "solve(3, [['enqueue', 10], ['enqueue', 20], ['dequeue'], ['dequeue']])", expected: "[10, 20]" },
      { label: "空队列", expression: "solve(2, [['dequeue'], ['enqueue', 0], ['dequeue'], ['dequeue']])", expected: "[None, 0, None]" },
      { label: "满队列与单个容量", expression: "solve(1, [['enqueue', 3], ['enqueue', 4], ['dequeue'], ['enqueue', 5], ['dequeue']])", expected: "[3, 5]" },
      { label: "索引回绕", expression: "solve(2, [['enqueue', 1], ['enqueue', 2], ['dequeue'], ['enqueue', 3], ['dequeue'], ['enqueue', 4], ['dequeue'], ['dequeue']])", expected: "[1, 2, 3, 4]" },
    ],
  },
  {
    id: "bracket-matching",
    number: "02",
    title: "括号匹配：读懂嵌套结构",
    subtitle: "用一个栈，识别表达式中的成对关系。",
    course: "数据结构",
    difficulty: "基础",
    minutes: 25,
    tags: ["栈", "字符串", "条件判断"],
    description: "为表达式编写一个括号检查器。逐个读取字符，判断三种括号是否配对完整且嵌套顺序正确。",
    requirements: [
      "实现 is_balanced(text)，返回 Python 布尔值 True 或 False。",
      "检查圆括号 ()、方括号 [] 和花括号 {}，忽略其他字符。",
      "左括号必须由对应的右括号按正确的嵌套顺序闭合；空字符串视为匹配。",
      "尝试使用列表模拟栈，并说明遇到右括号时应检查哪些条件。",
    ],
    steps: [
      { title: "推演嵌套顺序", description: "比较 ([]){ } 与 ([)]，说明为什么仅统计数量不够。" },
      { title: "用栈记录括号", description: "左括号入栈，右括号检查栈顶并配对。" },
      { title: "验证异常输入", description: "检查右括号先出现、左括号未闭合和空字符串。" },
      { title: "解释处理过程", description: "用一次具体输入说明栈内容如何变化。" },
    ],
    starterCode: "def is_balanced(text):\n    stack = []\n    # TODO: 忽略普通字符，检查括号的配对和嵌套顺序\n    return False\n\n\nprint(is_balanced('a * (b + [c - d])'))\n",
    examples: [
      { input: "is_balanced('a * (b + [c - d])')", output: "True" },
      { input: "is_balanced('([)]')", output: "False" },
    ],
    tests: [
      { label: "正确嵌套与普通字符", expression: "is_balanced('a * (b + [c - {d}])')", expected: "True" },
      { label: "交叉括号", expression: "is_balanced('([)]')", expected: "False" },
      { label: "空字符串", expression: "is_balanced('')", expected: "True" },
      { label: "缺失配对", expression: "[is_balanced(']abc'), is_balanced('(()')]", expected: "[False, False]" },
    ],
  },
  {
    id: "binary-search",
    number: "03",
    title: "二分查找：缩小问题的范围",
    subtitle: "每一次比较，都让搜索区间更小。",
    course: "Python 程序设计",
    difficulty: "基础",
    minutes: 30,
    tags: ["查找", "循环", "边界处理"],
    description: "在一个升序整数列表中寻找目标值。练习维护搜索区间，并定位循环条件与索引更新中的常见错误。",
    requirements: [
      "实现 binary_search(numbers, target)，numbers 为严格升序、元素不重复的整数列表。",
      "找到目标时返回从 0 开始的索引，找不到时返回 -1；空列表同样返回 -1。",
      "使用二分查找，尝试让每轮比较至少排除当前区间的一半。",
      "自行复核循环结束条件以及 left、right 的更新，公开自测只验证给出的输入输出。",
    ],
    steps: [
      { title: "明确搜索区间", description: "选择闭区间或半开区间，写出左右边界的含义。" },
      { title: "实现区间收缩", description: "比较中间值与目标值，更新对应的边界。" },
      { title: "检查首尾与空列表", description: "运行公开自测，排查越界和无法终止的循环。" },
      { title: "解释查找效率", description: "记录一个目标值的查找过程，说明区间如何逐步缩小。" },
    ],
    starterCode: "def binary_search(numbers, target):\n    left = 0\n    right = len(numbers) - 1\n    # TODO: 比较中间元素并缩小搜索区间\n    return -1\n\n\nprint(binary_search([2, 5, 8, 12, 16], 12))\n",
    examples: [
      { input: "binary_search([2, 5, 8, 12, 16], 12)", output: "3" },
      { input: "binary_search([2, 5, 8, 12, 16], 7)", output: "-1" },
    ],
    tests: [
      { label: "中间目标", expression: "binary_search([2, 5, 8, 12, 16], 8)", expected: "2" },
      { label: "首尾元素", expression: "[binary_search([-5, 0, 3, 9], -5), binary_search([-5, 0, 3, 9], 9)]", expected: "[0, 3]" },
      { label: "不存在的目标", expression: "binary_search([2, 5, 8, 12, 16], 7)", expected: "-1" },
      { label: "空列表与单个元素", expression: "[binary_search([], 3), binary_search([3], 3), binary_search([3], 4)]", expected: "[-1, 0, -1]" },
    ],
  },
];

export function getTrainingTask(id: string | null): TrainingTask | undefined {
  return TRAINING_TASKS.find((task) => task.id === id);
}

export interface TrainingRun {
  language?: CodeLanguage;
  stdin?: string;
  stderr?: string;
  compileOutput?: string;
  id: string;
  taskId: string;
  createdAt: string;
  kind: "run" | "check";
  code: string;
  stdout: string;
  error: string | null;
  durationMs: number;
  passed: boolean;
}

export interface TrainingProgress {
  language?: CodeLanguage;
  drafts?: Partial<Record<CodeLanguage, { code: string; stdin: string }>>;
  code: string;
  updatedAt: string;
  startedAt: string;
  runs: TrainingRun[];
}

export type TrainingState = Record<string, TrainingProgress>;

export function getTrainingStatus(progress?: TrainingProgress): "未开始" | "进行中" | "自测通过" {
  if (!progress) return "未开始";
  // History is newest first. A later failed check supersedes an earlier pass
  // for the same draft; ordinary runs cannot establish task completion.
  const latestCheck = progress.runs.find((run) => run.kind === "check" && run.code === progress.code && (run.language ?? "python") === (progress.language ?? "python"));
  return latestCheck?.passed && latestCheck.error === null ? "自测通过" : "进行中";
}

const MAX_CODE_LENGTH = 10_000;
const MAX_STDOUT_LENGTH = 16_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_RUNS = 20;
const MAX_STORAGE_LENGTH = 2_000_000;

export function trainingStorageKey(studentId: string): string {
  // JSON escaping also keeps lone UTF-16 surrogates distinct without URI errors.
  return `sl_training_v1:${JSON.stringify(studentId)}`;
}

export function serializeTrainingState(state: TrainingState): string {
  const raw = JSON.stringify(state);
  // Never write a snapshot that our bounded reader would discard on reload.
  if (raw.length > MAX_STORAGE_LENGTH) throw new Error("实训记录超过本机存储上限，请导出档案");
  return raw;
}

/** Merge recent history across devices without replacing a newer draft. */
export function mergeTrainingState(local: TrainingState, remote: TrainingState): TrainingState {
  const merged = { ...local };
  for (const [id, incoming] of Object.entries(remote)) {
    if (!isTrainingTaskId(id)) continue;
    const old = merged[id];
    const latest = !old || Date.parse(incoming.updatedAt) > Date.parse(old.updatedAt) ? incoming : old;
    merged[id] = { ...latest, runs: boundedRuns([...(old?.runs ?? []), ...incoming.runs], id) };
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CODE_LENGTH;
}

function readRun(value: unknown, taskId: string): TrainingRun | undefined {
  if (
    !isRecord(value) || value.taskId !== taskId ||
    typeof value.id !== "string" || !value.id || value.id.length > 160 ||
    !isDate(value.createdAt) || (value.kind !== "run" && value.kind !== "check") ||
    !isCode(value.code) || typeof value.stdout !== "string" ||
    (value.error !== null && typeof value.error !== "string") ||
    typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 ||
    typeof value.passed !== "boolean"
  ) return undefined;

  return {
    id: value.id,
    ...(isCodeLanguage(value.language) ? { language: value.language } : {}),
    ...(typeof value.stdin === "string" ? { stdin: value.stdin.slice(0, MAX_CODE_LENGTH) } : {}),
    ...(typeof value.stderr === "string" ? { stderr: value.stderr.slice(0, MAX_STDOUT_LENGTH) } : {}),
    ...(typeof value.compileOutput === "string" ? { compileOutput: value.compileOutput.slice(0, MAX_STDOUT_LENGTH) } : {}),
    taskId,
    createdAt: value.createdAt,
    kind: value.kind,
    code: value.code,
    stdout: value.stdout.slice(0, MAX_STDOUT_LENGTH),
    error: value.error === null ? null : value.error.slice(0, MAX_ERROR_LENGTH),
    durationMs: value.durationMs,
    // A successful normal run is not evidence of passing the task's self-check.
    passed: value.passed && value.kind === "check" && value.error === null,
  };
}

function boundedRuns(values: unknown[], taskId: string): TrainingRun[] {
  const runs = values.flatMap((value) => {
    const run = readRun(value, taskId);
    return run ? [run] : [];
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const ids = new Set<string>();
  return runs.filter((run) => {
    if (ids.has(run.id)) return false;
    ids.add(run.id);
    return true;
  }).slice(0, MAX_RUNS);
}

/** Read untrusted local storage without copying arbitrary keys into application state. */
export function parseTrainingState(raw: string | null): TrainingState {
  if (!raw || raw.length > MAX_STORAGE_LENGTH) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(value)) return {};
  const state: TrainingState = {};
  for (const id of Object.keys(value).filter(isTrainingTaskId)) {
    const task = { id };
    if (!Object.hasOwn(value, task.id)) continue;
    const progress = value[task.id];
    if (
      !isRecord(progress) || !isCode(progress.code) ||
      !isDate(progress.updatedAt) || !isDate(progress.startedAt) || !Array.isArray(progress.runs)
    ) continue;
    state[task.id] = {
      ...(isCodeLanguage(progress.language) ? { language: progress.language } : {}),
      ...(isRecord(progress.drafts) ? { drafts: Object.fromEntries(Object.entries(progress.drafts).flatMap(([language, draft]) => isCodeLanguage(language) && isRecord(draft) && isCode(draft.code) && typeof draft.stdin === "string" && draft.stdin.length <= MAX_CODE_LENGTH ? [[language, { code: draft.code, stdin: draft.stdin }]] : [])) } : {}),
      code: progress.code,
      updatedAt: progress.updatedAt,
      startedAt: progress.startedAt,
      runs: boundedRuns(progress.runs, task.id),
    };
  }
  return state;
}

export function updateTrainingDraft(state: TrainingState, taskId: string, code: string, nowISO: string, language?: CodeLanguage, stdin = ""): TrainingState {
  if (!isTrainingTaskId(taskId) || !isCode(code) || !isDate(nowISO)) return state;
  const previous = state[taskId];
  return {
    ...state,
    [taskId]: {
      ...previous,
      ...(language ? { language, drafts: { ...previous?.drafts, ...(!previous?.drafts?.[previous?.language ?? "python"] && previous ? { [previous.language ?? "python"]: { code: previous.code, stdin: "" } } : {}), [language]: { code, stdin: stdin.slice(0, MAX_CODE_LENGTH) } } } : {}),
      code,
      updatedAt: nowISO,
      startedAt: previous?.startedAt ?? nowISO,
      runs: previous?.runs ?? [],
    },
  };
}

export function appendTrainingRun(state: TrainingState, run: TrainingRun): TrainingState {
  if (!isTrainingTaskId(run.taskId)) return state;
  const checkedRun = readRun(run, run.taskId);
  if (!checkedRun) return state;
  const previous = state[run.taskId];
  return {
    ...state,
    [run.taskId]: {
      ...previous,
      code: previous?.code ?? checkedRun.code,
      updatedAt: previous && Date.parse(previous.updatedAt) > Date.parse(checkedRun.createdAt) ? previous.updatedAt : checkedRun.createdAt,
      startedAt: previous?.startedAt ?? checkedRun.createdAt,
      runs: boundedRuns([checkedRun, ...(previous?.runs ?? [])], run.taskId),
    },
  };
}

function isTrainingTaskId(id: string) {
  return Boolean(getTrainingTask(id)) || /^code-exercise-[a-f0-9]{32}$/.test(id);
}

/** Generated starters define a function; a run must also invoke a visible example. */
export function buildTrainingRun(task: TrainingTask, code: string, exampleIndex = 0): string {
  if (!task.source) return code;
  const example = task.tests[exampleIndex];
  if (!example) throw new Error("请选择一个公开示例");
  return `${code.trimEnd()}\n\n# 运行所选公开示例\nprint(${JSON.stringify(`示例 ${exampleIndex + 1} 返回值：`)}, (${example.expression}))\n`;
}

/** Public examples only: passing these assertions is not a formal grade. */
export function buildTrainingCheck(task: TrainingTask, code: string): string {
  const assertions = task.tests.map((check, index) =>
    `assert (${check.expression}) == (${check.expected}), ${JSON.stringify(`自测 ${index + 1} 未通过：${check.label}`)}`,
  );
  return `${code.trimEnd()}\n\n# 平台公开自测\n${assertions.join("\n")}\nprint(${JSON.stringify(`平台自测通过：${task.tests.length}/${task.tests.length}`)})\n`;
}
