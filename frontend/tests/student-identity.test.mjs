import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clearAuthenticatedStudentId,
  getStudentId,
  setAuthenticatedStudentId,
} from "../lib/student-identity.ts";

function fakeStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("browser identity is generated once and reused", () => {
  const storage = fakeStorage();

  const first = getStudentId({
    storage,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  });
  const second = getStudentId({
    storage,
    randomUUID: () => "22222222-2222-4222-8222-222222222222",
  });

  assert.equal(first, "local_11111111-1111-4111-8111-111111111111");
  assert.equal(second, first);
});

test("desktop installation identity wins over browser storage", () => {
  const studentId = getStudentId({
    desktopId: "local_33333333-3333-4333-8333-333333333333",
    storage: fakeStorage([
      ["sl_student_id_v1", "local_44444444-4444-4444-8444-444444444444"],
    ]),
    randomUUID: () => "55555555-5555-4555-8555-555555555555",
  });

  assert.equal(studentId, "local_33333333-3333-4333-8333-333333333333");
});

test("authenticated account identity wins and can be cleared on logout", () => {
  const storage = fakeStorage([
    ["sl_student_id_v1", "local_44444444-4444-4444-8444-444444444444"],
  ]);
  const accountId = "local_77777777-7777-4777-8777-777777777777";

  setAuthenticatedStudentId(accountId, storage);
  assert.equal(getStudentId({ storage }), accountId);

  clearAuthenticatedStudentId(storage);
  assert.equal(getStudentId({ storage }), "local_44444444-4444-4444-8444-444444444444");
});

test("authenticated account identity accepts server-issued ids without weakening anonymous ids", () => {
  const storage = fakeStorage([
    ["sl_student_id_v1", "local_44444444-4444-4444-8444-444444444444"],
  ]);

  setAuthenticatedStudentId("user_001", storage);

  assert.equal(getStudentId({ storage }), "user_001");
});

test("invalid legacy identity is replaced instead of reused", () => {
  const storage = fakeStorage([["sl_student_id_v1", "legacy_student"]]);

  const studentId = getStudentId({
    storage,
    randomUUID: () => "66666666-6666-4666-8666-666666666666",
  });

  assert.equal(studentId, "local_66666666-6666-4666-8666-666666666666");
});

test("learner API callers use the runtime identity instead of a hard-coded account", async () => {
  const files = await Promise.all(
    [
      "../lib/api.ts",
      "../lib/library.ts",
      "../lib/ppt-export.ts",
      "../hooks/use-material-generator.ts",
      "../hooks/use-orchestrator.ts",
      "../app/diagnostic/page.tsx",
      "../app/path/study/page.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
  );
  const source = files.join("\n");

  assert.doesNotMatch(source, /\bSTUDENT_ID\b|PPT_STUDENT_ID/);
  assert.match(source, /getStudentId\(\)/);
});
