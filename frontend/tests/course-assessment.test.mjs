import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCourseAssessmentScopes,
  courseAssessmentScopeSignature,
  courseExamRequestCourses,
  normalizeCourseAssessmentQuestions,
} from "../lib/course-assessment.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("course assessment scope includes completed and current nodes but not future nodes", () => {
  const subjects = [{
    id: "course-1",
    title: "数据结构学习路径",
    requestSummary: "数据结构",
    status: "active",
    controlStatus: "active",
    dailyMinutes: 30,
    path: [
      { day: "第一阶段", title: "线性表", desc: "", types: [], state: "todo", knowledge_points: ["顺序表"], steps: [{ title: "学习", detail: "", minutes: 20, resource_types: [] }] },
      { day: "第二阶段", title: "栈", desc: "", types: [], state: "current", knowledge_points: ["栈"], steps: [{ title: "学习", detail: "", minutes: 20, resource_types: [] }] },
      { day: "第三阶段", title: "图", desc: "", types: [], state: "todo", knowledge_points: ["最短路径"], steps: [{ title: "学习", detail: "", minutes: 20, resource_types: [] }] },
    ],
    sourcePlanIds: [],
    completedTasks: 1,
    totalTasks: 3,
    progress: 33,
    sourceStatus: "legacy",
  }];

  const scopes = buildCourseAssessmentScopes(subjects, ["0:task:0"]);
  assert.deepEqual(scopes[0].scopePoints, ["顺序表", "栈"]);
  assert.equal(scopes[0].currentStage, "栈");
  assert.equal(scopes[0].coveredStageCount, 2);
  assert.equal(scopes[0].scopePoints.includes("最短路径"), false);

  const courses = courseExamRequestCourses(scopes, ["course-1"]);
  assert.equal(courses[0].course_id, "course-1");
  assert.equal(courseAssessmentScopeSignature(courses), courseAssessmentScopeSignature([...courses]));
});

test("course assessment question normalization never retains answer material", () => {
  const questions = normalizeCourseAssessmentQuestions([{
    id: "q1",
    type: "mcq",
    stem: "栈的特点？",
    options: ["A. 先进后出", "B. 先进先出"],
    answer: "A",
    explanation: "栈是 LIFO",
    knowledge_point: "栈",
  }]);

  assert.equal(questions.length, 1);
  assert.equal("answer" in questions[0], false);
  assert.equal("explanation" in questions[0], false);
});

test("desktop course assessment is a standalone backend-graded route", async () => {
  const [route, page, pathPage, library] = await Promise.all([
    read("app/desktop/path/assessment/page.tsx"),
    read("components/desktop/desktop-course-assessment.tsx"),
    read("components/desktop/desktop-path.tsx"),
    read("lib/library.ts"),
  ]);

  assert.match(route, /desktop-course-assessment/);
  assert.match(page, /"\/api\/assess\/course-exam"/);
  assert.match(page, /courses:\s*requestCourses/);
  assert.match(page, /`\/api\/assess\/\$\{encodeURIComponent\(examId\)\}\/submit`/);
  assert.match(page, /paper\.category === COURSE_ASSESSMENT_CATEGORY/);
  assert.match(page, /paper\.status === "graded"/);
  assert.match(page, /scope\.status === "active"/);
  assert.doesNotMatch(page, /QuizRunner|gradeQuizSubmission/);
  assert.match(pathPage, /href="\/path\/assessment"/);
  assert.doesNotMatch(pathPage, /href="\/practice"[^>]*>进入考试测评/);
  assert.match(library, /results\?: PaperQuestionResult\[\]/);
  assert.match(library, /mastery\?: Record<string, PaperMasteryItem \| number>/);
  assert.match(library, /papers\/detail\/\$\{id\}\?student_id=\$\{encodeURIComponent\(getStudentId\(\)\)\}/);
});
