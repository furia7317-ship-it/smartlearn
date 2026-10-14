import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("conversation persistence sends the account cookie for reads and writes", async () => {
  const source = await read("../lib/conversation-store.ts");

  assert.match(
    source,
    /api\/conversations\/\$\{encodeURIComponent\(studentId\)\}`,[\s\S]{0,120}credentials:\s*"include"/,
  );
  assert.match(
    source,
    /api\/conversations`,\s*\{[\s\S]{0,180}method:\s*"PUT"[\s\S]{0,180}credentials:\s*"include"/,
  );
});
