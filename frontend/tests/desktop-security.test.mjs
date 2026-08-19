import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop bundle source contains no embedded vendor credentials", async () => {
  const source = await read("../electron/main.js");

  assert.doesNotMatch(source, /sk-[a-z0-9]{16,}/i);
  assert.doesNotMatch(source, /IFLYTEK_[A-Z_]+:\s*"[^"]+"/);
  assert.match(source, /backend\.env/);
});

test("desktop main process tolerates closed console and backend log pipes", async () => {
  const source = await read("../electron/main.js");

  assert.match(source, /function isClosedPipeError/);
  assert.match(source, /"EPIPE", "EOF", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"/);
  assert.match(source, /process\.on\("uncaughtException", handleMainProcessException\)/);
  assert.match(source, /stream\.on\("error", \(\) => \{\}\)/);
  assert.match(source, /backendProc\.stdout\.on\("data", \(d\) => writeBackendLog\(logStream, d\)\)/);
  assert.match(source, /backendProc\.stderr\.on\("data", \(d\) => writeBackendLog\(logStream, d\)\)/);
});

test("desktop shell persists and exposes one installation student identity", async () => {
  const [main, preload] = await Promise.all([
    read("../electron/main.js"),
    read("../electron/preload.js"),
  ]);

  assert.match(main, /identity\.json/);
  assert.match(main, /SMARTLEARN_STUDENT_ID/);
  assert.match(preload, /studentId:\s*process\.env\.SMARTLEARN_STUDENT_ID/);
});

test("packaged desktop owns an isolated backend port and exposes it to the renderer", async () => {
  const [main, preload, api] = await Promise.all([
    read("../electron/main.js"),
    read("../electron/preload.js"),
    read("../lib/api.ts"),
  ]);

  assert.match(main, /packaged \? await allocateBackendPort\(\) : DEFAULT_BACKEND_PORT/);
  assert.match(main, /if \(!packaged && await ping\(\)\)/);
  assert.match(main, /process\.env\.SMARTLEARN_API_BASE/);
  assert.match(preload, /apiBase:\s*process\.env\.SMARTLEARN_API_BASE/);
  assert.match(api, /window\.desktop\?\.apiBase/);
  assert.match(api, /desktopApiBase \|\| process\.env\.NEXT_PUBLIC_API_BASE/);
});

test("public HTTPS web uses the same origin for API requests", async () => {
  const api = await read("../lib/api.ts");

  assert.match(api, /window\.location\.protocol === "https:"/);
  assert.match(api, /window\.location\.origin/);
  assert.match(api, /window\.location\.hostname/);
  assert.match(api, /`http:\/\/\$\{browserApiHost\}:8000`/);
  assert.doesNotMatch(api, /window\.location\.hostname === "127\.0\.0\.1"/);
});

test("desktop microphone policy accepts the app origin without relying on a trailing slash", async () => {
  const main = await read("../electron/main.js");

  assert.match(main, /url\.protocol === "app:" && url\.hostname === "local"/);
  assert.match(main, /details\.securityOrigin/);
  assert.match(main, /details\.requestingUrl/);
  assert.match(main, /details\.mediaType === "audio"/);
});

test("desktop fullscreen policy permits only the app and the embedded Bilibili player", async () => {
  const main = await read("../electron/main.js");

  assert.match(main, /permission === "fullscreen"/);
  assert.match(main, /url\.hostname === "player\.bilibili\.com"/);
  assert.match(main, /trustedOrigin\(webContents\?\.getURL\?\.\(\)/);
});

test("desktop reads service credentials only from the user data directory", async () => {
  const main = await read("../electron/main.js");

  assert.match(main, /Object\.assign\(env, loadUserBackendEnv\(userData\)\)/);
  assert.doesNotMatch(main, /loadPackagedBackendEnv/);
  assert.doesNotMatch(main, /ASSETS, "backend\.env"/);
});

test("desktop constrains video rendering and exposes the bundled Remotion runtime", async () => {
  const main = await read("../electron/main.js");

  assert.match(main, /REMOTION_RUNTIME_DIR: REMOTION_RUNTIME/);
  assert.match(main, /REMOTION_NODE_BINARY = REMOTION_NODE/);
  assert.match(main, /SMARTLEARN_FFMPEG_THREADS: env\.SMARTLEARN_FFMPEG_THREADS \|\| "2"/);
});
