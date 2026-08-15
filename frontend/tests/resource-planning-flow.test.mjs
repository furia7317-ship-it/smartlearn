import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createInitialMaterialTypeSelection,
  FORM_MATERIAL_TYPES,
  materialTypesForRequest,
  MATERIAL_TYPE_LABEL,
  toggleMaterialTypeSelection,
} from "../lib/material-types.ts";
import { normalizePathSteps } from "../lib/path-normalize.ts";
import * as sessionInsights from "../lib/session-insights.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("orchestrator creates an editable plan instead of a clarification loop", async () => {
  const source = await read("../hooks/use-orchestrator.ts");

  assert.match(source, /createPlanForRequest/);
  assert.doesNotMatch(source, /pendingResourceTopicRef/);
  assert.doesNotMatch(source, /event === "clarify"/);
});

test("learning path requests route into the resource pipeline", async () => {
  const [source, intent] = await Promise.all([
    read("../hooks/use-orchestrator.ts"),
    read("../lib/agent-action.ts"),
  ]);

  assert.match(intent, /"学习路径"/);
  assert.match(intent, /"学习计划"/);
  assert.match(source, /const generate = wantsResource\(question\);/);
  assert.match(source, /if \(generate\) void createPlanForRequest\(question\);/);
});

test("orchestrator consumes task review, integration trace, and schedule events", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const types = await read("../lib/types.ts");
  const pathPanel = await read("../components/path-panel.tsx");

  assert.match(source, /event === "task_review"/);
  assert.match(source, /event === "trace"/);
  assert.match(source, /event === "schedule"/);
  assert.match(source, /setPath\(/);
  assert.match(types, /steps\?:\s*PathTask\[\]/);
  assert.match(types, /minutes\?:\s*number/);
  assert.match(pathPanel, /buildDailyTaskPlan/);
  assert.match(pathPanel, /今天/);
});

test("a candidate released after one rework uses normal published copy", async () => {
  const source = await read("../hooks/use-orchestrator.ts");

  assert.doesNotMatch(source, /返工上限|带告警放行|自动放行/);
  assert.match(source, /subtitle:\s*approved\s*\?\s*"质量审核通过"/);
  assert.match(source, /detail:\s*approved\s*\?\s*"质量审核通过"/);
});

test("studio creates a plan before executing resource agents", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  assert.match(source, /createResourcePlan/);
  assert.match(source, /streamResourcePlanExecution/);
  assert.match(source, /"plan_review"/);
  assert.match(source, /auto_execute/);
  assert.doesNotMatch(source, /streamSSE\(\s*"\/api\/agents\/resource"/);
});

test("complex plans pause and simple plans auto execute", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  assert.match(source, /awaiting_confirmation/);
  assert.match(source, /plan\.complexity\.auto_execute/);
  assert.match(source, /confirmResourcePlan/);
});

test("planning state is durable and both studio surfaces share plan actions", async () => {
  const [source, desktop, web] = await Promise.all([
    read("../hooks/use-orchestrator.ts"),
    read("../components/desktop/desktop-studio.tsx"),
    read("../app/studio/page.tsx"),
  ]);
  assert.match(source, /plans:\s*Record<string, ResourcePlanRecord>/);
  assert.match(source, /resourceExecution/);
  assert.match(source, /getResourcePlan/);
  assert.match(source, /recoverResourcePlanRecord/);
  assert.match(source, /runningPlanIds/);
  assert.doesNotMatch(source, /record\.plan\.status === "running" \|\| record\.plan\.status === "approved"/);
  for (const surface of [desktop, web]) {
    assert.match(surface, /plans=\{o\.plans\}/);
    assert.match(surface, /onConfirmPlan=\{o\.confirmResourcePlan\}/);
    assert.match(surface, /onReplanPlan=\{o\.replanPlan\}/);
  }
});

