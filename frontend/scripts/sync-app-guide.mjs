// backend/app/catalogs/app_guide.json is the maintained source. Keep a bundled
// frontend copy so static/Electron navigation also works without a backend.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const source = new URL("../../backend/app/catalogs/app_guide.json", import.meta.url);
const target = new URL("../lib/app-guide.json", import.meta.url);
if (existsSync(source)) {
  const content = readFileSync(source, "utf8");
  if (!existsSync(target) || readFileSync(target, "utf8") !== content) writeFileSync(target, content);
}
