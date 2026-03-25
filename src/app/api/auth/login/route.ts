import { NextResponse } from "next/server";

const AUTH_URL = "https://api.schwabapi.com/v1/oauth/authorize";

export async function GET() {
  const params = new URLSearchParams({
    client_id: process.env.SCHWAB_CLIENT_ID!,
    redirect_uri: process.env.SCHWAB_REDIRECT_URI!,
    response_type: "code",
  });

  return NextResponse.redirect(`${AUTH_URL}?${params}`);
}
