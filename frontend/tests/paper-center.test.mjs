import assert from "node:assert/strict";
import test from "node:test";
import { filterPapers, paperAnswerText } from "../lib/paper-center.ts";
import { normalizeCourseAssessmentQuestions, summarizeExamComposition } from "../lib/course-assessment.ts";

test("paper center filters every exam status without mixing unrelated courses", () => {
  const papers = [
    { id: "old", title: "线性表", topic: "数据结构", category: "课程测评", tags: [], status: "graded", created_at: "2026-09-01T10:00:00Z" },
    { id: "new", title: "树", topic: "数据结构", category: "课程测评", tags: [], status: "in_progress", created_at: "2026-09-02T10:00:00Z" },
    { id: "english", title: "语法", topic: "英语", category: "练习", tags: [], status: "submitted", created_at: "2026-09-03T10:00:00Z" },
  ];
  assert.deepEqual(filterPapers(papers, "", "", "").map(p => p.id), ["english", "new", "old"]);
  assert.deepEqual(filterPapers(papers, "数据结构", "in_progress", "课程测评").map(p => p.id), ["new"]);
  assert.deepEqual(filterPapers(papers, "不存在", "", ""), []);
  assert.equal(papers[0].id, "old");
});

test("answer records show objective answers and preserve written submissions", () => {
  assert.equal(paperAnswerText("false", "boolean"), "错误");
  assert.equal(paperAnswerText("A", "mcq", ["A. 先进先出"]), "A. 先进先出");
  assert.equal(paperAnswerText("步骤一\n步骤二", "practical"), "步骤一\n步骤二");
  assert.equal(paperAnswerText("  ", "essay"), "未作答");
});

test("new question types remain answerable without leaking reference answers", () => {
  const raw = ["boolean", "essay", "practical"].map(type => ({ id: type, type, stem: "题干", answer: "答案", explanation: "解析" }));
  const questions = normalizeCourseAssessmentQuestions(raw);
  assert.deepEqual(questions.map(q => q.type), ["boolean", "essay", "practical"]);
  assert.ok(questions.every(q => !("answer" in q) && !("explanation" in q)));
  assert.deepEqual(summarizeExamComposition({ boolean: 2, practical: 1, essay: 1 }), { count: 4, score: 70, minutes: 18 });
  assert.deepEqual(summarizeExamComposition({}), { count: 0, score: 0, minutes: 0 });
});
