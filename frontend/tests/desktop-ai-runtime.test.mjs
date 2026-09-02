import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop AI page is a real three-column workspace with working controls", async () => {
  const [desktop, chat, teachers] = await Promise.all([
    read("../components/desktop/desktop-studio.tsx"),
    read("../components/chat.tsx"),
    read("../lib/teacher-persona.ts"),
  ]);

  assert.match(desktop, /aria-label="会话栏"/);
  assert.match(desktop, /aria-label="AI 对话主区"/);
  assert.match(desktop, /aria-label="协同检查器"/);
  assert.match(desktop, /setTeacherChooserOpen\(true\)/);
  assert.match(desktop, /o\.newConversation\(teacher\)/);
  assert.doesNotMatch(desktop, /shouldStartFreshConversationOnStudioEntry/);
  assert.doesNotMatch(desktop, /entryConversationCheckedRef/);
  assert.match(teachers, /鳄鱼老师/);
  assert.match(teachers, /浣熊老师/);
  assert.match(desktop, /onStop=\{o\.stop\}/);
  assert.match(desktop, /onRetry=\{o\.retryLast\}/);
  assert.match(desktop, /o\.openConversation\(conversation\.id\)/);
  assert.match(desktop, /o\.deleteConversation\(conversation\.id\)/);
  assert.match(desktop, /conversation\.running/);
  assert.match(desktop, /"处理中"/);
  assert.match(desktop, /资料问答记录/);
  assert.match(desktop, /conversation\.kind === conversationGroup/);
  assert.doesNotMatch(desktop, /aria-label=\{`删除会话：\$\{conversation\.title\}`\}/);
  assert.match(desktop, /aria-expanded=\{sessionMenuId === conversation\.id\}/);
  assert.match(desktop, /o\.renameConversation\(conversation\.id, renameDraft\)/);
  assert.match(desktop, /aria-label="收起会话栏"/);
  assert.match(desktop, /AgentRunInspector run=\{o\.activeAgentRun\}/);
  assert.doesNotMatch(desktop, /真实后端已连接/);
  assert.match(desktop, /启动 backend/);
  assert.doesNotMatch(desktop, /href=["']#["']/);
  assert.doesNotMatch(desktop, /在线\s*14/);

  assert.match(chat, /停止当前运行/);
  assert.match(chat, /重试上一问/);
  assert.match(
    chat,
    /disabled=\{mode !== "live" \|\| uploadingFiles\.length > 0 \|\| \(!input\.trim\(\) && attachments\.length === 0\)\}/,
  );
  assert.doesNotMatch(chat, /<Textarea[\s\S]{0,500}disabled=\{running\}/);
  assert.match(chat, /showInlineTrace && \(m\.runId \|\| messageTrace\.length > 0 \|\| m\.reasoning\)/);
  assert.match(chat, /处理中/);
  assert.match(chat, /已处理/);
  assert.doesNotMatch(chat, /正在查看处理过程/);
  assert.match(chat, /aria-expanded=\{open\}/);
  assert.match(desktop, /o\.focusMessageRun\(messageId\)/);
  assert.doesNotMatch(desktop, /o\.focusMessageRun\(messageId\);\s*setPanel\("orchestration"\)/);
  const newMessageIndex = chat.indexOf("有新消息 · 回到底部");
  const gateIndex = chat.lastIndexOf("{baselineGate?.request && (");
  const composerIndex = chat.indexOf('data-testid="chat-composer"');
  assert.ok(
    newMessageIndex > 0 && newMessageIndex < gateIndex && gateIndex < composerIndex,
    "the new-message affordance stays inside the viewport and the non-modal requirement card sits above the composer",
  );
});

