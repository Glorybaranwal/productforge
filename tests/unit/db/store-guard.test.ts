import { afterEach, describe, expect, it, vi } from "vitest";

import { readState, STORE_OFF } from "@/src/db/store";

afterEach(() => vi.unstubAllEnvs());

describe("Postgres-only mode (PF-075)", () => {
  it("refuses the demo store when Postgres holds the data", async () => {
    vi.stubEnv("DATA_DRIVER", "postgres");
    await expect(readState()).rejects.toThrow(STORE_OFF);
  });

  it("keeps the demo store in demo mode", async () => {
    vi.stubEnv("DATA_DRIVER", "memory");
    expect(await readState()).toBeDefined();
  });
});
