import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(root, "public", "voice-assets");
const vadDist = join(root, "node_modules", "@ricky0123", "vad-web", "dist");
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");

await mkdir(destination, { recursive: true });
await Promise.all([
  [join(vadDist, "silero_vad_v5.onnx"), join(destination, "silero_vad_v5.onnx")],
  [join(vadDist, "vad.worklet.bundle.min.js"), join(destination, "vad.worklet.bundle.min.js")],
  [join(ortDist, "ort-wasm-simd-threaded.mjs"), join(destination, "ort-wasm-simd-threaded.mjs")],
  [join(ortDist, "ort-wasm-simd-threaded.wasm"), join(destination, "ort-wasm-simd-threaded.wasm")],
].map(([source, target]) => copyFile(source, target)));

console.log("Silero VAD browser assets are ready.");
