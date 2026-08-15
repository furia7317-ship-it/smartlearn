import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
const [propsPath, outputPath, browserExecutable = ""] = process.argv.slice(2);

if (!propsPath || !outputPath) {
  throw new Error("Usage: node render.mjs <props.json> <output.mp4> [browserExecutable]");
}

const inputProps = JSON.parse(await fs.readFile(path.resolve(propsPath), "utf8"));
const output = path.resolve(outputPath);
const bundleDir = path.join(path.dirname(output), "remotion-bundle");

await fs.mkdir(path.dirname(output), { recursive: true });
const serveUrl = await bundle({
  entryPoint: path.join(runtimeRoot, "src", "index.ts"),
  outDir: bundleDir,
  onProgress: (progress) => {
    process.stdout.write(`${JSON.stringify({ type: "bundle", progress: progress / 100 })}\n`);
  },
});

const shared = {
  serveUrl,
  id: "LessonVideo",
  inputProps,
  ...(browserExecutable ? { browserExecutable } : {}),
};

const composition = await selectComposition(shared);

await renderMedia({
  ...shared,
  composition,
  codec: "h264",
  outputLocation: output,
  concurrency: 1,
  disallowParallelEncoding: true,
  muted: true,
  imageFormat: "jpeg",
  jpegQuality: 82,
  x264Preset: "superfast",
  logLevel: "error",
  overwrite: true,
  onProgress: ({ progress, renderedFrames, encodedFrames }) => {
    process.stdout.write(`${JSON.stringify({
      type: "render",
      progress,
      renderedFrames,
      encodedFrames,
    })}\n`);
  },
});

process.stdout.write(`${JSON.stringify({ type: "done", output })}\n`);
