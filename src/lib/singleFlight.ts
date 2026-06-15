/**
 * Coalesces concurrent calls so only one underlying invocation runs at a time.
 *
 * While a call is in flight, every other caller receives the same promise instead
 * of starting its own run. Once it settles, the next call starts fresh.
 *
 * Used to guard token refresh: brokerage refresh/remember-me tokens are single-use
 * and rotate on every use, so two parallel refreshes race and invalidate each other.
 * The data routes fan out ~7 authenticated fetches per account in parallel, any of
 * which can trigger a refresh, so coalescing is required for stable auth.
 *
 * The first caller's arguments win for the shared run; concurrent callers reading the
 * same stored token pass identical arguments, so this is safe in practice.
 */
export function singleFlight<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (...args: A) => {
    inFlight ??= fn(...args).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
