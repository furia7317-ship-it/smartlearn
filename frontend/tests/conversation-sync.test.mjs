import assert from "node:assert/strict";
import test from "node:test";
import { ConversationSyncController } from "../lib/conversation-sync.ts";
import { conversationSaveError } from "../lib/conversation-sync.ts";

const session = (id, text = id) => ({ id, title: text, updatedAt: 1,
  messages: [{ id: "m1", role: "user", content: text, kind: "text" }],
  teacher: "raccoon", kind: "general", resourceId: "", resourceTitle: "", resourceContext: "" });
const state = (...sessions) => ({ activeConversationId: sessions[0]?.id ?? "", sessions });
const copy = (value) => structuredClone(value);

test("unchanged hydrated snapshots do not write or contend for account revisions", async () => {
  const s = server(session("a"));
  let writes = 0;
  const w = windowClient({ ...s.transport, async write(value) { writes++; return s.transport.write(value); } });
  const restored = await w.client.load();
  await w.client.save(copy(restored));
  await w.client.save(copy(restored));
  assert.equal(writes, 0);
  assert.equal(w.storage.read(), null);
  assert.equal(w.client.getStatus().phase, "idle");
});

test("save failure keeps drafts, backs off and clears its warning after recovery", async () => {
  const s = server(session("a"));
  let online = false;
  const w = windowClient({ ...s.transport, async write(value) { if (!online) throw new TypeError("Failed to fetch"); return s.transport.write(value); } });
  await w.client.load();
  const draft = state(session("a", "unsynced answer"));
  await assert.rejects(w.client.save(draft));
  const retryAt = w.client.getStatus().retryAt;
  assert.ok(retryAt > Date.now());
  assert.match(w.client.getStatus().message, /恢复连接后会自动同步/);
  await assert.rejects(w.client.save(draft));
  assert.ok(w.client.getStatus().retryAt > retryAt);
  online = true;
  await w.client.save(draft);
  assert.equal(s.current().sessions[0].messages[0].content, "unsynced answer");
  assert.equal(w.storage.read(), null);
  assert.deepEqual(w.client.getStatus(), { phase: "idle", message: "" });
});

test("authentication and server-version failures are not reported as generic network failures", () => {
  assert.match(conversationSaveError({ status: 401 }), /重新登录/);
  assert.match(conversationSaveError(new Error("会话服务需要更新")), /重启后端/);
  assert.match(conversationSaveError({ status: 409 }), /其他窗口/);
});

test("a successful reload clears an obsolete recovered-draft notice", async () => {
  const s = server(session("a"));
  const w = windowClient(s.transport);
  await w.client.load();
  w.client.stage(state(session("a", "draft")));
  await w.client.load();
  w.storage.write(null);
  await w.client.load();
  assert.deepEqual(w.client.getStatus(), { phase: "idle", message: "" });
});
function server(...sessions) {
  let stored = { ...state(...sessions), revision: 0 };
  const transport = {
    async read() { return copy(stored); },
    async clear(revision) {
      if (revision !== stored.revision) throw Object.assign(new Error("conflict"), { status: 409 });
      stored = { revision: stored.revision + 1, activeConversationId: "", sessions: [] };
      return copy(stored);
    },
    async write(mutation) {
      if (mutation.revision !== stored.revision) throw Object.assign(new Error("conflict"), { status: 409 });
      const records = new Map(stored.sessions.map((s) => [s.id, s]));
      mutation.deletedSessionIds.forEach((id) => records.delete(id));
      mutation.sessions.forEach((s) => records.set(s.id, copy(s)));
      assert.ok(!mutation.activeConversationId || records.has(mutation.activeConversationId));
      stored = { revision: stored.revision + 1, activeConversationId: mutation.activeConversationId, sessions: [...records.values()] };
      return copy(stored);
    },
  };
  return { transport, current: () => copy(stored) };
}
function windowClient(transport, id = "local-copy") {
  let pending = null;
  const storage = { read: () => copy(pending), write: (value) => { pending = copy(value); } };
  return { client: new ConversationSyncController(transport, storage, () => id), storage };
}

