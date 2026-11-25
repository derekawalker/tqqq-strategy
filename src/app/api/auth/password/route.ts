import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const FAIL_DELAY_MS = 500;

/** Constant-time compare; hashing first makes the lengths equal. */
function passwordMatches(given: unknown, expected: string | undefined): boolean {
  if (typeof given !== "string" || !expected) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// Module-level rate limiter — persists within a warm function instance
const attempts = new Map<string, { count: number; resetAt: number }>();

function getIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  if (!process.env.APP_PASSWORD || !process.env.APP_SESSION_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const ip = getIp(request);
  const now = Date.now();
  const record = attempts.get(ip);

  // Reset window if expired
  if (record && now > record.resetAt) {
    attempts.delete(ip);
  }

  const current = attempts.get(ip);
  if (current && current.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many attempts — try again later" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const password: unknown = body?.password;

  if (!passwordMatches(password, process.env.APP_PASSWORD)) {
    // Record failed attempt
    const entry = attempts.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
    entry.count += 1;
    attempts.set(ip, entry);
    // Delay to slow brute force
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Success — clear any recorded attempts for this IP
  attempts.delete(ip);

  const token = await createSessionToken(process.env.APP_SESSION_SECRET, SESSION_TTL_SECONDS);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
