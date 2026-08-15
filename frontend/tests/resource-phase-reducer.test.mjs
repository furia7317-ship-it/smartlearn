import assert from "node:assert/strict";
import test from "node:test";

import {
  createResourcePhaseState,
  reduceResourceExecutionEvent,
} from "../lib/resource-phase-reducer.ts";


test("ten tasks remain six top-level phases", () => {
  let state = createResourcePhaseState();
  state = reduceResourceExecutionEvent(state, {
    event: "plan_ready",
    task_total: 10,
    auto_execute: false,
  });
  for (let i = 1; i <= 10; i += 1) {
    state = reduceResourceExecutionEvent(state, {
      event: "task_progress",
      task_id: `task-${i}`,
      status: "completed",
      title: `资料 ${i}`,
    });
  }

  assert.equal(state.phases.length, 6);
  assert.equal(state.phases.find((phase) => phase.id === "generation").progress, 100);
  assert.equal(Object.keys(state.tasks).length, 10);
});


test("phase updates replace the stable phase instead of appending", () => {
  let state = createResourcePhaseState();
  state = reduceResourceExecutionEvent(state, {
    event: "phase",
    phase: "review",
    status: "running",
  });
  state = reduceResourceExecutionEvent(state, {
    event: "phase",
    phase: "review",
    status: "completed",
  });

  assert.equal(state.phases.filter((phase) => phase.id === "review").length, 1);
  assert.equal(state.phases.find((phase) => phase.id === "review").status, "completed");
});


test("task reviews stay folded under the review phase", () => {
  let state = createResourcePhaseState();
  state = reduceResourceExecutionEvent(state, {
    event: "plan_ready",
    task_total: 2,
    auto_execute: true,
  });
  state = reduceResourceExecutionEvent(state, {
    event: "task_review",
    task_id: "a",
    approved: true,
    score: 0.9,
    retry_count: 0,
  });
  state = reduceResourceExecutionEvent(state, {
    event: "task_review",
    task_id: "b",
    approved: false,
    score: 0.5,
    retry_count: 1,
  });

  assert.equal(state.phases.length, 6);
  assert.equal(state.phases.find((phase) => phase.id === "review").progress, 100);
  assert.equal(state.tasks.b.status, "failed");
  assert.deepEqual(state.tasks.b.issues, []);
});


test("a retryable review keeps the task in rework instead of terminal failure", () => {
  let state = reduceResourceExecutionEvent(createResourcePhaseState(), {
    event: "plan_ready",
    task_total: 1,
    auto_execute: true,
  });
  state = reduceResourceExecutionEvent(state, {
    event: "task_progress",
    task_id: "retrying-task",
    status: "rework",
    retry_count: 1,
  });
  state = reduceResourceExecutionEvent(state, {
    event: "task_review",
    task_id: "retrying-task",
    approved: false,
    terminal: false,
    retry_count: 1,
    issues: ["timeout at provider call"],
  });

  assert.equal(state.tasks["retrying-task"].status, "rework");
  assert.equal(state.phases.find((phase) => phase.id === "generation").status, "running");
  assert.equal(state.phases.find((phase) => phase.id === "review").status, "running");
});
