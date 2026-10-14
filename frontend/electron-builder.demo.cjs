// Explicit private distribution: never run for a public release.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const base = yaml.load(fs.readFileSync(path.join(__dirname, "electron-builder.yml"), "utf8"));
const seed = path.join(__dirname, "runtime/private-demo");
if (!fs.existsSync(path.join(seed, "manifest.json"))) throw new Error("Prepare the private demo seed first");

module.exports = {
  ...base,
  appId: "com.smartlearn.a3.demo",
  productName: "学枢演示版",
  directories: { ...base.directories, output: "dist-electron-demo" },
  extraResources: [
    ...base.extraResources.filter((entry) => entry.to !== "assets"),
    { from: "runtime/private-demo", to: "private-demo", filter: ["**/*", "!**/*-wal", "!**/*-shm"] },
    { from: "runtime/ffmpeg", to: "ffmpeg" },
    { from: "runtime/toolchains/w64devkit", to: "toolchains/w64devkit" },
    { from: "runtime/toolchains/jdk", to: "toolchains/jdk" },
    { from: "runtime/chromium", to: "chromium" },
  ],
  nsis: { ...base.nsis, artifactName: "学枢-演示安装版-${version}.exe", shortcutName: "学枢演示版" },
};