test("confirmed learning paths leave the questionnaire and use explicit bounded retry", async () => {
  const [source, desktop, web] = await Promise.all([
    read("../hooks/use-orchestrator.ts"),
    read("../components/desktop/desktop-studio.tsx"),
    read("../app/studio/page.tsx"),
  ]);

  assert.doesNotMatch(source, /while \(learningPathRequestRef\.current\)/);
  assert.match(source, /traceMessageId/);
  assert.match(source, /const result = await createPlanForRequest/);
  assert.match(source, /学习路径规划暂未完成/);
  assert.match(source, /patchMessage\(traceMessageId, \{ streaming: false \}\)/);
  assert.doesNotMatch(source, /patchMessage\(traceMessageId, \{ content: "", streaming: false \}\)/);
  assert.match(source, /const retryLearningPath = useCallback/);
  assert.match(source, /const executePlanWithRecovery = useCallback/);
  assert.match(source, /仅重试未通过资料（自动恢复/);
  assert.match(source, /recoveryAttempt <= 1/);
  assert.match(source, /if \(!completed\)/);
  assert.match(source, /pendingLearningPath\.error/);
  assert.match(source, /planId:\s*record\.plan\.plan_id/);
  assert.match(source, /if \(pendingLearningPath\.planId\)/);
  assert.match(source, /const record = await getResourcePlan\(planId\)/);
  assert.match(source, /!pendingPlanIds\.has\(record\.plan\.plan_id\)/);
  assert.match(source, /Boolean\(message\.runId \|\| message\.planId\)/);
  assert.doesNotMatch(source, /appendTraceStep/);
  for (const surface of [desktop, web]) {
    assert.match(surface, /pendingLearningPath\?\.stage === "planning"/);
  }
});

test("execution records the final server snapshot before coordination and notification", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const executeStart = source.indexOf("const executePlan = useCallback");
  const executeEnd = source.indexOf("const savePlan = useCallback", executeStart);
  const executeSource = source.slice(executeStart, executeEnd);
  const streamIndex = executeSource.indexOf("await streamResourcePlanExecution");
  const completionIndex = executeSource.indexOf("await completeActiveResourcePlanRun(", streamIndex);
  const readIndex = executeSource.indexOf("read: () => getResourcePlan(plan.plan_id)", completionIndex);
  const snapshotIndex = executeSource.indexOf("recordSnapshot:", readIndex);
  const plansIndex = executeSource.indexOf("setPlans(", snapshotIndex);
  const applyIndex = executeSource.indexOf("applyFinalized:", plansIndex);
  const resourcesIndex = executeSource.indexOf("setResources(finalized.resources)", applyIndex);
  const pathIndex = executeSource.indexOf("setPath(finalized.path)", applyIndex);
  const executionIndex = executeSource.indexOf(
    "setResourceExecution(finalized.execution)",
    applyIndex,
  );
  const notificationIndex = executeSource.indexOf("notify:", applyIndex);

  assert.match(source, /completeActiveResourcePlanRun/);
  assert.ok(completionIndex > streamIndex, "completion helper should run after streaming");
  assert.ok(readIndex > completionIndex, "completion helper should read the final server record");
  assert.ok(snapshotIndex > readIndex, "the refreshed record should be snapshotted after reading");
  assert.ok(plansIndex > snapshotIndex, "the refreshed record should update plans immediately");
  assert.ok(applyIndex > plansIndex, "coordination should be declared after snapshot recording");
  for (const [label, coordinationIndex] of [
    ["resources", resourcesIndex],
    ["path", pathIndex],
    ["execution", executionIndex],
  ]) {
    assert.ok(
      coordinationIndex > applyIndex,
      `${label} state should consume the pure finalized snapshot`,
    );
    assert.ok(
      notificationIndex > coordinationIndex,
      `${label} state should be coordinated before the completion notification`,
    );
  }
  assert.doesNotMatch(
    executeSource,
    /setResources\(\(previous\)\s*=>\s*\{[\s\S]{0,400}set(?:Path|ResourceExecution)\(/,
  );
});

test("concurrent plan executions use per-plan liveness and active-run UI state", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const executeStart = source.indexOf("const executePlan = useCallback");
  const executeEnd = source.indexOf("const savePlan = useCallback", executeStart);
  const executeSource = source.slice(executeStart, executeEnd);

  assert.doesNotMatch(executeSource, /tokenRef|alive\(/);
  assert.match(
    executeSource,
    /isPlanRunActive\(abortRef\.current, plan\.plan_id, ctrl\)/,
  );
  assert.ok(
    (executeSource.match(/syncRunningState\(\)/g) ?? []).length >= 2,
    "running should be derived from all conversation-owned runs when a plan starts and finishes",
  );
  assert.match(
    executeSource,
    /activePlanRunsRef\.current\.values\(\)\.next\(\)\.value \?\? ""/,
    "finishing one plan should expose another still-active plan id",
  );
});

test("plan execution scopes placeholders by plan id and streams only its final result", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const executeStart = source.indexOf("const executePlan = useCallback");
  const executeEnd = source.indexOf("const savePlan = useCallback", executeStart);
  const executeSource = source.slice(executeStart, executeEnd);

  assert.match(source, /import \{ planResourceId \}/);
  assert.match(executeSource, /id:\s*planResourceId\(plan\.plan_id, task\.task_id\)/);
  assert.ok(
    (executeSource.match(/planResourceId\(plan\.plan_id, taskId\)/g) ?? []).length >= 2,
    "task progress and review events should each scope their resource id",
  );
  assert.match(executeSource, /event === "result_start"/);
  assert.match(executeSource, /event === "result_delta"/);
  assert.match(executeSource, /event === "result"/);
  assert.doesNotMatch(executeSource, /event === "content_delta"/);
  assert.doesNotMatch(executeSource, /generated\.overview|generated\.explanation/);
  assert.match(executeSource, /scheduleToPath\(schedule, plan\.plan_id\)/);
});

test("completed plans reconcile stale failures in both open and archived conversations", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const completion = await read("../lib/resource-plan-completion.ts");

  assert.match(completion, /reconcilePlanFailureConversations/);
  assert.ok(
    (source.match(/reconcilePlanFailureConversations\(history, acceptedRecords\)/g) ?? []).length >= 2,
    "hydration and running-plan polling should repair inactive conversation snapshots",
  );
  assert.match(source, /normalizeStoredMessages\(target\.messages\)[\s\S]{0,160}Object\.values\(plansRef\.current\)/);
});

