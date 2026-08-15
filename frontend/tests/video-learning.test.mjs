import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWatchedVideoStep,
  mapVideoLearningPayloadToResources,
  toBilibiliEmbedUrl,
} from "../lib/video-learning.ts";

const video = {
  bvid: "BV1VAMXz6ETz",
  title: "动态规划入门",
  url: "https://www.bilibili.com/video/BV1VAMXz6ETz/",
  embed_url: "https://player.bilibili.com/player.html?bvid=BV1VAMXz6ETz&autoplay=0",
  author: "UP主",
  cover: "",
  duration: "10:00",
  summary: "用状态定义、状态转移和初始化讲解动态规划。",
  published_at: "2026-06-01",
};

test("toBilibiliEmbedUrl builds an Electron embeddable player url", () => {
  assert.equal(
    toBilibiliEmbedUrl("BV1VAMXz6ETz"),
    "https://player.bilibili.com/player.html?bvid=BV1VAMXz6ETz&autoplay=0"
  );
});

test("video analysis payload can be saved as summary and quiz resources", () => {
  const payload = {
    video,
    analysis: {
      summary: "状态定义、状态转移和初始化是动态规划复盘重点。",
      key_points: ["状态定义", "状态转移"],
      questions: [
        {
          id: "q1",
          type: "mcq",
          stem: "动态规划复盘最该关注什么？",
          options: ["A. 封面", "B. 状态定义和转移", "C. 弹幕", "D. 发布时间"],
          answer: "B",
          explanation: "状态定义和转移决定了动态规划解法。",
        },
      ],
    },
    summary_resource: {
      type: "reading",
      title: "动态规划入门｜视频学习总结",
      subtitle: "状态定义、状态转移和初始化是动态规划复盘重点。",
      meta: ["视频", "已观看 360 秒"],
      sources: 1,
      knowledge_points: "动态规划",
      data: { video, key_points: ["状态定义", "状态转移"] },
      source: "video",
    },
    quiz_resource: {
      type: "quiz",
      title: "动态规划入门｜视频复盘题",
      subtitle: "基于后端分析生成",
      meta: ["1 题", "视频"],
      sources: 1,
      knowledge_points: "动态规划",
      data: {
        video,
        questions: [
          {
            id: "q1",
            type: "mcq",
            stem: "动态规划复盘最该关注什么？",
            options: ["A. 封面", "B. 状态定义和转移", "C. 弹幕", "D. 发布时间"],
            answer: "B",
          },
        ],
      },
      source: "video",
    },
    path_attachment: {
      type: "video",
      title: video.title,
      url: video.url,
      bvid: video.bvid,
      embed_url: video.embed_url,
      summary: "状态定义、状态转移和初始化是动态规划复盘重点。",
      watched_seconds: 360,
    },
  };

  const resources = mapVideoLearningPayloadToResources(payload);

  assert.equal(resources.length, 2);
  assert.deepEqual(
    resources.map((item) => [item.type, item.status, item.sources]),
    [
      ["reading", "ready", 1],
      ["quiz", "ready", 1],
    ]
  );
  assert.match(resources[0].title, /视频学习总结/);
  assert.equal(resources[0].data?.video?.bvid, "BV1VAMXz6ETz");
  assert.equal(resources[1].data?.questions?.length, 1);
});

test("watched Bilibili video becomes a learning path step attachment", () => {
  const step = buildWatchedVideoStep(video, 360);

  assert.equal(step.day, "B站");
  assert.equal(step.title, "动态规划入门");
  assert.deepEqual(step.types, ["video"]);
  assert.equal(step.links?.[0].bvid, "BV1VAMXz6ETz");
  assert.equal(step.links?.[0].watched_seconds, 360);
});
