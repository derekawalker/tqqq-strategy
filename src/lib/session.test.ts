import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

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
