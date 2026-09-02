import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagingRoot = path.join(frontendRoot, ".electron-app");
const temporaryRoot = path.join(frontendRoot, `.electron-app-${process.pid}.tmp`);

function assertInsideFrontend(candidate) {
  const relative = path.relative(frontendRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to prepare an unsafe Electron staging path: ${candidate}`);
  }
}

function requirePath(candidate, description) {
  if (!fs.existsSync(candidate)) {
    throw new Error(`${description} is missing: ${candidate}`);
  }
}

assertInsideFrontend(stagingRoot);
assertInsideFrontend(temporaryRoot);

const packageSource = path.join(frontendRoot, "package.json");
const electronSource = path.join(frontendRoot, "electron");
const exportSource = path.join(frontendRoot, "out");
requirePath(packageSource, "Frontend package metadata");
requirePath(electronSource, "Electron main-process sources");
requirePath(path.join(exportSource, "index.html"), "Next.js static export");

const rootPackage = JSON.parse(fs.readFileSync(packageSource, "utf8"));
const appPackage = {
  name: `${rootPackage.name}-desktop`,
  version: rootPackage.version,
  private: true,
  description: rootPackage.description,
  author: rootPackage.author,
  main: "electron/main.js",
};

// Build the staging tree completely before replacing the previous one, so a
// failed copy cannot leave electron-builder with a half-written application.
fs.rmSync(temporaryRoot, { recursive: true, force: true });
fs.mkdirSync(temporaryRoot, { recursive: true });

try {
  fs.cpSync(electronSource, path.join(temporaryRoot, "electron"), { recursive: true });
  fs.cpSync(exportSource, path.join(temporaryRoot, "out"), { recursive: true });
  fs.writeFileSync(
    path.join(temporaryRoot, "package.json"),
    `${JSON.stringify(appPackage, null, 2)}\n`,
    "utf8",
  );

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.renameSync(temporaryRoot, stagingRoot);
} catch (error) {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  throw error;
}

console.log(`Minimal Electron app ready: ${stagingRoot}`);
