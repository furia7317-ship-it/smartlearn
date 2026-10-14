// Windows source checkout launcher. Defaults match README.md and frontend/lib/api.ts.
// Uses installed runtimes only; does not install dependencies or change system settings.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");
const runDir = path.join(root, "tmp", "launcher");
const lockPath = path.join(runDir, "launch.lock");
const token = randomUUID();
const ownedChildren = [];
let ownsLock = false;
let stopping = false;
let running = false;
let serviceFailure;
let reader;
let logPath;
let resolveCompletion;
const completion = new Promise((resolve) => { resolveCompletion = resolve; });

function say(message) {
  process.stdout.write(`${message}\n`);
  if (logPath) fs.appendFileSync(logPath, `${message}\n`, "utf8");
}

function optionsFromArgs() {
  const options = { frontendPort: 3000, backendPort: 8000, timeout: 120, noBrowser: false, check: false };
  const numeric = { "--frontend-port": "frontendPort", "--backend-port": "backendPort", "--timeout-seconds": "timeout" };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-browser") options.noBrowser = true;
    else if (arg === "--check") options.check = true;
    else if (numeric[arg]) {
      const text = args[++index];
      const value = Number(text);
      const max = arg === "--timeout-seconds" ? 600 : 65535;
      if (!/^\d+$/.test(text || "") || value < 1 || value > max) throw new Error(`${arg} 参数无效。`);
      options[numeric[arg]] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (options.frontendPort === options.backendPort) throw new Error("前后端端口不能相同。");
  return options;
}

function command(executable, args) {
  return execFileSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 15000 });
}

