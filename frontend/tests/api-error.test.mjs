import assert from "node:assert/strict";
import test from "node:test";

import { ApiRequestError, requestErrorMessage, requireOk } from "../lib/api-error.ts";
import {
  finalizeGeneratedResources,
  visibleGenerationResources,
} from "../lib/resource-generation-state.ts";

const resource = (status) => ({
  id: `resource-${status}`,
  type: "explainer",
  title: "讲义",
  subtitle: "",
  meta: [],
  status,
  version: 1,
  sources: 0,
});

test("requireOk returns successful responses unchanged", async () => {
  const response = new Response("ok", { status: 200 });
  assert.equal(await requireOk(response), response);
});

test("network failures are shown as a recoverable local-service interruption", () => {
  const message = requestErrorMessage(new TypeError("Failed to fetch"), "fallback");

  assert.match(message, /本地生成服务/);
  assert.match(message, /已完成内容会保留/);
  assert.doesNotMatch(message, /Failed to fetch/);
});

test("requireOk throws a typed error with backend JSON detail", async () => {
  const response = new Response(JSON.stringify({ detail: "资料不存在" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

  await assert.rejects(
    requireOk(response),
    (error) =>
      error instanceof ApiRequestError &&
      error.status === 404 &&
      error.detail === "资料不存在"
  );
});

test("requireOk preserves a bounded plain-text server failure", async () => {
  await assert.rejects(
    requireOk(new Response("server failed", { status: 500 })),
    (error) =>
      error instanceof ApiRequestError &&
      error.status === 500 &&
      error.detail === "server failed"
  );
});

test("requireOk exposes structured plan validation errors", async () => {
  const response = new Response(
    JSON.stringify({ detail: { valid: false, errors: ["D1 缺少资料大纲"], warnings: [] } }),
    { status: 422, headers: { "content-type": "application/json" } }
  );

  await assert.rejects(
    requireOk(response),
    (error) =>
      error instanceof ApiRequestError &&
      error.status === 422 &&
      error.detail.includes("D1 缺少资料大纲")
  );
});

test("requireOk explains FastAPI request validation arrays instead of only HTTP 422", async () => {
  const response = new Response(
    JSON.stringify({
      detail: [
        {
          type: "too_long",
          loc: ["body", "learning_path_preferences", "material_types"],
          msg: "List should have at most 5 items after validation, not 6",
          ctx: { max_length: 5, actual_length: 6 },
        },
      ],
    }),
    { status: 422, headers: { "content-type": "application/json" } },
  );

  await assert.rejects(
    requireOk(response),
    (error) =>
      error instanceof ApiRequestError &&
      error.status === 422 &&
      error.detail === "资料类型最多可选 5 项，当前为 6 项",
  );
});

test("generation finalization never promotes pending candidates", () => {
  const pending = resource("pending");
  const ready = resource("ready");

  assert.deepEqual(
    finalizeGeneratedResources([pending, ready], true).map((item) => item.status),
    ["failed", "ready"]
  );
  assert.deepEqual(
    finalizeGeneratedResources([pending, ready], false).map((item) => item.status),
    ["failed", "ready"]
  );
  assert.equal(
    finalizeGeneratedResources([pending], false)[0].subtitle,
    "未收到审核批准版本，资料没有保存"
  );
});

test("failed and rejected candidates never become user-selectable generation cards", () => {
  assert.deepEqual(
    visibleGenerationResources([
      resource("pending"),
      resource("review"),
      resource("rejected"),
      resource("failed"),
      resource("ready"),
    ]).map((item) => item.status),
    ["pending", "review", "ready"],
  );
});
