import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const runtimePython = path.join(frontendRoot, "runtime", "python", "python.exe");
const pythonEnv = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
};
const required = [
  ["pypdf", "pypdf>=5.0"],
  ["docx", "python-docx>=1.1"],
  ["openpyxl", "openpyxl>=3.1"],
];
const desktopExcludedDistributions = [
  "smartlearn-backend",
  "matplotlib",
  "manim",
  "pytest",
  "pytest-asyncio",
  "pytest-cov",
  "coverage",
  "ruff",
];

if (!fs.existsSync(runtimePython)) {
  throw new Error(`Desktop Python runtime is missing: ${runtimePython}`);
}

function moduleAvailable(moduleName) {
  const probe = spawnSync(
    runtimePython,
    ["-c", `import ${moduleName}`],
    { stdio: "ignore", windowsHide: true, env: pythonEnv },
  );
  return probe.status === 0;
}

function distributionInstalled(distributionName) {
  const probe = spawnSync(
    runtimePython,
    ["-m", "pip", "show", distributionName],
    { stdio: "ignore", windowsHide: true, env: pythonEnv },
  );
  return probe.status === 0;
}

const installedExcluded = desktopExcludedDistributions.filter(distributionInstalled);
if (installedExcluded.length > 0) {
  console.log(`Removing non-production Python packages: ${installedExcluded.join(", ")}`);
  const uninstall = spawnSync(
    runtimePython,
    ["-m", "pip", "uninstall", "-y", ...installedExcluded],
    { stdio: "inherit", windowsHide: true, env: pythonEnv },
  );
  if (uninstall.status !== 0) {
    throw new Error("Failed to remove non-production Python packages");
  }
}

const missing = required.filter(([moduleName]) => !moduleAvailable(moduleName));
if (missing.length > 0) {
  console.log(`Installing missing desktop document readers: ${missing.map(([name]) => name).join(", ")}`);
  const install = spawnSync(
    runtimePython,
    [
      "-m",
      "pip",
      "install",
      ...missing.map(([, requirement]) => requirement),
      "--disable-pip-version-check",
      "--no-cache-dir",
    ],
    { stdio: "inherit", windowsHide: true, env: pythonEnv },
  );
  if (install.status !== 0) {
    throw new Error("Failed to install desktop document readers");
  }
}

const unavailable = required.filter(([moduleName]) => !moduleAvailable(moduleName));
if (unavailable.length > 0) {
  throw new Error(`Desktop Python runtime is incomplete: ${unavailable.map(([name]) => name).join(", ")}`);
}

const dependencyCheck = spawnSync(
  runtimePython,
  ["-m", "pip", "check"],
  { stdio: "inherit", windowsHide: true, env: pythonEnv },
);
if (dependencyCheck.status !== 0) {
  throw new Error("Desktop Python runtime contains incompatible dependencies");
}

console.log("Desktop Python runtime dependencies are ready.");
