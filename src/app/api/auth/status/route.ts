import { readTokens, isExpired } from "@/lib/schwab/tokens";

export async function GET() {
  const tokens = await readTokens();

  if (!tokens) {
    return Response.json({ authenticated: false, reason: "no_tokens" });
  }

  if (isExpired(tokens)) {
    return Response.json({ authenticated: false, reason: "expired" });
  }

  return Response.json({ authenticated: true });
}
