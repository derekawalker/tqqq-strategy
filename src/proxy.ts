import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "tqqq-auth";
const PUBLIC_PATHS = ["/login", "/api/auth/password"];

export function proxy(request: NextRequest) {
  if (process.env.DEMO_MODE === "true") return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const secret = process.env.APP_SESSION_SECRET;
  const cookie = request.cookies.get(COOKIE_NAME);

  if (!secret || cookie?.value !== secret) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