test("clearAll deletes the entire remote account beyond the local 100-session view", async () => {
  const s = server(...Array.from({ length: 130 }, (_, index) => session(`s${index}`)));
  const { client, storage } = windowClient(s.transport);
  await client.load();
  client.stage(state(session("draft")));
  const cleared = await client.clearAll();
  assert.equal(cleared.sessions.length, 0);
  assert.equal(s.current().sessions.length, 0);
  assert.equal(storage.read(), null);
  await client.save(state(session("new")));
  assert.deepEqual(s.current().sessions.map((s) => s.id), ["new"]);
});

test("clearing drains an in-flight write and prevents queued stale snapshots from reappearing", async () => {
  const s = server(session("old"));
  let unblock, started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { unblock = resolve; });
  const client = windowClient({ ...s.transport, async write(change) { started(); await gate; return s.transport.write(change); } }).client;
  await client.load();
  const first = client.save(state(session("old", "changed")));
  await startedPromise;
  const queued = client.save(state(session("old", "queued")));
  const queuedCheck = assert.rejects(queued, /已取消/);
  const clearing = client.clearAll();
  await assert.rejects(client.save(state(session("old", "stale"))), /正在清除/);
  unblock();
  await Promise.all([first, queuedCheck, clearing]);
  assert.equal(s.current().sessions.length, 0);
  assert.equal(client.isClearing(), false);
});

test("a failed account clear preserves local drafts and can be retried", async () => {
  const s = server(session("keep"));
  let offline = true;
  const { client, storage } = windowClient({ ...s.transport, async clear(revision) {
    if (offline) throw new Error("offline");
    return s.transport.clear(revision);
  } });
  await client.load();
  client.stage(state(session("draft")));
  await assert.rejects(client.clearAll(), /offline/);
  assert.equal(s.current().sessions[0].id, "keep");
  assert.equal(storage.read().pending.sessions[0].id, "draft");
  assert.equal(client.getStatus().phase, "error");
  offline = false;
  await client.clearAll();
  assert.equal(s.current().sessions.length, 0);
});

test("reloading the same controller clears old UI aliases after a successful conflict fork", async () => {
  const s = server(session("a"));
  const a = windowClient(s.transport).client;
  const b = windowClient(s.transport).client;
  await Promise.all([a.load(), b.load()]);
  await a.save(state(session("a", "remote")));
  await b.save(state(session("a", "local")));
  const restored = await b.load();
  assert.deepEqual(b.getAliases(), {});
  await b.save({ ...restored, sessions: restored.sessions.map((item) => item.id === "a" ? session("a", "edit original") : item) });
  assert.equal(s.current().sessions.find((item) => item.id === "a").title, "edit original");
  assert.equal(s.current().sessions.find((item) => item.id === "local-copy").messages[0].content, "local");
});

test("storage exhaustion never claims a failed network save has a durable local draft", async () => {
  const s = server(session("a"));
  const client = new ConversationSyncController({ ...s.transport, write: async () => { throw new Error("offline"); } },
    { read: () => null, write: () => { throw new Error("quota"); } });
  await client.load();
  await assert.rejects(client.save(state(session("a", "draft"))));
  assert.match(client.getStatus().message, /空间不足/);
  assert.doesNotMatch(client.getStatus().message, /已保留在本机/);
});

test("an older window cannot implicitly delete another window's new session", async () => {
  const s = server(session("a"));
  const a = windowClient(s.transport).client;
  const b = windowClient(s.transport).client;
  await Promise.all([a.load(), b.load()]);
  await a.save(state(session("a"), session("b")));
  await b.save(state(session("a", "changed locally")));
  assert.deepEqual(s.current().sessions.map((s) => s.id).sort(), ["a", "b"]);
});

