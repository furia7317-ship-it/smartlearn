export interface RequestCacheScope {
  studentId: string;
  mode: string;
  key: string;
}

export interface RequestCacheFilter {
  studentId?: string;
  mode?: string;
  keys?: readonly string[];
}

export interface RequestCacheOptions {
  force?: boolean;
  ttlMs?: number;
}

interface RequestCacheEntry {
  scope: RequestCacheScope;
  expiresAt: number;
  hasValue: boolean;
  value?: unknown;
  inFlight?: Promise<unknown>;
}

export const DEFAULT_REQUEST_CACHE_TTL_MS = 45_000;

function scopeKey(scope: RequestCacheScope): string {
  return JSON.stringify([scope.studentId, scope.mode, scope.key]);
}

/**
 * Small account-scoped cache for idempotent client reads.
 *
 * A stale value is never served after its TTL. Concurrent callers share the
 * same promise, rejected loads are removed immediately, and invalidating an
 * in-flight request prevents its late result from repopulating the cache.
 */
export function createScopedRequestCache(
  defaultTtlMs = DEFAULT_REQUEST_CACHE_TTL_MS,
  now: () => number = Date.now,
) {
  const entries = new Map<string, RequestCacheEntry>();

  const getOrLoad = async <T>(
    scope: RequestCacheScope,
    load: () => Promise<T>,
    options: RequestCacheOptions = {},
  ): Promise<T> => {
    const key = scopeKey(scope);
    const existing = entries.get(key);
    if (existing?.inFlight) return existing.inFlight as Promise<T>;
    if (!options.force && existing?.hasValue && existing.expiresAt > now()) {
      return existing.value as T;
    }

    const inFlight = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          const active = entries.get(key);
          if (active?.inFlight === inFlight) {
            entries.set(key, {
              scope,
              expiresAt: now() + Math.max(0, options.ttlMs ?? defaultTtlMs),
              hasValue: true,
              value,
            });
          }
          return value;
        },
        (error) => {
          if (entries.get(key)?.inFlight === inFlight) entries.delete(key);
          throw error;
        },
      );

    entries.set(key, {
      scope,
      expiresAt: 0,
      hasValue: false,
      inFlight,
    });
    return inFlight;
  };

  const invalidate = (filter: RequestCacheFilter = {}): void => {
    const selectedKeys = filter.keys ? new Set(filter.keys) : null;
    for (const [key, entry] of entries) {
      if (filter.studentId !== undefined && entry.scope.studentId !== filter.studentId) continue;
      if (filter.mode !== undefined && entry.scope.mode !== filter.mode) continue;
      if (selectedKeys && !selectedKeys.has(entry.scope.key)) continue;
      entries.delete(key);
    }
  };

  return {
    getOrLoad,
    invalidate,
    clear: () => entries.clear(),
  };
}
