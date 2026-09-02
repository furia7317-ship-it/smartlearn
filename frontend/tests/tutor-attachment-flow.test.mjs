import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chat = await readFile(new URL("../components/chat.tsx", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("../hooks/use-orchestrator.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../lib/api.ts", import.meta.url), "utf8");
const types = await readFile(new URL("../lib/types.ts", import.meta.url), "utf8");
const materials = await readFile(new URL("../lib/material-types.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("../components/resource-viewer.tsx", import.meta.url), "utf8");

test("smart tutor accepts click and drag-drop attachments", () => {
  assert.match(chat, /type="file"/);
  assert.match(chat, /onDrop=/);
  assert.match(chat, /uploadTutorAttachment/);
  assert.match(chat, /图片、PDF、Word/);
  assert.match(api, /\/api\/chat\/attachments/);
  assert.match(chat, /讯飞已识别/);
  assert.match(chat, /正在识别/);
  assert.match(orchestrator, /attachments,/);
  assert.match(orchestrator, /void runTutorLive\(question, question, undefined, attachments, pageContext\)/);
});

test("chat history persists only public attachment metadata", () => {
  assert.match(types, /attachments\?: ChatAttachmentMeta\[\]/);
  assert.match(orchestrator, /attachments\.map\(\(\{ id, name, kind, media_type, size \}\)/);
  assert.doesNotMatch(orchestrator, /patchMessage\([^)]*image_data/);
});

test("problem solution is a distinct resource type with a dedicated viewer", () => {
  assert.match(types, /\| "solution"/);
  assert.match(materials, /id: "solution", label: "题目解析"/);
  assert.match(viewer, /function SolutionBody/);
  assert.match(viewer, /case "solution"/);
  assert.match(viewer, /参考答案/);
  assert.match(viewer, /逐题解析/);
});
