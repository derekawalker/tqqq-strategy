import { readTokens, writeTokens, clearTokens, isExpired, TokenSet } from "./tokens";

const BASE_URL = "https://api.tastyworks.com";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LOGIN_BODY = () => ({
  login: process.env.TASTYTRADE_USERNAME!,
  password: process.env.TASTYTRADE_PASSWORD!,
  "remember-me": true,
  "client-domain": "tastyworks_customers",
});

/** Step 1: POST credentials, triggers SMS. Returns the challenge token for step 2. */
export async function initiateMfaLogin(): Promise<string> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify(LOGIN_BODY()),
  });
  // Grab challenge token from response headers regardless of status
  const challengeToken = res.headers.get("X-Tastyworks-Challenge-Token") ?? "";
  const text = await res.text();
  // If we got a challenge token, SMS was triggered — proceed to step 2
  if (challengeToken) return challengeToken;
  // Check for a direct session (no 2FA)
  if (res.ok) {
    const json = JSON.parse(text);
    const sessionToken: string | undefined = json.data?.["session-token"];
    if (sessionToken) {
      await writeTokens({
        sessionToken,
        rememberMeToken: json.data["remember-me-token"] ?? "",
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      return "";
    }
  }
  throw new Error(`Login failed (${res.status}): ${text.slice(0, 300)}`);
}

/** Step 2: Submit the SMS code + challenge token as headers to complete login. */
export async function completeMfaLogin(challengeToken: string, otp: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
      "X-Tastyworks-OTP": otp,
      "X-Tastyworks-Challenge-Token": challengeToken,
    },
    body: JSON.stringify(LOGIN_BODY()),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MFA failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  await writeTokens({
    sessionToken: json.data["session-token"],
    rememberMeToken: json.data["remember-me-token"],
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  invalidateSessionCache();
}

async function login(): Promise<TokenSet> {
  throw new Error("tastytrade requires one-time SMS setup — click the TT button in the header");
}

async function refreshSession(rememberMeToken: string): Promise<TokenSet> {
  const username = process.env.TASTYTRADE_USERNAME!;
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: username, "remember-me-token": rememberMeToken }),
  });
  if (!res.ok) {
    // Remember-me token rejected — clear stored tokens so UI shows disconnected
    await clearTokens();
    throw new Error("tastytrade session expired — reconnect via the TT button");
  }
  const json = await res.json();
  const tokens: TokenSet = {
    sessionToken: json.data["session-token"],
    rememberMeToken: json.data["remember-me-token"] ?? rememberMeToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await writeTokens(tokens);
  return tokens;
}

// Module-level token cache — avoids a Supabase read on every tastyFetch call
let cachedSessionToken: string | null = null;
let cachedSessionExpiry = 0;

export async function getSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedSessionToken && now < cachedSessionExpiry) return cachedSessionToken;

  let tokens = await readTokens();
  if (!tokens) tokens = await login();
  else if (isExpired(tokens)) tokens = await refreshSession(tokens.rememberMeToken);

  // Cache until 60s before the token expires
  cachedSessionToken = tokens.sessionToken;
  cachedSessionExpiry = tokens.expiresAt - 60_000;
  return cachedSessionToken;
}

/** Call after writing new tokens (MFA login, refresh) to keep the cache in sync. */
export function invalidateSessionCache(): void {
  cachedSessionToken = null;
  cachedSessionExpiry = 0;
}

export async function tastyFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getSessionToken();
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
      ...(init?.headers ?? {}),
    },
  });
}
