import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BUILTIN_AGENT_KEY,
  builtinAgentForType,
  CUSTOM_AGENT_KEY_PREFIX,
  CUSTOM_AGENT_NAME_MAX,
  CUSTOM_AGENT_PROMPT_MAX,
  CUSTOM_AGENT_SCOPE_MAX,
  createCustomAgent,
  customAgentMonogram,
  deleteCustomAgent,
  isCustomAgentKey,
  listCustomAgents,
  normalizeCustomAgentInput,
  normalizeCustomAgentPatch,
  planTaskAgentPatch,
  updateCustomAgent,
  validateCustomAgentInput,
} from "../lib/custom-agents.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const sampleAgent = {
  id: "agent-1",
  name: "严谨的物理助教",
  emoji: "🔬",
  duty: "把公式拆成可验证的推导步骤",
  system_prompt: "先给结论再给推导",
  output_type: "interactive",
  knowledge_scope: ["电磁感应"],
  config: {},
  agent_key: "custom:11111111-2222-3333-4444-555555555555",
  status: "active",
  source_listing_id: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

test("custom agent input is trimmed and clamped to the backend limits", () => {
  const payload = normalizeCustomAgentInput({
    name: `  ${"名".repeat(CUSTOM_AGENT_NAME_MAX + 20)}  `,
    emoji: " 🤖 ",
    duty: "  拆解推导  ",
    system_prompt: `  ${"提".repeat(CUSTOM_AGENT_PROMPT_MAX + 50)}  `,
    knowledge_scope: [
      " 电磁感应 ",
      "电磁感应",
      "",
      "   ",
      ...Array.from({ length: 30 }, (_, index) => `知识点${index}`),
    ],
  });

  assert.equal(payload.name.length, CUSTOM_AGENT_NAME_MAX);
  assert.equal(payload.emoji, "🤖");
  assert.equal(payload.duty, "拆解推导");
  assert.equal(payload.system_prompt.length, CUSTOM_AGENT_PROMPT_MAX);
  assert.equal(payload.knowledge_scope.length, CUSTOM_AGENT_SCOPE_MAX);
  assert.equal(payload.knowledge_scope[0], "电磁感应");
  assert.equal(payload.knowledge_scope.filter((tag) => tag === "电磁感应").length, 1);
  // output_type 未提供时落到既有 9 种里的默认值，用户不能造新类型
  assert.equal(payload.output_type, "reading");
  assert.deepEqual(payload.config, {});
});

test("patches only carry the fields the user actually touched", () => {
  assert.deepEqual(normalizeCustomAgentPatch({}), {});
  assert.deepEqual(normalizeCustomAgentPatch({ name: "  新名字  " }), { name: "新名字" });
  assert.deepEqual(normalizeCustomAgentPatch({ status: "archived" }), { status: "archived" });
  const patch = normalizeCustomAgentPatch({ duty: "", knowledge_scope: [" 力学 ", " 力学 "] });
  assert.deepEqual(patch, { duty: "", knowledge_scope: ["力学"] });
});

test("hand written validation rejects empty names, empty prompts and oversized prompts", () => {
  assert.match(validateCustomAgentInput({ name: "  " }), /名字/);
  assert.match(
    validateCustomAgentInput({ name: "助教", system_prompt: " " }),
    /系统提示词/,
  );
  assert.match(
    validateCustomAgentInput({
      name: "助教",
      system_prompt: "提".repeat(CUSTOM_AGENT_PROMPT_MAX + 1),
      output_type: "reading",
    }),
    new RegExp(`${CUSTOM_AGENT_PROMPT_MAX}`),
  );
  assert.match(
    validateCustomAgentInput({ name: "助教", system_prompt: "有效提示词" }),
    /输出类型/,
  );
  assert.equal(
    validateCustomAgentInput({
      name: "助教",
      system_prompt: "有效提示词",
      output_type: "quiz",
    }),
    null,
  );
});

