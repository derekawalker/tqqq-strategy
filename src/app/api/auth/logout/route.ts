import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/schwab/tokens";

export async function POST() {
  await clearTokens();
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
