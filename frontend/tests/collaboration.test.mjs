import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCollaboration, readCollaboration } from "../lib/collaboration.ts";

test("default effort does not grant network access", () => {
  const options = normalizeCollaboration(null);
  assert.equal(options.effort, "standard");
  assert.equal(options.sources.web, false);
  assert.equal(readCollaboration().effort, "standard");
});
test("manual source restrictions survive strong effort and invalid stored data", () => {
  assert.deepEqual(normalizeCollaboration({ effort: "rigorous", sources: { course: false, personal: false, web: false, document_ids: ["book", 12] } }).sources,
    { course: false, personal: false, web: false, document_ids: ["book"] });
  assert.equal(normalizeCollaboration({ effort: "unlimited", sources: { web: "true" } }).sources.web, false);
  assert.equal(normalizeCollaboration({ effort: "unlimited" }).effort, "standard");
});
