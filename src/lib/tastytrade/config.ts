export const SANDBOX = process.env.TASTYTRADE_SANDBOX === "true";
export const LIVE_URL = "https://api.tastyworks.com";
export const SANDBOX_URL = "https://api.cert.tastyworks.com";

// Data fetching and the MFA auth flow always use the live account.
export const BASE_URL = LIVE_URL;
export const TOKEN_ID = 2;
