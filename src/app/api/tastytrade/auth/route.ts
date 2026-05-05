import { initiateMfaLogin, completeMfaLogin } from "@/lib/tastytrade/client";
import { readTokens, isExpired } from "@/lib/tastytrade/tokens";

export async function GET() {
  if (!process.env.TASTYTRADE_USERNAME) {
    return Response.json({ connected: false, reason: "not_configured" });
  }
  const tokens = await readTokens();
  if (!tokens || isExpired(tokens)) {
    return Response.json({ connected: false, reason: "no_tokens" });
  }
  return Response.json({ connected: true });
}

export async function POST(request: Request) {
  if (!process.env.TASTYTRADE_USERNAME) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  try {
    const body = await request.json();

    if (body.action === "initiate") {
      const mfaToken = await initiateMfaLogin();
      // Empty mfaToken means direct login succeeded (no 2FA)
      return Response.json({ mfaToken, connected: mfaToken === "" });
    }

    if (body.action === "complete") {
      const { mfaToken, otp } = body;
      if (!mfaToken || !otp) {
        return Response.json({ error: "mfaToken and otp required" }, { status: 400 });
      }
      await completeMfaLogin(String(mfaToken), String(otp).trim());
      return Response.json({ success: true });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 401 });
  }
}
