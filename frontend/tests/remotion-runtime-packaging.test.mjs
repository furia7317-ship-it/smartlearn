import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (relative) => JSON.parse(
  await readFile(new URL(relative, import.meta.url), "utf8"),
);

test("Remotion runtime declares the libraries imported by render.mjs directly", async () => {
  const [manifest, lock] = await Promise.all([
    readJson("../remotion-runtime/package.json"),
    readJson("../remotion-runtime/package-lock.json"),
  ]);

  assert.match(manifest.dependencies.remotion, /^4\.\d+\.\d+$/);
  assert.equal(manifest.dependencies["@remotion/bundler"], manifest.dependencies.remotion);
  assert.equal(manifest.dependencies["@remotion/renderer"], manifest.dependencies.remotion);
  assert.equal(manifest.dependencies["@remotion/cli"], undefined);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(lock.packages["node_modules/@remotion/cli"], undefined);
});
