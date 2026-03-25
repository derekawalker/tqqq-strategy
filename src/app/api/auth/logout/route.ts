import { clearTokens } from "@/lib/schwab/tokens";

export async function POST() {
  clearTokens();
  return Response.json({ ok: true });
}
