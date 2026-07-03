import { schwabFetch } from "./client";

/** Schwab's chains endpoint groups strikes under "date:daysToExpiration" keys. */
interface ExpDateMap {
  [dateKey: string]: {
    [strike: string]: unknown[];
  };
}

interface ChainsResponse {
  callExpDateMap?: ExpDateMap;
  putExpDateMap?: ExpDateMap;
}

/** Listed strikes for the expiration closest to `targetDte`, or [] if unavailable. */
export async function getListedStrikes(symbol: string, targetDte: number): Promise<number[]> {
  const p = new URLSearchParams({
    symbol,
    contractType: "ALL",
    strikeCount: "40",
    range: "ALL",
  });
  const res = await schwabFetch(`/marketdata/v1/chains?${p.toString()}`);
  if (!res.ok) {
    throw new Error(`chains ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data: ChainsResponse = await res.json();
  return strikesNearestExpiry(data, targetDte);
}

/** Pure — pick the expiry closest to targetDte and return its sorted, deduped strikes. */
export function strikesNearestExpiry(data: ChainsResponse, targetDte: number): number[] {
  const dateKeys = new Set([
    ...Object.keys(data.callExpDateMap ?? {}),
    ...Object.keys(data.putExpDateMap ?? {}),
  ]);
  if (dateKeys.size === 0) return [];

  let bestKey: string | null = null;
  let bestDiff = Infinity;
  for (const key of dateKeys) {
    const dte = Number(key.split(":")[1]);
    if (!Number.isFinite(dte)) continue;
    const diff = Math.abs(dte - targetDte);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }
  if (bestKey === null) return [];

  const strikes = new Set<number>();
  for (const map of [data.callExpDateMap?.[bestKey], data.putExpDateMap?.[bestKey]]) {
    for (const strike of Object.keys(map ?? {})) {
      const n = Number(strike);
      if (Number.isFinite(n)) strikes.add(n);
    }
  }
  return [...strikes].sort((a, b) => a - b);
}

/**
 * Cap on how far a strike may snap. The whole point is nudging a $0.50-grid
 * model strike onto a real $1 (or coarser) listing a fraction of a dollar
 * away — never folding it onto some unrelated strike. Without this cap, a
 * sparse or malformed chain response (e.g. only a couple of strikes came
 * back) would snap dozens of unrelated ladder rungs onto the same strike and
 * collapse them into one merged row.
 */
const MAX_SNAP_DISTANCE = 1;

/** Snap an ideal (model-grid) strike to the nearest listed strike within MAX_SNAP_DISTANCE, else return it unchanged. */
export function snapToListedStrike(ideal: number, listed: number[]): number {
  if (listed.length === 0) return ideal;
  let best = listed[0];
  let bestDiff = Math.abs(listed[0] - ideal);
  for (const s of listed) {
    const diff = Math.abs(s - ideal);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return bestDiff <= MAX_SNAP_DISTANCE ? best : ideal;
}
