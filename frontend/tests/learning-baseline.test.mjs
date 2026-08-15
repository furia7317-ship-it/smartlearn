import test from "node:test";
import assert from "node:assert/strict";
import { isValidLearningBaseline, needsLearningBaseline, wantsLearningPath } from "../lib/learning-baseline.ts";
import { cancelGate, diagnosticBaseline, enterSelfReport, explicitDefault, historyBaseline, initialGateState, normalizeScore, optionAnswerValue, selfReportBaseline } from "../lib/learning-baseline-gate.ts";

test("only learning-path intent requires a baseline", () => {
  assert.equal(wantsLearningPath("给我做 7 天学习计划"), true);
  assert.equal(needsLearningBaseline("生成一份栈讲义"), false);
});

test("gate scoring, mapping, and cancel helpers are deterministic", () => {
  assert.equal(normalizeScore(.72), .72);
  assert.equal(normalizeScore(72), .72);
  assert.equal(diagnosticBaseline(.39, {}, 3).level, "novice");
  assert.equal(diagnosticBaseline(.64, {}, 3).level, "basic");
  assert.equal(diagnosticBaseline(.79, {}, 3).level, "intermediate");
  assert.equal(diagnosticBaseline(80, {}, 3).level, "advanced");
  const initial = initialGateState();
  assert.equal(initial.selectedLevel, null);
  assert.equal(enterSelfReport(initial).step, "self_report");
  assert.equal(selfReportBaseline(enterSelfReport(initial)), null);
  assert.equal(cancelGate(), null);
  assert.equal(optionAnswerValue("A", 3), "A");
  assert.equal(optionAnswerValue("B. option", 0), "B");
  assert.equal(optionAnswerValue("C、中文", 0), "C");
  assert.equal(optionAnswerValue("plain", 2), "C");
  assert.equal(explicitDefault().explicit_default_confirmed, true);
  assert.equal(historyBaseline({id:"1",subject:"x",self_level:"基础",analysis:{},created_at:"now"}).level,"novice");
  assert.equal(historyBaseline({id:"1",subject:"x",self_level:"进阶",analysis:{},created_at:"now"}).level,"intermediate");
  assert.equal(historyBaseline({id:"1",subject:"x",self_level:"完全掌握",analysis:{},created_at:"now"}).level,"advanced");
});

test("default and custom baselines require explicit valid input", () => {
  assert.equal(isValidLearningBaseline({ source: "explicit_default", level: "basic", confidence: .4, summary: "默认" }), false);
  assert.equal(isValidLearningBaseline({ source: "explicit_default", level: "basic", confidence: .4, summary: "默认", explicit_default_confirmed: true }), true);
  assert.equal(isValidLearningBaseline({ source: "self_report", level: "custom", confidence: .5, summary: "其他" }), false);
});
