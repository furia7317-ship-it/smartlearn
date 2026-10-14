import type { PaperDetail, PaperSummary } from "./library.ts";
import type { PracticeAttempt } from "./practice-feedback.ts";
import type { ResourceItem } from "./types.ts";

export type PracticeFilter = "recommended" | "mine" | "recent" | "starred" | "wrongbook";
export type PracticeSort = "recommended" | "latest" | "oldest" | "score-low" | "score-high";
export interface PracticePaper extends PaperSummary {
  sessionResource?: ResourceItem;
  lastPracticedAt?: string;
}
export interface PracticeMistake {
  id: string;
  paperId: string;
  paperTitle: string;
  topic: string;
  stem: string;
  options?: string[];
  answer: string;
  chosen: string;
  explanation: string;
  date: string;
}

/** The backend's unzoned timestamps are UTC, while browser timestamps include Z. */
export function practiceTimestamp(value?: string): number {
  if (!value) return 0;
  const normalized = value.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) || /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function buildPracticePapers(papers: PaperSummary[], resources: ResourceItem[], attempts: PracticeAttempt[]): PracticePaper[] {
  const quizzes = resources.filter((resource) => resource.type === "quiz" && resource.status === "ready");
  const rows: PracticePaper[] = papers.map((paper) => ({ ...paper }));
  for (const resource of quizzes) {
    const paper = rows.find((row) => row.id === resource.id || Boolean(resource.exam_id && row.exam_id === resource.exam_id));
    if (paper) paper.sessionResource = resource;
    else rows.unshift({
      id: `session_${resource.id}`, exam_id: resource.exam_id || "", title: resource.title,
      topic: resource.subtitle || "当前学习", category: "当前会话", tags: resource.meta || [], status: "created",
      overall_score: null, question_count: resource.data?.questions?.length || 0, created_at: "", sessionResource: resource,
    });
  }
  for (const row of rows) {
    const latest = attempts.filter((attempt) => attempt.resourceId === row.id || attempt.resourceId === row.sessionResource?.id || Boolean(row.exam_id && attempt.resourceId === row.exam_id))
      .sort((a, b) => practiceTimestamp(b.submittedAt) - practiceTimestamp(a.submittedAt))[0];
    if (latest) {
      row.status = "graded";
      row.overall_score = latest.score;
      row.lastPracticedAt = latest.submittedAt;
    }
  }
  return rows;
}

export function selectPracticePapers(papers: PracticePaper[], options: { filter: PracticeFilter; query: string; sort: PracticeSort; starred: string[]; recent: Record<string, string> }): PracticePaper[] {
  const query = options.query.trim().toLocaleLowerCase();
  const recentTime = (paper: PracticePaper) => Math.max(practiceTimestamp(paper.lastPracticedAt), practiceTimestamp(options.recent[paper.id]), paper.status === "graded" || paper.status === "in_progress" ? practiceTimestamp(paper.created_at) : 0);
  const result = papers.filter((paper) => {
    if (options.filter === "starred" && !paper.starred && !options.starred.includes(paper.id)) return false;
    if (options.filter === "recent" && !recentTime(paper)) return false;
    return !query || [paper.title, paper.topic, paper.category, ...paper.tags].join(" ").toLocaleLowerCase().includes(query);
  });
  return result.sort((a, b) => {
    if (options.filter === "recommended" && options.sort === "recommended") {
      const priority = (paper: PracticePaper) => paper.status !== "graded" ? 0 : (paper.overall_score ?? 100) < 80 ? 1 : 2;
      if (priority(a) !== priority(b)) return priority(a) - priority(b);
      if (priority(a) === 1 && a.overall_score !== b.overall_score) return (a.overall_score ?? 100) - (b.overall_score ?? 100);
    }
    if (options.sort === "score-low" || options.sort === "score-high") {
      const aScore = a.status === "graded" ? a.overall_score : null;
      const bScore = b.status === "graded" ? b.overall_score : null;
      if (aScore == null && bScore != null) return 1;
      if (bScore == null && aScore != null) return -1;
      if (aScore != null && bScore != null && aScore !== bScore) return options.sort === "score-low" ? aScore - bScore : bScore - aScore;
    }
    const time = options.filter === "recent" ? recentTime : (paper: PracticePaper) => practiceTimestamp(paper.created_at);
    return options.sort === "oldest" ? time(a) - time(b) : time(b) - time(a);
  });
}

