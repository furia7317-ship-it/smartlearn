import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(frontendRoot, "..");
const python = path.join(frontendRoot, "runtime", "python", "python.exe");
const script = path.join(projectRoot, "backend", "scripts", "build_packaged_knowledge_seed.py");
const knowledgeDir = path.join(projectRoot, "knowledge");
const outputDir = path.join(frontendRoot, "runtime", "assets", "chroma_seed_cs2026_v1");
const embeddingModel = path.join(frontendRoot, "runtime", "assets", "models", "bge-small-zh-v1.5");

const result = spawnSync(
  python,
  [
    script,
    "--knowledge-dir",
    knowledgeDir,
    "--output-dir",
    outputDir,
    "--embedding-model",
    embeddingModel,
  ],
  {
    cwd: path.join(projectRoot, "backend"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || "Desktop knowledge seed preparation failed.\n");
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout);