test("orchestrator isolates runtime state and performs real stop and resource deletion", async () => {
  const orchestrator = await read("../hooks/use-orchestrator.ts");

  assert.match(orchestrator, /setAgentRunStore\(createAgentRunStore\(\)\)/);
  assert.match(orchestrator, /messageRunBindingsRef\.current\.clear\(\)/);
  assert.match(orchestrator, /trace: undefined/);
  assert.doesNotMatch(orchestrator, /runId: undefined/);
  assert.match(orchestrator, /fetchAgentRunEvents\(runId/);
  assert.match(orchestrator, /const focusMessageRun = useCallback/);
  assert.match(orchestrator, /const newConversation = useCallback/);
  assert.match(orchestrator, /const clearConversationSurface = useCallback/);
  assert.doesNotMatch(orchestrator, /foregroundRunning/);
  assert.match(orchestrator, /conversationSwitchLocked: false/);
  assert.match(orchestrator, /tutorRunsRef = useRef\(new Map<string, TutorRunControl>\(\)\)/);
  assert.match(orchestrator, /tutorRunsRef\.current\.set\(ownerConversationId, control\)/);
  assert.match(orchestrator, /tutorRunsRef\.current\.get\(ownerConversationId\) === control/);
  assert.match(orchestrator, /planConversationRef\.current\.get\(planId\) === ownerConversationId/);
  assert.match(orchestrator, /focusedRunByConversation\[activeConversationId\]/);
  assert.match(orchestrator, /agentRunStore\.runs\[activeConversationRunId\]/);
  assert.match(orchestrator, /running: conversationRunning/);
  assert.match(orchestrator, /Boolean\(runningConversationIds\[session\.id\]\)/);
  assert.match(orchestrator, /setConversationHistory\(\(history\) => history\.map/);
  assert.match(orchestrator, /teacher_persona: ownerTeacher/);
  assert.doesNotMatch(orchestrator, /连续 60 秒没有收到后端事件/);
  assert.doesNotMatch(orchestrator, /inactivityTimer|armInactivityTimeout/);
  assert.match(orchestrator, /processingStartedAt/);
  assert.match(orchestrator, /const requestLearningPath = useCallback/);
  assert.match(orchestrator, /const openConversation = useCallback/);
  assert.match(orchestrator, /const deleteConversation = useCallback/);
  assert.match(orchestrator, /const askResourceQuestion = useCallback/);
  assert.match(orchestrator, /activeConversationKind === "resource_qa"/);
  assert.match(orchestrator, /splitLegacyResourceConversation\(restoredMessages\)/);
  assert.match(orchestrator, /getConversationState\(\)/);
  assert.match(orchestrator, /saveConversationState\(localState\)/);
  assert.match(orchestrator, /conversationSyncReady/);
  assert.match(orchestrator, /history\.filter\(\(session\) => session\.id !== conversationId\)/);
  assert.match(orchestrator, /const stop = useCallback/);
  assert.match(orchestrator, /cancelResourcePlan\(plan\)/);
  assert.match(orchestrator, /tutorControl\.controller\.abort\(\)/);
  assert.match(orchestrator, /pendingLearningPaths\[activeConversationId\]/);
  assert.match(orchestrator, /learningPathRequestRef = useRef\(new Set<string>\(\)\)/);
  assert.match(orchestrator, /const retryLast = useCallback/);
  assert.match(orchestrator, /const removeResource = useCallback/);
  assert.match(orchestrator, /deletePaper\(mode, persisted\.exam_id\)/);
  assert.match(orchestrator, /deleteMaterial\(mode, id\)/);
  assert.doesNotMatch(orchestrator, /appendTraceStep/);
  assert.doesNotMatch(orchestrator, /for \(const phaseEntry/);
  assert.doesNotMatch(orchestrator, /while \(learningPathRequestRef\.current\)/);
});

test("learning-path form and resource selection reuse the live teacher pipeline", async () => {
  const [path, viewer, orchestrator] = await Promise.all([
    read("../components/desktop/desktop-path.tsx"),
    read("../components/resource-viewer.tsx"),
    read("../hooks/use-orchestrator.ts"),
  ]);

  assert.match(path, /function LearningPathRequestDialog/);
  assert.match(path, /aria-label="生成或重塑学习路径"/);
  assert.match(path, /onSubmit=\{requestLearningPath\}/);
  assert.match(path, /<LearningBaselineGate/);
  assert.match(path, /正在后台生成新的学习路径/);
  assert.match(path, /pendingLearningPath\.stage === "confirming" \|\| Boolean\(pendingLearningPath\.error\)/);
  assert.match(orchestrator, /planning_mode: confirmation \? "learning_path" : "resource"/);
  assert.doesNotMatch(orchestrator, /shouldStartFreshConversationOnStudioEntry/);
  assert.match(orchestrator, /const localState = normalizeState\(currentLocalState\)/);
  assert.match(viewer, /window\.getSelection\(\)/);
  assert.match(viewer, /解释选中内容/);
  assert.match(viewer, /就此询问/);
  assert.match(viewer, /openTutorAnswer\(request, question\?\.trim\(\) \|\| "解释选中内容", selectedContext\)/);
  assert.match(viewer, /useTeacherWindow/);
  assert.match(viewer, /openTeacher\(\{/);
  assert.match(viewer, /module: "resource"/);
  assert.doesNotMatch(viewer, /aria-label="资料问答"/);
  assert.doesNotMatch(viewer, /tutorMessages\.map/);
  assert.doesNotMatch(viewer, /startTutorResize/);
  assert.doesNotMatch(viewer, /router\.push\(shellHref\(base, "\/studio"\)\)/);
  assert.match(viewer, /\}, \[taskKey, viewedItemId\]\);/);
  assert.doesNotMatch(viewer, /setTutorOpen\(false\);[\s\S]{0,300}\}, \[goBack, taskKey, viewedItem\]\);/);
});
