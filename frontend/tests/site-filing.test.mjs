import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("filing is deployment-specific and links to the official registry", () => {
  const source = readFileSync(new URL("../components/site-filing.tsx", import.meta.url), "utf8");
  assert.match(source, /process\.env\.NEXT_PUBLIC_ICP_NUMBER/);
  assert.match(source, /if \(!number\) return null/);
  assert.match(source, /href="https:\/\/beian\.miit\.gov\.cn\/"/);
  assert.match(source, /rel="noopener noreferrer"/);
});

for (const page of ["components/marketing/marketing-home.tsx", "app/login/page.tsx"]) {
  test(`${page} includes the filing in its footer`, () => {
    const source = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(source, /<footer[\s\S]*?<SiteFiling\s*\/>[\s\S]*?<\/footer>/);
  });
}
