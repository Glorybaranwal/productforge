import type { DataStore } from "../store";

/**
 * Browser store for the hosted preview build. Falls back to memory when storage is
 * unavailable (private mode, sandboxed frames).
 */
export function createLocalStorageStore(key = "productforge:demo-db"): DataStore {
  let fallback: string | null = null;
  return {
    kind: "local-storage",
    async load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      } catch {
        return fallback === null ? null : JSON.parse(fallback);
      }
    },
    async save(state) {
      const raw = JSON.stringify(state);
      fallback = raw;
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // storage unavailable or full: keep the in-memory copy
      }
    },
  };
}
