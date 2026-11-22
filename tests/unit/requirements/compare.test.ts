import { describe, expect, it } from "vitest";

import { orderPair } from "@/src/modules/requirements/compare";

describe("orderPair", () => {
  it("keeps an older-left pair as it is", () => {
    expect(orderPair({ version: 1 }, { version: 3 })).toEqual([{ version: 1 }, { version: 3 }]);
  });
  it("swaps a newer-left pair so the older version is first", () => {
    expect(orderPair({ version: 3 }, { version: 2 })).toEqual([{ version: 2 }, { version: 3 }]);
  });
  it("keeps equal versions in place", () => {
    const a = { version: 2, id: "a" };
    const b = { version: 2, id: "b" };
    expect(orderPair(a, b)).toEqual([a, b]);
  });
});
