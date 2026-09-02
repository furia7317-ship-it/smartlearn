// 学枢 — Electron 桌面壳（一体版）
// 双击即自动拉起自带的 Python 后端(FastAPI :8000) + 前端静态站，无需任何环境。
// 后端运行时/依赖/嵌入模型/公共知识索引随安装包分发；db/chroma/media 写入 userData。

const { app, BrowserWindow, Menu, protocol, session, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const DESKTOP_BACKEND_ENV_KEYS = require("./backend-env-keys.json");

function isClosedPipeError(error) {
  const code = String(error?.code || error?.errno || "").toUpperCase();
  const message = String(error?.message || "");
  return (
    ["EPIPE", "EOF", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"].includes(code)
    || /\bwrite\s+(?:EPIPE|EOF)\b/i.test(message)
  );
}

// 防御：当 stdout/stderr 管道被关闭时（后台启动、双击无控制台、父进程退出等），
// console.* 写入会抛 EPIPE，在主进程里会变成「未捕获异常」弹错并退出。这里吞掉管道写入
// 错误，避免一条日志拖垮整个应用。
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (isClosedPipeError(err)) return;
  });
}

function handleMainProcessException(error) {
  if (isClosedPipeError(error)) return;
  process.removeListener("uncaughtException", handleMainProcessException);
  throw error;
}
process.on("uncaughtException", handleMainProcessException);

function createBackendLogStream(logPath) {
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  // 日志写入失败不能拖垮主进程；后端生命周期仍可由健康检查判断。
  stream.on("error", () => {});
  return stream;
}

function writeBackendLog(stream, data) {
  if (!stream || stream.destroyed || !stream.writable) return;
  try {
    stream.write(data);
  } catch (error) {
    if (!isClosedPipeError(error)) throw error;
  }
}

function endBackendLog(stream, data) {
  if (!stream || stream.destroyed || !stream.writable) return;
  try {
    stream.end(data);
  } catch (error) {
    if (!isClosedPipeError(error)) throw error;
  }
}

const PRODUCT_NAME = "学枢";
const LEGACY_PRODUCT_NAMES = ["智学伴A3"];

// 新品牌使用独立 userData 目录；首次启动时从旧目录无损迁移现有学习数据。
app.setName(PRODUCT_NAME);

const SCHEME = "app";
const ROOT = path.join(__dirname, "..", "out"); // 静态站根目录（打包进 asar）
const BACKEND_HOST = "127.0.0.1";
const DEFAULT_BACKEND_PORT = 8000;
let backendPort = DEFAULT_BACKEND_PORT;

// ── 资源路径：打包后在 resources/，开发期在 frontend/runtime 与 ../backend ──
const packaged = app.isPackaged;
const PYTHON = packaged
  ? path.join(process.resourcesPath, "python", "python.exe")
  : path.join(__dirname, "..", "runtime", "python", "python.exe");
const BACKEND_DIR = packaged
  ? path.join(process.resourcesPath, "backend")
  : path.join(__dirname, "..", "..", "backend");
const ASSETS = packaged
  ? path.join(process.resourcesPath, "assets")
  : path.join(__dirname, "..", "runtime", "assets");
const KNOWLEDGE = packaged
  ? path.join(process.resourcesPath, "knowledge")
  : path.join(__dirname, "..", "..", "knowledge");
const REMOTION_RUNTIME = packaged
  ? path.join(process.resourcesPath, "remotion")
  : path.join(__dirname, "..", "remotion-runtime");
const REMOTION_NODE = packaged
  ? path.join(process.resourcesPath, "node", "node.exe")
  : "";

let backendProc = null;
let mainWin = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function allocateBackendPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ host: BACKEND_HOST, port: 0, exclusive: true }, () => {
      const address = probe.address();
      const port = address && typeof address === "object" ? address.port : 0;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("无法分配本地后端端口"));
        else resolve(port);
      });
    });
  });
}

const LEGACY_CACHE_DIRS = new Set(["Cache", "Code Cache", "GPUCache"]);

function copyMissingTree(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    if (LEGACY_CACHE_DIRS.has(path.basename(source))) return;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyMissingTree(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (!fs.existsSync(target)) fs.copyFileSync(source, target);
}

function migrateLegacyUserData() {
  const currentUserData = app.getPath("userData");
  for (const legacyName of LEGACY_PRODUCT_NAMES) {
    const legacyUserData = path.join(app.getPath("appData"), legacyName);
    if (!fs.existsSync(legacyUserData)) continue;
    try {
      copyMissingTree(legacyUserData, currentUserData);
      console.log(`[brand-migration] ${legacyName} -> ${PRODUCT_NAME}`);
    } catch (error) {
      console.error(`[brand-migration] ${error.message}`);
    }
  }
}

const USER_BACKEND_ENV_KEYS = new Set(DESKTOP_BACKEND_ENV_KEYS);

/**
 * 桌面端只从用户数据目录读取允许项。安装包不携带账号或服务密钥；
 * 开发版后端仍可独立使用 backend/.env。
 */
function loadBackendEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};

  const entries = [];
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!USER_BACKEND_ENV_KEYS.has(key)) continue;
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function loadUserBackendEnv(userData) {
  return loadBackendEnvFile(path.join(userData, "backend.env"));
}

