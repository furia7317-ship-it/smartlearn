import assert from "node:assert/strict";
import test from "node:test";
import { ConversationSyncController } from "../lib/conversation-sync.ts";

const session = (id, text = id) => ({ id, title: text, updatedAt: 1,
  messages: [{ id: "m1", role: "user", content: text, kind: "text" }],
  teacher: "raccoon", kind: "general", resourceId: "", resourceTitle: "", resourceContext: "" });
const state = (...sessions) => ({ activeConversationId: sessions[0]?.id ?? "", sessions });
const copy = (value) => structuredClone(value);
function server(...sessions) {
  let stored = { ...state(...sessions), revision: 0 };
  const transport = {
    async read() { return copy(stored); },
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
