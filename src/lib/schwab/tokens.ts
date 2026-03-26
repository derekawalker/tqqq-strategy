import { createClient } from "@supabase/supabase-js";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

function supabase() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

export async function readTokens(): Promise<TokenSet | null> {
  const { data, error } = await supabase()
    .from("tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("id", 1)
    .single();
  if (error || !data) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
}

export async function writeTokens(tokens: TokenSet): Promise<void> {
  await supabase().from("tokens").upsert({
    id: 1,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt,
  });
}

export async function clearTokens(): Promise<void> {
  await supabase().from("tokens").delete().eq("id", 1);
}

export function isExpired(tokens: TokenSet): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}