function processInfo(pids) {
  if (!pids.length) return [];
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const query = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`;
  try {
    const parsed = JSON.parse(command(ps, ["-NoProfile", "-NonInteractive", "-Command", query]).replace(/^\uFEFF/, "").trim() || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new Error("无法读取占用端口的进程归属。请在本机直接双击启动入口；启动器不会结束无法确认归属的进程。");
  }
}

function listeningOwners(port) {
  const owners = new Set();
  for (const line of command("netstat.exe", ["-ano", "-p", "tcp"]).split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === "TCP" && fields[3] === "LISTENING" && fields[1].endsWith(`:${port}`)) {
      const pid = Number(fields[4]);
      if (Number.isInteger(pid) && pid > 0) owners.add(pid);
    }
  }
  return [...owners];
}

function belongsToProject(info, service) {
  const line = (info?.CommandLine || "").replaceAll("/", "\\").toLowerCase();
  const directory = (service === "后端" ? root : frontendDir).toLowerCase() + "\\";
  if (!line.includes(directory)) return false;
  return service === "后端"
    ? /\buvicorn\s+app\.main:app\b/i.test(info.CommandLine)
    : /(?:next[\\/]dist[\\/]|serve-static\.mjs)/i.test(info.CommandLine);
}

async function healthy(service, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3500), redirect: "follow" });
    if (!response.ok) { await response.body?.cancel(); return false; }
    if (service === "后端") {
      const body = await response.json();
      return body.status === "running" && typeof body.name === "string" && typeof body.version === "string";
    }
    const html = await response.text();
    return /<html[\s>]/i.test(html) && /学枢|_next\//.test(html);
  } catch { return false; }
}

async function existingService(service, port, url) {
  const pids = listeningOwners(port);
  if (!pids.length) return false;
  const infos = processInfo(pids);
  if (!pids.every((pid) => belongsToProject(infos.find((info) => info.ProcessId === pid), service))) {
    throw new Error(`${service}端口 ${port} 已被其他服务占用，或无法确认属于本项目（PID ${pids.join(", ")}）。请查看占用程序，或使用说明中的端口参数；启动器不会关闭它。`);
  }
  if (!(await healthy(service, url))) {
    throw new Error(`${service}进程已占用 ${port}，但健康检查未通过。请查看原启动窗口；不会重复启动或关闭已有服务。`);
  }
  say(`[复用] ${service}已就绪：${url}（PID ${pids.join(", ")}）`);
  return true;
}

function runtimeDependencies(needBackend, needFrontend) {
  const requiredMajor = Number(fs.readFileSync(path.join(root, ".node-version"), "utf8").trim().split(".")[0]);
  if (Number(process.versions.node.split(".")[0]) !== requiredMajor) throw new Error(`请使用 Node.js ${requiredMajor}.x，当前为 ${process.version}。参见 README.md。`);
  const python = [path.join(backendDir, ".venv", "Scripts", "python.exe"), path.join(frontendDir, "runtime", "python", "python.exe")].find((candidate) => fs.existsSync(candidate));
  let npmCli;
  if (needBackend) {
    if (!python) throw new Error("未找到后端 Python 环境（backend\\.venv 或 frontend\\runtime\\python）。请按 README.md 创建 Python 3.11.15 环境并同步 requirements-windows.lock，再双击启动；不会自动安装依赖。");
    const modules = ["uvicorn", "fastapi", "pydantic_settings", "sqlalchemy", "aiosqlite", "langgraph", "langchain_openai", "chromadb", "numpy", "httpx", "multipart", "pptx", "PIL", "pypdf", "docx", "openpyxl", "bs4"];
    const probe = spawnSync(python, ["-c", `import sys,json,importlib.util; print(json.dumps({'version':list(sys.version_info[:3]),'missing':[m for m in ${JSON.stringify(modules)} if importlib.util.find_spec(m) is None]}))`], { cwd: backendDir, encoding: "utf8", windowsHide: true, timeout: 20000 });
    if (probe.error || probe.status !== 0) throw new Error("后端 Python 环境不可运行。请按 README.md 修复环境；不会自动安装依赖。");
    const result = JSON.parse(probe.stdout.trim());
    if (result.version[0] !== 3 || result.version[1] !== 11) throw new Error(`后端要求 Python 3.11，当前为 ${result.version.join(".")}。参见 backend/.python-version。`);
    if (result.missing.length) throw new Error(`后端缺少依赖：${result.missing.join(", ")}。请按 README.md 同步 requirements-windows.lock。`);
    say(`[检查] Python ${result.version.join(".")} 和后端依赖可用。`);
  }
  if (needFrontend) {
    if (!fs.existsSync(path.join(frontendDir, "node_modules", "next", "dist", "bin", "next"))) throw new Error("前端依赖未安装。请先在 frontend 中手动运行 npm ci，再双击启动；不会自动安装依赖。");
    let npmPaths;
    try { npmPaths = command("where.exe", ["npm.cmd"]).trim().split(/\r?\n/); }
    catch { throw new Error("未找到 npm。请使用包含 npm 的 Node.js 24 安装。参见 README.md。"); }
    npmCli = npmPaths.map((entry) => path.join(path.dirname(entry.trim()), "node_modules", "npm", "bin", "npm-cli.js")).find((candidate) => fs.existsSync(candidate));
    if (!npmCli) throw new Error("未找到 npm-cli.js。请修复 Node.js 24 / npm 安装。参见 README.md。");
    say(`[检查] Node.js ${process.versions.node} 和前端依赖可用。`);
  }
  return { python, npmCli };
}

function acquireLock() {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
    ownsLock = true;
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let previous;
  try { previous = JSON.parse(fs.readFileSync(lockPath, "utf8")); }
  catch { throw new Error(`启动锁损坏，请检查 ${lockPath}；确认没有启动窗口后再删除此锁文件。`); }
  if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error(`启动锁无效，请检查 ${lockPath}。`);
  let alive = true;
  try { process.kill(previous.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
  if (alive) {
    const info = processInfo([previous.pid]).find((entry) => entry.ProcessId === previous.pid);
    // An unrelated process may have reused the PID after the old launcher exited.
    alive = !info || (info.CommandLine || "").toLowerCase().includes(scriptPath.toLowerCase());
  }
  if (alive) return false;
  fs.unlinkSync(lockPath);
  return acquireLock();
}

function releaseLock() {
  if (!ownsLock) return;
  try {
    if (JSON.parse(fs.readFileSync(lockPath, "utf8")).token === token) fs.unlinkSync(lockPath);
  } catch { /* Never remove another launcher's lock. */ }
  ownsLock = false;
}

async function stop(code) {
  if (stopping) return completion;
  stopping = true;
  reader?.close();
  process.stdin.pause();
  // A piped stdin can otherwise keep Node alive after both services have stopped.
  process.stdin.unref?.();
  for (const entry of [...ownedChildren].reverse()) {
    if (entry.child.exitCode !== null || entry.child.signalCode !== null || !entry.child.pid) continue;
    say(`[停止] ${entry.name}（仅本次创建的 PID ${entry.child.pid} 及其子进程）`);
    try { command("taskkill.exe", ["/PID", String(entry.child.pid), "/T", "/F"]); }
    catch { if (entry.child.exitCode === null) say(`[提示] 无法自动停止 ${entry.name}，请查看对应 PID。`); }
  }
  releaseLock();
  process.exitCode = code;
  resolveCompletion();
}

function startService(name, executable, args, cwd, env) {
  say(`[启动] ${name}……`);
  const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  ownedChildren.push({ name, child });
  const output = (data) => { const text = data.toString("utf8"); process.stdout.write(text); fs.appendFileSync(logPath, text, "utf8"); };
  child.stdout.on("data", output);
  child.stderr.on("data", output);
  const failed = (detail) => {
    if (stopping) return;
    serviceFailure = new Error(`${name}进程退出：${detail}。详细错误见上方及日志 ${logPath}`);
    if (running) { say(`[错误] ${serviceFailure.message}`); void stop(1); }
  };
  child.on("error", (error) => failed(error.message));
  child.on("exit", (code, signal) => failed(signal || `退出码 ${code}`));
  return child;
}

async function waitReady(name, url, timeout) {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    if (serviceFailure) throw serviceFailure;
    if (stopping) return false;
    if (await healthy(name, url)) { say(`[就绪] ${name}：${url}`); return true; }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`${name}在 ${timeout} 秒内未就绪，请查看日志 ${logPath}。`);
}

function openBrowser(url) {
  const helper = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], { windowsVerbatimArguments: true, windowsHide: true, encoding: "utf8", timeout: 15000 });
  if (helper.error || helper.status !== 0) say(`[提示] 浏览器未能自动打开，请手动访问 ${url}`);
}

async function main() {
  if (process.platform !== "win32") throw new Error("此入口适用于 Windows。");
  const options = optionsFromArgs();
  for (const directory of [backendDir, frontendDir]) if (!fs.existsSync(directory)) throw new Error(`项目目录缺失：${directory}`);
  fs.mkdirSync(runDir, { recursive: true });
  logPath = path.join(runDir, `launch-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.log`);
  const apiUrl = `http://127.0.0.1:${options.backendPort}/`;
  const webUrl = `http://127.0.0.1:${options.frontendPort}/desktop/`;
  say(`学枢 · 本地一键启动\n项目：${root}\n日志：${logPath}`);
  if (!options.check && !acquireLock()) {
    say("[重复启动] 已有本项目启动窗口，正在启动或运行中。请查看该窗口。不会创建重复服务。");
    if (!options.noBrowser && await healthy("后端", apiUrl) && await healthy("前端", webUrl)) openBrowser(webUrl);
    return;
  }
  const backendExists = await existingService("后端", options.backendPort, apiUrl);
  const frontendExists = await existingService("前端", options.frontendPort, webUrl);
  if (frontendExists && options.backendPort !== 8000) throw new Error("自定义后端端口时，请选择一个未被已有前端占用的前端端口，以保证 API 地址一致。");
  const runtimes = runtimeDependencies(options.check || !backendExists, options.check || !frontendExists);
  if (options.check) { say("[通过] 运行环境检查完成；未启动服务。"); return; }
  if (!backendExists) {
    if (!fs.existsSync(path.join(backendDir, ".env"))) say("[提示] 未找到 backend/.env。界面和基础后端可启动；AI 生成与云端检索需要按 .env.example 自行配置服务凭据。");
    startService("后端", runtimes.python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(options.backendPort)], backendDir, { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });
    if (!(await waitReady("后端", apiUrl, options.timeout))) return;
  }
  if (!frontendExists) {
    startService("前端", process.execPath, [runtimes.npmCli, "run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(options.frontendPort)], frontendDir, { ...process.env, NEXT_PUBLIC_API_BASE: apiUrl.replace(/\/$/, ""), PORT: String(options.frontendPort) });
    if (!(await waitReady("前端", webUrl, options.timeout))) return;
  }
  if (serviceFailure) throw serviceFailure;
  say(`[成功] 打开 ${webUrl}\n学习路径：${webUrl}path/`);
  if (!options.noBrowser) openBrowser(webUrl);
  if (!ownedChildren.length) { say("前后端均为已有服务，已复用。它们继续由原启动窗口管理。"); return; }
  running = true;
  say("请保持此窗口开启。退出时按回车或 Ctrl+C，只停止本次新启动的服务；已复用的服务继续运行。");
  reader = createInterface({ input: process.stdin });
  reader.once("line", () => { void stop(0); });
  await completion;
}

process.on("SIGINT", () => { say("\n正在停止本次启动的服务……"); void stop(0); });
process.on("SIGTERM", () => { void stop(0); });
process.on("exit", releaseLock);
try { await main(); releaseLock(); }
catch (error) { say(`[错误] ${error.message}`); await stop(1); }
