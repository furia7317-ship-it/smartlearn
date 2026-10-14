import { API_BASE } from "@/lib/api";
import { requireOk } from "@/lib/api-error";
import { getStudentId } from "@/lib/student-identity";

type Mode = "checking" | "live" | "offline";

export interface ResourceCollection {
  id: string;
  name: string;
  resource_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ResourceCollectionInput {
  name: string;
  resource_ids: string[];
}

function storageKey(): string {
  return `sl_resource_collections_v2:${getStudentId()}`;
}

function readLocal(): ResourceCollection[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ResourceCollection => (
      Boolean(item)
      && typeof item === "object"
      && typeof (item as ResourceCollection).id === "string"
      && typeof (item as ResourceCollection).name === "string"
      && Array.isArray((item as ResourceCollection).resource_ids)
    ));
  } catch {
    return [];
  }
}

function writeLocal(collections: ResourceCollection[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(), JSON.stringify(collections));
}

function localId(): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `collection_${suffix}`;
}

export async function listResourceCollections(mode: Mode): Promise<ResourceCollection[]> {
  if (mode === "live") {
    const response = await requireOk(await fetch(`${API_BASE}/api/resource-collections`, {
      cache: "no-store",
      credentials: "include",
    }));
    return (await response.json()) as ResourceCollection[];
  }
  return mode === "offline" ? readLocal() : [];
}

export async function createResourceCollection(
  mode: Mode,
  input: ResourceCollectionInput,
): Promise<ResourceCollection> {
  if (mode === "live") {
    const response = await requireOk(await fetch(`${API_BASE}/api/resource-collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    }));
    return (await response.json()) as ResourceCollection;
  }
  if (mode !== "offline") throw new Error("账户状态确认中，请稍后重试。");
  const now = new Date().toISOString();
  const collections = readLocal();
  if (collections.some((collection) => collection.name.trim().toLocaleLowerCase("zh-CN") === input.name.trim().toLocaleLowerCase("zh-CN"))) {
    throw new Error("已有同名集合");
  }
  const collection: ResourceCollection = {
    id: localId(),
    name: input.name.trim(),
    resource_ids: [...new Set(input.resource_ids)],
    created_at: now,
    updated_at: now,
  };
  writeLocal([collection, ...collections]);
  return collection;
}

export async function updateResourceCollection(
  mode: Mode,
  collectionId: string,
  input: ResourceCollectionInput,
): Promise<ResourceCollection> {
  if (mode === "live") {
    const response = await requireOk(await fetch(`${API_BASE}/api/resource-collections/${encodeURIComponent(collectionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    }));
    return (await response.json()) as ResourceCollection;
  }
  if (mode !== "offline") throw new Error("账户状态确认中，请稍后重试。");
  const collections = readLocal();
  const current = collections.find((collection) => collection.id === collectionId);
  if (!current) throw new Error("集合不存在");
  if (collections.some((collection) => collection.id !== collectionId && collection.name.trim().toLocaleLowerCase("zh-CN") === input.name.trim().toLocaleLowerCase("zh-CN"))) {
    throw new Error("已有同名集合");
  }
  const updated: ResourceCollection = {
    ...current,
    name: input.name.trim(),
    resource_ids: [...new Set(input.resource_ids)],
    updated_at: new Date().toISOString(),
  };
  writeLocal(collections.map((collection) => collection.id === collectionId ? updated : collection));
  return updated;
}

export async function deleteResourceCollection(mode: Mode, collectionId: string): Promise<void> {
  if (mode === "live") {
    await requireOk(await fetch(`${API_BASE}/api/resource-collections/${encodeURIComponent(collectionId)}`, {
      method: "DELETE",
      credentials: "include",
    }));
    return;
  }
  if (mode !== "offline") throw new Error("账户状态确认中，请稍后重试。");
  writeLocal(readLocal().filter((collection) => collection.id !== collectionId));
}