const LOCAL_STUDENT_ID_PATTERN =
  /^local_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureRuntimeStudentId() {
  if (LOCAL_STUDENT_ID_PATTERN.test(process.env.SMARTLEARN_STUDENT_ID || "")) {
    return process.env.SMARTLEARN_STUDENT_ID;
  }

  const userData = app.getPath("userData");
  const identityPath = path.join(userData, "identity.json");
  try {
    const stored = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    if (LOCAL_STUDENT_ID_PATTERN.test(stored?.studentId || "")) {
      process.env.SMARTLEARN_STUDENT_ID = stored.studentId;
      return stored.studentId;
    }
  } catch {
    // 首次启动或旧文件损坏时创建新身份。
  }

  const studentId = `local_${randomUUID()}`;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(identityPath, JSON.stringify({ studentId }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  process.env.SMARTLEARN_STUDENT_ID = studentId;
  return studentId;
}

function installDesktopPermissionPolicy() {
  const trustedOrigin = (rawUrl = "") => {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === "app:" && url.hostname === "local") return true;
      return url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
        url.port === "3000";
    } catch {
      return false;
    }
  };
  const trustedFullscreenSource = (rawUrl = "") => {
    if (trustedOrigin(rawUrl)) return true;
    try {
      const url = new URL(rawUrl);
      return url.protocol === "https:" && url.hostname === "player.bilibili.com";
    } catch {
      return false;
    }
  };
  const trustedMediaSource = (origin = "", details = {}) =>
    [origin, details.securityOrigin, details.requestingUrl, details.embeddingOrigin]
      .some((candidate) => trustedOrigin(candidate));
  const audioRequest = (permission, details = {}) =>
    permission === "media" &&
    (!Array.isArray(details.mediaTypes) || details.mediaTypes.includes("audio")) &&
    (!details.mediaType || details.mediaType === "audio" || details.mediaType === "unknown");
  const fullscreenRequest = (webContents, permission, origin = "", details = {}) =>
    permission === "fullscreen" &&
    trustedOrigin(webContents?.getURL?.() || details.embeddingOrigin || "") &&
    [origin, details.securityOrigin, details.requestingUrl, details.requestingOrigin, details.embeddingOrigin]
      .some((candidate) => trustedFullscreenSource(candidate));

  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin, details = {}) =>
    (trustedMediaSource(origin, details) && audioRequest(permission, details)) ||
    fullscreenRequest(webContents, permission, origin, details),
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      (trustedMediaSource(webContents.getURL(), details) && audioRequest(permission, details)) ||
      fullscreenRequest(webContents, permission, details?.requestingUrl || "", details),
    );
  });
}

// ════════════════ 静态站服务（app://local/ → out/） ════════════════
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

async function serve(request) {
  const { pathname } = new URL(request.url);
  let rel = decodeURIComponent(pathname);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  let filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) return new Response("Forbidden", { status: 403 });

  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return new Response(data, {
      headers: { "content-type": MIME[ext] || "application/octet-stream" },
    });
  } catch {
    if (!path.extname(rel)) {
      try {
        const data = await fsp.readFile(path.join(ROOT, "index.html"));
        return new Response(data, { headers: { "content-type": MIME[".html"] } });
      } catch {
        /* fallthrough */
      }
    }
    return new Response("Not Found", { status: 404 });
  }
}

// ════════════════ 后端生命周期 ════════════════
function backendEnv() {
  const userData = app.getPath("userData");
  const dbPath = path.join(userData, "smartlearn.db");
  const chromaDir = path.join(userData, "chroma-cs-2026-v1");
  const mediaDir = path.join(userData, "media", "output");

  const env = { ...process.env };
  delete env.PYTHONHOME; // 防止外部 Python 环境串扰
  delete env.PYTHONPATH;
  // 服务凭据属于当前用户，只能从 userData/backend.env 注入。
  Object.assign(env, loadUserBackendEnv(userData));
  env.SMARTLEARN_STUDENT_ID = ensureRuntimeStudentId();
  Object.assign(env, {
    DEBUG: "false",
    DATABASE_URL: "sqlite+aiosqlite:///" + dbPath.replace(/\\/g, "/"),
    CHROMA_PERSIST_DIR: chromaDir,
    MEDIA_OUTPUT_DIR: mediaDir,
    KNOWLEDGE_DIR: KNOWLEDGE,
    EMBEDDING_MODEL: path.join(ASSETS, "models", "bge-small-zh-v1.5"),
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    REMOTION_RUNTIME_DIR: REMOTION_RUNTIME,
    SMARTLEARN_FFMPEG_THREADS: env.SMARTLEARN_FFMPEG_THREADS || "2",
  });
  if (REMOTION_NODE) env.REMOTION_NODE_BINARY = REMOTION_NODE;
  env.DEFAULT_LLM_PROVIDER ||= "deepseek";
  return { env, dbPath, chromaDir, mediaDir, userData };
}

