import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import seed from "../electron/demo-seed.cjs";

test("demo initializes a fresh profile and never replaces learning data or edited keys", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xueshu-demo-test-"));
  try {
    const source = path.join(root, "seed"), user = path.join(root, "user");
    fs.mkdirSync(path.join(source, "chroma"), { recursive: true });
    fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ format: 1, product_name: "学枢演示版", student_id: "demo", login: "furia" }));
    fs.writeFileSync(path.join(source, "smartlearn.db"), "one account");
    fs.writeFileSync(path.join(source, "backend.env"), "demo setting");
    fs.writeFileSync(path.join(source, "chroma/index"), "demo vectors");
    fs.mkdirSync(path.join(source, "media/video_tasks/demo"), { recursive: true });
    fs.writeFileSync(path.join(source, "media/video_tasks/demo/progress.json"), '{"file_path":"__XUESHU_MEDIA_ROOT__/demo.mp4"}');
    assert.equal(await seed.ensureDemoSeed(source, user), true);
    assert.equal(fs.readFileSync(path.join(user, "smartlearn.db"), "utf8"), "one account");
    assert.equal(fs.readFileSync(path.join(user, "chroma-cs-2026-v1/index"), "utf8"), "demo vectors");
    assert.equal(JSON.parse(fs.readFileSync(path.join(user, "media/output/video_tasks/demo/progress.json"), "utf8")).file_path, path.join(user,"media/output/demo.mp4").replaceAll("\\", "/"));
    fs.writeFileSync(path.join(user, "smartlearn.db"), "new learning");
    fs.writeFileSync(path.join(user, "backend.env"), "edited setting");
    assert.equal(await seed.ensureDemoSeed(source, user), false);
    assert.equal(fs.readFileSync(path.join(user, "smartlearn.db"), "utf8"), "new learning");
    // Even without the marker, an existing DB must not be reset by an upgrade.
    fs.unlinkSync(path.join(user, ".demo-initialized.json"));
    assert.equal(await seed.ensureDemoSeed(source, user), false);
    assert.equal(fs.readFileSync(path.join(user, "backend.env"), "utf8"), "edited setting");
    assert.equal(await seed.ensureDemoSeed(path.join(root, "no-seed"), user), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