test("approved plans resume sequentially instead of starting competing executions", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const hydrationStart = source.indexOf("const known = Object.values(plansRef.current)");
  const hydrationEnd = source.indexOf("const runningPlanIds", hydrationStart);
  const hydrationSource = source.slice(hydrationStart, hydrationEnd);

  assert.match(source, /runPlansSequentially/);
  assert.match(hydrationSource, /await runPlansSequentially\(/);
  assert.doesNotMatch(hydrationSource, /void executePlan\(record\.plan/);
});

test("hydration refreshes cancelled plans so their legacy resources reach terminal state", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const hydrationStart = source.indexOf("const known = Object.values(plansRef.current)");
  const hydrationEnd = source.indexOf("const runningPlanIds", hydrationStart);
  const hydrationSource = source.slice(hydrationStart, hydrationEnd);

  assert.match(hydrationSource, /const known = Object\.values\(plansRef\.current\)/);
  assert.doesNotMatch(hydrationSource, /status !== "cancelled"/);
});

test("plan cancellation keeps SSE open for the real terminal and reconciles state", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const cancelStart = source.indexOf("const cancelPlan = useCallback");
  const cancelEnd = source.indexOf("const confirmResourcePlan", cancelStart);
  const cancelSource = source.slice(cancelStart, cancelEnd);
  const requestIndex = cancelSource.indexOf("await cancelResourcePlan(plan)");
  const recoveryIndex = cancelSource.indexOf(
    "recoverAcceptedResourcePlanSnapshot(",
    requestIndex,
  );
  const resourcesIndex = cancelSource.indexOf("setResources(recovered.resources)", recoveryIndex);
  const executionIndex = cancelSource.indexOf(
    "setResourceExecution(recovered.execution)",
    recoveryIndex,
  );

  assert.match(source, /const abortRef = useRef\(new Map<string, AbortController>\(\)\)/);
  assert.doesNotMatch(
    cancelSource,
    /abortRef\.current\.get\(plan\.plan_id\)\?\.abort\(\)/,
    "a successful cancellation keeps SSE open for the backend cancelled trace",
  );
  assert.ok(recoveryIndex > requestIndex, "a successful cancellation should recover its record");
  assert.ok(resourcesIndex > recoveryIndex, "cancelled resources should be applied immediately");
  assert.ok(executionIndex > recoveryIndex, "cancelled execution phases should be applied immediately");
  assert.ok(
    (source.match(/for \(const controller of abortRef\.current\.values\(\)\)/g) ?? []).length >= 2,
    "clear and reset should abort every active plan controller",
  );
});

