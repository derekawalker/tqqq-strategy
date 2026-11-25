import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({
  tokens: null as null | { accessToken: string; refreshToken: string; expiresAt: number },
}));

vi.mock("./tokens", () => ({
  readTokens: async () => store.tokens,
  writeTokens: async (t: typeof store.tokens) => {
    store.tokens = t;
  },
  isExpired: (t: { expiresAt: number }) => t.expiresAt < Date.now(),
}));

import { schwabFetch, invalidateTokenCache } from "./client";

const HOUR = 3_600_000;
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function authHeader(call: unknown[]): string {
  return ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  fetchMock.mockReset();
  invalidateTokenCache();
  store.tokens = { accessToken: "A", refreshToken: "R", expiresAt: Date.now() + HOUR };
});

describe("schwabFetch", () => {
  it("passes a non-401 response straight through", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const res = await schwabFetch("/x");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("on 401, retries with a newer stored token without refreshing", async () => {
    // Prime the in-memory cache with A.
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await schwabFetch("/x");
    // Another instance / re-login stored B.
    store.tokens = { accessToken: "B", refreshToken: "R2", expiresAt: Date.now() + HOUR };

    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const res = await schwabFetch("/x");

    expect(res.status).toBe(200);
    const calls = fetchMock.mock.calls;
    expect(authHeader(calls[1])).toBe("Bearer A");
    expect(authHeader(calls[2])).toBe("Bearer B");
    expect(calls).toHaveLength(3); // no token-endpoint call
  });

  it("on 401 with the same stored token, refreshes then retries", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "C", refresh_token: "R3", expires_in: 1800 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const res = await schwabFetch("/x");

    expect(res.status).toBe(200);
    const calls = fetchMock.mock.calls;
    expect(String(calls[1][0])).toContain("/v1/oauth/token");
    expect(authHeader(calls[2])).toBe("Bearer C");
    expect(store.tokens?.accessToken).toBe("C");
  });

  it("does not retry a 401 whose body can't be re-sent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    const stream = new ReadableStream();
    const res = await schwabFetch("/x", { method: "POST", body: stream });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
