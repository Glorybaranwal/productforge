import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFileStore } from "@/src/db/drivers/file";
import { emptyState, normalizeState } from "@/src/db/state";

describe("file store (demo mode)", () => {
  it("returns null before anything is saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pf-"));
    expect(await createFileStore(join(dir, "db.json")).load()).toBeNull();
  });

  it("saves and loads the document, creating the folder if needed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pf-"));
    const file = join(dir, "nested", "db.json");
    const store = createFileStore(file);
    const state = { ...emptyState(), projects: [] };
    await store.save(state);

    expect(await store.load()).toEqual(state);
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(1);
  });
});

describe("normalizeState", () => {
  it("fills collections missing from an older file", () => {
    const state = normalizeState({ schemaVersion: 1, projects: [] });
    expect(state.auditLogs).toEqual([]);
    expect(state.workspaces).toEqual([]);
  });

  it("treats garbage as an empty database", () => {
    expect(normalizeState("not an object")).toEqual(emptyState());
  });
});