test("all persisted plan snapshots use monotonic acceptance before recovery", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const executeStart = source.indexOf("const executePlan = useCallback");
  const executeEnd = source.indexOf("const savePlan = useCallback", executeStart);
  const executeSource = source.slice(executeStart, executeEnd);
  const hydrationStart = source.indexOf("const known = Object.values(plansRef.current)");
  const hydrationEnd = source.indexOf("const runningPlanIds", hydrationStart);
  const hydrationSource = source.slice(hydrationStart, hydrationEnd);
  const pollingStart = source.indexOf("const refreshRunningPlans = async");
  const pollingEnd = source.indexOf("void refreshRunningPlans", pollingStart);
  const pollingSource = source.slice(pollingStart, pollingEnd);
  const cancelStart = source.indexOf("const cancelPlan = useCallback");
  const cancelEnd = source.indexOf("const confirmResourcePlan", cancelStart);
  const cancelSource = source.slice(cancelStart, cancelEnd);

  assert.match(source, /acceptResourcePlanSnapshot/);
  assert.match(executeSource, /recordSnapshot:[\s\S]*acceptResourcePlanSnapshot/);
  assert.match(
    executeSource,
    /recoveryContext:[\s\S]{0,400}resourcePlanTaskOwnerCounts/,
  );
  assert.match(hydrationSource, /resourcePlanTaskOwnerCounts\(records\)/);
  assert.match(hydrationSource, /recoverAcceptedResourcePlanSnapshot/);
  assert.match(pollingSource, /resourcePlanTaskOwnerCounts\(/);
  assert.match(pollingSource, /recoverAcceptedResourcePlanSnapshot/);
  assert.match(cancelSource, /resourcePlanTaskOwnerCounts\(/);
  assert.match(cancelSource, /recoverAcceptedResourcePlanSnapshot/);
  assert.match(cancelSource, /\{ taskOwnerCounts \}/);
});

test("failed retry acceptance is scoped to active execution and initial hydration", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const executeStart = source.indexOf("const executePlan = useCallback");
  const executeEnd = source.indexOf("const savePlan = useCallback", executeStart);
  const executeSource = source.slice(executeStart, executeEnd);
  const hydrationStart = source.indexOf("const known = Object.values(plansRef.current)");
  const hydrationEnd = source.indexOf("const runningPlanIds", hydrationStart);
  const hydrationSource = source.slice(hydrationStart, hydrationEnd);
  const pollingStart = source.indexOf("const refreshRunningPlans = async");
  const pollingEnd = source.indexOf("void refreshRunningPlans", pollingStart);
  const pollingSource = source.slice(pollingStart, pollingEnd);

  assert.match(
    executeSource,
    /allowFailedRetry\s*=\s*current\?\.plan\.status\s*===\s*"failed"\s*&&\s*planAlive\(\)/,
  );
  assert.match(
    executeSource,
    /acceptResourcePlanSnapshot\([\s\S]{0,300}\{ allowFailedRetry \}/,
  );
  assert.match(
    hydrationSource,
    /recoverAcceptedResourcePlanSnapshot\([\s\S]{0,300}\{ allowFailedRetry: true \}/,
  );
  assert.doesNotMatch(pollingSource, /allowFailedRetry/);
});

test("replanning persists the new lifecycle through the shared snapshot store", async () => {
  const source = await read("../hooks/use-orchestrator.ts");
  const storeStart = source.indexOf("const storeAcceptedPlanSnapshot");
  const storeEnd = source.indexOf("/* 在线模式", storeStart);
  const storeSource = source.slice(storeStart, storeEnd);
  const replanStart = source.indexOf("const replanPlan = useCallback");
  const replanEnd = source.indexOf("const cancelPlan = useCallback", replanStart);
  const replanSource = source.slice(replanStart, replanEnd);

  assert.match(storeSource, /acceptResourcePlanSnapshot\(plansRef\.current\[planId\], incoming\)/);
  const responseIndex = replanSource.indexOf("await replanResourcePlan(plan, feedback)");
  const storeIndex = replanSource.indexOf("storeAcceptedPlanSnapshot(record)");
  assert.ok(responseIndex >= 0);
  assert.ok(storeIndex > responseIndex);
  assert.match(replanSource, /if \(!storeAcceptedPlanSnapshot\(record\)\) return/);
  assert.match(replanSource, /resourcePlanTaskOwnerCounts\(/);
  assert.match(
    replanSource,
    /recoverResourcePlanRecord\(record, resourcesRef\.current, \{ taskOwnerCounts \}\)/,
  );
  assert.match(replanSource, /resourcesRef\.current = recovered\.resources/);
  assert.match(replanSource, /setResources\(recovered\.resources\)/);
  assert.match(replanSource, /setResourceExecution\(recovered\.execution\)/);
  assert.doesNotMatch(replanSource, /reduceResourceExecutionEvent\(createResourcePhaseState\(\)/);
});

test("path panel focuses one selectable day instead of noisy summary copy", async () => {
  const pathPanel = await read("../components/path-panel.tsx");

  assert.doesNotMatch(pathPanel, /随评估动态调整/);
  assert.doesNotMatch(pathPanel, /compact-\$\{step\.day\}/);
  assert.match(pathPanel, /useState/);
  assert.match(pathPanel, /selected/);
  assert.match(pathPanel, /setSelected/);
  assert.match(pathPanel, /buildDailyTaskPlan/);
  assert.match(pathPanel, /aria-label=\{`查看 \$\{step\.day\} 学习内容`\}/);
});

test("desktop studio renders real dependency health and recovery instead of fake online state", async () => {
  const desktopStudio = await read("../components/desktop/desktop-studio.tsx");
  const desktopShell = await read("../components/layout/desktop-shell.tsx");
  const studioPage = await read("../app/studio/page.tsx");

  assert.match(desktopStudio, /getMaterialData\(o\.mode/);
  assert.doesNotMatch(desktopStudio, /真实后端已连接/);
  assert.match(desktopShell, /checkBackend\(\)/);
  assert.match(desktopShell, /SERVICE_POLL_INTERVAL_MS/);
  assert.match(desktopShell, /"online"/);
  assert.match(desktopShell, /"focus"/);
  assert.match(desktopShell, /"服务异常"/);
  assert.doesNotMatch(desktopStudio, /在线 14/);
  assert.doesNotMatch(studioPage, /后端已连接/);
  assert.doesNotMatch(studioPage, /后端未连接/);
});

test("resource center can clear persisted and current-session resources", async () => {
  const library = await read("../lib/library.ts");
  const orchestrator = await read("../hooks/use-orchestrator.ts");
  const desktopResources = await read("../components/desktop/desktop-resources.tsx");

  assert.match(library, /export async function clearMaterials/);
  assert.match(library, /method:\s*"DELETE"/);
  assert.match(orchestrator, /const clearResources = useCallback/);
  assert.match(orchestrator, /setResources\(\[\]\)/);
  assert.match(desktopResources, /clearMaterials\(session\.mode\)/);
  assert.match(desktopResources, /session\.clearResources\(\)/);
  assert.match(desktopResources, /data-testid="clear-resource-center"/);
});

test("learning path resource actions use the shared exact resolver on both surfaces", async () => {
  const pathPanel = await read("../components/path-panel.tsx");
  const desktopStudio = await read("../components/desktop/desktop-studio.tsx");
  const desktopPath = await read("../components/desktop/desktop-path.tsx");

  for (const surface of [pathPanel, desktopPath]) {
    assert.match(surface, /resourceTargets\.map/);
    assert.match(surface, /resolveResourceForTaskTarget\(target, task, resources\)/);
    assert.doesNotMatch(
      surface,
      /findResourceForTarget\(target,\s*resources\)\s*\?\?\s*taskFallbackResource/,
    );
    assert.match(surface, /missingExactTarget/);
    assert.match(surface, /资料审核完成后自动出现/);
    assert.doesNotMatch(surface, /href=\{action\.href\}/);
  }
  assert.match(pathPanel, /onOpenResource/);
  assert.match(desktopStudio, /ResourceViewer/);
  assert.match(desktopStudio, /resources=\{o\.resources\}/);
  assert.match(desktopStudio, /onOpenResource=\{\(item, taskKey\) => setOpenResource\(\{ item, taskKey \}\)\}/);
  assert.match(desktopStudio, /taskKey=\{openResource\?\.taskKey\}/);
  assert.match(desktopPath, /ResourceViewer/);
});

test("unavailable schedule targets stay non-clickable until an approved resource exists", async () => {
  const [recovery, pathPanel, desktopPath] = await Promise.all([
    read("../lib/resource-plan-recovery.ts"),
    read("../components/path-panel.tsx"),
    read("../components/desktop/desktop-path.tsx"),
  ]);

  assert.match(recovery, /step\.id/);
  assert.match(recovery, /planResourceId\(planId, stepId\)/);
  for (const surface of [pathPanel, desktopPath]) {
    assert.match(surface, /resolveResourceForTaskTarget\(target, task, resources\)/);
    assert.match(surface, /missingExactTarget/);
    assert.match(surface, /资料审核完成后自动出现/);
    assert.doesNotMatch(surface, /href=\{action\.href\}/);
  }
});

test("web studio wires path resources and opens the original item in ResourceViewer", async () => {
  const webStudio = await read("../app/studio/page.tsx");

  assert.match(webStudio, /import \{ ResourceViewer \}/);
  assert.match(webStudio, /item: ResourceItem;[\s\S]{0,80}taskKey\?: string;/);
  assert.match(
    webStudio,
    /<PathPanel[\s\S]{0,300}path=\{o\.masterPath\}[\s\S]{0,300}scheduleAnchor=\{o\.masterPathScheduleAnchor\}[\s\S]{0,300}completed=\{o\.completedMaterials\}[\s\S]{0,300}resources=\{o\.resources\}[\s\S]{0,400}onRecordEvidence=[\s\S]{0,400}onOpenResource=\{\(item, taskKey\) => setOpenResource\(\{ item, taskKey \}\)\}/,
  );
  assert.match(webStudio, /WebConversationSidebar/);
  assert.match(webStudio, /item=\{openResource\?\.item \?\? null\}/);
  assert.match(webStudio, /taskKey=\{openResource\?\.taskKey\}/);
});

test("resource center renders one de-duplicated collection that opens original items in ResourceViewer", async () => {
  const desktopResources = await read("../components/desktop/desktop-resources.tsx");
  const pathResourceLinks = await read("../lib/path-resource-links.ts");

  assert.match(pathResourceLinks, /buildPathResourceCollection/);
  assert.match(pathResourceLinks, /buildDailyTaskResources/);
  assert.match(desktopResources, /buildPathResourceCollection/);
  assert.equal(
    (desktopResources.match(/data-testid="learning-path-collection"/g) ?? []).length,
    1,
  );
  assert.match(desktopResources, /pathCollectionOpen/);
  assert.match(desktopResources, /pathResourceIds/);
  assert.match(desktopResources, /stage\.resources\.map\(\(\{ item \}\)/);
  assert.match(desktopResources, /onClick=\{\(\) => selectResource\(item\)\}/);
  assert.match(desktopResources, /<ResourceViewer item=\{openItem\}/);
  assert.doesNotMatch(desktopResources, /pathCollections\.map/);
});

test("collection resources stay in the unified manageable list", async () => {
  const desktopResources = await read("../components/desktop/desktop-resources.tsx");

  assert.equal(typeof sessionInsights.getResourceCenterDisplayState, "function");
  assert.deepEqual(
    sessionInsights.getResourceCenterDisplayState({
      totalResourceCount: 1,
      standaloneResourceCount: 0,
      hasPathCollection: true,
      filtersActive: false,
    }),
    {
      hasAnyResources: true,
      hasStandaloneResources: false,
      showStandaloneContent: false,
    },
  );
  assert.equal(
    sessionInsights.getResourceCenterDisplayState({
      totalResourceCount: 1,
      standaloneResourceCount: 0,
      hasPathCollection: true,
      filtersActive: true,
    }).showStandaloneContent,
    true,
  );
  assert.match(desktopResources, /for \(const resource of \[\.\.\.library, \.\.\.session\.resources\]\)/);
  assert.match(desktopResources, /applyResourceFilters\(combined/);
  assert.match(desktopResources, /pathResourceIds\.has\(resource\.id\)/);
  assert.match(desktopResources, /session\.removeResource\(resource\.id\)/);
  assert.doesNotMatch(desktopResources, /standaloneResources/);
});

test("both resource centers consume the published-only filter and incomplete plans expose a real continuation action", async () => {
  const webResources = await read("../app/resources/page.tsx");
  const desktopResources = await read("../components/desktop/desktop-resources.tsx");
  const planCard = await read("../components/resource-plan-card.tsx");

  assert.match(webResources, /applyResourceFilters\(combined/);
  assert.match(desktopResources, /applyResourceFilters\(combined/);
  assert.match(webResources, /item.status !== "ready"/);
  assert.match(desktopResources, /resource\.status !== "ready"/);
  assert.match(planCard, /继续完成剩余/);
  assert.doesNotMatch(planCard, /disabled=\{[^}]*plan\.status === "failed"/);
  assert.match(planCard, /plan.status === "failed"/);
});

test("resource generation form exposes extension reading and hides only mindmap", async () => {
  const desktopCreate = await read("../components/desktop/desktop-create.tsx");
  const webCreate = await read("../app/create/page.tsx");

  assert.deepEqual(
    FORM_MATERIAL_TYPES.map((item) => item.id),
    ["explainer", "quiz", "solution", "reading", "code", "video", "courseware", "interactive"]
  );
  assert.equal(MATERIAL_TYPE_LABEL.mindmap, "思维导图");
  assert.equal(MATERIAL_TYPE_LABEL.interactive, "交互演示");
  assert.equal(MATERIAL_TYPE_LABEL.reading, "扩展阅读");
  assert.equal(MATERIAL_TYPE_LABEL.solution, "题目解析");
  assert.match(desktopCreate, /FORM_MATERIAL_TYPES/);
  assert.match(webCreate, /FORM_MATERIAL_TYPES/);
});

test("resource generation sends exactly the material type selected by the user", async () => {
  const [controller, desktopCreate, webCreate] = await Promise.all([
    read("../hooks/use-material-generator.ts"),
    read("../components/desktop/desktop-create.tsx"),
    read("../app/create/page.tsx"),
  ]);
  const initial = createInitialMaterialTypeSelection();

  assert.deepEqual(materialTypesForRequest(initial), []);

  const explainerOnly = toggleMaterialTypeSelection(initial, "explainer");
  assert.deepEqual(materialTypesForRequest(explainerOnly), ["explainer"]);

  const explainerAndQuiz = toggleMaterialTypeSelection(explainerOnly, "quiz");
  assert.deepEqual(materialTypesForRequest(explainerAndQuiz), ["explainer", "quiz"]);

  const quizOnly = toggleMaterialTypeSelection(explainerAndQuiz, "explainer");
  assert.deepEqual(materialTypesForRequest(quizOnly), ["quiz"]);

  assert.match(controller, /useState<Set<ResourceType>>\(\s*createInitialMaterialTypeSelection/);
  assert.match(controller, /const types = materialTypesForRequest\(selected\)/);
  assert.match(controller, /material_types: types/);
  for (const surface of [desktopCreate, webCreate]) {
    assert.match(surface, /aria-pressed=\{active\}/);
  }
});

test("resource generation survives route changes and exposes streamed trace and output", async () => {
  const [layout, shellSwitch, controller, shell, desktopCreate] = await Promise.all([
    read("../app/layout.tsx"),
    read("../components/layout/shell-switch.tsx"),
    read("../hooks/use-material-generator.ts"),
    read("../components/layout/desktop-shell.tsx"),
    read("../components/desktop/desktop-create.tsx"),
  ]);

  assert.match(`${layout}\n${shellSwitch}`, /MaterialGeneratorProvider/);
  assert.match(controller, /event === "trace"/);
  assert.match(controller, /event === "content_delta"/);
  assert.match(controller, /normalizeAgentRunEvent/);
  assert.match(shell, /materialGenerator\.running/);
  assert.match(desktopCreate, /AgentRunInspector/);
  assert.match(desktopCreate, /已过审内容流/);
});

test("diagnostic page does not render backend status badge", async () => {
  const diagnosticPage = await read("../app/diagnostic/page.tsx");

  assert.doesNotMatch(diagnosticPage, /在线后端/);
});

test("persisted path titles are normalized when old prompts polluted the schedule", () => {
  const normalized = normalizePathSteps([
    {
      day: "D1",
      title: "一份数据结构的学习路径来告诉我怎么学习 不要多余的东西基础",
      desc: "完成「一份数据结构的学习路径来告诉我怎么学习 不要多余的东西基础定位」的理解、练习和输出",
      types: ["explainer", "mindmap"],
      state: "current",
      minutes: 90,
      steps: [
        {
          title: "学习：一份数据结构的学习路径来告诉我怎么学习 不要多余的东西基础定位",
          detail: "阅读讲义/导图，先建立概念框架。",
          minutes: 30,
          resource_types: ["explainer"],
        },
      ],
    },
  ]);

  assert.equal(normalized[0].title, "数据结构基础定位");
  assert.equal(normalized[0].desc, "完成「数据结构基础定位」的理解、练习和输出");
  assert.equal(normalized[0].steps?.[0]?.title, "学习：数据结构基础定位");

  const repaired = normalizePathSteps([
    {
      day: "D1",
      title: "数据结构",
      desc: "完成「数据结构础定位」的理解、练习和输出",
      types: ["explainer", "mindmap"],
      state: "current",
      minutes: 90,
      steps: [
        {
          title: "学习：数据结构基础定位",
          detail: "阅读讲义/导图，先建立概念框架。",
          minutes: 30,
          resource_types: ["explainer"],
        },
      ],
    },
  ]);

  assert.equal(repaired[0].title, "数据结构基础定位");
  assert.equal(repaired[0].desc, "完成「数据结构基础定位」的理解、练习和输出");
});

test("specific generated day titles are not replaced by words before 讲义", () => {
  const normalized = normalizePathSteps([
    {
      day: "D1",
      title: "理解栈的后进先出原则",
      desc: "通过讲义和练习题，理解并掌握栈为什么后进先出",
      objective: "理解后进先出",
      types: ["explainer", "quiz"],
      state: "current",
      minutes: 30,
      steps: [
        { title: "栈为什么后进先出", detail: "阅读讲义", minutes: 15, resource_types: ["explainer"] },
      ],
    },
  ]);

  assert.equal(normalized[0].title, "理解栈的后进先出原则");
});

test("legacy one-word day titles recover from the first concrete task", () => {
  const normalized = normalizePathSteps([
    {
      day: "D1",
      title: "通过",
      desc: "通过讲义和练习题，理解并掌握栈为什么后进先出",
      types: ["explainer", "quiz"],
      state: "current",
      minutes: 30,
      steps: [
        { title: "栈为什么后进先出", detail: "阅读讲义", minutes: 15, resource_types: ["explainer"] },
      ],
    },
  ]);

  assert.equal(normalized[0].title, "栈为什么后进先出");
});

test("lecture viewer recovers structured content and renders video only after user action", async () => {
  const viewer = await read("../components/resource-viewer.tsx");

  assert.match(viewer, /function normalizedResourceData/);
  assert.match(viewer, /embedded_code_examples/);
  assert.match(viewer, /embedded_readings/);
  assert.match(viewer, /正在渲染 MP4/);
  assert.match(viewer, /await watchVideoTask\(existingTaskId\)/);
  assert.match(viewer, /pausedTaskId \? resumeVideo\(pausedTaskId\) : renderVideo\(\)/);
  assert.match(viewer, /MP4 任务已暂停，不会占用 CPU/);
  assert.match(viewer, /terminalStatus === null/);
  assert.doesNotMatch(viewer, /正在准备 MP4/);
  assert.doesNotMatch(viewer, />渲染 MP4</);
});
