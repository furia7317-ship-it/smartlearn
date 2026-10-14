/* eslint-disable @typescript-eslint/no-require-imports -- Electron main process uses CommonJS. */
const fs = require("node:fs");
const path = require("node:path");

function readDemoManifest(seedRoot) {
  const file = path.join(seedRoot, "manifest.json");
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.format !== 1 || !manifest.student_id || manifest.product_name !== "学枢演示版") {
    throw new Error("演示数据清单格式不正确");
  }
  return manifest;
}

async function ensureDemoSeed(seedRoot, userData) {
  const manifest = readDemoManifest(seedRoot);
  if (!manifest) return false;
  fs.mkdirSync(userData, { recursive: true });
  const marker = path.join(userData, ".demo-initialized.json");
  if (fs.existsSync(marker)) return false;
  const db = path.join(userData, "smartlearn.db");
  // Existing learning data always wins; an update must never reset it.
  if (fs.existsSync(db)) return false;
  const env = path.join(userData, "backend.env");
  if (!fs.existsSync(env)) fs.copyFileSync(path.join(seedRoot, "backend.env"), env, fs.constants.COPYFILE_EXCL);
  const chroma = path.join(userData, "chroma-cs-2026-v1");
  if (!fs.existsSync(chroma)) await fs.promises.cp(path.join(seedRoot, "chroma"), chroma, { recursive: true, force: false });
  const sourceMedia = path.join(seedRoot, "media");
  const media = path.join(userData, "media", "output");
  if (fs.existsSync(sourceMedia)) {
    await fs.promises.cp(sourceMedia, media, { recursive: true, force: false });
    const relocate = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) relocate(file);
        else if (entry.name.endsWith(".json")) {
          const text = fs.readFileSync(file, "utf8");
          if (text.includes("__XUESHU_MEDIA_ROOT__")) fs.writeFileSync(file, text.replaceAll("__XUESHU_MEDIA_ROOT__", media.replaceAll("\\", "/")), "utf8");
        }
      }
    };
    relocate(media);
  }
  // Database is the final commit point, after the file resources have arrived.
  fs.copyFileSync(path.join(seedRoot, "smartlearn.db"), db, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(marker, JSON.stringify({ format: 1, login: manifest.login }), "utf8");
  return true;
}

module.exports = { readDemoManifest, ensureDemoSeed };
