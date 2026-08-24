import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/schwab/tokens";
import { invalidateTokenCache } from "@/lib/schwab/client";

export async function POST() {
  await clearTokens();
  // The client caches the access token in memory; without this a logged-out
  // process would keep making authenticated calls until the token expired.
  invalidateTokenCache();
  const response = NextResponse.json({ ok: true });
  response.cookies.set("tqqq-auth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
