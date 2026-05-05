import { createClient } from "@supabase/supabase-js";

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

// Uses id=2 in the same tokens table as Schwab (id=1)
export async function readTokens(): Promise<TokenSet | null> {
  const { data, error } = await supabase()
    .from("tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("id", 2)
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
    id: 2,
    access_token: tokens.sessionToken,
    refresh_token: tokens.rememberMeToken,
    expires_at: tokens.expiresAt,
  });
}

export async function clearTokens(): Promise<void> {
  await supabase().from("tokens").delete().eq("id", 2);
}

export function isExpired(tokens: TokenSet): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}
