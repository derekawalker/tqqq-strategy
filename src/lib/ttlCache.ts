/**
 * Minimal module-level TTL cache for expensive, slow-changing upstream responses.
 *
 * The brokerage data routes each scan a 365-day window of orders + transactions on every call, and
 * the client refetches them on mount, on tab focus, and on manual refresh. This collapses those
 * bursts: within a warm serverless instance, repeat requests inside the TTL reuse the last payload
 * instead of re-scanning a year of history upstream. Best-effort across cold starts, and this is a
 * single-user app, so a process-wide cache is safe.
 */
type Entry<T> = { at: number; data: T };

const store = new Map<string, Entry<unknown>>();

/** Returns the cached value if present and younger than ttlMs, else null. */
export function getCached<T>(key: string, ttlMs: number): T | null {
  const e = store.get(key);
  if (e && Date.now() - e.at < ttlMs) return e.data as T;
  return null;
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { at: Date.now(), data });
}
