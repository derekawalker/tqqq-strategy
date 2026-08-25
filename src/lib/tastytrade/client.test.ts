import { describe, it, expect } from "vitest";
import { tokenFromPayload } from "./client";

// A trimmed-down copy of a real POST /oauth/token response body.
const payload = (extra: Record<string, unknown> = {}) => ({
  access_token: "acc-abc",
  token_type: "Bearer",
  expires_in: 900,
  ...extra,
});

describe("tokenFromPayload", () => {
  it("passes the access token through", () => {
    expect(tokenFromPayload(payload()).accessToken).toBe("acc-abc");
  });

  it("takes the lifetime from expires_in rather than assuming one", () => {
    // tastytrade access tokens are 15 minutes today, but the response is the authority:
    // an over-long guess leaves us serving a token the server already killed.
    const before = Date.now();
    const { expiresAt } = tokenFromPayload(payload({ expires_in: 120 }));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it("falls back to 15 minutes when expires_in is missing", () => {
    const before = Date.now();
    const { expiresAt } = tokenFromPayload({ access_token: "acc-abc" });
    expect(expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });

  it("falls back when expires_in is not a usable number", () => {
    for (const bad of ["900", 0, -1, null]) {
      const { expiresAt } = tokenFromPayload(payload({ expires_in: bad }));
      expect(expiresAt).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    }
  });

  it("throws when the response has no access token", () => {
    expect(() => tokenFromPayload({ expires_in: 900 })).toThrow(/missing access_token/);
  });

  it("throws on an undefined payload", () => {
    expect(() => tokenFromPayload(undefined)).toThrow(/missing access_token/);
  });
});
