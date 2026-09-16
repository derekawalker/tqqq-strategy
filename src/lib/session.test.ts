import { describe, it, expect } from "vitest";
import {
  SESSION_REFRESH_AFTER_SECONDS,
  createSessionToken,
  readSessionToken,
  sessionNeedsRefresh,
  verifySessionToken,
} from "./session";

const SECRET = "test-secret-value-1234567890";
const WEEK = 60 * 60 * 24 * 7;

describe("session tokens", () => {
  it("verifies a freshly minted token", async () => {
    const token = await createSessionToken(SECRET, WEEK);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SECRET, WEEK);
    expect(await verifySessionToken(token, "other-secret")).toBe(false);
  });

  it("rejects an expired token", async () => {
    const issuedAt = Date.now() - WEEK * 1000 - 1000; // issued just over a week ago
    const token = await createSessionToken(SECRET, WEEK, issuedAt);
    expect(await verifySessionToken(token, SECRET)).toBe(false);
  });

  it("accepts a token that is not yet expired", async () => {
    const issuedAt = Date.now() - (WEEK - 60) * 1000; // expires in ~60s
    const token = await createSessionToken(SECRET, WEEK, issuedAt);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const token = await createSessionToken(SECRET, WEEK);
    const [, sig] = token.split(".");
    const forged = `${btoa('{"iat":0,"exp":9999999999}').replace(/=+$/, "")}.${sig}`;
    expect(await verifySessionToken(forged, SECRET)).toBe(false);
  });

  it("rejects malformed and empty tokens", async () => {
    expect(await verifySessionToken(undefined, SECRET)).toBe(false);
    expect(await verifySessionToken("", SECRET)).toBe(false);
    expect(await verifySessionToken("no-dot", SECRET)).toBe(false);
    expect(await verifySessionToken(".sig", SECRET)).toBe(false);
    expect(await verifySessionToken("payload.", SECRET)).toBe(false);
    expect(await verifySessionToken("a.b.c", SECRET)).toBe(false);
  });

  it("rejects the legacy raw-secret cookie value", async () => {
    // Old scheme stored APP_SESSION_SECRET verbatim as the cookie; it must not verify.
    expect(await verifySessionToken(SECRET, SECRET)).toBe(false);
  });
});

describe("session refresh", () => {
  it("does not refresh a session issued less than a day ago", async () => {
    const issued = Date.now();
    const payload = await readSessionToken(await createSessionToken(SECRET, 3600 * 24 * 7, issued), SECRET, issued);
    expect(payload).not.toBeNull();
    expect(sessionNeedsRefresh(payload!, issued + (SESSION_REFRESH_AFTER_SECONDS - 60) * 1000)).toBe(false);
  });

  it("refreshes a still-valid session once it is a day old", async () => {
    const issued = Date.now();
    const token = await createSessionToken(SECRET, 3600 * 24 * 7, issued);
    const later = issued + (SESSION_REFRESH_AFTER_SECONDS + 60) * 1000;
    const payload = await readSessionToken(token, SECRET, later);
    expect(payload).not.toBeNull();
    expect(sessionNeedsRefresh(payload!, later)).toBe(true);
  });

  it("returns no payload for an expired session, so it cannot be refreshed", async () => {
    const issued = Date.now();
    const token = await createSessionToken(SECRET, 60, issued);
    expect(await readSessionToken(token, SECRET, issued + 120 * 1000)).toBeNull();
  });
});
