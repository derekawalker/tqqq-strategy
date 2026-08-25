export const BASE_URL = "https://api.tastyworks.com";

// tastytrade rejects requests without a `<product>/<version>` User-Agent.
export const USER_AGENT = process.env.TASTYTRADE_USER_AGENT || "tqqq-strategy/1.0";

export interface TastytradeConfig {
  clientSecret: string;
  refreshToken: string;
}

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(
      `tastytrade credentials are not configured. Missing: ${missing.join(", ")}. ` +
        `Create an OAuth application at tastytrade.com → Manage → My Profile → API, ` +
        `with the "read" and "trade" scopes, then create a personal grant to obtain a refresh token.`,
    );
    this.name = "MissingCredentialsError";
  }
}

/** True when OAuth credentials exist, without throwing — used by the route guards. */
export function hasTastytradeCredentials(): boolean {
  return Boolean(process.env.TASTYTRADE_CLIENT_SECRET && process.env.TASTYTRADE_REFRESH_TOKEN);
}

export function getTastytradeConfig(): TastytradeConfig {
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET ?? "";
  const refreshToken = process.env.TASTYTRADE_REFRESH_TOKEN ?? "";
  const missing: string[] = [];
  if (!clientSecret) missing.push("TASTYTRADE_CLIENT_SECRET");
  if (!refreshToken) missing.push("TASTYTRADE_REFRESH_TOKEN");
  if (missing.length) throw new MissingCredentialsError(missing);
  return { clientSecret, refreshToken };
}
