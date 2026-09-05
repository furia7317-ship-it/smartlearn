import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("SQLite is the canonical workspace store and browser storage is migration-only", async () => {
  const [orchestrator, learnerState] = await Promise.all([
    read("../hooks/use-orchestrator.ts"),
    read("../lib/learner-state.ts"),
  ]);

  assert.match(orchestrator, /getLearnerWorkspaceState<DurableSession>\(\)/);
  assert.match(orchestrator, /saveLearnerWorkspaceState\([\s\S]*snapshot,[\s\S]*Date\.now\(\),[\s\S]*workspaceVersionRef\.current/);
  assert.match(orchestrator, /deleteLearnerWorkspaceState\(\)/);
  assert.doesNotMatch(orchestrator, /localStorage\.setItem\(accountStorageKey\(SESSION_KEY\)/);
  assert.match(orchestrator, /localStorage 仅作为旧版本的一次性迁移来源/);
  assert.match(learnerState, /\/api\/memory\/workspace/);
});

test("tutor sends enough working memory for server-side budgeting and compression", async () => {
  const orchestrator = await read("../hooks/use-orchestrator.ts");
  assert.match(orchestrator, /\.slice\(-100\)/);
  assert.match(orchestrator, /conversation_id: ownerConversationId/);
  assert.match(orchestrator, /const messagesRef = useRef\(messages\)/);
  assert.match(orchestrator, /session\.id === ownerConversationId/);
  assert.match(orchestrator, /const history = scopedMessages/);
  assert.match(orchestrator, /event === "context_budget"/);
  assert.match(orchestrator, /已压缩 \$\{compressed\} 条旧消息/);
});

test("settings exposes SQLite-backed memory inspection and explicit forgetting", async () => {
  const [settings, panel, api] = await Promise.all([
    read("../app/settings/page.tsx"),
    read("../components/agent-memory-settings.tsx"),
    read("../lib/agent-memory.ts"),
  ]);

  assert.match(settings, /<AgentMemorySettings mode=\{mode\}/);
  assert.match(panel, /智能体三重记忆/);
  assert.match(panel, /可逐条遗忘/);
  assert.match(panel, /forgetSemanticMemoryFact\(fact\.id\)/);
  assert.match(panel, /clearLongTermAgentMemory\(\)/);
  assert.match(panel, /导出记忆/);
  assert.match(panel, /清空长期记忆/);
  assert.doesNotMatch(panel, /后端服务离线，记忆仍安全保存在本机 SQLite/);
  assert.match(api, /\/api\/memory\/facts\//);
  assert.match(api, /\/api\/memory\/long-term\//);
  assert.match(api, /method: "DELETE"/);
});
