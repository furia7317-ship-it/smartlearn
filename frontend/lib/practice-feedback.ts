import type { ProfileDim, QuizQuestion } from "./types";

const LETTERS = "ABCDEFGHIJ".split("");

export interface WrongQuestion {
  id: string;
  stem: string;
  chosen: string;
  answer: string;
  explanation?: string;
}

export interface QuizSubmission {
  score: number;
  correctCount: number;
  total: number;
  answers: Record<string, string>;
  wrongQuestions: WrongQuestion[];
}

export interface PracticeAttempt extends QuizSubmission {
  id: string;
  resourceId: string;
  title: string;
  submittedAt: string;
}

export interface PathAdjustment {
  id: string;
  submittedAt: string;
  score: number;
  text: string;
}

function questionKey(question: QuizQuestion, index: number): string {
  return question.id ?? `q${index}`;
}

function optionLetter(option: string, index: number): string {
  const match = option.trim().match(/^([A-Za-z])\s*[.、，:：)]/);
  return match ? match[1].toUpperCase() : LETTERS[index] ?? String(index + 1);
}

function optionText(option: string): string {
  return option.replace(/^([A-Za-z])\s*[.、，:：)]\s*/, "").trim();
}

function normalizedAnswer(answer?: string): string {
  if (!answer) return "";
  const match = answer.trim().match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : answer.trim();
}

export function isQuizAnswerCorrect(
  question: QuizQuestion,
  chosen: string | undefined
): boolean {
  if (!chosen) return false;
  if (Array.isArray(question.options) && question.options.length > 0) {
    const answerLetter = normalizedAnswer(question.answer);
    if (chosen.toUpperCase() === answerLetter) return true;
    const index = question.options.findIndex(
      (option, optionIndex) => optionLetter(option, optionIndex) === chosen.toUpperCase()
    );
    return (
      index >= 0 &&
      optionText(question.options[index]) === (question.answer ?? "").trim()
    );
  }

  const normalize = (value: string) =>
    value.trim().toLocaleLowerCase("zh-CN").replace(/[\s。；;，,]/g, "");
  return normalize(chosen) === normalize(question.answer ?? "");
}

export function gradeQuizSubmission(
  questions: QuizQuestion[],
  answers: Record<string, string>
): QuizSubmission {
  const validQuestions = questions.filter((question) => question?.stem);
  const wrongQuestions: WrongQuestion[] = [];
  let correctCount = 0;

  validQuestions.forEach((question, index) => {
    const id = questionKey(question, index);
    const chosen = answers[id] ?? "";
    if (isQuizAnswerCorrect(question, chosen)) {
      correctCount += 1;
      return;
    }
    wrongQuestions.push({
      id,
      stem: question.stem,
      chosen,
      answer: question.answer ?? "",
      ...(question.explanation ? { explanation: question.explanation } : {}),
    });
  });

  return {
    score: validQuestions.length
      ? Math.round((correctCount / validQuestions.length) * 100)
      : 0,
    correctCount,
    total: validQuestions.length,
    answers: { ...answers },
    wrongQuestions,
  };
}

export function applyPracticeProfile(
  profile: ProfileDim[],
  submission: QuizSubmission
): ProfileDim[] {
  return profile.map((dimension) => {
    if (!["knowledge", "knowledge_level"].includes(dimension.key)) return dimension;
    const value = Math.max(
      0,
      Math.min(100, Math.round(dimension.value * 0.7 + submission.score * 0.3))
    );
    return { ...dimension, value, delta: value - dimension.value };
  });
}

export function buildPathAdjustment(
  title: string,
  submission: QuizSubmission
): string {
  const wrongCount = submission.wrongQuestions.length;
  if (submission.score >= 80) {
    return `${title} ${submission.score} 分，掌握度良好；路径继续推进，并提高后续模拟难度。`;
  }
  if (submission.score >= 60) {
    return `${title} ${submission.score} 分，${wrongCount} 道错题已归档；路径安排一次针对性复盘。`;
  }
  return `${title} ${submission.score} 分，${wrongCount} 道错题已归档；路径保留当前阶段并增加错题复盘。`;
}
