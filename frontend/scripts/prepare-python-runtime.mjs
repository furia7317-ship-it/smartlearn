import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const runtimePython = path.join(frontendRoot, "runtime", "python", "python.exe");
const required = [
  ["pypdf", "pypdf>=5.0"],
  ["docx", "python-docx>=1.1"],
  ["openpyxl", "openpyxl>=3.1"],
];

if (!fs.existsSync(runtimePython)) {
  throw new Error(`Desktop Python runtime is missing: ${runtimePython}`);
}

function moduleAvailable(moduleName) {
  const probe = spawnSync(
    runtimePython,
    ["-c", `import ${moduleName}`],
    { stdio: "ignore", windowsHide: true },
  );
  return probe.status === 0;
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
    { stdio: "inherit", windowsHide: true },
  );
  if (install.status !== 0) {
    throw new Error("Failed to install desktop document readers");
  }
}

const unavailable = required.filter(([moduleName]) => !moduleAvailable(moduleName));
if (unavailable.length > 0) {
  throw new Error(`Desktop Python runtime is incomplete: ${unavailable.map(([name]) => name).join(", ")}`);
}

console.log("Desktop Python document readers are ready.");
