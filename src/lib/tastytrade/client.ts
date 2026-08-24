import { readTokens, writeTokens, clearTokens, isExpired, TokenSet } from "./tokens";
import { BASE_URL } from "./config";
import { singleFlight } from "@/lib/singleFlight";

// Fallback only — the real lifetime comes from session-expiration in the response,
// which tastytrade currently sets about an hour out. Never assume longer than the
// API says: an over-long guess leaves us serving a token the server already killed.
const SESSION_TTL_MS = 60 * 60 * 1000;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LOGIN_BODY = () => ({
  login: process.env.TASTYTRADE_USERNAME!,
  password: process.env.TASTYTRADE_PASSWORD!,
  "remember-me": true,
  "client-domain": "tastyworks_customers",
});

/** POST /sessions. The browser User-Agent is required — without it the API 403s. */
function postSession(body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Read a session response into a TokenSet.
 * The remember token comes back as `remember-token`; `remember-me-token` is the
 * name in older docs and is accepted as a fallback.
 * Exported for tests.
 */
export function tokensFromSession(data: Record<string, unknown> | undefined): TokenSet {
  const sessionToken = data?.["session-token"];
  if (typeof sessionToken !== "string" || !sessionToken) {
    throw new Error(`Session response missing session-token. Keys: ${Object.keys(data ?? {}).join(", ")}`);
  }
  const rememberMeToken = data["remember-token"] ?? data["remember-me-token"] ?? "";
  const expiration = data["session-expiration"];
  const expiresAt = typeof expiration === "string" ? Date.parse(expiration) : NaN;
  return {
    sessionToken,
    rememberMeToken: typeof rememberMeToken === "string" ? rememberMeToken : "",
    expiresAt: Number.isNaN(expiresAt) ? Date.now() + SESSION_TTL_MS : expiresAt,
  };
}

async function storeSession(res: Response): Promise<TokenSet> {
  const json = await res.json();
  const tokens = tokensFromSession(json.data);
  await writeTokens(tokens);
  invalidateSessionCache();
  return tokens;
}

/** Step 1: POST credentials. Returns a challenge token if 2FA was triggered, "" if not. */
export async function initiateMfaLogin(): Promise<string> {
  const res = await postSession(LOGIN_BODY());
  // The challenge token arrives in a header regardless of status.
  const challengeToken = res.headers.get("X-Tastyworks-Challenge-Token") ?? "";
  if (challengeToken) return challengeToken;
  if (res.ok) {
    await storeSession(res);
    return "";
  }
  throw new Error(`Login failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

/** Step 2: Submit the OTP + challenge token as headers to complete login. */
export async function completeMfaLogin(challengeToken: string, otp: string): Promise<void> {
  const res = await postSession(LOGIN_BODY(), {
    "X-Tastyworks-OTP": otp,
    "X-Tastyworks-Challenge-Token": challengeToken,
  });
  if (!res.ok) {
    throw new Error(`MFA failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  await storeSession(res);
}

/** Password login, used when there is no stored session at all. */
async function login(): Promise<TokenSet> {
  const res = await postSession(LOGIN_BODY());
  if (res.headers.get("X-Tastyworks-Challenge-Token")) {
    throw new Error("tastytrade sent an SMS code — click the TT button in the header to finish login");
  }
  if (!res.ok) {
    throw new Error(`tastytrade login failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return storeSession(res);
}

async function refreshSession(rememberMeToken: string): Promise<TokenSet> {
  if (!rememberMeToken) return login();
  const res = await postSession({
    login: process.env.TASTYTRADE_USERNAME!,
    "remember-token": rememberMeToken,
    "remember-me": true,
    "client-domain": "tastyworks_customers",
  });
  if (!res.ok) {
    // Remember token rejected — drop it so the next call falls back to a password login.
    await clearTokens();
    invalidateSessionCache();
    throw new Error("tastytrade session expired — reconnect via the TT button");
  }
  return storeSession(res);
}

let cachedSessionToken: string | null = null;
let cachedSessionExpiry = 0;

// Coalesce concurrent refreshes: the remember token rotates on use, so parallel
// refreshes triggered by the fan-out of data fetches would race and invalidate each other.
const refreshSessionOnce = singleFlight(refreshSession);

export async function getSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedSessionToken && now < cachedSessionExpiry) return cachedSessionToken;

  let tokens = await readTokens();
  if (!tokens) tokens = await login();
  else if (isExpired(tokens)) tokens = await refreshSessionOnce(tokens.rememberMeToken);

  cachedSessionToken = tokens.sessionToken;
  cachedSessionExpiry = tokens.expiresAt - 60_000;
  return cachedSessionToken;
}

/** Call after writing new tokens (MFA login, refresh) to keep the cache in sync. */
export function invalidateSessionCache(): void {
  cachedSessionToken = null;
  cachedSessionExpiry = 0;
}

/** Discard the cached session and mint a fresh one, whatever the stored expiry claims. */
async function forceNewSession(): Promise<string> {
  invalidateSessionCache();
  const tokens = await readTokens();
  const fresh = await refreshSessionOnce(tokens?.rememberMeToken ?? "");
  cachedSessionToken = fresh.sessionToken;
  cachedSessionExpiry = fresh.expiresAt - 60_000;
  return fresh.sessionToken;
}

function authedFetch(path: string, init: RequestInit | undefined, token: string): Promise<Response> {
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

/** Fetch against the tastytrade API, re-authenticating once if the session is dead. */
export async function tastyFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await authedFetch(path, init, await getSessionToken());
  // A 401 means the server killed the session before its stated expiry. Retry once
  // with a fresh one — but only when the body is safe to re-send.
  if (res.status !== 401) return res;
  const body = init?.body;
  if (body != null && typeof body !== "string") return res;
  return authedFetch(path, init, await forceNewSession());
}
