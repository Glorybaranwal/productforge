import { createFileStore } from "./drivers/file";
import { createMemoryStore } from "./drivers/memory";
import { normalizeState, type DbState } from "./state";

/** Where the demo-mode document lives. Repositories never use a driver directly. */
export interface DataStore {
  readonly kind: "memory" | "file" | "local-storage";
  load(): Promise<unknown>;
  save(state: DbState): Promise<void>;
}

type Shared = { store?: DataStore; queue: Promise<unknown> };

// Kept on globalThis so every server bundle in `next dev` shares one store and one write queue.
const shared: Shared = ((globalThis as { __productforgeDb?: Shared }).__productforgeDb ??= {
  queue: Promise.resolve(),
});

function defaultStore(): DataStore {
  const env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {};
  const driver = env.DATA_DRIVER ?? (env.NODE_ENV === "test" ? "memory" : "file");
  return driver === "memory" ? createMemoryStore() : createFileStore();
}

export function getDataStore(): DataStore {
  shared.store ??= defaultStore();
  return shared.store;
}

/** Swap the driver (tests, browser preview). */
export function setDataStore(store: DataStore): void {
  shared.store = store;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = shared.queue.then(work);
  shared.queue = run.catch(() => undefined);
  return run;
}

/** Reads a consistent snapshot (waits for in-flight writes). Mutating it has no effect. */
export function readState(): Promise<DbState> {
  return enqueue(async () => normalizeState(await getDataStore().load()));
}

/** Serialised read-modify-write: changes `fn` makes to `state` are saved together. */
export function transact<T>(fn: (state: DbState) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const store = getDataStore();
    const state = normalizeState(await store.load());
    const result = await fn(state);
    await store.save(state);
    return result;
  });
}
