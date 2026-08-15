import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the personal profile uses the selected learning portfolio with working sections", async () => {
  const [page, styles, profilePanel, identityApi] = await Promise.all([
    read("app/desktop/profile/page.tsx"),
    read("app/desktop/profile/profile.module.css"),
    read("components/profile-panel.tsx"),
    read("lib/profile-identity.ts"),
  ]);

  await access(new URL("../public/brand/xueshu-app-icon.png", import.meta.url));
  assert.match(page, /<AvatarPicker[\s\S]*userId=\{user\?\.id\}/);
  assert.match(page, /个人概览/);
  assert.match(page, /学习记录/);
  assert.match(page, /成果档案/);
  assert.match(page, /账号设置/);
  assert.match(page, /本月小结/);
  assert.match(page, /当前学习重点/);
  assert.match(page, /知识掌握图谱/);
  assert.match(page, /最近学习证据/);
  assert.match(page, /AnimatePresence mode="wait"/);
  assert.match(page, /getDesktopViewSwap/);
  assert.match(page, /openGraph/);
  assert.match(page, /listAssessments/);
  assert.match(page, /listPapers/);
  assert.match(page, /buildProfileInsights/);
  assert.match(page, /getProfileIdentity/);
  assert.match(page, /saveProfileIdentity/);
  assert.match(page, /URLSearchParams\(window\.location\.search\)/);
  assert.doesNotMatch(page, /24\.6/);
  assert.doesNotMatch(page, /市场版/);
  assert.doesNotMatch(page, /const evidenceRows/);
  assert.match(profilePanel, /\/desktop\/profile\?view=graph/);
  assert.match(styles, /\.tabs/);
  assert.match(styles, /\.overviewGrid/);
  assert.doesNotMatch(styles, /profile-scholar-desk\.png/);
  assert.match(identityApi, /credentials: "include"/);
  assert.match(identityApi, /method: "PUT"/);
});
