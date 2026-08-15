import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GALGAME_BACKDROP_ASSETS,
  GALGAME_COMPANION_POSE_ASSETS,
  readGalgameProgress,
  readGalgameProjects,
  resourceDataToTheaterText,
  saveGalgameProgress,
  saveGalgameProject,
  selectGalgameBackdrop,
  selectGalgameCompanionPose,
} from "../lib/galgame.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const project = {
  id: "theater-1",
  title: "图论资料剧场",
  source_title: "图论讲义",
  source_kind: "approved-resource",
  resource_id: "resource-1",
  companion_name: "知夏",
  language: "zh-CN",
  learning_objectives: ["理解图"],
  key_takeaways: ["图由顶点与边组成"],
  sources: [{ id: "source-1", title: "图论讲义", excerpt: "图由顶点与边组成。", locator: "第 1 页" }],
  scenes: [{
    id: "scene-1",
    title: "认识图",
    speaker: "知夏",
    expression: "smile",
    text: "先看图的定义。",
    blackboard_title: "定义",
    blackboard_points: ["顶点", "边"],
    source_ids: ["source-1"],
    choices: [],
    duration_seconds: 12,
  }],
  video_script: {},
  generation_provider: "test",
  created_at: "2026-07-31T10:00:00.000Z",
};

test("approved resources become bounded theater evidence without executable payloads", () => {
  const text = resourceDataToTheaterText({
    id: "resource-1",
    type: "explainer",
    title: "图论讲义",
    subtitle: "基础概念",
    meta: ["数据结构", "图论"],
    status: "ready",
    version: 1,
    sources: 2,
    data: {
      overview: "图由顶点和边组成。",
      key_points: ["有向图与无向图", "度的定义"],
      html: "<script>doNotCopy()</script>",
      css: ".bad { display: none }",
    },
  });

  assert.match(text, /资料标题：图论讲义/);
  assert.match(text, /图由顶点和边组成/);
  assert.match(text, /有向图与无向图/);
  assert.doesNotMatch(text, /doNotCopy|display: none/);
  assert.ok(text.length <= 18_000);
});

test("projects and branching progress persist per learner", () => {
  const storage = memoryStorage();
  saveGalgameProject(storage, "student-1", project);
  saveGalgameProgress(storage, "student-1", {
    projectId: project.id,
    sceneId: "scene-1",
    visitedSceneIds: ["scene-1"],
    choiceHistory: [{ sceneId: "scene-1", choiceId: "choice-1", label: "我理解了" }],
    videoTaskId: "video-1",
    updatedAt: "2026-07-31T10:01:00.000Z",
  });

  assert.equal(readGalgameProjects(storage, "student-1")[0].title, "图论资料剧场");
  assert.equal(readGalgameProjects(storage, "student-2").length, 0);
  assert.deepEqual(readGalgameProgress(storage, "student-1", project.id)?.visitedSceneIds, ["scene-1"]);
  assert.equal(readGalgameProgress(storage, "student-1", project.id)?.videoTaskId, "video-1");
});

test("theater scenes select varied deterministic companion poses", () => {
  const scene = project.scenes[0];
  assert.equal(selectGalgameCompanionPose(scene, 0, 6), "greeting");
  assert.equal(selectGalgameCompanionPose({ ...scene, id: "scene-2" }, 1, 6), "explaining");
  assert.equal(selectGalgameCompanionPose({ ...scene, id: "scene-3" }, 2, 6), "pointing");
  assert.equal(selectGalgameCompanionPose({ ...scene, id: "scene-4", expression: "thinking" }, 3, 6), "thinking");
  assert.equal(selectGalgameCompanionPose({ ...scene, id: "scene-5", expression: "thinking" }, 4, 6), "reading");
  assert.equal(selectGalgameCompanionPose({ ...scene, id: "scene-6" }, 5, 6), "encourage");
  assert.match(GALGAME_COMPANION_POSE_ASSETS.greeting, /greeting\.png$/);
  assert.match(GALGAME_COMPANION_POSE_ASSETS.encourage, /encourage\.png$/);
});

test("continue moves through varied semantic theater backdrops", () => {
  const scene = project.scenes[0];
  assert.equal(selectGalgameBackdrop(scene, 0, 5), "courtyard");
  assert.equal(selectGalgameBackdrop({ ...scene, id: "scene-2" }, 1, 5), "lecture");
  assert.equal(selectGalgameBackdrop({ ...scene, id: "scene-3" }, 2, 5), "library");
  assert.equal(selectGalgameBackdrop({ ...scene, id: "scene-4", expression: "thinking" }, 3, 5), "study");
  assert.equal(selectGalgameBackdrop({ ...scene, id: "scene-5" }, 4, 5), "corridor");
  assert.match(GALGAME_BACKDROP_ASSETS.courtyard, /courtyard\.png$/);
  assert.match(GALGAME_BACKDROP_ASSETS.corridor, /corridor\.png$/);
});

test("interactive teaching library can collapse without retaining removed helper copy", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("../components/desktop/desktop-galgame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/desktop/desktop-galgame.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /libraryCollapsed/);
  assert.match(component, /收起互动教学片库/);
  assert.doesNotMatch(component, /从已审核资料或你的文档生成可选择、可回放的互动课堂/);
  assert.match(styles, /\.libraryCollapsed\s*\{/);
});
