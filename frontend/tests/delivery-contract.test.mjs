import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("delivery uses built frontend, persistent sqlite, production dependencies, and clean lint scope", async (context) => {
  try {
    await access(new URL("../../deploy/docker-compose.yml", import.meta.url));
  } catch {
    context.skip("web deployment files are intentionally excluded from this desktop workspace");
    return;
  }
  const [compose, dockerfile, pyproject, readme, eslint] = await Promise.all([
    read("../../deploy/docker-compose.yml"),
    read("../../backend/Dockerfile"),
    read("../../backend/pyproject.toml"),
    read("../../README.md"),
    read("../eslint.config.mjs"),
  ]);

  assert.match(compose, /\.\.\/frontend\/out:\/usr\/share\/nginx\/html:ro/);
  assert.match(compose, /smartlearn-data:\/app\/data/);
  assert.match(
    compose,
    /sqlite\+aiosqlite:\/\/\/\/app\/data\/smartlearn\.db/
  );
  assert.doesNotMatch(dockerfile, /\.\[dev\]/);
  assert.match(pyproject, /beautifulsoup4>=4\.12/);
  assert.doesNotMatch(readme, /脚本化.*演示|脚本剧本/);
  assert.match(eslint, /dist-electron\/\*\*/);
  assert.match(eslint, /runtime\/\*\*/);
});

test("desktop delivery packages runtime source without local accounts or credentials", async () => {
  const [packageJsonSource, serviceEnvKeysSource, runtimeScript, knowledgeSeedScript, knowledgeSeedBuilder, remotionScript, electronMain, builderConfig] = await Promise.all([
    read("../package.json"),
    read("../electron/backend-env-keys.json"),
    read("../scripts/prepare-python-runtime.mjs"),
    read("../scripts/prepare-knowledge-seed.mjs"),
    read("../../backend/scripts/build_packaged_knowledge_seed.py"),
    read("../scripts/prepare-remotion-runtime.mjs"),
    read("../electron/main.js"),
    read("../electron-builder.yml"),
  ]);
  const packageJson = JSON.parse(packageJsonSource);
  const serviceEnvKeys = JSON.parse(serviceEnvKeysSource);

  const expectedPreparation = "npm run prepare:python-runtime && npm run prepare:knowledge-seed && npm run prepare:remotion-runtime";
  assert.equal(packageJson.scripts["preapp:dist"], expectedPreparation);
  assert.equal(packageJson.scripts["preapp:pack"], expectedPreparation);
  assert.equal(packageJson.scripts["prepare:full-desktop-data"], undefined);
  assert.equal(packageJson.scripts["prepare:test-service-env"], undefined);
  assert.equal(packageJson.scripts["prepare:demo-data"], undefined);
  assert.equal(packageJson.scripts["mobile:apk"], undefined);
  assert.ok(serviceEnvKeys.includes("DEEPSEEK_API_KEY"));
  assert.ok(serviceEnvKeys.includes("DEEPSEEK_BASE_URL"));
  assert.ok(serviceEnvKeys.includes("QWEN_API_KEY"));
  assert.ok(serviceEnvKeys.includes("OPENAI_API_KEY"));
  for (const key of [
    "SPARK_API_KEY",
    "BOCHA_API_KEY",
    "IFLYTEK_API_SECRET",
    "IFLYTEK_VISION_API_SECRET",
    "IFLYTEK_PDF_OCR_API_SECRET",
    "IFLYTEK_AVATAR_API_SECRET",
    "MIMO_API_KEY",
    "MINIMAX_API_KEY",
    "PEXELS_API_KEY",
  ]) {
    assert.ok(serviceEnvKeys.includes(key), `${key} must be accepted from the user's local config`);
  }
  assert.match(electronMain, /require\("\.\/backend-env-keys\.json"\)/);
  assert.match(electronMain, /Object\.assign\(env, loadUserBackendEnv\(userData\)\)/);
  assert.doesNotMatch(electronMain, /loadPackagedBackendEnv/);
  assert.doesNotMatch(electronMain, /runDemoSeedUpgrade/);
  assert.doesNotMatch(electronMain, /ASSETS, "smartlearn\.db"/);
  assert.match(runtimeScript, /\["pypdf", "pypdf>=5\.0"\]/);
  assert.match(runtimeScript, /\["docx", "python-docx>=1\.1"\]/);
  assert.match(runtimeScript, /\["openpyxl", "openpyxl>=3\.1"\]/);
  assert.match(knowledgeSeedScript, /chroma_seed_cs2026_v1/);
  assert.match(knowledgeSeedBuilder, /collection_count != len\(documents\)/);
  assert.match(electronMain, /chroma-cs-2026-v1/);
  assert.match(electronMain, /chroma_seed_cs2026_v1/);
  assert.match(remotionScript, /node_modules", "@remotion", "renderer"/);
  assert.match(remotionScript, /fs\.copyFileSync\(process\.execPath, bundledNode\)/);
  assert.match(remotionScript, /"-m",\s*"zipfile",\s*"-c"/);
  assert.match(electronMain, /DEFAULT_LLM_PROVIDER \|\|= "deepseek"/);
  assert.match(builderConfig, /!smartlearn\.db/);
  assert.match(builderConfig, /!backend\.env/);
  assert.match(builderConfig, /from: remotion-runtime/);
  assert.match(builderConfig, /runtime\.zip/);
  assert.match(builderConfig, /from: runtime\/node/);
});