test("agent keys are recognised by the custom: prefix", () => {
  assert.equal(CUSTOM_AGENT_KEY_PREFIX, "custom:");
  assert.equal(isCustomAgentKey(sampleAgent.agent_key), true);
  assert.equal(isCustomAgentKey("explainer"), false);
  assert.equal(isCustomAgentKey(undefined), false);
});

test("custom agents use a restrained name monogram instead of emoji badges", () => {
  assert.equal(customAgentMonogram("  严谨助教  "), "严");
  assert.equal(customAgentMonogram("physics coach"), "P");
  assert.equal(customAgentMonogram(""), "智");
});

test("每次选执行者都成对写入 agent 与 type，绝不产生失配", () => {
  // agent 决定谁来生成，type 决定走哪道审核门、怎么落库、怎么渲染。
  // 只改其一，后端就会「按 agent 生成、按 type 审核」，产出必被误判并空烧重试。
  const custom = planTaskAgentPatch(sampleAgent.agent_key, [sampleAgent], "explainer");
  assert.deepEqual(custom, { agent: sampleAgent.agent_key, type: "interactive" });

  // 内置执行者由资料类型推导，不接受任意指定。
  const builtin = planTaskAgentPatch(BUILTIN_AGENT_KEY, [sampleAgent], "explainer");
  assert.deepEqual(builtin, { agent: "explainer", type: "explainer" });

  // solution 复用出题智能体，是后端 normalize_task_type 的既有约定。
  assert.deepEqual(planTaskAgentPatch(BUILTIN_AGENT_KEY, [], "solution"), {
    agent: "quiz",
    type: "solution",
  });
  assert.equal(builtinAgentForType("solution"), "quiz");
  assert.equal(builtinAgentForType("interactive"), "interactive");

  // 未知 key（比如已删除的智能体）退回内置，而不是留下一个悬空 agent。
  assert.deepEqual(planTaskAgentPatch("custom:gone", [], "video"), {
    agent: "video",
    type: "video",
  });
});

test("计划编辑器不把内置执行者单列成可选项", async () => {
  const card = await readFile(new URL("../components/resource-plan-card.tsx", import.meta.url), "utf8");
  // 逐个列出内置执行者会让用户造出 agent="video" + type="courseware" 这种失配。
  assert.doesNotMatch(card, /<optgroup label="内置智能体">/);
  assert.match(card, /value=\{BUILTIN_AGENT_KEY\}/);
  // 改资料类型时执行者必须跟着重推。
  assert.match(card, /agent:\s*builtinAgentForType\(type\)/);
});

test("offline degrades reads to empty and refuses writes instead of faking local agents", async () => {
  for (const mode of ["offline", "checking"]) {
    assert.deepEqual(await listCustomAgents(mode), []);
    await assert.rejects(() => createCustomAgent(mode, { name: "助教" }), /学习服务未连接/);
    await assert.rejects(() => updateCustomAgent(mode, "agent-1", { name: "助教" }), /学习服务未连接/);
    await assert.rejects(() => deleteCustomAgent(mode, "agent-1"), /学习服务未连接/);
  }
});

test("the data layer talks to the documented /api/custom-agents contract", async () => {
  const source = await read("../lib/custom-agents.ts");
  assert.match(source, /\/api\/custom-agents\?student_id=\$\{studentId\}&status=active/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /student_id: getStudentId\(\)/);
  assert.match(source, /requireOk/);
  // offline 语义必须写成一种并注释理由，不允许混用 localStorage
  assert.doesNotMatch(source, /localStorage\.(get|set|remove)Item/);
});

test("the agent workspace form states the 2000 character prompt limit and the review guardrail", async () => {
  const workspace = await read("../components/custom-agent-workspace.tsx");

  assert.match(workspace, /CUSTOM_AGENT_PROMPT_MAX/);
  assert.match(workspace, /\{promptLength\} \/ \{CUSTOM_AGENT_PROMPT_MAX\} 字/);
  assert.match(workspace, /已超出 \$\{CUSTOM_AGENT_PROMPT_MAX\} 字上限/);
  assert.match(workspace, /提示词只影响写作风格与侧重，产出仍会走统一的质量审核与防幻觉门禁。/);
  assert.match(workspace, /validateCustomAgentInput/);
  assert.match(workspace, /setError/);
  // 表单校验手写 if + setError，不引入 zod
  assert.doesNotMatch(workspace, /\bzod\b/);
});

