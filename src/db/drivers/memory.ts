import type { DataStore } from "../store";
import type { DbState } from "../state";

/** In-process store for tests. Each load returns a fresh copy, like reading a real database. */
export function createMemoryStore(initial?: DbState): DataStore {
  let snapshot: string | null = initial ? JSON.stringify(initial) : null;
  return {
    kind: "memory",
    async load() {
      return snapshot === null ? null : JSON.parse(snapshot);
    },
    async save(state) {
      snapshot = JSON.stringify(state);
    },
  };
}
