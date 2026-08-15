import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import { getStudentId } from "./student-identity";

export interface CodeExecutionError {
  type: string;
  message: string;
  line: number | null;
}

export interface CodeChange {
  name: string;
  before: unknown;
  after: unknown;
  kind: "array.update" | "variable.update" | string;
}

export interface CodeStackFrame {
  function: string;
  line: number;
  locals: Record<string, unknown>;
}

export interface CodeTraceStep {
  index: number;
  line: number;
  event: "line" | "call" | "return" | "exception" | string;
  function: string;
  variables: Record<string, unknown>;
  changes: CodeChange[];
  stack: CodeStackFrame[];
  stdout: string;
  stdout_delta: string;
}

export interface CodeExecution {
  language: "python";
  stdout: string;
  error: CodeExecutionError | null;
  trace: CodeTraceStep[];
  trace_truncated: boolean;
  execution_time_ms: number;
}

export interface CodeVisualStep {
  trace_index: number;
  component:
    | "array_view"
    | "call_stack"
    | "flow_marker"
    | "output_console"
    | "variable_panel";
  heading: string;
  explanation: string;
}

export interface CodeVisualizationResponse {
  execution: CodeExecution;
  ai_status: "completed" | "unavailable";
  plan: {
    overview: string;
    steps: CodeVisualStep[];
    challenge: null;
  };
  persisted?: boolean;
}

export interface CodeDiagnosisIssue {
  severity: "error" | "warning" | "info";
  line: number | null;
  title: string;
  explanation: string;
  suggestion: string;
}

export interface CodeDiagnosis {
  summary: string;
  issues: CodeDiagnosisIssue[];
  strengths: string[];
  next_step: string;
}

export interface CodeExecutionResponse {
  execution: CodeExecution;
  ai_status: "completed" | "unavailable" | "not_requested";
  diagnosis: CodeDiagnosis | null;
}

export interface CodeExercise {
  id: string;
  learning_date: string;
  context_title: string;
  title: string;
  prompt: string;
  difficulty: string;
  knowledge_points: string[];
  constraints: string[];
  starter_code: string;
  function_name: string;
  examples: { input: unknown[]; output: unknown }[];
  test_count: number;
  ai_status: "completed" | "fallback" | "unavailable";
  created_at: string | null;
}

export interface CodeExerciseSubmission extends CodeExecutionResponse {
  submission_id: string;
  exercise_id: string;
  score: number;
  passed: boolean;
  passed_tests: number;
  total_tests: number;
}

export interface CodeVisualizationEligibility {
  eligible: boolean;
  reason: string;
  line: number | null;
}

const MAX_VISUALIZATION_SOURCE_CHARS = 10000;
const MAX_VISUALIZATION_SOURCE_LINES = 300;

export function countExecutableSourceLines(code: string): number {
  return code.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  }).length;
}

export async function checkCodeVisualizationEligibility(
  code: string,
  language = "python",
): Promise<CodeVisualizationEligibility> {
  const normalizedLanguage = language.trim().toLocaleLowerCase();
  if (normalizedLanguage !== "python" && normalizedLanguage !== "py") {
    return { eligible: false, reason: "运行演示当前仅支持 Python", line: null };
  }
  if (!code.trim()) {
    return { eligible: false, reason: "代码为空", line: null };
  }
  if (code.length > MAX_VISUALIZATION_SOURCE_CHARS) {
    return { eligible: false, reason: "代码超过演示长度限制", line: null };
  }
  if (countExecutableSourceLines(code) > MAX_VISUALIZATION_SOURCE_LINES) {
    return { eligible: false, reason: "代码超过演示行数限制", line: null };
  }

  const response = await requireOk(
    await fetch(`${API_BASE}/api/code-lab/eligibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language: "python" }),
    }),
  );
  return (await response.json()) as CodeVisualizationEligibility;
}

export async function requestCodeVisualization(
  code: string,
  options: { title?: string; context?: string; resourceId?: string } = {},
): Promise<CodeVisualizationResponse> {
  const response = await requireOk(
    await fetch(`${API_BASE}/api/code-lab/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        language: "python",
        title: options.title ?? "代码运行演示",
        context: options.context ?? "",
        student_id: options.resourceId ? getStudentId() : "",
        resource_id: options.resourceId ?? "",
      }),
    }),
  );
  return (await response.json()) as CodeVisualizationResponse;
}

export async function restoreCodeVisualization(
  code: string,
  resourceId: string,
): Promise<CodeVisualizationResponse | null> {
  if (!resourceId) return null;
  const response = await fetch(`${API_BASE}/api/code-lab/visualizations/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      student_id: getStudentId(),
      resource_id: resourceId,
    }),
  });
  if (response.status === 404) return null;
  await requireOk(response);
  return (await response.json()) as CodeVisualizationResponse;
}

export async function executeCodeWithReview(
  code: string,
  context = "",
): Promise<CodeExecutionResponse> {
  const response = await requireOk(
    await fetch(`${API_BASE}/api/code-lab/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        language: "python",
        include_ai_review: true,
        context,
      }),
    }),
  );
  return (await response.json()) as CodeExecutionResponse;
}

export async function getLatestCodeExercise(
  studentId: string,
  learningDate: string,
): Promise<CodeExercise | null> {
  const response = await fetch(
    `${API_BASE}/api/code-lab/exercises/latest/${encodeURIComponent(studentId)}?learning_date=${encodeURIComponent(learningDate)}`,
  );
  if (response.status === 404) return null;
  await requireOk(response);
  return (await response.json()) as CodeExercise;
}

export async function generateCodeExercise(options: {
  learningDate: string;
  contextTitle: string;
  learningContext: string;
}): Promise<CodeExercise> {
  const response = await requireOk(
    await fetch(`${API_BASE}/api/code-lab/exercises`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: getStudentId(),
        learning_date: options.learningDate,
        context_title: options.contextTitle,
        learning_context: options.learningContext,
      }),
    }),
  );
  return (await response.json()) as CodeExercise;
}

export async function submitCodeExercise(
  exerciseId: string,
  code: string,
): Promise<CodeExerciseSubmission> {
  const response = await requireOk(
    await fetch(`${API_BASE}/api/code-lab/exercises/${encodeURIComponent(exerciseId)}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: getStudentId(),
        code,
        language: "python",
      }),
    }),
  );
  return (await response.json()) as CodeExerciseSubmission;
}
