import { readTokens, writeTokens, clearTokens, isExpired, TokenSet } from "./tokens";
import { BASE_URL, SANDBOX, SANDBOX_URL } from "./config";

export { SANDBOX };
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Live credentials — used for data fetching and MFA auth flow
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
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: process.env.TASTYTRADE_USERNAME!, "remember-me-token": rememberMeToken }),
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

// Live session cache
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

/** Fetch against the live tastytrade API. Always uses live credentials and token. */
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

// Sandbox OAuth2 token cache (in-memory; access tokens last 15 min)
let cachedSandboxToken: string | null = null;
let cachedSandboxExpiry = 0;

async function getSandboxSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedSandboxToken && now < cachedSandboxExpiry) return cachedSandboxToken;

  const clientSecret = process.env.TASTYTRADE_SANDBOX_CLIENT_SECRET;
  const refreshToken = process.env.TASTYTRADE_SANDBOX_REFRESH_TOKEN;
  if (!clientSecret || !refreshToken) {
    throw new Error("Sandbox OAuth not configured — set TASTYTRADE_SANDBOX_CLIENT_SECRET and TASTYTRADE_SANDBOX_REFRESH_TOKEN");
  }

  const res = await fetch(`${SANDBOX_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_secret: clientSecret, refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sandbox OAuth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const expiresIn: number = json.expires_in ?? 900;
  cachedSandboxToken = json.access_token;
  cachedSandboxExpiry = now + (expiresIn - 60) * 1000;
  return cachedSandboxToken!;
}

/**
 * Fetch used exclusively for order placement.
 * Routes to the sandbox API when sandbox=true (defaults to TASTYTRADE_SANDBOX env var).
 */
export async function tastyOrderFetch(path: string, init?: RequestInit, sandbox = SANDBOX): Promise<Response> {
  if (!sandbox) return tastyFetch(path, init);

  const token = await getSandboxSessionToken();
  return fetch(`${SANDBOX_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
      ...(init?.headers ?? {}),
    },
  });
}
