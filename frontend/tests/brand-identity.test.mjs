import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("web and desktop surfaces expose the 学枢 brand", () => {
  const metadata = read("app/layout.tsx");
  const desktopShell = read("components/layout/desktop-shell.tsx");
  const webBrand = read("components/layout/brand-lockup.tsx");
  const marketing = read("components/marketing/marketing-home.tsx");
  const splash = read("electron/splash.html");

  assert.match(metadata, /title: "学枢 — AI 个性化学习平台"/);
  assert.match(desktopShell, />学枢</);
  assert.match(desktopShell, />XUESHU</);
  assert.match(webBrand, />学枢</);
  assert.match(marketing, /© 2026 学枢 Xueshu/);
  assert.match(splash, /<title>学枢<\/title>/);
  assert.doesNotMatch([metadata, desktopShell, webBrand, marketing, splash].join("\n"), /智学伴|SMARTLEARN/);
});

test("desktop package uses the mascot icon and migrates the legacy data directory", () => {
  const builder = read("electron-builder.yml");
  const main = read("electron/main.js");
  const packageJson = JSON.parse(read("package.json"));
  const icon = new URL("../public/brand/xueshu-app-icon.png", import.meta.url);

  assert.equal(packageJson.version, "0.1.14");
  assert.equal(packageJson.author, "学枢团队");
  assert.match(builder, /productName: 学枢/);
  assert.match(builder, /artifactName: 学枢-一体安装版-\$\{version\}\.exe/);
  assert.match(builder, /icon: public\/brand\/xueshu-app-icon\.png/);
  assert.match(main, /const PRODUCT_NAME = "学枢"/);
  assert.match(main, /migrateLegacyUserData\(\)/);
  assert.ok(existsSync(icon));
  assert.ok(statSync(icon).size > 100_000);
});
