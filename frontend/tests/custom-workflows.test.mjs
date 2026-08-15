import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_WORKFLOW_STORAGE_KEY,
  DEFAULT_WORKFLOW,
  createStarterWorkflow,
  loadCustomWorkflows,
  persistCustomWorkflow,
} from "../lib/custom-workflows.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("missing or invalid local data falls back to the starter example", () => {
  assert.equal(loadCustomWorkflows(memoryStorage()).length, 1);
  assert.equal(loadCustomWorkflows(memoryStorage())[0].id, DEFAULT_WORKFLOW.id);

  const invalid = memoryStorage({ [CUSTOM_WORKFLOW_STORAGE_KEY]: "{broken" });
  assert.equal(loadCustomWorkflows(invalid)[0].name, "学习资料生成器");
});
test("publishing a workflow updates the existing record instead of duplicating it", () => {
  const storage = memoryStorage();
  const first = persistCustomWorkflow(
    { ...DEFAULT_WORKFLOW, name: "第一次发布", status: "published" },
    storage,
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].name, "第一次发布");

  const second = persistCustomWorkflow(
    { ...DEFAULT_WORKFLOW, name: "更新后的名字", status: "published" },
    storage,
  );
  assert.equal(second.length, 1);
  assert.equal(loadCustomWorkflows(storage)[0].name, "更新后的名字");
});

test("a new blank workflow has unique start and end nodes and no invented edge", () => {
  const workflow = createStarterWorkflow();
  assert.equal(workflow.status, "draft");
  assert.equal(workflow.nodes.length, 2);
  assert.deepEqual(
    workflow.nodes.map((node) => node.kind),
    ["start", "end"],
  );
  assert.equal(workflow.edges.length, 0);
  assert.notEqual(workflow.id, DEFAULT_WORKFLOW.id);
});