test("concurrent message edits survive in separate sessions, including later streaming updates", async () => {
  const s = server(session("a"));
  const a = windowClient(s.transport).client;
  const b = windowClient(s.transport).client;
  await Promise.all([a.load(), b.load()]);
  await a.save(state(session("a", "remote answer")));
  await b.save(state(session("a", "local answer")));
  await b.save(state(session("a", "local answer continues")));
  const records = new Map(s.current().sessions.map((s) => [s.id, s]));
  assert.equal(records.size, 2);
  assert.equal(records.get("a").messages[0].content, "remote answer");
  assert.equal(records.get("local-copy").messages[0].content, "local answer continues");
});

test("receiving a newer account revision does not authorize overwriting unseen session changes", async () => {
  const s = server(session("a"));
  const a = windowClient(s.transport).client;
  const b = windowClient(s.transport).client;
  await Promise.all([a.load(), b.load()]);
  await a.save(state(session("a", "remote answer")));
  await b.save(state(session("a"), session("b")));
  await b.save(state(session("a", "late local edit"), session("b")));
  assert.equal(s.current().sessions.find((s) => s.id === "a").title, "remote answer");
  assert.equal(s.current().sessions.find((s) => s.id === "local-copy").messages[0].content, "late local edit");
});

test("explicit deletion works, but a concurrent remote edit cancels a stale deletion", async () => {
  const s = server(session("a"), session("b"));
  const a = windowClient(s.transport).client;
  const b = windowClient(s.transport).client;
  await Promise.all([a.load(), b.load()]);
  await a.save(state(session("a", "new remote content"), session("b")));
  b.deleteSession("a");
  await b.save(state(session("b")));
  assert.equal(s.current().sessions.length, 2);
  assert.match(b.getStatus().message, /已保留/);
  const fresh = windowClient(s.transport).client;
  await fresh.load();
  fresh.deleteSession("a");
  await fresh.save(state(session("b")));
  assert.deepEqual(s.current().sessions.map((s) => s.id), ["b"]);
});

test("deleting the final conversation clears the server's active pointer", async () => {
  const s = server(session("a"));
  const client = windowClient(s.transport).client;
  await client.load();
  client.deleteSession("a");
  await client.save(state());
  assert.deepEqual(s.current().sessions, []);
  assert.equal(s.current().activeConversationId, "");
});

test("failed saves survive reload and a lost acknowledgement does not create duplicate sessions", async () => {
  const s = server(session("a"));
  let fail = true;
  const flaky = { ...s.transport, async write(mutation) {
    const result = await s.transport.write(mutation);
    if (fail) { fail = false; throw new Error("lost response"); }
    return result;
  } };
  const w = windowClient(flaky);
  await w.client.load();
  const local = state(session("a", "unsynced"));
  await assert.rejects(w.client.save(local));
  assert.equal(w.storage.read().pending.sessions[0].title, "unsynced");
  const recovered = new ConversationSyncController(flaky, w.storage, () => "unexpected-fork");
  const draft = await recovered.load();
  await recovered.save(draft);
  assert.equal(s.current().sessions.length, 1);
  assert.equal(w.storage.read(), null);
});

test("offline hydration restores the outbox before the UI can stage an empty snapshot", async () => {
  const s = server(session("a"));
  const w = windowClient(s.transport);
  await w.client.load();
  w.client.stage(state(session("a", "offline draft")));
  const client = new ConversationSyncController({ ...s.transport, read: async () => { throw new Error("must not contact network"); } }, w.storage);
  const restored = await client.load(false);
  assert.equal(restored.sessions[0].title, "offline draft");
  assert.equal(w.storage.read().pending.sessions[0].title, "offline draft");
  await client.save(restored);
  assert.equal(s.current().sessions[0].title, "offline draft");
});

test("an older request acknowledgement cannot clear a newer staged draft", async () => {
  const s = server(session("a"));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const w = windowClient({ ...s.transport, async write(mutation) { await gate; return s.transport.write(mutation); } });
  await w.client.load();
  const first = w.client.save(state(session("a", "first")));
  w.client.stage(state(session("a", "second")));
  release();
  await first;
  assert.equal(w.storage.read().pending.sessions[0].title, "second");
});
