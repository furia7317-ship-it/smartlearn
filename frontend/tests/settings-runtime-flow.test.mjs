import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("grade settings expose semesters and migrate legacy grade labels", async () => {
  const [settings, page, onboarding] = await Promise.all([
    read("../lib/user-settings.ts"),
    read("../app/settings/page.tsx"),
    read("../app/onboarding/page.tsx"),
  ]);

  for (const grade of ["大一上", "大一下", "大四下", "研一上", "研三下"]) {
    assert.match(settings, new RegExp(`"${grade}"`));
  }
  assert.match(settings, /LEGACY_GRADE_PATTERN/);
  assert.match(page, /GRADES\.map/);
  assert.match(onboarding, /isUndergraduateGrade/);
});

test("runtime dependency panel manages arbitrary OpenAI-compatible providers", async () => {
  const panel = await read("../components/service-dependency-card.tsx");
  assert.match(panel, /OpenAI 兼容模型供应商/);
  assert.match(panel, /新增供应商/);
  assert.match(panel, /Base URL/);
  assert.match(panel, /API Key/);
  assert.match(panel, /默认对话模型/);
  assert.match(panel, /config\.current === provider\.id/);
  assert.match(panel, /\/api\/config\/llm\/active/);
  assert.match(panel, /\/api\/config\/llm\/providers/);
  assert.match(panel, /method: "PUT"/);
  assert.match(panel, /method: "POST"/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /智能教师、学习路径和资料生成将统一使用该模型/);
  assert.match(panel, /provider\.api_key_hint/);
  assert.doesNotMatch(panel, /DeepSeek 与星火之间选择/);
  assert.match(panel, /HIDDEN_DEPENDENCY_IDS = new Set\(\["spark_avatar"\]\)/);
  assert.doesNotMatch(panel, /TTS、PPT、数字人/);
});

test("settings groups common preferences ahead of goals, memory, and advanced services", async () => {
  const [page, preferences, goals, memory, services, layout, api, reminder] = await Promise.all([
    read("../app/settings/page.tsx"),
    read("../components/learning-preferences-settings.tsx"),
    read("../components/learning-goals-settings.tsx"),
    read("../components/agent-memory-settings.tsx"),
    read("../components/service-dependency-card.tsx"),
    read("../app/layout.tsx"),
    read("../lib/learner-preferences.ts"),
    read("../components/learning-reminder-bridge.tsx"),
  ]);

  for (const section of ["学情与外观", "学习与 AI", "目标管理", "记忆与隐私", "模型与服务"]) {
    assert.match(page, new RegExp(section));
  }
  assert.match(page, /跟随系统/);
  assert.match(layout, /enableSystem/);
  assert.match(goals, /role="dialog"/);
  assert.match(goals, /suggestedTargetDate/);
  assert.match(memory, /管理记忆/);
  assert.match(memory, /long_term_memory_enabled/);
  assert.match(services, /查看高级信息/);
  for (const label of ["教学方式", "回答详细度", "默认难度", "每日学习时长", "偏好资料类型", "每日学习提醒"]) {
    assert.match(preferences, new RegExp(label));
  }
  assert.match(api, /\/api\/settings\//);
  assert.match(api, /method: "PUT"/);
  assert.match(reminder, /30 分钟后提醒/);
});

test("orchestrator effects do not repeat the SQLite synchronization dependencies", async () => {
  const orchestrator = await read("../hooks/use-orchestrator.ts");
  assert.doesNotMatch(
    orchestrator,
    /conversationSyncReady,\s*hydrated,\s*mode,\s*conversationSyncReady/,
  );
  assert.doesNotMatch(orchestrator, /\bmode,\s*conversationSyncReady,\s*messages,\s*mode,/);
});
