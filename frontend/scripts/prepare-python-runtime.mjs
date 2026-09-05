import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(frontendRoot, "runtime");
const backendRoot = path.resolve(frontendRoot, "../backend");
const target = path.join(runtimeRoot, "python");
const lockFile = path.join(backendRoot, "requirements-windows.lock");
const pythonVersion = fs.readFileSync(path.join(backendRoot, ".python-version"), "utf8").trim();
const digest = crypto.createHash("sha256").update(fs.readFileSync(lockFile)).digest("hex");
const stamp = ".xueshu-python-lock.json";
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", UV_HTTP_TIMEOUT: "120",
  UV_HTTP_RETRIES: "5", UV_CONCURRENT_DOWNLOADS: "4" };

if (process.platform !== "win32") throw new Error("The desktop runtime builder targets Windows x64.");
if (!/^3\.11\.\d+$/.test(pythonVersion)) throw new Error("Use the exact supported Python 3.11 patch version in backend/.python-version.");
fs.mkdirSync(runtimeRoot, { recursive: true });
const realRoot = fs.realpathSync(runtimeRoot);

function checked(candidate) {
  const absolute = path.resolve(candidate);
  const resolved = fs.existsSync(absolute) ? fs.realpathSync(absolute)
    : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  if (!resolved.startsWith(realRoot + path.sep)) throw new Error(`Runtime path escapes ${realRoot}: ${resolved}`);
  return absolute;
}

function run(command, args, cwd = backendRoot) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.status}`);
}

function matches(directory) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, stamp), "utf8"));
    return value.python === pythonVersion && value.lockSha256 === digest;
  } catch { return false; }
}

function verify(directory) {
  const python = path.join(directory, "python.exe");
  run(python, ["-I", "-c", `
import importlib.metadata as metadata, re, sys
from pathlib import Path
assert sys.version.split()[0] == ${JSON.stringify(pythonVersion)}, sys.version
text = Path(${JSON.stringify(lockFile)}).read_text('utf-8')
expected = dict(re.findall(r'^([a-zA-Z0-9_.-]+)(?:\\[[^\\]]+\\])?==([^\\s;\\\\]+)', text, re.M))
normalize = lambda value: re.sub(r'[-_.]+', '-', value).lower()
expected = {normalize(name): version for name, version in expected.items()}
assert expected, 'No pinned distributions in runtime lock'
actual = {normalize(d.metadata['Name']): d.version for d in metadata.distributions()}
for name, version in expected.items():
    assert actual.get(name) == version, (name, version, actual.get(name))
unexpected = actual.keys() - expected.keys() - {'pip', 'wheel', 'setuptools'}
assert not unexpected, sorted(unexpected)
import fastapi, sqlalchemy, chromadb, sentence_transformers, numpy, pypdf, docx, openpyxl, pptx
print('Verified Python', sys.version.split()[0], 'and', len(expected), 'locked runtime packages')
`], directory);
  run("uv", ["pip", "check", "--python", python], directory);
}

function activate(prepared) {
  checked(prepared);
  checked(target);
  if (path.resolve(prepared) === path.resolve(target)) throw new Error("Prepared runtime must differ from the active runtime.");
  if (!matches(prepared)) throw new Error("Prepared runtime does not match the current Python version and lock.");
  verify(prepared);
  const previous = path.join(runtimeRoot, `python.previous-${Date.now()}`);
  checked(previous);
  if (fs.existsSync(target)) fs.renameSync(target, previous);
  try {
    fs.renameSync(prepared, target);
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(checked(previous), checked(target));
    throw error;
  }
  console.log(`Desktop Python runtime ready: ${target}`);
  if (fs.existsSync(previous)) console.log(`Previous runtime retained for rollback: ${previous}`);
}

const activateIndex = process.argv.indexOf("--activate");
if (activateIndex >= 0) {
  const prepared = process.argv[activateIndex + 1];
  if (!prepared) throw new Error("--activate requires the prepared runtime directory.");
  activate(prepared);
} else if (matches(target) && !process.argv.includes("--rebuild")) {
  verify(target);
  console.log("Desktop Python runtime matches its lock.");
} else if (process.argv.includes("--check")) {
  throw new Error("Desktop runtime is missing or out of date. Run npm run prepare:python-runtime.");
} else {
  // Build outside the active runtime; failed downloads leave the app intact.
  const downloads = path.join(runtimeRoot, ".python-build");
  run("uv", ["python", "install", pythonVersion, "--no-bin", "--install-dir", downloads]);
  const source = path.join(downloads, `cpython-${pythonVersion}-windows-x86_64-none`);
  const prepared = path.join(runtimeRoot, `python.prepared-${crypto.randomUUID()}`);
  checked(prepared);
  fs.cpSync(source, prepared, { recursive: true });
  run("uv", ["pip", "sync", "--python", path.join(prepared, "python.exe"),
    // This is our checked, isolated copy, never uv's shared Python installation.
    "--break-system-packages", "--require-hashes", "--index-url", "https://pypi.org/simple", lockFile]);
  verify(prepared);
  fs.writeFileSync(path.join(prepared, stamp), JSON.stringify({ python: pythonVersion, lockSha256: digest }, null, 2));
  console.log(`Prepared runtime: ${prepared}`);
  if (!process.argv.includes("--stage-only")) activate(prepared);
}
