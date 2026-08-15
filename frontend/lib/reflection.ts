import { streamSSE } from "./api";
import type { TaskEvidenceRecord } from "../hooks/use-orchestrator";
import type { PracticeAttempt } from "./practice-feedback";
import { getStudentId } from "./student-identity";
import type { TeacherPersona } from "./teacher-persona";
import type { ChatMessage } from "./types";

export interface ReflectionContext {
  chatHistory: { role: "user" | "assistant"; content: string }[];
  quizSummaries: string[];
  evidenceSummaries: string[];
}

export function reflectionHref(day: string, taskKey: string, pathId?: string): string {
  const query = new URLSearchParams({ day, taskKey });
  if (pathId) query.set("pathId", pathId);
  return `/reflection?${query.toString()}`;
}

function isToday(value: string): boolean {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

export function buildReflectionContext(
  messages: ChatMessage[],
  attempts: PracticeAttempt[],
  evidence: Record<string, TaskEvidenceRecord>,
): ReflectionContext {
  const chatHistory = messages
    .filter((message) => message.kind === "text" && !message.streaming && message.content.trim())
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content.replace(/\s+/g, " ").trim().slice(0, 1600),
    }));
  const quizSummaries = attempts
    .filter((attempt) => isToday(attempt.submittedAt))
    .slice(0, 5)
    .map(
      (attempt) =>
        `${attempt.title}：${attempt.correctCount}/${attempt.total} 题正确，得分 ${attempt.score}，错题 ${attempt.wrongQuestions.length} 道`,
    );
  const evidenceSummaries = Object.values(evidence)
    .filter((item) => isToday(item.completedAt))
    .slice(-8)
    .map((item) => item.content.slice(0, 500));
  return { chatHistory, quizSummaries, evidenceSummaries };
}

export function reflectionContextText(context: ReflectionContext): string {
  const questions = context.chatHistory
    .map((message) => `${message.role === "user" ? "学生" : "教师"}：${message.content}`)
    .join("\n");
  return [
    questions ? `今日问答：\n${questions}` : "今日问答：暂无记录",
    context.quizSummaries.length
      ? `今日测验：\n${context.quizSummaries.join("\n")}`
      : "今日测验：暂无提交记录",
    context.evidenceSummaries.length
      ? `今日完成证据：\n${context.evidenceSummaries.join("\n")}`
      : "今日完成证据：暂无其他记录",
  ].join("\n\n");
}

export async function generateReflectionSupplement(input: {
  userContent: string;
  dayTitle: string;
  context: ReflectionContext;
  teacher: TeacherPersona;
  signal?: AbortSignal;
}): Promise<string> {
  const contextText = reflectionContextText(input.context);
  const prompt = [
    `你正在补充学生对“${input.dayTitle}”的学习复盘。`,
    "只补充学生遗漏的要点、测验暴露的问题和下一步行动，不要改写或冒充学生原文。",
    "用 2—4 条简洁条目输出；若发现概念错误，明确指出并给出正确说法。不要输出标题或开场白。",
    `学生原文：\n${input.userContent.trim()}`,
    contextText,
  ].join("\n\n");
  let answer = "";
  let failure = "";
  await streamSSE(
    "/api/chat",
    {
      student_id: getStudentId(),
      message: prompt,
      history: input.context.chatHistory.slice(-8),
      teacher_persona: input.teacher,
    },
    ({ event, data }) => {
      if (event === "delta") answer += String(data.text ?? "");
      if (event === "content" && typeof data.data === "string") answer = data.data;
      if (event === "blocked" || event === "error") {
        failure = String(data.message ?? "AI 暂时无法补充复盘");
      }
    },
    input.signal,
  );
  const normalized = answer.trim();
  if (!normalized) throw new Error(failure || "AI 没有返回可用的复盘补充，请稍后重试。");
  return normalized.slice(0, 12000);
}
