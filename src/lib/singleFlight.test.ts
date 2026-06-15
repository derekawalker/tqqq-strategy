import { describe, it, expect, vi } from "vitest";
import { singleFlight } from "./singleFlight";

describe("singleFlight", () => {
  it("runs the underlying fn once for concurrent calls and shares the result", async () => {
    let calls = 0;
    let resolve!: (v: string) => void;
    const fn = vi.fn(() => {
      calls++;
      return new Promise<string>((r) => { resolve = r; });
    });
    const coalesced = singleFlight(fn);

    // Three callers race before the first run settles
    const p1 = coalesced();
    const p2 = coalesced();
    const p3 = coalesced();

    expect(calls).toBe(1);
    resolve("token");
    expect(await Promise.all([p1, p2, p3])).toEqual(["token", "token", "token"]);
  });

  it("starts a fresh run after the previous one settles", async () => {
    let calls = 0;
    const fn = vi.fn(async () => `run-${++calls}`);
    const coalesced = singleFlight(fn);

    expect(await coalesced()).toBe("run-1");
    expect(await coalesced()).toBe("run-2");
    expect(calls).toBe(2);
  });

  it("clears the in-flight slot on rejection so the next call retries", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return "ok";
    });
    const coalesced = singleFlight(fn);

    await expect(coalesced()).rejects.toThrow("transient");
    expect(await coalesced()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("passes the first caller's arguments to the shared run", async () => {
    let resolve!: (v: number) => void;
    const fn = vi.fn((n: number) => {
      void n;
      return new Promise<number>((r) => { resolve = r; });
    });
    const coalesced = singleFlight(fn);

    const p1 = coalesced(1);
    const p2 = coalesced(2);
    resolve(42);

    await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });
});
