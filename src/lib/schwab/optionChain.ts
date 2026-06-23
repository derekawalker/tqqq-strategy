/**
 * Schwab option-chain fetch + parse.
 *
 * Pulls the live QQQ put chain so the hedge recommendations can size off *real*
 * marks and implied vol instead of the Black-Scholes model. The parser is pure
 * (feed it a raw Schwab `chains` response) so it's unit-testable without a live
 * connection; `getPutChain` is the authenticated wrapper.
 *
 * Schwab returns a `putExpDateMap` keyed by "YYYY-MM-DD:DTE" → strike →
 * [contract]. Each contract carries bid/ask/last/mark, `volatility` (annualized
 * IV in percent, or -999 when there's no quote), greeks, and open interest.
 */

import { schwabFetch } from "./client";

export interface OptionQuote {
  expiry: string; // YYYY-MM-DD
  daysToExp: number;
  strike: number;
  bid: number;
  ask: number;
  mark: number; // $ per share — best available of mark / mid / last
  iv: number | null; // annualized, as a decimal (0.22 = 22%); null when no quote
  delta: number | null;
  openInterest: number;
}

interface RawContract {
  strikePrice?: number;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
  volatility?: number; // percent, or -999
  delta?: number;
  openInterest?: number;
  daysToExpiration?: number;
}

interface RawChain {
  status?: string;
  putExpDateMap?: Record<string, Record<string, RawContract[]>>;
}

/** Best usable per-share price: mark, else bid/ask mid, else last. 0 if none. */
function resolveMark(c: RawContract): number {
  if (c.mark != null && c.mark > 0) return c.mark;
  if (c.bid != null && c.ask != null && c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2;
  if (c.last != null && c.last > 0) return c.last;
  return 0;
}

/** Parse a raw Schwab chains response into a flat, sorted list of put quotes. */
export function parsePutChain(raw: RawChain): OptionQuote[] {
  const out: OptionQuote[] = [];
  const map = raw.putExpDateMap ?? {};
  for (const [expKey, strikes] of Object.entries(map)) {
    const expiry = expKey.split(":")[0];
    for (const contracts of Object.values(strikes)) {
      for (const c of contracts) {
        if (c.strikePrice == null) continue;
        const vol = c.volatility;
        out.push({
          expiry,
          daysToExp: c.daysToExpiration ?? 0,
          strike: c.strikePrice,
          bid: c.bid ?? 0,
          ask: c.ask ?? 0,
          mark: resolveMark(c),
          iv: vol != null && vol > 0 ? vol / 100 : null,
          delta: c.delta != null && c.delta !== -999 ? c.delta : null,
          openInterest: c.openInterest ?? 0,
        });
      }
    }
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
}

/**
 * The most *liquid* expiry near `targetDte` — the one with the most total open
 * interest within ±`window` days. Monthlies (3rd Friday) usually win since OI
 * concentrates there, but this adapts if a weekly is ever deeper. Falls back to
 * the nearest-DTE expiry when nothing carries open interest in the window.
 */
export function pickLiquidExpiry(
  quotes: OptionQuote[],
  targetDte: number,
  window = 25,
): string | null {
  const byExp = new Map<string, { oi: number; dte: number }>();
  for (const q of quotes) {
    if (Math.abs(q.daysToExp - targetDte) > window) continue;
    const cur = byExp.get(q.expiry) ?? { oi: 0, dte: q.daysToExp };
    cur.oi += q.openInterest;
    byExp.set(q.expiry, cur);
  }
  let best: string | null = null;
  let bestOi = -1;
  let bestGap = Infinity;
  for (const [exp, { oi, dte }] of byExp) {
    const gap = Math.abs(dte - targetDte);
    if (oi > bestOi || (oi === bestOi && gap < bestGap)) {
      best = exp;
      bestOi = oi;
      bestGap = gap;
    }
  }
  // Nothing in window, or every candidate had zero OI → nearest DTE.
  return bestOi > 0 ? best : pickExpiry(quotes, targetDte);
}

/** The single expiry whose DTE is closest to `targetDte`. */
export function pickExpiry(quotes: OptionQuote[], targetDte: number): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  const seen = new Set<string>();
  for (const q of quotes) {
    if (seen.has(q.expiry)) continue;
    seen.add(q.expiry);
    const gap = Math.abs(q.daysToExp - targetDte);
    if (gap < bestGap) {
      bestGap = gap;
      best = q.expiry;
    }
  }
  return best;
}

/**
 * Nearest listed, quotable put to `targetStrike` within `expiry`. Skips strikes
 * with no usable mark so the recommendation never points at an unfillable contract.
 */
export function nearestStrike(
  quotes: OptionQuote[],
  expiry: string,
  targetStrike: number,
): OptionQuote | null {
  let best: OptionQuote | null = null;
  let bestGap = Infinity;
  for (const q of quotes) {
    if (q.expiry !== expiry || q.mark <= 0) continue;
    const gap = Math.abs(q.strike - targetStrike);
    if (gap < bestGap) {
      bestGap = gap;
      best = q;
    }
  }
  return best;
}

/**
 * Fetch OTM puts for `symbol` whose expiries bracket `targetDte` days out.
 * Returns parsed quotes, or throws if not authenticated / Schwab errors.
 */
export async function getPutChain(symbol: string, targetDte: number): Promise<OptionQuote[]> {
  const day = 86_400_000;
  const from = new Date(Date.now() + (targetDte - 25) * day).toISOString().slice(0, 10);
  const to = new Date(Date.now() + (targetDte + 35) * day).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    symbol,
    contractType: "PUT",
    strategy: "SINGLE",
    range: "OTM",
    fromDate: from,
    toDate: to,
  });
  const res = await schwabFetch(`/marketdata/v1/chains?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`chains ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const raw = (await res.json()) as RawChain;
  if (raw.status && raw.status !== "SUCCESS") {
    throw new Error(`chains status ${raw.status}`);
  }
  return parsePutChain(raw);
}
