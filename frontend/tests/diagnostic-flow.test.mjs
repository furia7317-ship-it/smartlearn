import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  diagnosticAnalysisFromGrade,
  diagnosticLevelFromScore,
  normalizeDiagnosticQuestions,
} from "../lib/diagnostic-exam.ts";

const page = await readFile(new URL("../app/diagnostic/page.tsx", import.meta.url), "utf8");
const desktopPage = await readFile(new URL("../components/desktop/desktop-diagnostic.tsx", import.meta.url), "utf8");
const desktopRoute = await readFile(new URL("../app/desktop/diagnostic/page.tsx", import.meta.url), "utf8");

test("standalone diagnostic starts with a real generated exam and grades the submission", () => {
  assert.match(page, /"\/api\/assess\/exam"/);
  assert.match(page, /`\/api\/assess\/\$\{encodeURIComponent\(examId\)\}\/submit`/);
  assert.match(page, /category: "学情摸底"/);
  assert.doesNotMatch(page, /streamSSE\(\s*"\/api\/diagnostic\/"/);
  assert.match(page, /完成测试前不会提前给出学情分析/);
});

test("diagnostic questions use stable fallback ids and discard unusable items", () => {
  assert.deepEqual(normalizeDiagnosticQuestions([
    { type: "mcq", stem: "  队列遵循什么原则？  ", options: ["A. FIFO", "B. LIFO"] },
    { type: "essay", stem: "unsupported" },
    { type: "short", stem: "" },
  ]), [{
    id: "diagnostic-1",
    type: "mcq",
    stem: "队列遵循什么原则？",
    options: ["A. FIFO", "B. LIFO"],
    knowledge_point: undefined,
  }]);
});

test("graded diagnostic drives the displayed mastery level and analysis", () => {
  assert.equal(diagnosticLevelFromScore(59), "基础");
  assert.equal(diagnosticLevelFromScore(0.72), "进阶");
  assert.equal(diagnosticLevelFromScore(85), "完全掌握");

  const analysis = diagnosticAnalysisFromGrade(
    72,
    { 线性表: { score: 0.8 }, 图: { score: 45 } },
    { summary: "基础稳定", weaknesses: ["图"], suggestions: ["复习遍历"], next_steps: ["完成图练习"] },
  );
  assert.deepEqual(analysis.knowledge_seed, { 线性表: 0.8, 图: 0.45 });
  assert.deepEqual(analysis.gaps, ["图"]);
  assert.deepEqual(analysis.recommended_focus, ["复习遍历", "完成图练习"]);
});

test("desktop diagnostic uses the selected three-column assessment workspace", () => {
  assert.match(desktopRoute, /DesktopDiagnostic/);
  assert.match(desktopPage, /aria-label="答题卡"/);
  assert.match(desktopPage, /aria-label="当前题目"/);
  assert.match(desktopPage, /aria-label="本次摸底蓝图"/);
  assert.match(desktopPage, /这题我：/);
  assert.match(desktopPage, /已自动保存/);
  assert.match(desktopPage, /完成全部题目并提交后，才生成学情分析并写入学习画像/);
  assert.match(desktopPage, /answeredCount < questions\.length/);
  assert.match(desktopPage, /"\/api\/assess\/exam"/);
  assert.match(desktopPage, /`\/api\/assess\/\$\{encodeURIComponent\(examId\)\}\/submit`/);
  assert.match(desktopPage, /applyAssessment/);
});
