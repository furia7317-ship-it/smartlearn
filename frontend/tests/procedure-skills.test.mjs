import assert from "node:assert/strict";
import test from "node:test";

import { createProcedureSkillsClient } from "../lib/procedure-skill-client.ts";
import { preferredSkillVersion, skillValidationView, skillVersionActions } from "../lib/procedure-skill-model.ts";

const definition = { name: "边界纠错", description: "定位边界错误", resource_types: ["explainer"], triggers: ["学生混淆边界"], steps: ["举出反例"], checks: ["完成迁移题"] };
const passed = (id, version) => ({ id, skill_id: "method-1", version, definition, content_hash: `hash-${id}`, status: "passed", validation: { status: "passed", content_hash: `hash-${id}`, passed: true, completed: true }, source_run_id: "run-a", created_at: "2026-09-22T00:00:00Z" });
const older = passed("v1", 1);
const latest = { ...passed("v2", 2), status: "candidate", validation: {} };
const skill = { id: "method-1", read_only: false, disabled: false, active_version_id: "v1", latest_version_id: "v2", latest_version: 2, versions: [latest, older] };

test("candidate, rejected, partial or stale evaluations cannot enable a version", () => {
  assert.equal(skillVersionActions(skill, latest).activate, false);
  const success = passed("v2", 2);
  assert.equal(skillVersionActions(skill, success).activate, true);
  for (const patch of [
    { status: "rejected" },
    { validation: { status: "passed", content_hash: "hash-v2", passed: true, completed: false } },
    { validation: { status: "passed", content_hash: "other-content", passed: true, completed: true } },
    { validation: { status: "passed", content_hash: "hash-v2", passed: "true", completed: true } },
    { validation: { status: "unavailable", content_hash: "hash-v2", passed: true, completed: true } },
  ]) assert.equal(skillVersionActions(skill, { ...success, ...patch }).activate, false);
});

test("an enabled version cannot be rechecked in place and passed history can be restored", () => {
  assert.deepEqual(skillVersionActions(skill, older), {
    active: true, evaluate: false, activate: false, disable: true, activationLabel: "切回此版本",
  });
  const usingLatest = { ...skill, active_version_id: "v2", versions: [passed("v2", 2), older] };
  assert.equal(skillVersionActions(usingLatest, older).activate, true);
  assert.equal(skillVersionActions(usingLatest, older).activationLabel, "切回此版本");
  const disabled = skillVersionActions({ ...skill, disabled: true }, older);
  assert.equal(disabled.activate, true);
  assert.equal(disabled.disable, false);
  assert.equal(disabled.activationLabel, "重新启用此版本");
});

test("built-in and unrelated methods have no mutation actions", () => {
  for (const state of [
    skillVersionActions({ ...skill, read_only: true }, latest),
    skillVersionActions(skill, { ...older, skill_id: "other-method" }),
    skillVersionActions(skill, passed("unknown-version", 3)),
  ]) {
    assert.equal(state.evaluate, false);
    assert.equal(state.activate, false);
    assert.equal(state.disable, false);
  }
});

test("a newly proposed version is discoverable without changing the active version", () => {
  assert.equal(preferredSkillVersion(skill).id, "v2");
  assert.equal(preferredSkillVersion(skill, "v1").id, "v1");
  assert.equal(preferredSkillVersion(skill, "gone").id, "v2");
  assert.equal(preferredSkillVersion({ ...skill, versions: [] }), undefined);
});

test("validation presentation exposes only bounded, named checks with strict booleans", () => {
  const view = skillValidationView({
    summary: "服务暂不可用", status: "unavailable", completed: false,
    raw_provider_response: "never-display-this",
    deterministic_checks: [{ id: "structure", label: "完整性", passed: "false", detail: "需要适用条件" }, null],
    scenario_results: [{ case_id: "case-1", title: "迁移练习", passed: true, checks: [{ id: "1", label: "步骤", passed: true, detail: "说明清楚" }] }],
    limitations: ["实际教学收益待验证", null, 3],
  });
  assert.equal(view.unavailable, true);
  assert.equal(view.checks.length, 1);
  assert.equal(view.checks[0].passed, false);
  assert.equal(view.cases[0].checks[0].passed, true);
  assert.deepEqual(view.limitations, ["实际教学收益待验证"]);
  assert.doesNotMatch(JSON.stringify(view), /never-display-this/);
  assert.equal(skillValidationView({ summary: "x".repeat(5000) }).summary.length, 800);
});

test("requests include session cookies and capture the current learner in both reads and writes", async () => {
  let account = "student-a";
  const calls = [];
  const client = createProcedureSkillsClient({ apiBase: "http://test", getStudentId: () => account, fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.includes("?") && !url.includes("method") ? [] : { id: "method-1" });
  } });
  await client.list();
  account = "student-b";
  await client.detail("method/one");
  await client.evaluate("method/one", "version-2");
  await client.activate("method/one", "version-1");
  await client.disable("method/one");
  assert.equal(calls[0].url, "http://test/api/procedure-skills?student_id=student-a");
  assert.match(calls[1].url, /method%2Fone\?student_id=student-b$/);
  for (const { init } of calls) {
    assert.equal(init.credentials, "include");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.deepEqual(JSON.parse(calls[2].init.body), { version_id: "version-2", student_id: "student-b" });
  assert.deepEqual(JSON.parse(calls[3].init.body), { version_id: "version-1", student_id: "student-b" });
  assert.deepEqual(JSON.parse(calls[4].init.body), { disabled: true, student_id: "student-b" });
});

test("switching accounts discards an in-flight response instead of returning old personal data", async () => {
  let account = "student-a";
  let finish;
  const client = createProcedureSkillsClient({ apiBase: "http://test", getStudentId: () => account, fetch: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = client.list();
  account = "student-b";
  finish(Response.json([{ name: "student-a private method" }]));
  await assert.rejects(pending, /账户已切换/);
});

test("failed activation returns the API reason and never retries automatically", async () => {
  let calls = 0;
  const client = createProcedureSkillsClient({ apiBase: "http://test", getStudentId: () => "student-a", fetch: async () => {
    calls += 1;
    return Response.json({ detail: "此版本未通过检查" }, { status: 409 });
  } });
  await assert.rejects(client.activate("method-1", "v2"), /此版本未通过检查/);
  assert.equal(calls, 1);
});

test("missing account-scoped details give a recoverable message without revealing ownership", async () => {
  const client = createProcedureSkillsClient({ apiBase: "http://test", getStudentId: () => "student-a", fetch: async () => Response.json({ detail: "Not Found" }, { status: 404 }) });
  await assert.rejects(client.detail("other-persons-method"), /此方法不存在或已不可访问/);
  await assert.rejects(client.list(), /当前学习服务暂不支持教学方法/);
});
