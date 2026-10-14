import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTrainingEvidence, applyTrainingProfile } from "../lib/training-evidence.ts";
import { buildKnowledgeMastery } from "../lib/knowledge-mastery.ts";
import { buildProfileInsights } from "../lib/profile-insights.ts";

const attempt = { id: "submission-1", taskId: "task-1", title: "循环队列", course: "数据结构", knowledgePoints: ["队列", "数组"], score: 50, passedTests: 2, totalTests: 4, createdAt: "2026-09-07T08:00:00Z", stage: "线性结构" };
const later = { ...attempt, id: "submission-2", score: 100, passedTests: 4, createdAt: "2026-09-07T09:00:00Z" };
const now = new Date("2026-09-07T10:00:00Z");

test("only scored checks with valid test counts enter training evidence", () => {
  assert.deepEqual(normalizeTrainingEvidence([attempt, attempt, { ...later, totalTests: 0 }, { ...later, score: NaN }]), [attempt]);
});
test("training scores update associated knowledge points with history and respect time filters", () => {
  const graph = buildKnowledgeMastery({ paths: [], assessments: [], papers: [], training: [later, attempt, later], now: now.getTime() });
  assert.deepEqual(graph.nodes.map(n => [n.label, n.score, n.evidenceCount]), [["队列", 100, 2], ["数组", 100, 2]]);
  assert.equal(graph.nodes[0].source, "实训中心");
  assert.equal(graph.nodes[0].history.length, 2);
  const other = buildKnowledgeMastery({ paths: [], assessments: [], papers: [], training: [attempt], rangeDays: 1, now: now.getTime() + 3 * 86400000 });
  assert.equal(other.overall, null);
});
test("profile uses the latest check for each task without compounding on reload or inventing interests", () => {
  const base = [{ key: "knowledge_level", value: 60, delta: 0 }, { key: "interests", value: 80, delta: 0 }];
  const first = applyTrainingProfile(base, [attempt, later]);
  assert.equal(first[0].value, 74);
  assert.equal(first[1], base[1]);
  assert.deepEqual(applyTrainingProfile(base, [later, attempt, later]), first);
  assert.equal(base[0].value, 60);
});
test("training contributes to profile records, activity and completed exercises", () => {
  const result = buildProfileInsights({ now, profile: [], practiceAttempts: [], taskEvidence: {}, completedMaterials: [], watchedVideos: [], subjectPaths: [], assessments: [], papers: [], training: [attempt, later, later] });
  assert.equal(result.summary.completedQuestions, 2);
  assert.equal(result.summary.accuracy, 75);
  assert.equal(result.summary.activityLevels.at(-1), 2);
  assert.equal(result.evidence[0].label, "实训");
  assert.match(result.evidence[0].knowledge, /队列、数组/);
  assert.match(result.evidence[0].href, /training\/records/);
});