export function buildPracticeMistakes(details: PaperDetail[], attempts: PracticeAttempt[], papers: PracticePaper[]): PracticeMistake[] {
  const rows = new Map<string, PracticeMistake>();
  for (const paper of details) {
    for (const result of paper.results || []) {
      if (result.correct) continue;
      const question = paper.questions.find((item) => item.id === result.question_id);
      if (!question) continue;
      const id = `${paper.id}:${result.question_id}`;
      rows.set(id, { id, paperId: paper.id, paperTitle: paper.title, topic: result.knowledge_point || paper.topic,
        stem: question.stem, options: question.options, answer: result.answer || question.answer || "见解析", chosen: result.student_answer || paper.answers?.[result.question_id] || "未作答",
        explanation: question.explanation || result.feedback || "", date: paper.created_at });
    }
  }
  // Latest local submissions override older copies of the same question from the archive.
  const seen = new Set<string>();
  for (const attempt of [...attempts].sort((a, b) => practiceTimestamp(b.submittedAt) - practiceTimestamp(a.submittedAt))) {
    const paper = papers.find((row) => row.id === attempt.resourceId || row.sessionResource?.id === attempt.resourceId || Boolean(row.exam_id && row.exam_id === attempt.resourceId));
    const paperId = paper?.id || attempt.resourceId;
    if (seen.has(paperId)) continue;
    seen.add(paperId);
    for (const [id, row] of rows) if (row.paperId === paperId) rows.delete(id);
    for (const question of attempt.wrongQuestions) {
      const id = `${paperId}:${question.id}`;
      const original = details.find((item) => item.id === paperId)?.questions.find((item) => item.id === question.id)
        || paper?.sessionResource?.data?.questions?.find((item) => item.id === question.id);
      rows.set(id, { id, paperId, paperTitle: attempt.title, topic: paper?.topic || "练习复盘", stem: question.stem, options: original?.options,
        answer: question.answer || "见解析", chosen: question.chosen || "未作答", explanation: question.explanation || "", date: attempt.submittedAt });
    }
  }
  return [...rows.values()].sort((a, b) => practiceTimestamp(b.date) - practiceTimestamp(a.date));
}

export function practiceStatistics(details: PaperDetail[], attempts: PracticeAttempt[], papers: PracticePaper[], now = new Date()) {
  const localPaperIds = new Set(attempts.map((attempt) => papers.find((paper) => paper.id === attempt.resourceId || paper.sessionResource?.id === attempt.resourceId || Boolean(paper.exam_id && paper.exam_id === attempt.resourceId))?.id || attempt.resourceId));
  const records = details.filter((paper) => paper.status === "graded" && !localPaperIds.has(paper.id)).map((paper) => ({
    date: paper.created_at, total: paper.results?.length || 0, correct: paper.results?.filter((result) => result.correct).length || 0,
  }));
  records.push(...attempts.map((attempt) => ({ date: attempt.submittedAt, total: attempt.total, correct: attempt.correctCount })));
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const days = new Set<string>();
  let weekly = 0, correct = 0, total = 0;
  for (const record of records) {
    const time = practiceTimestamp(record.date);
    if (time && time <= now.getTime()) {
      days.add(new Date(time).toLocaleDateString("sv-SE"));
      if (time >= start.getTime()) weekly += 1;
    }
    correct += record.correct; total += record.total;
  }
  return { weekly, accuracy: total ? Math.round(correct / total * 100) : null, days: days.size };
}
