"""Bounded asynchronous task scheduler with independent generation/review queues.

Implements the existing graph stream boundary so all product entrances share it.
The scheduler thread alone merges state, journals versions and binds artifacts.
"""
from __future__ import annotations

import copy
import hashlib
import json
import queue
import threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

from app.core.run_control import cancellation_checkpoint, RunCancelled
from app.schemas.resource_plan import PlanArtifact
from app.services.artifact_versions import content_hash, review_matches
from app.services.orchestration_profiles import resolve_policy, PROFILE_VERSION

_worker_slots = threading.BoundedSemaphore(6)


def _failure(message, kind="dependency_blocked"):
    return {"approved": False, "score": 0, "issues": [message], "blocking_issues": [message],
            "gate_status": "rejected", "failure_kind": kind, "error_code": kind,
            "retryable": False, "terminal": True}


class OrchestrationRuntime:
    def stream(self, initial, config=None, stream_mode=None):
        from app.graph import planned_resource_graph as workers
        from app.services.orchestration_journal import record
        from app.services.planned_integration import integrate_approved_plan

        state = copy.deepcopy(initial)
        plan = PlanArtifact.model_validate(state["plan"])
        policy = resolve_policy(plan.collaboration.model_dump(), state["plan"]["tasks"])
        state["orchestration"] = policy
        # Explicit caller budgets may be smaller (tests/administrative caps), never silently enlarge them.
        state.setdefault("retry_policy", policy["retry_policy"])
        tasks = {x["task_id"]: x for x in state["plan"]["tasks"]}
        state.setdefault("reviews", {})
        state.setdefault("resources", [])
        from app.services.procedure_skill_runtime import pin_run_skills
        state["procedure_skills"] = pin_run_skills(state)
        state.setdefault("skill_review_history", {})
        # Only new candidates from this invocation count as method usage;
        # dependency-blocked tasks and reused approved resources do not.
        state["skill_generated_task_ids"] = []
        events = queue.Queue()
        terminal = set()
        active = {}
        ready_reviews = []
        pending = list(tasks)
        candidates = {r["task_id"]: r for r in state["resources"] if r.get("task_id")}
        for resource in candidates.values():
            resource.setdefault("artifact_version", int(resource.get("retry_count") or 0) + 1)
        for task_id in list(pending):
            if review_matches(candidates.get(task_id, {}), state["reviews"].get(task_id)):
                terminal.add(task_id)
                pending.remove(task_id)

        def emit(payload):
            events.put(("custom", payload))

        def journal(kind, task_id, payload):
            record(state, kind, task_id, payload)

        def scoped(task):
            snapshot = copy.deepcopy(state)
            snapshot["plan_task"] = task
            return snapshot

        def work(kind, snapshot):
            while not _worker_slots.acquire(timeout=0.1):
                cancellation_checkpoint(snapshot["trace_run_id"])
            token = workers.runtime_writer.set(lambda p: emit(p) if p.get("event") != "task_review" else None)
            try:
                if kind == "generate":
                    return workers.run_planned_task(snapshot)
                result = workers.review_tasks(snapshot, announce_batch=False)
                task = snapshot["plan_task"]
                task_id = task["task_id"]
                verdict = result["reviews"][task_id]
                if policy["independent_review"] and verdict.get("approved"):
                    from app.services.resource_grounding import verify_resource_semantics, apply_grounding_gate
                    from app.schemas.resource_plan import TaskReview
                    try:
                        workers._model_call_checkpoint(snapshot)
                        evidence = [x for x in snapshot["kb_context"] if x["id"] in task["source_ids"]]
                        # A fresh reviewer gets candidate/evidence only, without the first verdict.
                        second = verify_resource_semantics(snapshot["resources"][0], task, evidence)
                        combined = apply_grounding_gate(TaskReview.model_validate(verdict), snapshot["resources"][0], task, evidence,
                                                        semantic_verifier=lambda *_: second).model_dump(mode="json")
                        # Semantic review can rebuild a TaskReview from scratch.
                        # Keep orchestration counters tied to this candidate.
                        combined.update(retry_count=int(task.get("retry_count") or 0),
                                        review_attempt=int(verdict.get("review_attempt") or 1))
                        verdict.update(combined)
                        verdict["independent_review"] = second
                        if not verdict.get("approved"):
                            verdict.update(failure_kind="quality", retryable=True, service_recoverable=True, terminal=False)
                            verdict["terminal"] = not workers._review_can_retry(verdict, snapshot)
                    except Exception:
                        verdict.update(_failure("独立复核未完成，资料未放行", "reviewer"), gate_status="review_unavailable")
                        verdict.update(retryable=True, service_recoverable=True, terminal=False)
                        verdict["terminal"] = not workers._review_can_retry(verdict, snapshot)
                return {"reviews": {task_id: verdict}}
            finally:
                workers.runtime_writer.reset(token)
                _worker_slots.release()

        def assemble():
            integrated = integrate_approved_plan(plan, state["resources"], state["reviews"])
            state.update(schedule=integrated["schedule"], coverage=integrated["coverage"], integration=integrated)
            state["bindings"] = [
                {"task_id": t.task_id, "day": t.day, "position": i, "plan_version": plan.version,
                 "artifact_version": candidates[t.task_id]["artifact_version"], "content_hash": content_hash(candidates[t.task_id])}
                for i, t in enumerate(plan.tasks)
                if t.task_id in candidates and review_matches(candidates[t.task_id], state["reviews"].get(t.task_id))
            ]

        journal("plan", "", {"plan": state["plan"], "policy": policy, "evidence": state.get("kb_context", [])})
        emit({"event": "orchestration", **policy})
        if any(state["procedure_skills"].values()):
            emit({"event": "progress", "agent": "supervisor", "status": "completed",
                  "detail": "已选用适合本次任务的教学方法，生成结果仍逐项审核"})
        from app.core.agent_trace import trace_event
        emit(trace_event(run_id=state["trace_run_id"], agent="supervisor", kind="plan", phase="planning",
                         title="协作安排", status="completed", observation=policy["summary"],
                         decision_summary="按确认范围执行；资料生成后逐项审核，只有批准版本进入路径。", action_type="scheduling_policy"))
        emit({"event": "progress", "agent": "scheduler", "status": "started", "detail": policy["summary"]})
        gen_pool = ThreadPoolExecutor(max_workers=policy["generation_concurrency"], thread_name_prefix="resource-generate")
        review_pool = ThreadPoolExecutor(max_workers=policy["review_concurrency"], thread_name_prefix="resource-review")
        try:
            while True:
                while pending or ready_reviews or active:
                    cancellation_checkpoint(state["trace_run_id"])
                    # Review slots are separate: finishing generation immediately releases a generation slot.
                    while ready_reviews and sum(k == "review" for k, _ in active.values()) < policy["review_concurrency"]:
                        task_id = ready_reviews.pop(0)
                        snapshot = scoped(tasks[task_id])
                        snapshot["resources"] = [candidates[task_id]]
                        journal("attempt", task_id, {"phase": "review", "version": candidates[task_id]["artifact_version"],
                                                      "review_attempt": int((state["reviews"].get(task_id) or {}).get("review_attempt", 0)) + 1})
                        emit({"event": "progress", "agent": "reviewer", "status": "started", "detail": "正在核对资料事实、来源与任务要求"})
                        active[review_pool.submit(work, "review", snapshot)] = ("review", task_id)
                    generation_count = sum(k == "generate" for k, _ in active.values())
                    batch = set([t for t in pending if set(tasks[t].get("depends_on") or []) <= terminal][:policy["batch_size"]])
                    if policy["strategy"] == "batched" and active:
                        active_days = {tasks[t]["day"] for _, t in active.values()}
                        batch = {t for t in pending if tasks[t]["day"] in active_days}
                    for task_id in list(pending):
                        task = tasks[task_id]
                        deps = task.get("depends_on") or []
                        failed = [d for d in deps if d in terminal and not review_matches(candidates.get(d, {}), state["reviews"].get(d))]
                        if failed:
                            state["reviews"][task_id] = _failure("前置资料未获批准：" + "、".join(failed))
                            pending.remove(task_id)
                            terminal.add(task_id)
                            journal("review", task_id, state["reviews"][task_id])
                            emit({"event": "task_review", "task_id": task_id, **state["reviews"][task_id]})
                            continue
                        if not set(deps) <= terminal or generation_count >= policy["generation_concurrency"]:
                            continue
                        if policy["strategy"] == "batched" and task_id not in batch:
                            continue
                        # Backpressure bounds candidate memory without monopolising reviewer capacity.
                        if len(ready_reviews) >= policy["review_concurrency"] * 2:
                            break
                        pending.remove(task_id)
                        journal("attempt", task_id, {"phase": "generate", "version": int(task.get("retry_count") or 0) + 1})
                        active[gen_pool.submit(work, "generate", scoped(task))] = ("generate", task_id)
                        generation_count += 1
                    if not active and not ready_reviews and pending:
                        # Includes cycles and missing dependencies; never leave a task waiting forever.
                        for task_id in pending:
                            state["reviews"][task_id] = _failure("任务依赖无法满足，未启动生成")
                            journal("review", task_id, state["reviews"][task_id])
                            emit({"event": "task_review", "task_id": task_id, **state["reviews"][task_id]})
                        pending.clear()
                    completed, _ = wait(active, timeout=0.05, return_when=FIRST_COMPLETED) if active else (set(), set())
                    for future in completed:
                        kind, task_id = active.pop(future)
                        result = future.result()
                        if task_id in (result.get("reviews") or {}):
                            state["reviews"][task_id] = result["reviews"][task_id]
                        if kind == "generate" and result.get("resources"):
                            candidate = result["resources"][-1]
                            if task_id not in state["skill_generated_task_ids"]:
                                state["skill_generated_task_ids"].append(task_id)
                            candidate["procedure_skills"] = [
                                {key: skill[key] for key in ("skill_id", "version_id", "version", "name")}
                                for skill in state["procedure_skills"].get(task_id, [])
                            ]
                            candidate.update(artifact_version=int(candidate.get("retry_count") or 0) + 1, plan_version=plan.version)
                            candidate["content_hash"] = content_hash(candidate)
                            candidates[task_id] = candidate
                            state["resources"] = list(candidates.values())
                            journal("candidate", task_id, candidate)
                            ready_reviews.append(task_id)
                            continue
                        review = state["reviews"].get(task_id) or _failure("任务未返回审核结果", "execution_failed")
                        if kind == "review":
                            evidence = [x for x in state.get("kb_context", []) if x["id"] in tasks[task_id]["source_ids"]]
                            review.update(content_hash=content_hash(candidates[task_id]), artifact_version=candidates[task_id]["artifact_version"],
                                          plan_version=plan.version, review_policy_version=PROFILE_VERSION,
                                          evidence_version=hashlib.sha256(json.dumps(evidence, sort_keys=True, default=str).encode()).hexdigest())
                        state["reviews"][task_id] = review
                        if review.get("approved"):
                            from app.services.resource_coverage import audit_plan_coverage
                            coverage = audit_plan_coverage(plan, state["resources"], state["reviews"])
                            if task_id not in coverage["ready_task_ids"]:
                                review.update(approved=False, gate_status="rejected", failure_kind="quality", retryable=True,
                                              blocking_issues=["资料未完整覆盖已确认大纲"], issues=["资料未完整覆盖已确认大纲"])
                        journal("review", task_id, review)
                        from app.services.procedure_skill_runtime import review_observation
                        history = state["skill_review_history"].setdefault(task_id, [])
                        history.append(review_observation(review))
                        state["skill_review_history"][task_id] = history[-5:]
                        if review.get("approved"):
                            terminal.add(task_id)
                            assemble()
                            binding = next(x for x in state["bindings"] if x["task_id"] == task_id)
                            journal("binding", task_id, binding)
                            emit({"event": "artifact_bound", **binding})
                            emit({"event": "schedule", "schedule": state["schedule"], "coverage": state["coverage"], "draft": True})
                        elif workers._review_can_retry(review, state):
                            if review.get("failure_kind") == "reviewer" and task_id in candidates:
                                ready_reviews.append(task_id)
                            else:
                                tasks[task_id] = workers._retry_task_for_review(state, tasks[task_id], review)
                                token = workers.runtime_writer.set(emit)
                                try:
                                    workers._emit_rework_started(state, tasks[task_id])
                                finally:
                                    workers.runtime_writer.reset(token)
                                pending.append(task_id)
                        else:
                            review["terminal"] = True
                            terminal.add(task_id)
                        emit({"event": "task_review", "task_id": task_id, **review})
                    while not events.empty():
                        yield events.get_nowait()
                    if completed:
                        yield "values", copy.deepcopy(state)
                if not policy["cross_review"]:
                    break
                from app.services.plan_consistency import review_consistency
                state["consistency"] = review_consistency(state)
                journal("consistency", "", state["consistency"])
                blocking = state["consistency"].get("blocking", {})
                if not blocking:
                    break
                invalid = set(blocking)
                while True:
                    dependent = {t for t, task in tasks.items() if t not in invalid and set(task.get("depends_on") or []) & invalid}
                    if not dependent:
                        break
                    invalid.update(dependent)
                for task_id in tasks:
                    if task_id not in invalid:
                        continue
                    issues = blocking.get(task_id) or ["前置资料正在修复一致性问题，需基于新版本重新生成"]
                    kind = "consistency" if task_id in blocking else "dependency_blocked"
                    review = {**state["reviews"].get(task_id, {}), **_failure("；".join(issues), kind),
                              "retry_count": int(tasks[task_id].get("retry_count") or 0),
                              "retryable": True, "terminal": False, "service_recoverable": True,
                              "fixes": issues,
                              "repair_instructions": [{"issue": issue, "action": "修正此冲突：" + issue,
                                                       "location": "跨资料一致性", "target_field": "content",
                                                       "acceptance_check": "与用户要求和相关资料一致，并重新通过质量及一致性审核"}
                                                      for issue in issues]}
                    state["reviews"][task_id] = review
                    if workers._review_can_retry(review, state):
                        tasks[task_id] = workers._retry_task_for_review(state, tasks[task_id], review)
                        terminal.discard(task_id)
                        pending.append(task_id)
                        token = workers.runtime_writer.set(emit)
                        try:
                            workers._emit_rework_started(state, tasks[task_id])
                        finally:
                            workers.runtime_writer.reset(token)
                    else:
                        review["terminal"] = True
                    journal("review", task_id, review)
                    emit({"event": "task_review", "task_id": task_id, **review})
                # Revoke stale bindings before dispatching repaired versions.
                assemble()
                while not events.empty():
                    yield events.get_nowait()
                yield "values", copy.deepcopy(state)
                if not pending:
                    break
            assemble()
            ready = len(state["bindings"])
            complete = bool(state["coverage"].get("complete"))
            state["delivery_status"] = "completed" if complete else "partial" if ready else "failed"
            journal("delivery", "", {"status": state["delivery_status"], "bindings": state["bindings"], "coverage": state["coverage"]})
            # Auxiliary learning must never prevent delivery of approved work.
            from app.services.procedure_skill_runtime import finish_skill_run
            finish_skill_run(state)
            emit({"event": "schedule", "schedule": state["schedule"], "coverage": state["coverage"], "draft": False})
            while not events.empty():
                yield events.get_nowait()
            yield "values", copy.deepcopy(state)
            yield "custom", {"event": "done", "completed": complete, "status": state["delivery_status"],
                             "task_total": len(tasks), "ready_total": ready, "failed_total": len(tasks)-ready,
                             "error_code": None if complete else "resource_review_failed"}
        except RunCancelled:
            for task_id in tasks:
                if task_id not in terminal:
                    journal("cancelled", task_id, {"status": "cancelled", "plan_version": plan.version})
            journal("delivery", "", {"status": "cancelled"})
            raise
        finally:
            for future in active:
                future.cancel()
            gen_pool.shutdown(wait=True, cancel_futures=True)
            review_pool.shutdown(wait=True, cancel_futures=True)

    def invoke(self, state, config=None):
        final = state
        for mode, payload in self.stream(state, config=config):
            if mode == "values":
                final = payload
        return final
