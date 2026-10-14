import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "runtime");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const ffmpegSource = process.argv.includes("--ffmpeg-root") && arg("--ffmpeg-root");
const jdkSource = process.argv.includes("--jdk-root") && arg("--jdk-root");
if (!ffmpegSource || !jdkSource) throw new Error("Supply --ffmpeg-root and --jdk-root for the private desktop build");
for (const file of [path.join(ffmpegSource, "bin/ffmpeg.exe"), path.join(ffmpegSource, "bin/ffprobe.exe"),
  path.join(jdkSource, "bin/javac.exe"), path.join(runtime, "toolchains/w64devkit/bin/gcc.exe")]) {
  if (!fs.existsSync(file)) throw new Error(`Required runtime missing: ${file}`);
}
fs.mkdirSync(path.join(runtime, "ffmpeg/bin"), { recursive: true });
for (const name of ["bin/ffmpeg.exe", "bin/ffprobe.exe", "LICENSE", "README.txt"]) {
  fs.copyFileSync(path.join(ffmpegSource, name), path.join(runtime, "ffmpeg", name));
}
fs.cpSync(jdkSource, path.join(runtime, "toolchains/jdk"), {
  recursive: true,
  filter: (source) => !["src.zip", "sample"].includes(path.basename(source)),
});
const require = createRequire(import.meta.url);
const { ensureBrowser } = require("../remotion-runtime/node_modules/@remotion/renderer");
const browser = await ensureBrowser({ chromeMode: "headless-shell", logLevel: "info" });
if (!browser.path) throw new Error("Remotion browser could not be prepared");
fs.cpSync(path.dirname(browser.path), path.join(runtime, "chromium"), { recursive: true });
console.log("FFmpeg, C/C++ and Java compilers, and Chromium are ready for packaging.");
