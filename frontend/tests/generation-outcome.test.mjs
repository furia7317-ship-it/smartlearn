import test from "node:test";
import assert from "node:assert/strict";
import { generationOutcome } from "../lib/generation-outcome.ts";

test("failed and incomplete review never display completed", () => {
  assert.equal(generationOutcome({ status: "failed", error_code: "review_unavailable" }).failed, true);
  assert.match(generationOutcome({ status: "failed", error_code: "review_unavailable" }).message, /未发布/);
  assert.equal(generationOutcome({}).failed, true);
  assert.equal(generationOutcome({status: "completed", completed: true, ready_total: 2}).failed, false);
  assert.match(generationOutcome({status: "partial", ready_total: 1}).message, /部分完成/);
});
