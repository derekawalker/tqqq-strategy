import { readTokens, isExpired } from "@/lib/schwab/tokens";

export async function GET() {
  if (process.env.DEMO_MODE === "true") {
    return Response.json({ authenticated: true });
  }
  const tokens = await readTokens();

  if (!tokens) {
    return Response.json({ authenticated: false, reason: "no_tokens" });
  }

  if (isExpired(tokens)) {
    return Response.json({ authenticated: false, reason: "expired" });
  }

  return Response.json({ authenticated: true });
}
