import type { StoredConversationSession, StoredConversationState } from "./conversation-store";

export interface ConversationMutation extends StoredConversationState {
  deletedSessionIds: string[];
  revision: number;
}

export interface ConversationOutbox {
  base: StoredConversationState;
  accepted: StoredConversationState;
  pending: StoredConversationState;
  aliases: Record<string, string>;
  deletions: string[];
}

export interface ConversationTransport {
  read(): Promise<StoredConversationState>;
  write(mutation: ConversationMutation): Promise<StoredConversationState>;
}

export interface OutboxStorage {
  read(): ConversationOutbox | null;
  write(value: ConversationOutbox | null): void;
}

export interface ConversationSyncStatus {
  phase: "idle" | "saving" | "error";
  message: string;
}

const empty = (): StoredConversationState => ({ revision: 0, activeConversationId: "", sessions: [] });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** One writer per window. The server's revision gate coordinates other windows
 * and processes; this queue only orders requests from this instance. */
export class ConversationSyncController {
  private remote: StoredConversationState | undefined;
  private accepted = empty();
  private pending: StoredConversationState | undefined;
  private aliases: Record<string, string> = {};
  private deletions = new Set<string>();
  private generation = 0;
  private storageFailed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private status: ConversationSyncStatus = { phase: "idle", message: "" };
  private transport: ConversationTransport;
  private storage: OutboxStorage;
  private createId: () => string;

  constructor(
    transport: ConversationTransport,
    storage: OutboxStorage,
    createId = () => `conversation_${crypto.randomUUID()}`,
  ) {
    this.transport = transport;
    this.storage = storage;
    this.createId = createId;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getStatus = () => this.status;
  getAliases = () => ({ ...this.aliases });
  getPendingDeletions = () => [...this.deletions].map((id) => this.aliases[id] ?? id);

  private announce(phase: ConversationSyncStatus["phase"], message = "") {
    this.status = { phase, message };
    this.listeners.forEach((listener) => listener());
  }

  private persist() {
    try {
      this.storage.write(this.pending ? {
        base: this.remote ?? empty(), accepted: this.accepted,
        pending: this.pending, aliases: this.aliases, deletions: [...this.deletions],
      } : null);
      this.storageFailed = false;
    } catch {
      this.storageFailed = true;
      this.announce("error", "本机草稿空间不足，请保持页面打开，等待会话保存完成");
    }
  }

  async load(connected = true): Promise<StoredConversationState> {
    const outbox = this.storage.read();
    if (outbox) {
      this.remote = outbox.base;
      this.accepted = outbox.accepted;
      this.pending = outbox.pending;
      this.aliases = outbox.aliases;
      this.deletions = new Set(outbox.deletions);
      this.announce("error", "已恢复未同步草稿，正在尝试保存");
      return outbox.pending;
    }
    if (!connected) return this.accepted;
    this.remote = await this.transport.read();
    this.accepted = this.remote;
    this.pending = undefined;
    this.aliases = {};
    this.deletions.clear();
    return this.remote;
  }

  stage(state: StoredConversationState) {
    this.pending = state;
    this.generation += 1;
    this.persist();
  }

  deleteSession(id: string) {
    this.deletions.add(id);
    this.generation += 1;
    this.persist();
  }

  save(state: StoredConversationState): Promise<StoredConversationState> {
    this.stage(state);
    const generation = this.generation;
    const deleted = [...this.deletions];
    const result = this.tail.then(() => this.saveNow(state, generation, deleted));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private remoteSession(session: StoredConversationSession): StoredConversationSession {
    const id = this.aliases[session.id];
    return id ? { ...session, id, title: `${session.title.replace(/（本地副本）$/, "")}（本地副本）` } : session;
  }

  private async saveNow(state: StoredConversationState, generation: number, deleted: string[]): Promise<StoredConversationState> {
    let notice = "";
    this.announce("saving");
    try {
      if (!this.remote) this.remote = await this.transport.read();
      const previous = new Map(this.accepted.sessions.map((s) => [s.id, s]));
      const expected = new Map(this.accepted.sessions.map((s) => {
        const remote = this.remoteSession(s);
        return [remote.id, remote];
      }));
      const changed = state.sessions.filter((session) => !same(session, previous.get(session.id)));
      let deleting = deleted.map((id) => this.aliases[id] ?? id);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const base = this.remote;
        const latest = new Map(base.sessions.map((s) => [s.id, s]));
        for (const session of changed) {
          const local = this.remoteSession(session);
          if (!same(latest.get(local.id), expected.get(local.id)) && !same(latest.get(local.id), local)) {
            // Preserve the remote version, including an explicit deletion.
            // Keep UI IDs stable while agent runs are still streaming.
            this.aliases[session.id] = this.createId();
            notice = "检测到另一窗口的修改，当前内容已另存为本地副本，双方记录均已保留";
          }
        }
        deleting = deleting.filter((id) => {
          if (!latest.has(id) || same(expected.get(id), latest.get(id))) return true;
          notice = "另一窗口更新了待删除会话，已保留该会话，请重新确认删除";
          return false;
        });
        const activeId = this.aliases[state.activeConversationId] ?? state.activeConversationId;
        const updates = changed.map((session) => this.remoteSession(session));
        const activeExists = latest.has(activeId) || updates.some((session) => session.id === activeId);
        const fallbackActive = deleting.includes(base.activeConversationId) ? "" : base.activeConversationId;
        try {
          const result = await this.transport.write({
            revision: base.revision ?? 0,
            activeConversationId: activeExists && !deleting.includes(activeId) ? activeId : (fallbackActive || ""),
            sessions: updates,
            deletedSessionIds: deleting,
          });
          this.remote = result;
          this.accepted = state;
          deleted.forEach((id) => this.deletions.delete(id));
          if (generation === this.generation) this.pending = undefined;
          this.persist();
          if (!this.storageFailed) this.announce("idle", notice);
          return result;
        } catch (error) {
          if (!error || typeof error !== "object" || !("status" in error) || error.status !== 409) throw error;
          this.remote = await this.transport.read();
          this.persist();
        }
      }
      throw new Error("会话正在被其他窗口更新，草稿已保留，请稍后重试");
    } catch (error) {
      this.persist();
      if (!this.storageFailed) this.announce("error", "会话尚未保存到服务，草稿已保留在本机，正在等待重试");
      throw error;
    }
  }
}
