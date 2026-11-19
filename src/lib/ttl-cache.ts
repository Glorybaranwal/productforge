/**
 * A small in-process cache whose entries expire (ADR-023). Per server instance; holds at most
 * `maxEntries`, dropping the oldest. Kept on globalThis under `key` so `next dev` reloads share it.
 */
export type TtlCache<V> = {
  get(id: string): V | undefined;
  set(id: string, value: V): void;
  delete(id: string): void;
  clear(): void;
};

type Entry<V> = { value: V; expires: number };

export function ttlCache<V>(
  key: string,
  ttlMs: number,
  maxEntries = 1000,
  now: () => number = Date.now,
): TtlCache<V> {
  const store = globalThis as unknown as Record<string, Map<string, Entry<V>> | undefined>;
  const entries = (store[key] ??= new Map<string, Entry<V>>());
  return {
    get(id) {
      const hit = entries.get(id);
      if (!hit) return undefined;
      if (hit.expires <= now()) {
        entries.delete(id);
        return undefined;
      }
      return hit.value;
    },
    set(id, value) {
      entries.delete(id);
      entries.set(id, { value, expires: now() + ttlMs });
      // Maps iterate in insertion order, so the first key is the oldest.
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    delete: (id) => void entries.delete(id),
    clear: () => entries.clear(),
  };
}
