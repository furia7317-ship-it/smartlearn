import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("resource selection opens the dedicated note workspace", async () => {
  const [viewer, notePage, workspace, library] = await Promise.all([
    read("../components/resource-viewer.tsx"),
    read("../app/desktop/notes/new/page.tsx"),
    read("../components/note-workspace.tsx"),
    read("../lib/library.ts"),
  ]);

  assert.match(viewer, /openNoteForSelection/);
  assert.match(viewer, />写笔记</);
  assert.match(viewer, /saveNoteSourceDraft/);
  assert.match(viewer, /\/desktop\/notes\/new/);
  assert.match(notePage, /NoteWorkspace/);
  assert.match(workspace, /保存到资源中心/);
  assert.match(library, /\/api\/materials\/notes/);
});

test("learning market supports publishing and non-overwriting path imports", async () => {
  const [market, dialog, api, orchestrator, master, resources] = await Promise.all([
    read("../components/desktop/desktop-market.tsx"),
    read("../components/market-publish-dialog.tsx"),
    read("../lib/learning-market.ts"),
    read("../hooks/use-orchestrator.ts"),
    read("../lib/master-learning-path.ts"),
    read("../components/desktop/desktop-resources.tsx"),
  ]);

  assert.match(market, /学习市场/);
  assert.match(market, /importFromMarket/);
  assert.match(dialog, /单份资料 \/ 资源包/);
  assert.match(dialog, /学习路径/);
  assert.match(dialog, /const EMPTY_RESOURCE_IDS: string\[\] = \[\];/);
  assert.match(dialog, /initialResourceIds = EMPTY_RESOURCE_IDS/);
  assert.doesNotMatch(dialog, /initialResourceIds = \[\]/);
  assert.match(dialog, /const initializedOpenRef = useRef\(false\)/);
  assert.match(dialog, /if \(initializedOpenRef\.current\) return/);
  assert.match(api, /createMarketPathRecord/);
  assert.match(orchestrator, /importMarketPath/);
  assert.match(master, /market:\$\{marketId\}/);
  assert.match(resources, /MarketPublishDialog/);
  assert.match(resources, /marketSelectedIds/);
});
