import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSubjectLearningPaths } from "../lib/master-learning-path.ts";
import { createMarketPathRecord } from "../lib/learning-market.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const snapshot = {
  title: "数据结构冲刺",
  requestSummary: "七天复习数据结构",
  dailyMinutes: 45,
  path: [
    {
      day: "D1",
      title: "链表",
      desc: "掌握链表",
      objective: "理解指针关系",
      minutes: 45,
      types: ["reading"],
      state: "current",
      steps: [
        {
          title: "阅读链表讲义",
          detail: "理解头指针",
          minutes: 30,
          resource_types: ["reading"],
        },
      ],
    },
  ],
};

test("market paths with the same title retain separate listing identities", () => {
  const first = createMarketPathRecord("listing-a", "小林", snapshot);
  const second = createMarketPathRecord("listing-b", "小林", snapshot);
  const subjects = buildSubjectLearningPaths({
    plans: {
      [first.plan.plan_id]: first,
      [second.plan.plan_id]: second,
    },
    fallbackPath: [],
    controls: {},
  });

  assert.equal(subjects.length, 2);
  assert.deepEqual(new Set(subjects.map((item) => item.id)), new Set(["market-listing-a", "market-listing-b"]));
  assert.ok(subjects.every((item) => item.title.includes("市场版")));
});

test("market record keeps provenance and does not reuse source completion keys", () => {
  const record = createMarketPathRecord("listing-safe", "分享者", snapshot);
  assert.match(record.plan.request_summary, /来源：学习市场 listing-safe/);
  assert.equal(record.execution.integration.listing_id, "listing-safe");
  assert.equal(record.execution.schedule[0].steps[0].id, "market-task-1-1");
});

test("market data layer carries the agent kind and stays live-only", async () => {
  const api = await read("../lib/learning-market.ts");

  assert.match(api, /export type MarketKind = "material" \| "bundle" \| "learning_path" \| "agent";/);
  assert.match(api, /export interface MarketAgentSnapshot/);
  assert.match(api, /agentId\?: string;/);
  assert.match(api, /agent_snapshot\?: MarketAgentSnapshot \| null;/);
  assert.match(api, /agent_id: input\.agentId \?\? "",/);
  // 市场是社区行为：读取降级为空、写入直接 throw，不允许 localStorage 分支。
  assert.match(api, /export async function listMarket\([\s\S]*?if \(mode !== "live"\) return \[\];/);
  assert.match(api, /export async function publishToMarket[\s\S]*?if \(mode !== "live"\) throw new Error/);
  assert.match(api, /export async function importFromMarket[\s\S]*?if \(mode !== "live"\) throw new Error/);
  assert.doesNotMatch(api, /localStorage/);
});

test("market page completes every kind-keyed constant for agent listings", async () => {
  const market = await read("../components/desktop/desktop-market.tsx");

  const marketHero = market.slice(
    market.indexOf('<header className="desktop-market-header">'),
    market.indexOf('<div className="desktop-market-layout">'),
  );
  assert.doesNotMatch(marketHero, /发布资源/);
  assert.match(market, /role="search"[\s\S]*desktop-market-publish shrink-0/);
  assert.match(market, /\{ id: "agent", label: "工作流", icon: Bot \}/);
  assert.match(market, /const KIND_LABEL: Record<MarketListing\["kind"\], string> = \{[\s\S]*?agent: "智能体",[\s\S]*?\};/);
  assert.match(market, /const MARKET_COVERS: Record<MarketListing\["kind"\], string> = \{[\s\S]*?agent: "\/brand\/[^"]+",[\s\S]*?\};/);
  // 静态导出 + CSP：封面必须是 public/ 下的本地资源，不能外链。
  assert.doesNotMatch(market, /MARKET_COVERS[\s\S]*?https?:\/\//);
  assert.match(market, /listing\.kind === "agent" \? "bg-\[#b83b2d\]"/);
  assert.match(market, /kind === "agent"\) return `\$\{Math\.max\(1, listing\.item_count\)\} 项能力`;/);
});

test("importing an agent listing skips the material refresh path", async () => {
  const market = await read("../components/desktop/desktop-market.tsx");
  const addListing = market.slice(market.indexOf("const addListing"), market.indexOf("<main"));

  assert.ok(addListing.includes("if (result.kind !== \"agent\") {"));
  // agent 导入不产生 generated_materials：appendResources 必须留在非 agent 分支里。
  const appendIndex = addListing.indexOf("session.appendResources");
  const guardIndex = addListing.indexOf("if (result.kind !== \"agent\") {");
  const guardEnd = addListing.indexOf("setListings((current)");
  assert.ok(guardIndex >= 0 && appendIndex > guardIndex && appendIndex < guardEnd);
  assert.match(addListing, /result\.kind === "agent"\s*\n?\s*\? `已把《\$\{listing\.title\}》添加到我的智能体/);
});

test("publish dialog can put a custom agent on the market", async () => {
  const dialog = await read("../components/market-publish-dialog.tsx");

  assert.match(dialog, /type PublishTarget = "resources" \| "path" \| "agent";/);
  assert.match(dialog, /grid grid-cols-3 gap-3/);
  assert.match(dialog, /自建智能体/);
  assert.match(dialog, /kind: target === "agent"\s*\n?\s*\? "agent"/);
  assert.match(dialog, /agentId: target === "agent" \? agent\?\.id : undefined,/);
  assert.match(dialog, /setError\("请选择一个要分享的智能体。"\)/);
  // 智能体的初始选中必须留在受 initializedOpenRef 保护的那一个 useEffect 里。
  const initEffect = dialog.slice(
    dialog.indexOf("if (initializedOpenRef.current) return;"),
    dialog.indexOf("const selectedResources = useMemo"),
  );
  assert.match(initEffect, /setSelectedAgentId\(""\);/);
  assert.match(initEffect, /listCustomAgents\(session\.mode\)/);
});
