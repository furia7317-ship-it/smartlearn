import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnosticAnalysisFromGrade,
  diagnosticLevelFromScore,
  normalizeDiagnosticQuestions,
} from "../lib/diagnostic-exam.ts";

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

