/**
 * Quick-bear circuit breaker for the TQQQ ladder.
 *
 * The ladder profits from volatility in bull, sideways and slow-grind markets,
 * but gets hurt by a *quick descending bear* — a fast crash where it deploys
 * cash into a gap-down and ends up fully invested near the low with no dry powder.
 *
 * The fragility sub-index (VIX term-structure inversion + realized-vol spike +
 * bond vol) is exactly the "panic velocity" gauge that separates a quick crash
 * from a slow grind: quick bears (COVID, Aug-2024, Apr-2025) spike fragility to
 * ~4+, while the 2022 slow grind topped out near 2.3. So the breaker keys off
 * fragility, not the 200-day trend (which fires in slow grinds where the ladder
 * is busy making money).
 *
 * When the breaker is "tripped" the ladder should PAUSE BUYING (stop adding to
 * the falling knife, preserve dry powder) — not liquidate, since fragility marks
 * bottoms and selling there locks in losses. It re-arms (resumes buying) once
 * fragility calms, which historically is at/after the low.
 *
 * Pure / no IO.
 */

import type { AnomalyPoint } from "./anomaly";

export interface BreakerParams {
  /** Fragility z that trips the breaker (pause the ladder). */
  armZ: number;
  /** Fragility z it must fall back below to reset (hysteresis). */
  disarmZ: number;
}

export const DEFAULT_BREAKER: BreakerParams = {
  armZ: 3,
  disarmZ: 1.5,
};

/**
 * Per-day breaker state aligned to `points`: true = tripped (pause the ladder).
 * Hysteresis: trips at fragility ≥ armZ, resets only below disarmZ.
 */
export function circuitBreaker(points: AnomalyPoint[], p: BreakerParams = DEFAULT_BREAKER): boolean[] {
  const out: boolean[] = [];
  let tripped = false;
  for (const pt of points) {
    const f = pt.fragility;
    if (f != null) {
      if (!tripped && f >= p.armZ) tripped = true;
      else if (tripped && f < p.disarmZ) tripped = false;
    }
    out.push(tripped);
  }
  return out;
}

/** Contiguous [startDate, endDate] spans where the breaker was tripped. */
export function breakerSpans(points: AnomalyPoint[], state: boolean[]): { x1: string; x2: string }[] {
  const spans: { x1: string; x2: string }[] = [];
  let cur: { x1: string; x2: string } | null = null;
  for (let i = 0; i < points.length; i++) {
    if (state[i]) {
      if (cur) cur.x2 = points[i].date;
      else cur = { x1: points[i].date, x2: points[i].date };
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);
  return spans;
}
