import { afterEach, describe, expect, it } from "vitest";

import { inUserTx, setUserRunner, type UserRunner } from "@/src/db/scope";

const scope = {
  session: { userId: "00000000-0000-4000-8000-000000000001", name: "Ana", email: "" },
};

/** A runner that fails with `errors` in turn, then succeeds; counts its calls. */
function flaky(...errors: unknown[]) {
  const calls = { n: 0 };
  const runner = (async (_session: unknown, fn: (tx: never) => Promise<unknown>) => {
    const err = errors[calls.n++];
    if (err) throw err;
    return fn(undefined as never);
  }) as unknown as UserRunner;
  return { runner, calls };
}

afterEach(() => setUserRunner(null));

describe("opening a database connection", () => {
  it("retries once when the connection times out while opening", async () => {
    const { runner, calls } = flaky(
      Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" }),
    );
    setUserRunner(runner);
    expect(await inUserTx(scope, async () => "ok")).toBe("ok");
    expect(calls.n).toBe(2);
  });

  it("gives up after the second timeout", async () => {
    const timeout = Object.assign(new Error("write CONNECT_TIMEOUT"), { code: "CONNECT_TIMEOUT" });
    const { runner, calls } = flaky(timeout, timeout);
    setUserRunner(runner);
    await expect(inUserTx(scope, async () => "ok")).rejects.toThrow("CONNECT_TIMEOUT");
    expect(calls.n).toBe(2);
  });

  it("never retries an error from inside the transaction", async () => {
    const { runner, calls } = flaky(Object.assign(new Error("duplicate"), { code: "23505" }));
    setUserRunner(runner);
    await expect(inUserTx(scope, async () => "ok")).rejects.toThrow("duplicate");
    expect(calls.n).toBe(1);
  });
});
