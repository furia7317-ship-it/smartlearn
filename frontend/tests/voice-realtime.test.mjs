import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adaptiveEndpointDelayMs,
  cleanSpeechText,
  extractSpeakableChunks,
} from "../lib/voice-turn.ts";
import { parseVoiceCommand, voiceDestinationPath } from "../lib/voice-command.ts";

test("adaptive endpointing waits for unfinished Mandarin phrases", () => {
  assert.ok(adaptiveEndpointDelayMs("我觉得因为", 2) >= 1_000);
  assert.ok(adaptiveEndpointDelayMs("这个结论成立。", 2) <= 200);
  assert.ok(adaptiveEndpointDelayMs("好", 0.5) >= 600);
});

test("streamed assistant text becomes non-duplicated speakable chunks", () => {
  const first = extractSpeakableChunks("**结论**：数组支持随机访问。后面还", 0, false);
  assert.deepEqual(first.map((item) => item.text), ["结论：数组支持随机访问。"]);
  const second = extractSpeakableChunks("**结论**：数组支持随机访问。后面还有链表", first[0].endOffset, true);
  assert.deepEqual(second.map((item) => item.text), ["后面还有链表"]);
  assert.equal(cleanSpeechText("[打开资料](https://example.com)"), "打开资料");
});

test("voice commands are explicit, bounded, and shell-aware", () => {
  assert.deepEqual(parseVoiceCommand("帮我打开资源中心"), {
    type: "navigate",
    destination: "resources",
    label: "打开资源中心",
  });
  assert.equal(parseVoiceCommand("请解释怎么打开资源中心"), null);
  assert.equal(voiceDestinationPath("resources", "/desktop/studio/"), "/desktop/resources/");
  assert.equal(voiceDestinationPath("resources", "/studio/"), "/resources/");
});

test("voice call keeps a heartbeat, reconnects, and delegates resource actions", () => {
  const hook = readFileSync(new URL("../hooks/use-realtime-voice.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");
  assert.match(hook, /type:\s*"ping"/);
  assert.match(hook, /connectSocketRef\.current/);
  assert.match(hook, /resolveAgentResourceAction/);
  assert.match(api, /\/api\/voice\/action/);
  assert.match(hook, /onOpenResource/);
  assert.match(hook, /isResourceOpenIntent/);
});

test("voice call serializes MiMo speech prefetches instead of bursting requests", () => {
  const hook = readFileSync(new URL("../hooks/use-realtime-voice.ts", import.meta.url), "utf8");

  assert.match(hook, /speechRequestTailRef/);
  assert.match(hook, /speechRequestTailRef\.current\.then/);
  assert.match(hook, /speechRequestTailRef\.current = request\.then/);
});

test("text software actions inherit a prior explicit resource target", () => {
  const orchestrator = readFileSync(new URL("../hooks/use-orchestrator.ts", import.meta.url), "utf8");
  assert.match(orchestrator, /previousSpecificRequest/);
  assert.match(orchestrator, /hasResourceTypeHint\(message\.content\)/);
  assert.match(orchestrator, /用户补充/);
  assert.match(orchestrator, /mergeResourceLists\(persisted, availableResources\)/);
  assert.match(orchestrator, /planned\.action === "open_resource"/);
});
