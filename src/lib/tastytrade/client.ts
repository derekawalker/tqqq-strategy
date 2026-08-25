import { BASE_URL, USER_AGENT, getTastytradeConfig } from "./config";
import { singleFlight } from "@/lib/singleFlight";

// Fallback only — the real lifetime comes from expires_in in the token response,
// which tastytrade currently sets to 15 minutes. Never assume longer than the API
// says: an over-long guess leaves us serving a token the server already killed.
const ACCESS_TTL_MS = 15 * 60 * 1000;

// Refresh this far before the stated expiry so a request never races the boundary.
const EXPIRY_MARGIN_MS = 60_000;

export class TastytradeAuthError extends Error {
  constructor(status: number, body: string) {
    super(
      `tastytrade OAuth token request failed (${status}): ${body.slice(0, 300)}\n` +
        `Most common cause: the refresh token was revoked or regenerated. Create a new ` +
        `personal grant at tastytrade.com → OAuth Applications → Manage → Create Grant.`,
    );
    this.name = "TastytradeAuthError";
  }
}

interface AccessToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

/**
 * Read a token response into an AccessToken.
 * Exported for tests.
 */
export function tokenFromPayload(data: Record<string, unknown> | undefined): AccessToken {
  const accessToken = data?.["access_token"];
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(`Token response missing access_token. Keys: ${Object.keys(data ?? {}).join(", ")}`);
  }
  const expiresIn = data["expires_in"];
  const lifetimeMs = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn * 1000 : ACCESS_TTL_MS;
  return { accessToken, expiresAt: Date.now() + lifetimeMs };
}

/**
 * Exchange the stored refresh token for an access token.
 *
 * There is no interactive redirect: this is a personal grant, created once in the
 * tastytrade web UI, and the refresh token lives in the environment rather than in
 * the database. Nothing here is rotated, so there is no stored state to keep in sync.
 */
async function requestAccessToken(): Promise<AccessToken> {
  const { clientSecret, refreshToken } = getTastytradeConfig();
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new TastytradeAuthError(res.status, await res.text());
  return tokenFromPayload(await res.json());
}

let cachedToken: AccessToken | null = null;

// Coalesce concurrent refreshes: the data routes fan out ~7 authenticated fetches per
// account in parallel, any of which can cross the expiry boundary at the same moment.
const requestAccessTokenOnce = singleFlight(requestAccessToken);

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_MARGIN_MS) {
    return cachedToken.accessToken;
  }
  cachedToken = await requestAccessTokenOnce();
  return cachedToken.accessToken;
}

/** Forces the next call to mint a fresh access token. */
export function clearTokenCache(): void {
  cachedToken = null;
}

/** Discard the cached token and mint a fresh one, whatever the stored expiry claims. */
async function forceNewToken(): Promise<string> {
  clearTokenCache();
  return getAccessToken();
}

function authedFetch(path: string, init: RequestInit | undefined, token: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
  });
}

/** Fetch against the tastytrade API, re-authenticating once if the token is dead. */
export async function tastyFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await authedFetch(path, init, await getAccessToken());
  // A 401 means the server killed the token before its stated expiry. Retry once
  // with a fresh one — but only when the body is safe to re-send.
  if (res.status !== 401) return res;
  const body = init?.body;
  if (body != null && typeof body !== "string") return res;
  return authedFetch(path, init, await forceNewToken());
}
