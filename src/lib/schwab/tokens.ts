import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

// One client per process. The data route reads tokens on every authenticated
// fetch, and building a fresh client each time is pure overhead.
let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  client ??= createClient(url, key);
  return client;
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
