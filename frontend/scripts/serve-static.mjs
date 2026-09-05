import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
const port = Number(process.env.PORT || 3000);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };

await stat(path.join(root, "index.html")).catch(() => { throw new Error("Static output is missing. Run npm run build first."); });
http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    if ((await stat(target)).isDirectory()) target = path.join(target, "index.html");
    const data = await readFile(target);
    response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch { response.writeHead(404).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`Static preview: http://127.0.0.1:${port}/desktop/`));
