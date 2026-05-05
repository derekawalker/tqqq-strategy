import { createClient } from "@supabase/supabase-js";
import { TOKEN_ID } from "./config";

export interface TokenSet {
  sessionToken: string;
  rememberMeToken: string;
  expiresAt: number; // Unix ms
}

function supabase() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

// Uses TOKEN_ID in the same tokens table as Schwab (id=1). Sandbox uses id=3.
export async function readTokens(): Promise<TokenSet | null> {
  const { data, error } = await supabase()
    .from("tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("id", TOKEN_ID)
    .single();
  if (error || !data) return null;
  return {
    sessionToken: data.access_token,
    rememberMeToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
}

export async function writeTokens(tokens: TokenSet): Promise<void> {
  await supabase().from("tokens").upsert({
    id: TOKEN_ID,
    access_token: tokens.sessionToken,
    refresh_token: tokens.rememberMeToken,
    expires_at: tokens.expiresAt,
  });
}

export async function clearTokens(): Promise<void> {
  await supabase().from("tokens").delete().eq("id", TOKEN_ID);
}

export function isExpired(tokens: TokenSet): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}