test("output types come from MATERIAL_TYPES so no new resource type can be invented", async () => {
  const [workspace, types] = await Promise.all([
    read("../components/custom-agent-workspace.tsx"),
    read("../lib/material-types.ts"),
  ]);

  assert.match(workspace, /MATERIAL_TYPES\.map/);
  assert.match(workspace, /MATERIAL_TYPE_LABEL/);
  assert.match(workspace, /既有 9 种资料类型里选一种/);
  assert.match(types, /id: "interactive", label: "交互演示"/);
  assert.equal((types.match(/\{ id: "/g) ?? []).length, 9);
});

test("deleting an agent needs an explicit second confirmation", async () => {
  const workspace = await read("../components/custom-agent-workspace.tsx");

  assert.match(workspace, /pendingDelete/);
  assert.match(workspace, /role="alertdialog"/);
  assert.match(workspace, /确认删除「\{pendingDelete\.name\}」？/);
  assert.match(workspace, /\{deleting \? "删除中…" : "确认删除"\}/);
  assert.match(workspace, /onClick=\{\(\) => setPendingDelete\(agent\)\}/);
  assert.match(workspace, /onClick=\{confirmDelete\}/);
});

test("desktop hides the agent workbench entry without breaking legacy routes", async () => {
  const [webPage, webShell, desktopPage, desktopComponent, desktopShell, settingsPage] = await Promise.all([
    read("../app/agents/page.tsx"),
    read("../components/layout/app-shell.tsx"),
    read("../app/desktop/agents/page.tsx"),
    read("../components/desktop/desktop-agents.tsx"),
    read("../components/layout/desktop-shell.tsx"),
    read("../app/settings/page.tsx"),
  ]);

  assert.match(webPage, /CustomAgentWorkspace/);
  assert.doesNotMatch(webPage, /["']\/desktop(?:\/|["'])/);
  assert.match(webShell, /href: "\/agents", label: "我的智能体"/);
  assert.match(desktopPage, /^export \{ default \} from "@\/components\/desktop\/desktop-agents";\s*$/);
  assert.match(desktopComponent, /CustomAgentWorkspace/);
  assert.doesNotMatch(desktopShell, /href: "\/desktop\/agents", label: "我的智能体"/);
  const settingsSections = settingsPage.match(/const SETTINGS_SECTIONS[\s\S]*?\n\] as const;/)?.[0] || "";
  assert.doesNotMatch(settingsSections, /高级设置|智能体与工作流/);
  assert.match(settingsPage, /<CustomAgentWorkspace \/>/);
  // 路由过场与侧栏指示条必须保持完好
  assert.match(desktopShell, /DesktopPageTransition/);
  assert.match(desktopShell, /desktop-rail-indicator/);
  assert.match(desktopShell, /LayoutGroup/);
});

test("the plan editor offers a per-task executor dropdown backed by custom agents", async () => {
  const [card, chat, plan] = await Promise.all([
    read("../components/resource-plan-card.tsx"),
    read("../components/chat.tsx"),
    read("../lib/resource-plan.ts"),
  ]);

  assert.match(card, /执行者/);
  assert.match(card, /optgroup label="我的智能体"/);
  assert.match(card, /planTaskAgentPatch\(event\.target\.value, customAgents, task\.type\)/);
  assert.match(card, /value=\{runByCustomAgent \? task\.agent : BUILTIN_AGENT_KEY\}/);
  assert.match(card, /isCustomAgentKey\(task\.agent\)/);
  // 自建智能体执行时资料类型跟随 output_type，不允许再手改
  assert.match(card, /disabled=\{readOnly \|\| runByCustomAgent\}/);
  assert.match(chat, /listCustomAgents\(mode\)/);
  assert.match(chat, /customAgents=\{customAgents\}/);
  assert.match(plan, /agent: ResourceType \| \(string & \{\}\)/);
});
