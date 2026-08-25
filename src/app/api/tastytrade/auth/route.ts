import { getAccessToken } from "@/lib/tastytrade/client";
import { hasTastytradeCredentials } from "@/lib/tastytrade/config";

/**
 * Connection status. There is nothing interactive to do here any more: OAuth2
 * replaced the session-token login in February 2026, and the refresh token is a
 * long-lived environment secret rather than something a user types a code for.
 * "Connected" therefore means the refresh token still mints an access token.
 */
export async function GET() {
  if (!hasTastytradeCredentials()) {
    return Response.json({ connected: false, reason: "not_configured" });
  }
  try {
    await getAccessToken();
    return Response.json({ connected: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ connected: false, reason: "auth_failed", error: message });
  }
}
