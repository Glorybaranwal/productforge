import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DataStore } from "../store";

/**
 * Local JSON file store for `pnpm dev` in demo mode (ADR-011).
 * Defaults to `.data/productforge.json` (git-ignored); override with DATA_FILE.
 */
export function createFileStore(path = process.env.DATA_FILE): DataStore {
  // Vercel's file system is read-only except /tmp: preview deploys run in demo mode with data that
  // lasts as long as the server instance (ADR-025).
  const fallback = process.env.VERCEL ? "/tmp" : join(process.cwd(), ".data");
  const file = path ?? join(fallback, "productforge.json");
  return {
    kind: "file",
    async load() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async save(state) {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
      await rename(tmp, file); // atomic replace: a crash never leaves a half-written file
    },
  };
}
