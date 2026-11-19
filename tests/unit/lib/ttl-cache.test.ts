import { describe, expect, it } from "vitest";

import { ttlCache } from "@/src/lib/ttl-cache";

describe("ttlCache (ADR-023)", () => {
  it("returns entries until they expire", () => {
    let now = 1_000;
    const cache = ttlCache<string>("__test_ttl_expiry", 100, 10, () => now);
    cache.set("a", "first");
    expect(cache.get("a")).toBe("first");
    now = 1_099;
    expect(cache.get("a")).toBe("first");
    now = 1_100;
    expect(cache.get("a")).toBeUndefined();
  });

  it("drops the oldest entry past its size limit", () => {
    const cache = ttlCache<number>("__test_ttl_size", 60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([undefined, 2, 3]);
  });

  it("forgets on request and is shared under the same key", () => {
    const one = ttlCache<number>("__test_ttl_shared", 60_000);
    const two = ttlCache<number>("__test_ttl_shared", 60_000);
    one.set("a", 1);
    expect(two.get("a")).toBe(1);
    two.delete("a");
    expect(one.get("a")).toBeUndefined();
  });
});
