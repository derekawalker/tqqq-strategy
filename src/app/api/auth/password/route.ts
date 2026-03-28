import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "tqqq-auth";
const TWENTY_FOUR_HOURS = 60 * 60 * 24;

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, process.env.APP_SESSION_SECRET!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TWENTY_FOUR_HOURS,
  });
  return response;
}
