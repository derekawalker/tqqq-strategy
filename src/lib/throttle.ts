/**
 * Graded "buy throttle" for the TQQQ ladder — a finer replacement for the binary
 * circuit breaker. Instead of fully pausing only on a panic-velocity spike, it
 * scales how much new capital the ladder deploys as stress builds, and then flips
 * to FULL deployment once a capitulation bottom is confirmed (so you redeploy the
 * preserved dry powder into the rebound).
 *
 * Per-day buy rate (fraction of each touched lot to buy):
 *   - 1.0  normal: fragility calm — run the full ladder.
 *   - 0.5  caution: fragility ≥ halfZ — deploy at half size (delay using up powder).
 *   - 0.0  pause:   fragility ≥ pauseZ — stop adding into the falling knife.
 *   - 1.0  redeploy: a confirmed bottom (composite reached ≤ deepBuyZ AND price then
 *          turned back above its short MA) — deploy fully through the recovery until
 *          the composite normalizes back above resetZ.
 *
 * This is the deep-fear BUY logic from `tradeSignals` (validated to land within a
 * day of the actual low) reused as the throttle's re-arm trigger. Pure / no IO.
 */

import { sma, type AnomalyPoint } from "./anomaly";

// Deep-fear buy-trigger thresholds (formerly in backtest.ts).
const DEEP_BUY_Z = -5;
const DEEP_BUY_RESET = -1;
const DEEP_BUY_MA = 10;

export interface ThrottleParams {
  halfZ: number; // fragility z at/above which to deploy at half rate
  pauseZ: number; // fragility z at/above which to pause new buys entirely
  deepBuyZ: number; // composite z that arms the bottom redeploy
  maPeriod: number; // price-turn confirmation MA for the bottom
  resetZ: number; // composite back above this ends the redeploy
}

export const DEFAULT_THROTTLE: ThrottleParams = {
  halfZ: 1.5,
  pauseZ: 2.5,
  deepBuyZ: DEEP_BUY_Z,
  maPeriod: DEEP_BUY_MA,
  resetZ: DEEP_BUY_RESET,
};

/**
 * Buy-side posture for a day:
 *   - "full":     buy every touched dip level normally.
 *   - "slow":     half-size buys (fragility building) — preserve dry powder.
 *   - "pause":    stop new buys (fragility spike / falling knife).
 *   - "redeploy": a capitulation bottom was confirmed — resume/deploy aggressively
 *                 through the bounce until the composite normalizes.
 * You always KEEP your TQQQ; this only governs new buying.
 */
export type ThrottleMode = "full" | "slow" | "pause" | "redeploy";

export interface ThrottlePoint {
  mode: ThrottleMode;
  rate: number; // fraction of each touched lot to buy: 1 / 0.5 / 0
}

/** Per-day buy posture + rate, aligned to `points`. */
export function buyThrottle(points: AnomalyPoint[], p: ThrottleParams = DEFAULT_THROTTLE): ThrottlePoint[] {
  const spx = points.map((pt) => pt.spx);
  const out: ThrottlePoint[] = [];
  let state: "seek" | "await" | "redeploy" = "seek"; // deep-buy state machine

  for (let i = 0; i < points.length; i++) {
    const c = points[i].composite;
    if (state === "seek") {
      if (c != null && c <= p.deepBuyZ) state = "await";
    } else if (state === "await") {
      const ma = sma(spx, i, p.maPeriod);
      if (Number.isFinite(ma) && spx[i] > ma) state = "redeploy";
    } else if (c != null && c >= p.resetZ) {
      state = "seek";
    }

    let mode: ThrottleMode;
    if (state === "redeploy") {
      mode = "redeploy"; // bottom confirmed — deploy the preserved powder into the bounce
    } else {
      const f = points[i].fragility;
      mode = f == null ? "full" : f >= p.pauseZ ? "pause" : f >= p.halfZ ? "slow" : "full";
    }
    out.push({ mode, rate: mode === "pause" ? 0 : mode === "slow" ? 0.5 : 1 });
  }
  return out;
}

/** Just the per-day buy rates (for the ladder simulation). */
export function throttleRates(pts: ThrottlePoint[]): number[] {
  return pts.map((t) => t.rate);
}

/** Contiguous spans where the buy rate matched a predicate, for chart shading. */
export function throttleSpans(
  points: { date: string }[],
  rates: number[],
  pred: (rate: number) => boolean,
): { x1: string; x2: string }[] {
  const spans: { x1: string; x2: string }[] = [];
  let cur: { x1: string; x2: string } | null = null;
  for (let i = 0; i < points.length; i++) {
    if (pred(rates[i])) {
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
