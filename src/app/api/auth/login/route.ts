import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

const AUTH_URL = "https://api.schwabapi.com/v1/oauth/authorize";

export async function GET() {
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: process.env.SCHWAB_CLIENT_ID!,
    redirect_uri: process.env.SCHWAB_REDIRECT_URI!,
    response_type: "code",
    state,
  });

  const response = NextResponse.redirect(`${AUTH_URL}?${params}`);
  response.cookies.set("oauth-state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes — enough to complete OAuth flow
  });
  return response;
}
