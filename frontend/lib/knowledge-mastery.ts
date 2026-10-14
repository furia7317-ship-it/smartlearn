import type { AssessmentRecord, PaperDetail } from "./library";
import type { SubjectLearningPath } from "./master-learning-path";
import { normalizeTrainingEvidence, type TrainingEvidence } from "./training-evidence.ts";
import type { PublishedKnowledge } from "./learning-data";

export interface KnowledgeNode {
  id: string; label: string; subject: string; group: string;
  score: number | null; source: string; updatedAt: string; evidenceCount: number;
  summary: string; feedback: string; x: number; y: number; root?: boolean;
  history?: { score: number; at: string }[];
  provisional?: boolean;
}
export interface KnowledgeEdge { source: string; target: string; strength: "strong" | "medium" | "weak" }
export interface KnowledgeCourse { id: string; title: string; currentStage: string }

const PROFILE_LABELS = new Set(["学习画像", "知识基础", "认知匹配", "目标清晰", "易错管理", "学习节奏", "兴趣投入", "未分类"]);
export const normalizeKnowledgeLabel = (value: string) => value.trim().toLowerCase().replace(/[\s·：:、，,。()（）/\-_]/g, "");
export function masteryPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

/** Only topic-level evidence may produce a topic score. Learning-profile axes never enter this graph. */
export function buildKnowledgeMastery(input: {
  paths: SubjectLearningPath[]; assessments: AssessmentRecord[]; papers: PaperDetail[];
  subject?: string; rangeDays?: number; now?: number;
  training?: TrainingEvidence[];
  published?: PublishedKnowledge[];
}) {
  const courses: KnowledgeCourse[] = [];
  const nodes = new Map<string, KnowledgeNode>();
  const edges = new Map<string, KnowledgeEdge>();
  const cutoff = input.rangeDays ? (input.now ?? Date.now()) - input.rangeDays * 86400000 : -Infinity;
  const ensureCourse = (title: string, currentStage = "") => {
    const cleaned = title.trim() || "已测评知识";
    const id = normalizeKnowledgeLabel(cleaned);
    const existing = courses.find((course) => course.id === id);
    if (existing) { if (currentStage) existing.currentStage = currentStage; return existing; }
    const course = { id, title: cleaned, currentStage };
    courses.push(course);
    return course;
  };
  function ensureNode(label: string, course: KnowledgeCourse, group = "", summary = "") {
    label = label.trim();
    if (label.startsWith(`${course.title}：`) || label.startsWith(`${course.title}:`)) label = label.slice(course.title.length + 1).trim();
    if (!label || PROFILE_LABELS.has(label)) return;
    const id = `${course.id}:${normalizeKnowledgeLabel(label)}`;
    if (!nodes.has(id)) nodes.set(id, { id, label, subject: course.id, group, summary, score: null,
      source: "学习路径", updatedAt: "", evidenceCount: 0, feedback: "", x: 50, y: 50 });
    return nodes.get(id)!;
  }
  function connect(from: KnowledgeNode | undefined, to: KnowledgeNode | undefined, strength: KnowledgeEdge["strength"]) {
    if (!from || !to || from.id === to.id) return;
    const key = [from.id, to.id].sort().join("|");
    if (!edges.has(key) || strength === "strong") edges.set(key, { source: from.id, target: to.id, strength });
  }
  function record(node: KnowledgeNode | undefined, score: number | null, at: string, source: string, feedback = "", count = 1) {
    if (input.published !== undefined) return;
    const time = Date.parse(at);
    if (!node || score === null || !Number.isFinite(time) || time < cutoff || time > (input.now ?? Date.now())) return;
    node.evidenceCount += count;
    (node.history ??= []).push({ score, at });
    if (!node.updatedAt || time >= Date.parse(node.updatedAt)) {
      Object.assign(node, { score, updatedAt: at, source, feedback });
    }
  }

  // The course plan supplies actual knowledge points and their learning relationships, even before assessment.
  const orderedPaths = [...input.paths].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
  orderedPaths.forEach((path) => {
    const course = ensureCourse(path.title, path.path.find((stage) => stage.state === "current")?.title);
    let previous: KnowledgeNode | undefined;
    path.path.forEach((stage) => {
      const points = (stage.knowledge_points ?? []).map((point) => ensureNode(point, course, stage.title, stage.objective || stage.desc)).filter((point): point is KnowledgeNode => Boolean(point));
      points.slice(1).forEach((point, index) => connect(points[index], point, "strong"));
      connect(previous, points[0], "medium");
      previous = points[0] ?? previous;
    });
  });

  input.assessments.forEach((assessment) => {
    const seed = Object.entries(assessment.analysis?.knowledge_seed ?? {}).filter(([label]) => !PROFILE_LABELS.has(label));
    if (!seed.length) return;
    const course = ensureCourse(assessment.subject);
    const points = seed.map(([label, score]) => {
      const node = ensureNode(label, course);
      record(node, masteryPercent(score), assessment.created_at, "摸底诊断");
      return node;
    });
    points.slice(1).forEach((point) => connect(points[0], point, "weak"));
  });

  input.papers.forEach((paper) => {
    const results = paper.results ?? [];
    const scoreByPoint = new Map<string, { score: number | null; count: number }>();
    Object.entries(paper.mastery ?? {}).forEach(([label, value]) => scoreByPoint.set(label, {
      score: masteryPercent(typeof value === "number" ? value : value.score),
      count: typeof value === "number" ? 1 : Math.max(1, value.question_count ?? 1),
    }));
    const totals = new Map<string, { earned: number; maximum: number; count: number }>();
    results.forEach((result) => {
      const label = result.knowledge_point || paper.questions.find((question) => question.id === result.question_id)?.knowledge_point;
      if (!label || !Number.isFinite(result.score) || !Number.isFinite(result.max_score) || result.max_score <= 0) return;
      const total = totals.get(label) ?? { earned: 0, maximum: 0, count: 0 };
      total.earned += result.score; total.maximum += result.max_score; total.count += 1;
      totals.set(label, total);
    });
    totals.forEach((total, label) => { if (!scoreByPoint.has(label)) scoreByPoint.set(label, { score: masteryPercent(total.earned / total.maximum), count: total.count }); });
    const labels = [...new Set([...scoreByPoint.keys(), ...paper.questions.map((question) => question.knowledge_point).filter((label): label is string => Boolean(label))])];
    if (!labels.length) return;
    const explicitCourse = courses.find((course) => course.id === normalizeKnowledgeLabel(paper.topic));
    const points = labels.map((label) => {
      const matches = [...nodes.values()].filter((node) => normalizeKnowledgeLabel(node.label) === normalizeKnowledgeLabel(label));
      const node = explicitCourse ? ensureNode(label, explicitCourse) : matches.length === 1 ? matches[0] : ensureNode(label, ensureCourse(paper.topic));
      const value = scoreByPoint.get(label);
      const feedback = [...new Set(results.filter((result) => (result.knowledge_point || paper.questions.find((question) => question.id === result.question_id)?.knowledge_point) === label && result.feedback)
        .sort((a, b) => a.score / (a.max_score || 1) - b.score / (b.max_score || 1)).map((result) => result.feedback))].slice(0, 3).join("；");
      if (paper.status === "graded") record(node, value?.score ?? null, paper.updated_at || paper.created_at, "试卷批阅", feedback, value?.count);
      return node;
    });
    points.slice(1).forEach((point) => { if (point?.subject === points[0]?.subject) connect(points[0], point, "weak"); });
  });

  normalizeTrainingEvidence(input.training).forEach((attempt) => {
    const course = ensureCourse(attempt.course);
    if (!course.currentStage) course.currentStage = attempt.stage;
    const points = attempt.knowledgePoints.map((label) => {
      const node = ensureNode(label, course);
      record(node, attempt.score, attempt.createdAt, "实训中心", `《${attempt.title}》测试通过 ${attempt.passedTests}/${attempt.totalTests}`, 1);
      return node;
    });
    points.slice(1).forEach((point) => connect(points[0], point, "weak"));
  });

  input.published?.forEach((point) => {
    const node = ensureNode(point.label, ensureCourse(point.course));
    if (!node || Date.parse(point.updatedAt) < cutoff) return;
    Object.assign(node, { score: point.score, source: point.provisional ? "自评参考 · 学习数据管家" : "加权测评 · 学习数据管家", updatedAt: point.updatedAt,
      evidenceCount: point.evidenceCount, provisional: point.provisional });
  });
  const populatedCourses = courses.filter((course) => [...nodes.values()].some((node) => node.subject === course.id));
  const scoredCount = (course: KnowledgeCourse) => [...nodes.values()].filter((node) => node.subject === course.id && node.score !== null).length;
  const course = populatedCourses.find((course) => course.id === input.subject)
    ?? [...populatedCourses].sort((a, b) => scoredCount(b) - scoredCount(a))[0];
  const visibleNodes = [...nodes.values()].filter((node) => node.subject === course?.id);
  const count = visibleNodes.length;
  visibleNodes.forEach((node, index) => {
    if (index === 0) { node.x = 50; node.y = 50; node.root = true; return; }
    const ring = Math.floor((index - 1) / 10);
    const ringCount = Math.min(10, count - 1 - ring * 10);
    const angle = ((index - 1) % 10) / ringCount * Math.PI * 2 - Math.PI / 2;
    const radius = Math.max(14, 38 - ring * 13);
    node.x = 50 + Math.cos(angle) * radius; node.y = 50 + Math.sin(angle) * radius;
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const known = visibleNodes.filter((node) => node.score !== null && !node.provisional);
  return { title: course?.title ?? "个人知识图谱", course, courses: populatedCourses, nodes: visibleNodes,
    edges: [...edges.values()].filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    overall: known.length ? Math.round(known.reduce((sum, node) => sum + node.score!, 0) / known.length) : null,
    assessedCount: known.length,
  };
}

export function knowledgeAdvice(node: KnowledgeNode | undefined, currentStage = "") {
  if (!node) return { judgement: "还没有可分析的知识点。先建立课程学习路径或完成一次摸底测评。", review: "积累知识点测评和学习记录后，再给出针对当前学习状况的分析。", steps: [] };
  const status = node.score === null ? "尚无测评记录，暂不能判断掌握情况" : node.score >= 80 ? "已基本掌握，下一步重点验证迁移与应用能力" : node.score >= 40 ? "已有部分基础，仍需巩固概念和应用边界" : "基础理解仍需加强，建议先梳理概念，再做练习";
  const focus = /复杂度/.test(node.label) ? "对比循环、嵌套循环与递归的增长趋势，分别写出时间和空间复杂度。"
    : /链表/.test(node.label) ? "画出指针变化，重点检查空链表、头节点和尾节点的处理。"
    : /哈希|散列|冲突/.test(node.label) ? "比较链地址法与开放寻址法，并手动演算一次冲突处理。"
    : /树|遍历/.test(node.label) ? "画一棵小树，手写遍历顺序，再用代码核对访问与终止条件。"
    : /排序|查找/.test(node.label) ? "用有序、逆序和重复元素验证过程，解释算法边界与复杂度。"
    : /栈|队列/.test(node.label) ? "手动模拟入栈出栈或入队出队，核对空结构和容量边界。"
    : `用自己的话解释“${node.label}”，写出一个例子，并说明它的适用条件。`;
  const history = [...(node.history ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const previous = history.find((item) => Date.parse(item.at) < Date.parse(node.updatedAt));
  const change = previous && node.score !== null ? node.score - previous.score : null;
  const trend = change === null ? "目前还缺少前后两次可比较的测评，暂不能判断进步趋势。"
    : change > 0 ? `最近两次测评从 ${previous!.score}% 提高到 ${node.score}%，表现有所改善；题目难度可能不同，还需通过新题确认是否稳定掌握。`
    : change < 0 ? `最近两次测评从 ${previous!.score}% 降至 ${node.score}%，建议对照两次答题记录定位失分环节，不能仅凭分数认定学习退步。`
    : `最近两次测评均为 ${node.score}%，建议用变式题检查能否在不同情境下独立应用。`;
  const priority = node.score === null ? `先用“${node.label}”的基础题和一道应用题了解起点，再安排后续练习。`
    : node.score >= 80 ? "当前应从基础巩固转向独立应用，重点检查能否解释思路、处理边界并迁移到新题。"
    : node.score >= 40 ? "当前还不宜直接跳过基础进入综合题。建议先区分概念理解、解题步骤和边界处理中的困难，再集中练习。"
    : "当前应放慢推进速度，先通过讲解和例题建立概念联系，再逐步过渡到独立解题。";
  const evidence = node.provisional ? "目前只有学生自评与摸底参考，尚不能据此确认实际掌握程度，应先完成对应测评。" : node.score === null ? "尚无该知识点的有效测评，学习状况需要先补充证据。"
    : `该知识点当前掌握度为 ${node.score}%，现有 ${node.evidenceCount} 项测评证据。${node.source.includes("学习数据管家") ? "此结果按测评来源与时间加权整理；后续会随下一批有效证据更新。" : trend}`;
  const stage = currentStage ? `结合当前“${currentStage}”阶段，` : "";
  return { judgement: node.provisional ? `“${node.label}”目前为自评参考，需通过实际答题确认掌握情况。` : `“${node.label}”${status}。`, review: `${evidence}${stage}${priority}${node.summary ? `本阶段应重点达到：${node.summary}。` : ""}`, steps: [
    focus,
    node.score === null ? "完成一组对应知识点的测评，建立可追踪的掌握度记录。" : node.score >= 80 ? "完成一道变式或综合应用题，检查能否独立解释解题依据。" : "重做本知识点的错题，记录错误原因，并用一道新题复测。",
    node.summary ? `结合当前学习要求：${node.summary}` : "复习后回看答题记录，比较同一知识点前后的掌握变化。",
  ] };
}
