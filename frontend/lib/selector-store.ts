/** Minimal external store: consumers decide which values they subscribe to. */
export function createSelectorStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: T) {
      if (Object.is(value, next)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key)
    && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** A selected snapshot must retain its identity across unrelated store writes. */
export function createSelectedSnapshot<T, S>(getState: () => T, select: (state: T) => S) {
  let cached: { value: S } | undefined;
  return () => {
    const next = select(getState());
    if (cached && shallowEqual(cached.value, next)) return cached.value;
    cached = { value: next };
    return next;
  };
}
