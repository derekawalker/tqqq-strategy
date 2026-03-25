import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/schwab/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?auth=error&reason=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?auth=error&reason=no_code`
    );
  }

  try {
    await exchangeCode(code);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?auth=success`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?auth=error&reason=${encodeURIComponent(message)}`
    );
  }
}
