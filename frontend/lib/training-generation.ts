import type { CodeExercise } from "./code-lab.ts";
import type { PathStep } from "./types.ts";
import { pathScheduleCurrentIndex } from "./path-schedule-clock.ts";
import { TRAINING_KINDS, type TrainingKind, type TrainingSource, type TrainingTask } from "./training.ts";

export function trainingPathSignature(path: PathStep[]) {
  const value = JSON.stringify(path.map(({ day, title, desc, objective, knowledge_points, subject_ids, steps }) => ({ day, title, desc, objective, knowledge_points, subject_ids, steps: steps?.map(({ title: taskTitle, detail, prompts }) => ({ title: taskTitle, detail, prompts })) })));
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `path-${(hash >>> 0).toString(16)}-${value.length}`;
}

export function currentTrainingPath(input: { masterPath: PathStep[]; path: PathStep[]; masterPathScheduleAnchor?: string; pathScheduleAnchor?: string }, today = new Date()) {
  const hasMaster = input.masterPath.length > 0;
  const path = hasMaster ? input.masterPath : input.path;
  return { path, signature: trainingPathSignature(path), currentIndex: pathScheduleCurrentIndex(path, hasMaster ? input.masterPathScheduleAnchor : input.pathScheduleAnchor, today) };
}

export function buildTrainingContext(path: PathStep[], index: number): { source: TrainingSource; context: string } | null {
  const step = path[index];
  if (!step) return null;
  const source: TrainingSource = {
    path_signature: trainingPathSignature(path), node_index: index,
    node_title: step.title.slice(0, 240), node_day: step.day.slice(0, 80),
    course: (step.subject_titles?.join(" · ") || "当前学习路径").slice(0, 240),
  };
  const context = [
    `课程：${source.course}`, `路径节点：${step.day} · ${step.title}`,
    `学习目标：${step.objective || step.desc}`,
    `路径脉络：${path.slice(0, index + 1).map((node) => `${node.day} ${node.title}`).join(" → ")}`,
    step.objective && step.desc ? `学习内容：${step.desc}` : "",
    step.knowledge_points?.length ? `知识点：${step.knowledge_points.join("、")}` : "",
    step.prerequisites?.length ? `前置知识：${step.prerequisites.join("、")}` : "",
    ...(step.steps ?? []).map((task) => [task.title, task.detail, ...(task.prompts ?? [])].filter(Boolean).join("；")),
  ].filter(Boolean).join("\n").slice(0, 6000);
  return { source, context };
}

/** Translate JSON data to Python literals; values can never become executable expressions. */
export function pythonLiteral(value: unknown): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(", ")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${pythonLiteral(entry)}`).join(", ")}}`;
  throw new Error("题目中含有不支持的测试数据");
}

export function exerciseToTrainingTask(exercise: CodeExercise): TrainingTask {
  const meta = exercise.training_metadata;
  if (!meta || meta.source !== "learning_path" || !Object.hasOwn(TRAINING_KINDS, meta.exercise_kind ?? "")
    || !/^code-exercise-[a-f0-9]{32}$/.test(exercise.id) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(exercise.function_name)
    || typeof meta.node_title !== "string" || typeof meta.path_signature !== "string" || !Number.isInteger(meta.node_index)
    || !Array.isArray(exercise.examples) || exercise.examples.length < 1 || exercise.test_count < 1) throw new Error("生成任务的数据不完整，请重新加载");
  const kind = meta.exercise_kind as TrainingKind;
  const info = TRAINING_KINDS[kind];
  const examples = exercise.examples.map((example) => ({ input: `${exercise.function_name}(${example.input.map(pythonLiteral).join(", ")})`, output: pythonLiteral(example.output) }));
  return {
    id: exercise.id, number: "AI", title: exercise.title, subtitle: `${info.label} · ${meta.node_day} ${meta.node_title}`,
    course: meta.course, difficulty: exercise.difficulty === "基础" ? "基础" : "进阶", minutes: 25,
    tags: exercise.knowledge_points, description: exercise.prompt,
    requirements: [info.description, ...exercise.constraints], starterCode: exercise.starter_code,
    examples, tests: examples.map((example, index) => ({ label: `公开示例 ${index + 1}`, expression: example.input, expected: example.output })),
    steps: [
      { title: "理解当前节点", description: `回顾「${meta.node_title}」的目标，确认题目输入与输出。` },
      { title: info.action, description: info.description },
      { title: "运行与验证", description: "运行代码观察真实轨迹，再执行平台自测，检查普通与边界场景。" },
      { title: "解释与复盘", description: kind === "debugging" ? "用代码注释记录：错误现象、产生原因和修复依据。" : "用代码注释解释关键逻辑，并回看本次运行记录。" },
    ], kind, source: { path_signature: meta.path_signature, node_index: meta.node_index, node_title: meta.node_title, node_day: meta.node_day, course: meta.course },
    testCount: exercise.test_count, createdAt: exercise.created_at ?? undefined,
  };
}
