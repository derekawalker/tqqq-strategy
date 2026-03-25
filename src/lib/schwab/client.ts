import { readTokens, writeTokens, isExpired, TokenSet } from "./tokens";

const BASE_URL = "https://api.schwabapi.com";
const TOKEN_URL = `${BASE_URL}/v1/oauth/token`;

function basicAuth(): string {
  const id = process.env.SCHWAB_CLIENT_ID!;
  const secret = process.env.SCHWAB_CLIENT_SECRET!;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const redirectUri = process.env.SCHWAB_REDIRECT_URI!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const tokens: TokenSet = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  writeTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const tokens: TokenSet = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  writeTokens(tokens);
  return tokens;
}

/** Get a valid access token, refreshing if needed. Throws if not authenticated. */
export async function getAccessToken(): Promise<string> {
  let tokens = readTokens();
  if (!tokens) throw new Error("Not authenticated");

  if (isExpired(tokens)) {
    tokens = await refreshAccessToken(tokens.refreshToken);
  }

  return tokens.accessToken;
}

/** Make an authenticated request to the Schwab API. */
export async function schwabFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
