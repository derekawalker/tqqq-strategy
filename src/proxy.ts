import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  readSessionToken,
  sessionCookieOptions,
  sessionNeedsRefresh,
} from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/password"];
// Cron-only route — no browser session exists to gate on (Vercel/GitHub
// Actions can't do the interactive login flow). It authenticates itself via
// its own CRON_SECRET bearer-token check, so it's safe to exempt here.
const CRON_PATHS = ["/api/push/check"];

export async function proxy(request: NextRequest) {
  if (process.env.DEMO_MODE === "true") return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (CRON_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.APP_SESSION_SECRET;
  const cookie = request.cookies.get(SESSION_COOKIE);
  const session = secret ? await readSessionToken(cookie?.value, secret) : null;

  if (!secret || !session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  // Sliding expiry: renew once a day while the app is in use, so the password is
  // only asked for after a full week away rather than a week after each login
  if (sessionNeedsRefresh(session)) {
    const token = await createSessionToken(secret, SESSION_TTL_SECONDS);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
