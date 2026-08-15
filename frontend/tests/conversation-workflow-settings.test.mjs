import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONVERSATION_WORKFLOW_SETTINGS_KEY,
  loadConversationWorkflowSettings,
  saveConversationWorkflowSettings,
} from "../lib/conversation-workflow-settings.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("conversation workflow settings persist independently per conversation", () => {
  const storage = memoryStorage();
  const saved = saveConversationWorkflowSettings(storage, {
    conversationId: "conversation-a",
    workflowId: "workflow-dp",
    knowledgeScope: "course",
    memoryPolicy: "session",
  });

  assert.equal(saved.workflowId, "workflow-dp");
  assert.equal(
    loadConversationWorkflowSettings(storage, "conversation-a")?.memoryPolicy,
    "session",
  );
  assert.equal(
    loadConversationWorkflowSettings(storage, "conversation-b"),
    null,
  );
});

test("conversation workflow settings ignore malformed local data", () => {
  const storage = memoryStorage({
    [CONVERSATION_WORKFLOW_SETTINGS_KEY]: JSON.stringify({
      "conversation-a": {
        conversationId: "conversation-a",
        workflowId: "workflow-dp",
        knowledgeScope: "unknown",
        memoryPolicy: "session",
      },
    }),
  });

  assert.equal(
    loadConversationWorkflowSettings(storage, "conversation-a"),
    null,
  );
});

test("desktop studio hides workflow controls while preserving the legacy implementation", async () => {
  const [studio, drawer] = await Promise.all([
    read("../components/desktop/desktop-studio.tsx"),
    read("../components/desktop/conversation-workflow-drawer.tsx"),
  ]);

  assert.match(studio, /aria-label="新建会话"/);
  assert.match(studio, />\s*新建会话\s*</);
  assert.match(studio, /setTeacherChooserOpen\(true\)/);
  assert.doesNotMatch(studio, /<ConversationWorkflowDrawer|workflowDrawerTarget|选择工作流/);
  assert.match(studio, /o\.renameConversation/);
  assert.match(studio, />\s*删除\s*</);
  assert.doesNotMatch(studio, /aria-label=\{`删除会话：/);
  assert.match(drawer, /loadCustomWorkflows\(window\.localStorage\)/);
  assert.match(drawer, /创建新会话/);
  assert.match(drawer, /保存会话设置/);
  assert.match(drawer, /工作流结构/);
  assert.match(drawer, /duration: 1\.25/);
});
