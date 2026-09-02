import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import { getStudentId } from "./student-identity";

export interface LearningPathWorkspaceSummary {
  student_id: string;
  active_goals: number;
  completed_goals: number;
  assessments: number;
  available_exams: number;
  graded_exams: number;
  wrong_questions: number;
  due_reviews: number;
}

const EMPTY_SUMMARY: LearningPathWorkspaceSummary = {
  student_id: "",
  active_goals: 0,
  completed_goals: 0,
  assessments: 0,
  available_exams: 0,
  graded_exams: 0,
  wrong_questions: 0,
  due_reviews: 0,
};

export async function getLearningPathWorkspaceSummary(): Promise<LearningPathWorkspaceSummary> {
  const studentId = getStudentId();
  const response = await requireOk(await fetch(
    `${API_BASE}/api/path/workspace/${encodeURIComponent(studentId)}/summary`,
    { cache: "no-store" },
  ));
  const payload = await response.json() as Partial<LearningPathWorkspaceSummary>;
  return {
    ...EMPTY_SUMMARY,
    ...payload,
    student_id: studentId,
  };
}

export function emptyLearningPathWorkspaceSummary(): LearningPathWorkspaceSummary {
  return { ...EMPTY_SUMMARY };
}
