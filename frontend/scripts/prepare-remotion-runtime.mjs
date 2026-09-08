import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remotionRoot = path.join(frontendRoot, "remotion-runtime");
const rendererPackage = path.join(remotionRoot, "node_modules", "@remotion", "renderer");
const runtimePython = path.join(frontendRoot, "runtime", "python", "python.exe");
const runtimeArchive = path.join(remotionRoot, "runtime.zip");

if (!fs.existsSync(rendererPackage)) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) {
    throw new Error("Remotion dependencies are missing and npm could not be located");
  }
  const install = spawnSync(
    process.execPath,
    [npmCli, "ci", "--omit=dev", "--no-audit", "--no-fund"],
    { cwd: remotionRoot, stdio: "inherit", windowsHide: true },
  );
  if (install.status !== 0 || !fs.existsSync(rendererPackage)) {
    throw new Error("Failed to prepare the bundled Remotion runtime");
  }
}

const nodeDir = path.join(frontendRoot, "runtime", "node");
const bundledNode = path.join(nodeDir, "node.exe");
fs.mkdirSync(nodeDir, { recursive: true });
fs.copyFileSync(process.execPath, bundledNode);

const stat = fs.statSync(bundledNode);
if (stat.size < 1_000_000) {
  throw new Error(`Bundled Node runtime is unexpectedly small: ${stat.size}`);
}

if (!fs.existsSync(runtimePython)) {
  throw new Error(`Desktop Python runtime is missing: ${runtimePython}`);
}
const cacheNames = new Set([".cache", ".rollup.cache"]);
const pruneBuildCaches = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    if (cacheNames.has(entry.name)) {
      fs.rmSync(candidate, { recursive: true, force: true });
    } else {
      pruneBuildCaches(candidate);
    }
  }
};
pruneBuildCaches(path.join(remotionRoot, "node_modules"));
if (fs.existsSync(runtimeArchive)) fs.rmSync(runtimeArchive);
const archive = spawnSync(
  runtimePython,
  [
    "-m",
    "zipfile",
    "-c",
    runtimeArchive,
    "package.json",
    "package-lock.json",
    "render.mjs",
    "tsconfig.json",
    "src",
    "node_modules",
  ],
  { cwd: remotionRoot, stdio: "inherit", windowsHide: true },
);
if (archive.status !== 0 || !fs.existsSync(runtimeArchive)) {
  throw new Error("Failed to archive the bundled Remotion runtime");
}

console.log(`Remotion runtime ready: ${remotionRoot}`);
console.log(`Remotion archive ready: ${runtimeArchive}`);
console.log(`Node sidecar ready: ${bundledNode}`);
