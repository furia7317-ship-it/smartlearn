import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createScopedRequestCache,
  DEFAULT_REQUEST_CACHE_TTL_MS,
} from "../lib/request-cache.ts";

const scope = (studentId = "student-a", mode = "live", key = "materials") => ({
  studentId,
  mode,
  key,
});

test("request cache deduplicates in-flight reads and respects account-scoped TTL", async () => {
  let clock = 1_000;
  let calls = 0;
  const cache = createScopedRequestCache(DEFAULT_REQUEST_CACHE_TTL_MS, () => clock);
  const load = async () => ({ call: ++calls });

  const [first, second] = await Promise.all([
    cache.getOrLoad(scope(), load),
    cache.getOrLoad(scope(), load),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);

  assert.deepEqual(await cache.getOrLoad(scope(), load), { call: 1 });
  assert.equal(calls, 1);

  await cache.getOrLoad(scope("student-b"), load);
  await cache.getOrLoad(scope("student-a", "offline"), load);
  await cache.getOrLoad(scope("student-a", "live", "papers"), load);
  assert.equal(calls, 4);

  clock += DEFAULT_REQUEST_CACHE_TTL_MS + 1;
  assert.deepEqual(await cache.getOrLoad(scope(), load), { call: 5 });
});

test("request cache never retains failures", async () => {
  let calls = 0;
  const cache = createScopedRequestCache();
  const fail = async () => {
    calls += 1;
    throw new Error("temporary failure");
  };

  await assert.rejects(cache.getOrLoad(scope(), fail), /temporary failure/);
  await assert.rejects(cache.getOrLoad(scope(), fail), /temporary failure/);
  assert.equal(calls, 2);
});

test("invalidation removes selected keys and blocks late in-flight repopulation", async () => {
  let calls = 0;
  let resolveFirst;
  const cache = createScopedRequestCache();
  const first = cache.getOrLoad(scope(), () => new Promise((resolve) => {
    calls += 1;
    resolveFirst = resolve;
  }));
  await Promise.resolve();

  cache.invalidate({ studentId: "student-a", keys: ["materials"] });
  resolveFirst("stale");
  assert.equal(await first, "stale");

  assert.equal(await cache.getOrLoad(scope(), async () => {
    calls += 1;
    return "fresh";
  }), "fresh");
  assert.equal(calls, 2);
});

test("library lists use the shared cache and home reuses orchestrator resources", async () => {
  const [library, home] = await Promise.all([
    readFile(new URL("../lib/library.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/desktop/page.tsx", import.meta.url), "utf8"),
  ]);

  for (const key of ["materials", "papers", "assessments", "goals"]) {
    assert.match(library, new RegExp(`cachedLibraryList\\(mode, "${key}"`));
  }
  assert.match(library, /invalidateLibraryListCache\("materials", "papers"\)/);
  assert.doesNotMatch(home, /listMaterials\(session\.mode\)/);
  assert.match(home, /for \(const resource of session\.resources\)/);
});

test("graded exams invalidate every list changed by backend persistence", async () => {
  const [course, desktopDiagnostic, baseline, legacyDiagnostic] = await Promise.all([
    readFile(new URL("../components/desktop/desktop-course-assessment.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/desktop/desktop-diagnostic.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/learning-baseline-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/diagnostic/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(course, /invalidateLibraryListCache\("papers", "goals"\)/);
  for (const diagnostic of [desktopDiagnostic, baseline, legacyDiagnostic]) {
    assert.match(
      diagnostic,
      /invalidateLibraryListCache\("papers", "assessments", "goals"\)/,
    );
  }
});
