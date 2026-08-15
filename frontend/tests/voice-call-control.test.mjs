import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("voice calls keep startup failures retryable and adapt to their host surface", async () => {
  const [source, launcher, chat] = await Promise.all([
    read("../components/voice-call-control.tsx"),
    read("../components/desktop/desktop-teacher-launcher.tsx"),
    read("../components/chat.tsx"),
  ]);

  assert.match(source, /voice\.active \|\| voice\.phase === "error"/);
  assert.match(source, /语音通话不可用：\$\{detail\}；点击重试/);
  assert.match(source, /voice\.phase === "error"[\s\S]*border-destructive/);
  assert.match(source, /surfaceMode === "inline" \? "inline" : "full"/);
  assert.match(source, /aria-label="窗口内语音通话"/);
  assert.match(source, /aria-label="与智能教师的语音通话"/);
  assert.match(source, /setSurface\("mini"\)/);
  assert.match(source, /aria-label="恢复语音通话全屏"/);
  assert.match(source, /await voice\.stop\(\)/);
  assert.match(launcher, /surfaceMode="inline"/);
  assert.doesNotMatch(chat, /surfaceMode="inline"/);
});