async function ensureKnowledgeSeed(chromaDir) {
  try {
    if (!fs.existsSync(chromaDir)) {
      const seedChroma = path.join(ASSETS, "chroma_seed_cs2026_v1");
      if (fs.existsSync(seedChroma)) await fsp.cp(seedChroma, chromaDir, { recursive: true });
    }
  } catch (e) {
    console.error("[knowledge-seed] " + e.message);
  }
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: BACKEND_HOST, port: backendPort, path: "/" }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startBackend(env, userData) {
  const logPath = path.join(userData, "backend.log");
  const logStream = createBackendLogStream(logPath);
  writeBackendLog(logStream, `\n==== ${new Date().toISOString()} 启动后端 ====\n`);
  writeBackendLog(logStream, `python: ${PYTHON}\ncwd: ${BACKEND_DIR}\n`);

  backendProc = spawn(
    PYTHON,
    ["-m", "uvicorn", "app.main:app", "--host", BACKEND_HOST, "--port", String(backendPort), "--log-level", "info"],
    { cwd: BACKEND_DIR, env, windowsHide: true }
  );
  backendProc.stdout.on("data", (d) => writeBackendLog(logStream, d));
  backendProc.stderr.on("data", (d) => writeBackendLog(logStream, d));
  backendProc.on("error", (e) => writeBackendLog(logStream, `[spawn-error] ${e.message}\n`));
  backendProc.on("exit", (code) => {
    writeBackendLog(logStream, `\n==== 后端退出 code=${code} ====\n`);
    endBackendLog(logStream);
    console.log(`[backend] exited ${code}`);
  });
  console.log(`[backend] pid=${backendProc.pid} log=${logPath}`);
}

function stopBackend() {
  if (backendProc && backendProc.pid && !backendProc.killed) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(backendProc.pid), "/T", "/F"]);
      } else {
        backendProc.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  backendProc = null;
}

async function setStatus(win, text) {
  if (!win || win.isDestroyed()) return;
  try {
    await win.webContents.executeJavaScript(
      `window.__setStatus && window.__setStatus(${JSON.stringify(text)})`
    );
  } catch {
    /* splash 可能已切走 */
  }
}

async function bootBackendThenLoad(win) {
  const { env, chromaDir, userData } = backendEnv();

  // 开发预览可复用手动启动的 8000；打包版始终使用自己分配的独立端口，
  // 避免误连到 --reload 开发服务及其数据库。
  if (!packaged && await ping()) {
    await win.loadURL(`${SCHEME}://local/desktop/`);
    return;
  }

  await setStatus(win, "正在准备本地数据…");
  await ensureKnowledgeSeed(chromaDir);

  await setStatus(win, "正在启动本地 AI 引擎（首次启动较慢，请稍候）…");
  startBackend(env, userData);

  const deadline = Date.now() + 90000;
  let ok = false;
  while (Date.now() < deadline) {
    if (await ping()) {
      ok = true;
      break;
    }
    await sleep(600);
  }

  if (ok) {
    await setStatus(win, "后端就绪，正在进入…");
    await sleep(250);
  } else {
    await setStatus(win, "后端启动超时，将进入离线界面（详见 backend.log）");
    await sleep(1600);
  }
  await win.loadURL(`${SCHEME}://local/desktop/`);
}

// ════════════════ 窗口 ════════════════
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#29292e",
    show: false,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 内置浏览器用 <webview> 加载任意网页
    },
  });
  mainWin = win;

  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[load-fail] ${code} ${desc} :: ${url}`);
  });
  win.webContents.on("did-finish-load", () => {
    console.log(`[ok] loaded :: ${win.webContents.getURL()}`);
  });

  // 先加载启动页；启动页就绪后异步拉起后端，再切到前端
  win.loadFile(path.join(__dirname, "splash.html"));
  win.webContents.once("did-finish-load", () => {
    bootBackendThenLoad(win);
  });

  if (!app.isPackaged) {
    win.webContents.on("before-input-event", (_e, input) => {
      if (input.key === "F12") win.webContents.toggleDevTools();
    });
  }
}

// ════════════════ 应用入口（单实例） ════════════════
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  // 内置浏览器 <webview> 里 target=_blank / 站内"打开新页面"时，留在同一 webview 内导航，
  // 不再弹出新的 Electron 窗口。
  app.on("web-contents-created", (_evt, contents) => {
    if (contents.getType() === "webview") {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) contents.loadURL(url);
        return { action: "deny" };
      });
    }
  });

  app.whenReady()
    .then(async () => {
      migrateLegacyUserData();
      ensureRuntimeStudentId();
      backendPort = packaged ? await allocateBackendPort() : DEFAULT_BACKEND_PORT;
      process.env.SMARTLEARN_API_BASE = `http://${BACKEND_HOST}:${backendPort}`;
      installDesktopPermissionPolicy();
      protocol.handle(SCHEME, serve);
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      console.error(`[startup-error] ${error instanceof Error ? error.stack : error}`);
      app.quit();
    });

  app.on("window-all-closed", () => {
    stopBackend();
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", stopBackend);
  app.on("will-quit", stopBackend);
}
