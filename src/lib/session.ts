/**
 * Signed session tokens for the app password gate.
 *
 * The cookie used to be the raw APP_SESSION_SECRET, which meant it never expired
 * server-side and the secret travelled in every request. Instead we issue a token
 * of the form `<payload>.<sig>` where payload carries an issued-at and expiry, and
 * sig is an HMAC-SHA256 over the payload keyed by the secret. The secret never
 * leaves the server, expiry is enforced independently of the cookie's maxAge, and
 * verification is constant-time (crypto.subtle.verify).
 *
 * Uses Web Crypto so the same code runs in the Node proxy and the route handler.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

interface SessionPayload {
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Mint a signed session token valid for `ttlSeconds` from `now`. */
export async function createSessionToken(
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const nowSec = Math.floor(now / 1000);
  const payload: SessionPayload = { iat: nowSec, exp: nowSec + ttlSeconds };
  const payloadPart = toBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadPart));
  return `${payloadPart}.${toBase64Url(new Uint8Array(sig))}`;
}

/** True only when the token is well-formed, authentic for `secret`, and unexpired. */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = fromBase64Url(sigPart);
  } catch {
    return false;
  }

  const key = await importKey(secret);
  const authentic = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    enc.encode(payloadPart),
  );
  if (!authentic) return false;

  try {
    const payload = JSON.parse(dec.decode(fromBase64Url(payloadPart))) as SessionPayload;
    if (typeof payload.exp !== "number") return false;
    return Math.floor(now / 1000) < payload.exp;
  } catch {
    return false;
  }
}
