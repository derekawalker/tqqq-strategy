import { describe, it, expect } from "vitest";
import { tokensFromSession } from "./client";

// A trimmed-down copy of a real POST /sessions response body.
const session = (extra: Record<string, unknown> = {}) => ({
  "session-token": "sess-abc",
  "session-expiration": "2026-08-24T07:54:19.560Z",
  ...extra,
});

describe("tokensFromSession", () => {
  it("reads the remember token from `remember-token`", () => {
    // The field the live API actually sends. Reading the wrong name here silently
    // stored an empty remember token, so every later refresh was rejected.
    const tokens = tokensFromSession(session({ "remember-token": "rt-123" }));
    expect(tokens.rememberMeToken).toBe("rt-123");
  });

  it("falls back to `remember-me-token`", () => {
    const tokens = tokensFromSession(session({ "remember-me-token": "rt-legacy" }));
    expect(tokens.rememberMeToken).toBe("rt-legacy");
  });

  it("prefers `remember-token` when both are present", () => {
    const tokens = tokensFromSession(
      session({ "remember-token": "rt-new", "remember-me-token": "rt-old" }),
    );
    expect(tokens.rememberMeToken).toBe("rt-new");
  });

  it("stores an empty remember token when the response has neither", () => {
    expect(tokensFromSession(session()).rememberMeToken).toBe("");
  });

  it("takes the expiry from session-expiration rather than assuming a lifetime", () => {
    const tokens = tokensFromSession(session());
    expect(tokens.expiresAt).toBe(Date.parse("2026-08-24T07:54:19.560Z"));
  });

  it("falls back to an hour out when session-expiration is missing", () => {
    const before = Date.now();
    const tokens = tokensFromSession({ "session-token": "sess-abc" });
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
  });

  it("falls back when session-expiration is unparseable", () => {
    const tokens = tokensFromSession(session({ "session-expiration": "not a date" }));
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("passes the session token through", () => {
    expect(tokensFromSession(session()).sessionToken).toBe("sess-abc");
  });

  it("throws when the response has no session token", () => {
    expect(() => tokensFromSession({ "session-expiration": "2026-08-24T07:54:19.560Z" })).toThrow(
      /missing session-token/,
    );
  });

  it("throws on an undefined payload", () => {
    expect(() => tokensFromSession(undefined)).toThrow(/missing session-token/);
  });
});
