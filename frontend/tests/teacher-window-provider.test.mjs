import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("desktop teacher window state persists above the desktop shell and supports contextual open controls", async () => {
  const [provider, shellSwitch, types] = await Promise.all([
    read("../components/desktop/teacher-window-provider.tsx"),
    read("../components/layout/shell-switch.tsx"),
    read("../lib/types.ts"),
  ]);

  for (const field of ["open", "wide", "draft", "context"]) {
    assert.match(provider, new RegExp(`\\b${field}\\b`));
  }
  for (const action of [
    "openTeacher",
    "minimizeTeacher",
    "toggleWide",
    "setDraft",
    "clearContext",
  ]) {
    assert.match(provider, new RegExp(`\\b${action}\\b`));
  }
  assert.match(provider, /export type TeacherWindowContext = TutorPageContext/);
  for (const contextField of ["module", "title", "detail", "entityId"]) {
    assert.match(types, new RegExp(`${contextField}\\?: string`));
  }

  assert.match(provider, /export function useTeacherWindow/);
  assert.match(provider, /export function TeacherOpenButton/);
  assert.match(provider, /ComponentPropsWithoutRef<"button">/);
  assert.match(provider, /if \(!event\.defaultPrevented\) openTeacher\(context\)/);
  assert.match(provider, /useSearchParams\(\)/);
  assert.match(provider, /searchParams\.get\("teacher"\) === "open"/);
  assert.match(provider, /<Suspense fallback=\{null\}>/);

  assert.match(shellSwitch, /import \{ TeacherWindowProvider \}/);
  assert.match(
    shellSwitch,
    /<ApplicationProviders>[\s\S]*?<TeacherWindowProvider>[\s\S]*?<DesktopShell>[\s\S]*?<\/DesktopShell>[\s\S]*?<\/TeacherWindowProvider>[\s\S]*?<\/ApplicationProviders>/,
  );
  const webBranch = shellSwitch.match(/return <ApplicationProviders><AppShell>[^\n]+/)?.[0] ?? "";
  assert.match(webBranch, /<AppShell>/);
  assert.doesNotMatch(webBranch, /TeacherWindowProvider/);
});
