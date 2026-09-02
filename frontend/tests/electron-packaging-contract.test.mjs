import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop packaging uses a dependency-free staged app", async () => {
  const [packageSource, builderConfig, stagingScript] = await Promise.all([
    read("../package.json"),
    read("../electron-builder.yml"),
    read("../scripts/prepare-electron-app.mjs"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.dependencies["@radix-ui/react-collapsible"], undefined);
  assert.equal(packageJson.dependencies["@radix-ui/react-tooltip"], undefined);
  assert.equal(packageJson.dependencies["tw-animate-css"], undefined);
  assert.equal(packageJson.devDependencies["tw-animate-css"], "^1.4.0");
  assert.match(packageJson.scripts["app:pack"], /npm run build.*prepare:electron-app/);
  assert.match(packageJson.scripts["app:dist"], /npm run build.*prepare:electron-app/);

  assert.match(builderConfig, /app: \.electron-app/);
  assert.match(builderConfig, /!node_modules\/\*\*\/\*/);
  assert.match(builderConfig, /npmRebuild: false/);
  assert.match(builderConfig, /electronLanguages:\s*\n\s*- zh-CN\s*\n\s*- en-US/);
  assert.match(builderConfig, /!\*\*\/__pycache__\/\*\*/);
  assert.match(builderConfig, /!\*\*\/\*\.pyc/);
  assert.doesNotMatch(builderConfig, /!Lib\/site-packages\/\*\*\/(?:test|tests)\/\*\*/);

  assert.match(stagingScript, /main: "electron\/main\.js"/);
  assert.doesNotMatch(stagingScript, /dependencies\s*:/);
  assert.match(stagingScript, /fs\.cpSync\(electronSource/);
  assert.match(stagingScript, /fs\.cpSync\(exportSource/);
});

test("desktop artwork ships compact WebP files without superseded PNG copies", async () => {
  const compactAssets = [
    "../public/brand/desktop/book-spine-mountains-v2",
    "../public/brand/desktop/book-spine-texture-v2",
    "../public/brand/desktop/paper-texture-v2",
    "../public/brand/path/course-data-structures-v1",
    "../public/brand/path/path-canvas-network-v2",
    "../public/brand/path/path-learning-landscape-v1",
    "../public/brand/resources/resource-spread-v3",
  ];

  for (const asset of compactAssets) {
    await access(new URL(`${asset}.webp`, import.meta.url));
    await assert.rejects(access(new URL(`${asset}.png`, import.meta.url)));
  }
});
