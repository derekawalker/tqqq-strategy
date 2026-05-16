// Verdict logic for the sentiment page (DCA / SKIP / CATCH UP).
// Shared so the live card and the historical accuracy panel use identical rules.

export type Verdict = "dca" | "skip" | "catchup";

export interface VerdictInputs {
  rsi14: number | null;
  vixLevel: number | null;       // unused in bottom indicators but exposed for future use
  vix1dChange: number | null;    // unused — kept for type compat
  qqq5dRet: number | null;
  daysSinceHigh: number | null;  // unused — kept for type compat
  vixTerm: number | null;
  realizedVol20d: number | null; // used by PAUSE
  tnxMom20d: number | null;      // used by PAUSE
}

export interface BottomIndicator {
  label: string;
  hit: boolean;
  detail: string;
  hint: string;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// Only three indicators kept: tested 1000 days, each one beats baseline
// bounce rate by a meaningful margin. The three indicators we dropped
// (VIX>25, VIX 1d spike, days-since-high) had essentially zero or
// negative lift over baseline.
export function computeBottomIndicators(inputs: VerdictInputs): BottomIndicator[] {
  const { rsi14, qqq5dRet, vixTerm } = inputs;
  return [
    {
      label: "5-day drawdown",
      hit: qqq5dRet != null && qqq5dRet < -4,
      detail: qqq5dRet != null ? fmtPct(qqq5dRet) : "—",
      hint: "More than 4% decline over the last week — capitulation territory. Strongest individual bounce signal (+9pts over baseline).",
    },
    {
      label: "VIX backwardation",
      hit: vixTerm != null && vixTerm > 1,
      detail: vixTerm != null ? vixTerm.toFixed(2) : "—",
      hint: "Front VIX > VIX3M = acute near-term fear, often near short-term bottoms.",
    },
    {
      label: "RSI(14) oversold",
      hit: rsi14 != null && rsi14 < 35,
      detail: rsi14 != null ? rsi14.toFixed(1) : "—",
      hint: "RSI below 35 suggests momentum exhaustion to the downside.",
    },
  ];
}

export function countBottomHits(inputs: VerdictInputs): number {
  return computeBottomIndicators(inputs).filter((i) => i.hit).length;
}

// Returns "tomorrow", "Monday", "Tuesday", etc. based on how far predictionDate is.
function nextTradingDayLabel(predictionDate: string | null): string {
  if (!predictionDate) return "tomorrow";
  const today = new Date();
  const pred = new Date(predictionDate + "T12:00:00Z");
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const predUTC = pred.getTime();
  const diffDays = Math.round((predUTC - todayUTC) / 86_400_000);
  if (diffDays <= 1) return "tomorrow";
  return pred.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export function computeVerdict(
  predictedRet: number,
  bottomHits: number,
  predictionDate?: string | null,
  qqq5dRet?: number | null,
  realizedVol20d?: number | null,
  tnxMom20d?: number | null,
): { verdict: Verdict; reason: string } {
  const dayLabel = nextTradingDayLabel(predictionDate ?? null);

  // BOTTOM: 2 of 3 effective indicators (5d_drawdown, VIX backwardation, RSI<35).
  // Tested 1000 days: 66% bounce rate vs 54% baseline = +12pt lift.
  if (bottomHits >= 2) {
    return {
      verdict: "catchup",
      reason: `${bottomHits}/3 bottom indicators triggered — the bottom looks in. Resume buying.`,
    };
  }

  // PAUSE: stress-regime compound signal.
  // Tested 1000 days: 50% precision on drops > -0.5%, avg next-day return
  // -0.60%, fires ~23/yr. Beats the old OLS-magnitude PAUSE on every metric.
  // Skip if QQQ has already run +1.5% over 5 days (model loses signal then).
  const stressRegime =
    realizedVol20d != null && realizedVol20d >= 25 &&
    tnxMom20d != null && tnxMom20d >= 0;
  const bigRallyRecent = qqq5dRet != null && qqq5dRet > 1.5;
  if (predictedRet < 0 && stressRegime && !bigRallyRecent) {
    return {
      verdict: "skip",
      reason: `Model leans down (${fmtPct(predictedRet)} ${dayLabel}) with elevated vol and rising rates — pause buying.`,
    };
  }

  return {
    verdict: "dca",
    reason:
      predictedRet >= 0
        ? `Model predicts ${fmtPct(predictedRet)} ${dayLabel} — operate as usual.`
        : `Predicted ${fmtPct(predictedRet)} ${dayLabel} is within normal tolerance — operate as usual.`,
  };
}

// ── outcome scoring ────────────────────────────────────────────────────────────

export type VerdictOutcome = "right" | "wrong" | "neutral";

// Given a verdict and the realized next-day return (in %), classify whether
// the verdict was the right call. Thresholds are deliberately a bit wider
// than the verdict thresholds themselves so small wiggles don't punish calls.
export function scoreVerdict(
  verdict: Verdict,
  realizedRet: number,
): VerdictOutcome {
  switch (verdict) {
    case "dca":
      // Right unless there was a meaningful drop you should have skipped.
      if (realizedRet < -0.5) return "wrong";
      return "right";
    case "skip":
      // Right if the drop materialized. Wrong if it rallied instead.
      if (realizedRet < -0.2) return "right";
      if (realizedRet > 0.4) return "wrong";
      return "neutral";
    case "catchup":
      // Right if it bounced. Wrong if it kept dropping meaningfully.
      if (realizedRet > 0) return "right";
      if (realizedRet < -0.5) return "wrong";
      return "neutral";
  }
}
