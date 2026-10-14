import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remotionRoot = path.join(frontendRoot, "remotion-runtime");
const manifestPath = path.join(remotionRoot, "package.json");
const lockPath = path.join(remotionRoot, "package-lock.json");
const nodeModules = path.join(remotionRoot, "node_modules");
const preparedLockStamp = path.join(nodeModules, ".xueshu-remotion-lock-sha256");
const runtimePython = path.join(frontendRoot, "runtime", "python", "python.exe");
const runtimeArchive = path.join(remotionRoot, "runtime.zip");

const parseJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const manifest = parseJson(manifestPath);
const lock = parseJson(lockPath);
const declaredDependencies = manifest.dependencies ?? {};
const lockedDeclarations = lock.packages?.[""]?.dependencies ?? {};
const declaredNames = Object.keys(declaredDependencies).sort();
const lockedNames = Object.keys(lockedDeclarations).sort();

if (
  JSON.stringify(declaredNames) !== JSON.stringify(lockedNames)
  || declaredNames.some((name) => declaredDependencies[name] !== lockedDeclarations[name])
) {
  throw new Error("Remotion package-lock.json does not match package.json; run npm install in remotion-runtime");
}

const lockDigest = crypto
  .createHash("sha256")
  .update(fs.readFileSync(lockPath))
  .digest("hex");

const dependenciesAreReady = () => {
  if (!fs.existsSync(preparedLockStamp)) return false;
  if (fs.readFileSync(preparedLockStamp, "utf8").trim() !== lockDigest) return false;
  return declaredNames.every((name) => {
    const lockedVersion = lock.packages?.[`node_modules/${name}`]?.version;
    const packageManifest = path.join(nodeModules, ...name.split("/"), "package.json");
    if (!lockedVersion || !fs.existsSync(packageManifest)) return false;
    try {
      return parseJson(packageManifest).version === lockedVersion;
    } catch {
      return false;
    }
  });
};

if (!dependenciesAreReady()) {
  const npmCli = process.env.npm_execpath;
  const installArgs = ["ci", "--omit=dev", "--no-audit", "--no-fund"];
  const install = npmCli && fs.existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...installArgs], {
      cwd: remotionRoot,
      stdio: "inherit",
      windowsHide: true,
    })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", installArgs, {
      cwd: remotionRoot,
      stdio: "inherit",
      windowsHide: true,
    });
  if (install.status !== 0) {
    throw new Error("Failed to prepare the bundled Remotion runtime");
  }
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(preparedLockStamp, `${lockDigest}\n`, "utf8");
  if (!dependenciesAreReady()) {
    throw new Error("The installed Remotion runtime does not match package-lock.json");
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
pruneBuildCaches(nodeModules);
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
