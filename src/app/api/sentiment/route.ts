/**
 * TQQQ Regime Dashboard — data endpoint.
 *
 * Fetches QQQ and ^VIX daily bars from Yahoo Finance, computes all signals,
 * scores them, and returns a single regime classification.
 *
 * Scoring:
 *   QQQ vs 200-day SMA  +2 / 0 / -2
 *   QQQ vs 50-day SMA   +1 / 0 / -1
 *   VIX trend (5-day slope)  +1 / 0 / -2
 *   Momentum (RSI-14)   +1 / 0 / -1
 *   Drawdown stress (20-day peak-to-trough)  0 / -1 / -2
 *
 *   +3 to +5 → Risk-On
 *    0 to +2 → Neutral
 *   < 0      → Risk-Off
 */

import { fetchYahooDaily } from "@/lib/yahoo";
import { sma } from "@/lib/strategySignals";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period && i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain += Math.max(delta, 0);
    avgLoss += Math.max(-delta, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const delta = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function slope5(arr: (number | null)[]): number | null {
  const vals = arr.slice(-5).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  return vals[vals.length - 1] - vals[0];
}

function maxDrawdown20(closes: number[]): number {
  const window = closes.slice(-20);
  if (window.length === 0) return 0;
  let peak = window[0];
  let maxDD = 0;
  for (const c of window) {
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD; // negative number, e.g. -0.08 = -8%
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const [qqqBars, vixBars] = await Promise.all([
      fetchYahooDaily("QQQ", 2),
      fetchYahooDaily("^VIX", 2),
    ]);

    if (qqqBars.length < 210) {
      return Response.json({ error: "Not enough QQQ history" }, { status: 502 });
    }

    const closes = qqqBars.map((b) => b.close);
    const dates = qqqBars.map((b) => b.date);
    const n = closes.length;

    const sma50vals = sma(closes, 50);
    const sma200vals = sma(closes, 200);
    const rsiVals = rsi(closes, 14);

    const latestClose = closes[n - 1];
    const latestDate = dates[n - 1];
    const latest50 = sma50vals[n - 1];
    const latest200 = sma200vals[n - 1];
    const latestRsi = rsiVals[n - 1];
    const dd20 = maxDrawdown20(closes);

    // 10-day return
    const return10d = n >= 11 ? (closes[n - 1] / closes[n - 11] - 1) : 0;

    // VIX
    const vixByDate = new Map(vixBars.map((b) => [b.date, b.close]));
    const latestVix = vixByDate.get(latestDate)
      ?? vixBars.at(-1)?.close
      ?? null;
    const vixCloses5 = vixBars.slice(-7).map((b): number | null => b.close);
    const vixSlope = slope5(vixCloses5);

    // Build historical chart data (last 252 trading days ≈ 1 year)
    const chartLen = Math.min(n, 252);
    const history = Array.from({ length: chartLen }, (_, k) => {
      const idx = n - chartLen + k;
      return {
        date: dates[idx],
        qqq: closes[idx],
        sma50: sma50vals[idx],
        sma200: sma200vals[idx],
        rsi: Math.round(rsiVals[idx] * 10) / 10,
        vix: vixByDate.get(dates[idx]) ?? null,
      };
    });

    // ---------------------------------------------------------------------------
    // Scoring  (max ≈ +7, min ≈ −12)
    // ---------------------------------------------------------------------------

    // 1. QQQ vs 200-day SMA  (-2 to +2, 5 tiers by % distance)
    let vs200Score = 0;
    if (latest200 != null) {
      const pct = latestClose / latest200 - 1;
      if (pct > 0.05) vs200Score = 2;
      else if (pct > 0.01) vs200Score = 1;
      else if (pct >= -0.01) vs200Score = 0;   // within ±1% — neutral zone
      else if (pct >= -0.05) vs200Score = -1;
      else vs200Score = -2;
    }

    // 2. QQQ vs 50-day SMA  (-2 to +2, 5 tiers by % distance)
    let vs50Score = 0;
    if (latest50 != null) {
      const pct = latestClose / latest50 - 1;
      if (pct > 0.05) vs50Score = 2;
      else if (pct > 0.01) vs50Score = 1;
      else if (pct >= -0.01) vs50Score = 0;    // within ±1% — neutral zone
      else if (pct >= -0.05) vs50Score = -1;
      else vs50Score = -2;
    }

    // 3. VIX level + 5-day slope  (-3 to +1, 5 tiers)
    let vixScore = 0;
    if (latestVix != null) {
      if (latestVix < 15) vixScore = 1;
      else if (latestVix < 20) vixScore = 0;
      else if (latestVix < 25) vixScore = -1;
      else if (latestVix < 35) vixScore = -2;
      else vixScore = -3;
    }
    // Rising VIX adds extra pressure regardless of level
    if (vixSlope != null && vixSlope > 2) vixScore = Math.min(vixScore, -1);

    // 4. RSI momentum  (-2 to +2, 5 tiers)
    let momentumScore = 0;
    if (latestRsi >= 55 && latestRsi <= 70) momentumScore = 2;
    else if ((latestRsi >= 45 && latestRsi < 55) || latestRsi > 70) momentumScore = 1;
    else if (latestRsi >= 35 && latestRsi < 45) momentumScore = 0;
    else if (latestRsi >= 30) momentumScore = -1;
    else momentumScore = -2;

    // 5. 20-day drawdown stress  (-3 to +1, 5 tiers)
    let stressScore = 0;
    if (dd20 <= -0.20) stressScore = -3;
    else if (dd20 <= -0.10) stressScore = -2;
    else if (dd20 <= -0.05) stressScore = -1;
    else if (dd20 > -0.01) stressScore = 1;   // near-flat: market is stable

    const totalScore = vs200Score + vs50Score + vixScore + momentumScore + stressScore;

    let regime: "Risk-On" | "Neutral" | "Risk-Off";
    let action: string;
    if (totalScore >= 4) {
      regime = "Risk-On";
      action = "Full TQQQ exposure OK. Add on dips (RSI < 40).";
    } else if (totalScore >= 0) {
      regime = "Neutral";
      action = "Reduce size 25–50%. Trade QQQ instead of TQQQ. No aggressive leverage adds.";
    } else {
      regime = "Risk-Off";
      action = "Exit TQQQ. Cash / SGOV / hedged exposure. No dip-buying.";
    }

    // Trend label
    let trendLabel: "Bull" | "Caution" | "Bear";
    if (latest200 != null && latest50 != null) {
      if (latestClose >= latest50 && latest50 >= latest200) trendLabel = "Bull";
      else if (latest50 >= latest200) trendLabel = "Caution";
      else trendLabel = "Bear";
    } else {
      trendLabel = "Caution";
    }

    return Response.json({
      asOf: latestDate,
      regime,
      score: totalScore,
      action,
      signals: {
        trend: {
          label: trendLabel,
          qqq: latestClose,
          sma50: latest50,
          sma200: latest200,
          vs50Score,
          vs200Score,
        },
        volatility: {
          vix: latestVix,
          vixSlope,
          score: vixScore,
          label: vixScore > 0 ? "Falling" : vixScore === 0 ? "Stable" : "Rising",
        },
        momentum: {
          rsi: Math.round(latestRsi * 10) / 10,
          return10d,
          score: momentumScore,
          label: momentumScore > 0 ? "Healthy" : momentumScore === 0 ? "Neutral" : "Stressed",
        },
        stress: {
          drawdown20: dd20,
          score: stressScore,
          label: stressScore === 0 ? "Low" : stressScore === -1 ? "Caution" : "High",
        },
      },
      history,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
