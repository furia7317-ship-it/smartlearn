import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = fs.readFileSync(path.join(here, "../components/learning-baseline-gate.tsx"), "utf8");
const profile = fs.readFileSync(path.join(here, "../components/profile-panel.tsx"), "utf8");
const orchestrator = fs.readFileSync(path.join(here, "../hooks/use-orchestrator.ts"), "utf8");

test("learning-path confirmation is driven by model clarification context", () => {
  assert.match(gate, /\/api\/chat\/clarify\/stream/);
  assert.match(gate, /event === "reasoning_delta"/);
  assert.match(gate, /onClarification\?\.\(streamedReasoning, true\)/);
  assert.match(gate, /onClarification\?\.\(next\.summary, false\)/);
  assert.doesNotMatch(gate, /phase: "confirmed"/);
  assert.match(orchestrator, /phase: "confirmed"/);
  assert.match(orchestrator, /learningPathConfirmationMessage\(confirmation\)/);
  assert.match(gate, /智能体需要补充信息/);
  assert.match(gate, /if \(!readyToReveal \|\| loading \|\| \(payload\?\.decision === "execute"/);
  assert.match(gate, /requestAnimationFrame\(\(\) => setReadyToReveal\(true\)\)/);
  assert.match(gate, /request_refinement/);
  assert.match(gate, /requirement_contract_source/);
  assert.doesNotMatch(gate, /questions\.unshift/);
  assert.doesNotMatch(gate, /Q1\. 基础确认方式/);
});

test("profile panel reports real update time and evidence sources", () => {
  assert.match(profile, /最近画像更新/);
  assert.match(profile, /来源：/);
  assert.doesNotMatch(profile, /无需填表/);
  assert.match(orchestrator, /markProfileUpdate\("练习批改"\)/);
  assert.match(orchestrator, /markProfileUpdate\("学习复盘"\)/);
  assert.match(orchestrator, /markProfileUpdate\("学情摸底"\)/);
});
