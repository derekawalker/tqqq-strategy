import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/schwab/client";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${APP_URL()}/?auth=error&reason=${encodeURIComponent(error)}`);
  }

  // Verify CSRF state token
  const savedState = request.cookies.get("oauth-state")?.value;
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${APP_URL()}/?auth=error&reason=invalid_state`);
  }

  if (!code) {
    return NextResponse.redirect(`${APP_URL()}/?auth=error&reason=no_code`);
  }

  try {
    await exchangeCode(code);
    const response = NextResponse.redirect(`${APP_URL()}/?auth=success`);
    // Clear the state cookie now that it's been used
    response.cookies.set("oauth-state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      `${APP_URL()}/?auth=error&reason=${encodeURIComponent(message)}`
    );
  }
}
