import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canSubmitConfirmation,
  confirmedLearningPathAnswers,
  confirmationProgress,
  createSingleSubmitGuard,
  learningPathConfirmationMessage,
  normalizeDiagnosticQuestions,
} from "../lib/learning-path-confirmation.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("learning path confirmation is a non-modal model-driven card that asks only unresolved fields", async () => {
  const gate = await read("../components/learning-baseline-gate.tsx");
  const chat = await read("../components/chat.tsx");
  const orchestrator = await read("../hooks/use-orchestrator.ts");

  assert.match(gate, /role="region"/);
  assert.doesNotMatch(gate, /aria-modal="true"/);
  assert.doesNotMatch(gate, /fixed inset-0/);
  assert.match(gate, /clipPath: "inset\(0 0 100% 0\)"/);
  assert.match(gate, /learning-confirmation-title/);
  assert.doesNotMatch(gate, /document\.addEventListener\("keydown"/);
  assert.match(gate, /\/api\/chat\/clarify\/stream/);
  assert.match(gate, /event === "reasoning_delta"/);
  assert.doesNotMatch(gate, /phase: "confirmed"/);
  assert.match(orchestrator, /phase: "confirmed"/);
  assert.match(orchestrator, /addMessage\("user", "text", learningPathConfirmationMessage\(confirmation\)\)/);
  assert.match(orchestrator, /traceMessageId = addMessage\("assistant", "text", "", true\)/);
  assert.match(orchestrator, /reasoning: streamedReasoning/);
  assert.match(gate, /normalizeQuestions/);
  assert.match(gate, /智能体需要补充信息/);
  assert.match(gate, /request_refinement/);
  assert.match(gate, /allow_custom/);
  assert.match(gate, /requirement_contract_source/);
  assert.match(gate, /if \(!readyToReveal \|\| loading \|\| \(payload\?\.decision === "execute"/);
  assert.match(gate, /requestAnimationFrame\(\(\) => setReadyToReveal\(true\)\)/);
  assert.match(gate, /useEffectEvent\(submit\)/);
  assert.match(gate, /\}, \[autoSubmitReady\]\)/);
  const cardHeader = gate.slice(
    gate.indexOf('data-testid="learning-requirement-card"'),
    gate.indexOf("{loadError &&"),
  );
  assert.doesNotMatch(cardHeader, /onClick=\{onCancel\}/);
  assert.match(gate, /按此方案生成/);
  assert.match(gate, /textarea/);
  assert.doesNotMatch(gate, /questions\.unshift/);
  assert.ok(chat.indexOf("baselineGate?.request") < chat.indexOf('data-testid="chat-composer"'));
  assert.doesNotMatch(gate, /Q1\. 基础确认方式/);
  assert.doesNotMatch(chat, /请回复 A\/B\/C/);
  assert.match(chat, /fallbackReasoning[\s\S]*aria-live=\{streaming \? "polite"/);
});

test("confirmed form values become a visible user message and a review payload", () => {
  const confirmation = {
    baseline: {
      source: "self_report",
      level: "intermediate",
      confidence: 0.8,
      summary: "用户自评",
    },
    preferences: {
      goal: "exam",
      days: 3,
      daily_minutes: 40,
      material_types: ["explainer", "quiz"],
    },
    clarifications: {
      baseline_level: "intermediate",
      preferred_examples: "历年真题",
    },
  };
  assert.deepEqual(confirmedLearningPathAnswers(confirmation), {
    baseline_level: "intermediate",
    preferred_examples: "历年真题",
    baseline_source: "self_report",
    goal: "exam",
    days: 3,
    daily_minutes: 40,
    material_types: ["explainer", "quiz"],
  });
  assert.equal(
    learningPathConfirmationMessage(confirmation),
    [
      "我已填写学习任务信息：",
      "基础：能完成基础题",
      "目标：应试复习",
      "周期：3 天",
      "每天：40 分钟",
      "资料：讲义、练习题",
      "补充：历年真题",
    ].join("\n"),
  );
});

test("diagnostic normalization preserves an AI-sized mixed paper up to fifteen questions", () => {
  const questions = normalizeDiagnosticQuestions([
    { id: "a", type: "mcq", stem: "A", options: ["A. one", "B. two"] },
    { id: "blank", type: "blank", stem: "blank", options: ["x", "y"] },
    { id: "short", type: "short", stem: "short", options: [] },
    { id: "bad", type: "mcq", stem: "bad", options: ["only", null] },
    { id: "b", type: "mcq", stem: "B", options: ["A", "B"] },
    { id: "c", type: "mcq", stem: "C", options: ["A", "B"] },
    { id: "d", type: "mcq", stem: "D", options: ["A", "B"] },
    { id: "e", type: "mcq", stem: "E", options: ["A", "B"] },
    { id: "f", type: "mcq", stem: "F", options: ["A", "B"] },
  ]);
  assert.equal(questions.length, 8);
  assert.ok(
    questions.filter((question) => question.type === "mcq")
      .every((question) => question.options.length >= 2),
  );
  assert.ok(questions.some((question) => question.type === "blank"));
  assert.ok(questions.some((question) => question.type === "short"));
  assert.deepEqual(
    normalizeDiagnosticQuestions([
      { id: "a", type: "mcq", stem: "A", options: ["A", "B"] },
    ]),
    [],
  );
});

test("confirmation progress preserves its branch sequence and submit guard accepts once", () => {
  const defaultSteps = [
    "method",
    "goal",
    "days",
    "minutes",
    "materials",
    "summary",
  ];
  for (const [index, page] of defaultSteps.entries()) {
    assert.deepEqual(confirmationProgress(page, 0, 3, "default"), {
      current: index + 1,
      total: 6,
    });
  }
  const diagnosticSteps = [
    "method",
    "diagnostic",
    "diagnostic",
    "diagnostic",
    "goal",
    "days",
    "minutes",
    "materials",
    "summary",
  ];
  for (const [index, page] of diagnosticSteps.entries()) {
    assert.deepEqual(
      confirmationProgress(page, Math.min(index - 1, 2), 3, "diagnostic"),
      { current: index + 1, total: 9 },
    );
  }
  assert.equal(canSubmitConfirmation(false), true);
  assert.equal(canSubmitConfirmation(true), false);
  const guard = createSingleSubmitGuard();
  assert.equal(guard(), true);
  assert.equal(guard(), false);
});

test("explicit confirmation preferences are sent with the learning-path plan request", async () => {
  const api = await read("../lib/resource-plan-api.ts");
  const orchestrator = await read("../hooks/use-orchestrator.ts");

  assert.match(api, /learning_path_preferences/);
  assert.match(orchestrator, /confirmation\?\.preferences/);
  assert.match(orchestrator, /continueLearningPath/);
});

test("planning failures preserve the confirmation modal and use sanitized actions", async () => {
  const gate = await read("../components/learning-baseline-gate.tsx");
  const apiError = await read("../lib/api-error.ts");

  assert.match(gate, /重试生成/);
  assert.match(gate, /打开知识库/);
  assert.match(apiError, /validation\.message/);
});
