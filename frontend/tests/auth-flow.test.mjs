import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test("root shell keeps marketing public and guards application routes with the account provider", async () => {
  const [layout, shell] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/shell-switch.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /<AuthProvider>/);
  assert.match(shell, /isMarketing/);
  assert.match(shell, /if \(isMarketing\) return children/);
  assert.match(shell, /router\.replace\("\/desktop"\)/);
  assert.doesNotMatch(shell, /\/choose-platform|\/mobile/);
  assert.match(shell, /router\.replace\("\/login\?next=%2Fdesktop"\)/);
  assert.match(shell, /router\.replace\("\/onboarding\?next=%2Fdesktop"\)/);
  assert.match(shell, /user\.onboarding_completed/);
});

test("login and first-use onboarding route directly into the desktop app", async () => {
  const [login, onboarding, majorCatalog] = await Promise.all([
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/onboarding/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/major-catalog-combobox.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(login, /router\.replace\("\/desktop"\)/);
  assert.match(onboarding, /router\.replace\("\/desktop"\)/);
  assert.doesNotMatch(login, /\/mobile|\/choose-platform/);
  assert.doesNotMatch(onboarding, /\/mobile|\/choose-platform/);
  assert.match(login, /用户名或邮箱/);
  assert.match(login, /创建账户/);
  assert.doesNotMatch(login, /30 天演示账号|填入账号/);
  assert.match(onboarding, /基本学情/);
  assert.match(onboarding, /学习偏好/);
  assert.match(onboarding, /长期目标/);
  assert.match(onboarding, /中期目标/);
  assert.match(onboarding, /短期目标/);
  assert.match(onboarding, /可不填/);
  assert.match(onboarding, /selectedMajor !== null/);
  assert.match(onboarding, /useReducedMotion/);
  assert.match(majorCatalog, /必须从检索结果中选择/);
  assert.match(majorCatalog, /searchMajorCatalog/);
  assert.match(majorCatalog, /let active = true/);
  assert.doesNotMatch(majorCatalog, /new AbortController/);
});

test("account endpoints always send the HttpOnly session cookie", async () => {
  const auth = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");

  assert.match(auth, /credentials:\s*"include"/);
  assert.match(auth, /\/api\/auth/);
  assert.match(auth, /"\/session"/);
  assert.doesNotMatch(auth, /localStorage.*password|password.*localStorage/);
});

test("account recovery is bounded and retries after the local service returns", async () => {
  const [provider, auth] = await Promise.all([
    readFile(new URL("../components/auth-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /AUTH_REQUEST_TIMEOUT_MS\s*=\s*8_000/);
  assert.match(auth, /controller\.abort\(\)/);
  assert.match(provider, /if \(!serviceError \|\| isLocallySignedOut\(\)\) return/);
  assert.match(provider, /window\.setInterval\(retry, 2_500\)/);
  assert.match(provider, /window\.addEventListener\("online", retry\)/);
  assert.match(provider, /document\.addEventListener\("visibilitychange", retry\)/);
});

test("logout clears local identity immediately and cannot be undone by a stale cookie", async () => {
  const [provider, auth] = await Promise.all([
    readFile(new URL("../components/auth-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(provider, /LOCALLY_SIGNED_OUT_KEY/);
  assert.match(provider, /setLocallySignedOut\(true\)[\s\S]*setUser\(null\)[\s\S]*await logoutAccount/);
  assert.match(provider, /if \(isLocallySignedOut\(\)\)/);
  assert.match(auth, /logoutAccount\(signal\?: AbortSignal\)/);
  assert.match(auth, /keepalive: true/);
});

test("web shell exposes a real logout action that clears auth and returns to marketing", async () => {
  const [shell, provider] = await Promise.all([
    readFile(new URL("../components/layout/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth-provider.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /function LogoutButton/);
  assert.match(shell, /await logout\(\)/);
  assert.match(shell, /router\.replace\("\/"\)/);
  assert.match(shell, /退出 Web 登录/);
  assert.match(provider, /await logoutAccount\(/);
  assert.match(provider, /clearAuthenticatedStudentId\(\)/);
  assert.match(provider, /setUser\(null\)/);
});
