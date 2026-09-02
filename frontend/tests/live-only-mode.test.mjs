import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("orchestrator uses live services and routes first messages by intent", async () => {
  const source = await read("../hooks/use-orchestrator.ts");

  assert.doesNotMatch(source, /OrchestratorMode\s*=\s*"checking"\s*\|\s*"live"\s*\|\s*"demo"/);
  assert.doesNotMatch(source, /const\s+runMainDemo\s*=/);
  assert.doesNotMatch(source, /const\s+runTutorDemo\s*=/);
  assert.doesNotMatch(source, /runMainDemo|runTutorDemo/);
  assert.doesNotMatch(source, /if\s*\(!hasRunMain\)\s*void\s+createPlanForRequest\(trimmed\);/);
  assert.match(source, /const\s+question\s*=\s*trimmed\s*\|\|/);
  assert.match(source, /const\s+generate\s*=\s*wantsResource\(question\);/);
  assert.match(source, /else if\s*\(generate\)\s*void\s+createPlanForRequest\(question\);\s*else\s*void\s+runTutorLive\(question, question, undefined, \[\], pageContext\);/);
});

test("backend-unavailable helpers do not synthesize placeholder content", async () => {
  const files = {
    library: await read("../lib/library.ts"),
    video: await read("../lib/video-learning.ts"),
    web: await read("../lib/web-summary.ts"),
    avatar: await read("../lib/avatar.ts"),
  };

  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /"demo"/, `${name} must not expose a demo mode`);
    assert.doesNotMatch(source, /\bdemo[A-Z]\w*|buildDemo\w*/, `${name} must not keep demo payload builders`);
    assert.doesNotMatch(source, /演示模式|演示\/离线模式|演示兜底/, `${name} must not describe demo fallback behavior`);
  }
});
