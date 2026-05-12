/**
 * Run with: npx tsx scripts/backtest-signals.ts
 *
 * Pulls 5y of daily history for the symbols below, computes each signal
 * historically, and writes per-bin forward-5d QQQ-return stats to
 * src/data/signal-stats.json. Re-run monthly or whenever signals change.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YEARS = 5;
const FORWARD_DAYS = 5;
const MIN_SAMPLES_PER_BIN = 30;

type Series = { date: Date; close: number }[];

async function fetchDaily(symbol: string, years: number): Promise<Series> {
  const period1 = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000 - 365 * 24 * 60 * 60 * 1000);
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return result.quotes
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: q.date as Date, close: q.close as number }));
}

function alignByDate(series: Record<string, Series>): { date: Date; values: Record<string, number> }[] {
  const dateSets = Object.values(series).map((s) => new Set(s.map((d) => d.date.toDateString())));
  const common = [...dateSets[0]].filter((d) => dateSets.every((set) => set.has(d)));
  const commonSet = new Set(common);
  const maps = Object.fromEntries(
    Object.entries(series).map(([k, s]) => [k, new Map(s.map((d) => [d.date.toDateString(), d.close]))])
  );
  const dates = series[Object.keys(series)[0]]
    .filter((d) => commonSet.has(d.date.toDateString()))
    .map((d) => d.date);
  return dates.map((date) => {
    const key = date.toDateString();
    const values: Record<string, number> = {};
    for (const sym of Object.keys(series)) values[sym] = maps[sym].get(key) as number;
    return { date, values };
  });
}

function sma(closes: number[], period: number, idx: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += closes[i];
  return sum / period;
}

// Solve β = (XᵀX)⁻¹ Xᵀy via Gauss-Jordan on the augmented normal equations.
function solveOLS(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const b: number[] = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r] += X[i][r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += X[i][r] * X[i][c];
    }
  }
  // Augment and reduce
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error(`OLS: singular matrix at col ${col}`);
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = 0; c <= k; c++) M[col][c] /= div;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = 0; c <= k; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[k]);
}

function stdev(xs: number[]) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

// ── bin definitions ────────────────────────────────────────────────────────

type BinDef = { label: string; min: number; max: number };

const BIN_DEFS = {
  vixTerm: [
    { label: "<0.90 (deep contango)",  min: -Infinity, max: 0.90 },
    { label: "0.90 – 0.95",            min: 0.90,      max: 0.95 },
    { label: "0.95 – 1.00",            min: 0.95,      max: 1.00 },
    { label: "1.00 – 1.05",            min: 1.00,      max: 1.05 },
    { label: ">1.05 (backwardation)",  min: 1.05,      max: Infinity },
  ],
  vixSpike: [
    { label: "<-10%",        min: -Infinity, max: -10 },
    { label: "-10% – 0%",    min: -10,       max: 0 },
    { label: "0% – 5%",      min: 0,         max: 5 },
    { label: "5% – 15%",     min: 5,         max: 15 },
    { label: ">15% (spike)", min: 15,        max: Infinity },
  ],
  pctAbove200ma: [
    { label: "<-3% (below MA)",      min: -Infinity, max: -3 },
    { label: "-3% – 0%",             min: -3,        max: 0 },
    { label: "0% – 5% (just above)", min: 0,         max: 5 },
    { label: "5% – 10%",             min: 5,         max: 10 },
    { label: ">10% (extended)",      min: 10,        max: Infinity },
  ],
  realizedVol20Pct: [
    { label: "<15 (very calm)",      min: 0,   max: 15 },
    { label: "15 – 40",              min: 15,  max: 40 },
    { label: "40 – 70 (typical)",    min: 40,  max: 70 },
    { label: "70 – 90",              min: 70,  max: 90 },
    { label: ">90 (very high)",      min: 90,  max: 100.0001 },
  ],
  // 20-day change in 10y yield (in percentage points). Rising rates = headwind for QQQ.
  tnxMom20: [
    { label: "<-0.30 (rates falling fast)", min: -Infinity, max: -0.30 },
    { label: "-0.30 – -0.10",              min: -0.30,     max: -0.10 },
    { label: "-0.10 – +0.10 (flat)",       min: -0.10,     max:  0.10 },
    { label: "+0.10 – +0.30",              min:  0.10,     max:  0.30 },
    { label: ">+0.30 (rates rising fast)", min:  0.30,     max: Infinity },
  ],
  // QQQ 1-day return. Testing mean-reversion hypothesis: big down days → bounce.
  qqq1dRet: [
    { label: "<-2% (big down)",       min: -Infinity, max: -2.0 },
    { label: "-2% – -0.5% (down)",    min: -2.0,      max: -0.5 },
    { label: "-0.5% – +0.5% (flat)",  min: -0.5,      max:  0.5 },
    { label: "+0.5% – +2% (up)",      min:  0.5,      max:  2.0 },
    { label: ">+2% (big up)",         min:  2.0,      max: Infinity },
  ],
  // CBOE SKEW Index. Low SKEW = complacency (bearish); 130-140 = moderate hedging (bullish sweet spot).
  skewLevel: [
    { label: "<130 (complacent)",          min: -Infinity, max: 130 },
    { label: "130 – 140 (moderate hedge)", min: 130,       max: 140 },
    { label: "140 – 150",                  min: 140,       max: 150 },
    { label: ">150 (heavy protection)",    min: 150,       max: Infinity },
  ],
} satisfies Record<string, BinDef[]>;

type SignalKey = keyof typeof BIN_DEFS;

function findBin(defs: readonly BinDef[], value: number): string | null {
  for (const def of defs) {
    if (value >= def.min && value < def.max) return def.label;
    if (def.min === def.max && value === def.min) return def.label;
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching ${YEARS}y of daily history...`);
  const [qqq, vix, vix3m, tnx, skew] = await Promise.all([
    fetchDaily("QQQ",   YEARS),
    fetchDaily("^VIX",  YEARS),
    fetchDaily("^VIX3M", YEARS),
    fetchDaily("^TNX",  YEARS),
    fetchDaily("^SKEW", YEARS),
  ]);

  console.log(`QQQ: ${qqq.length} days, VIX: ${vix.length}, VIX3M: ${vix3m.length}, TNX: ${tnx.length}, SKEW: ${skew.length}`);

  // Align without SKEW so missing SKEW dates don't drop rows
  const aligned = alignByDate({ QQQ: qqq, VIX: vix, VIX3M: vix3m, TNX: tnx });
  const skewMap = new Map(skew.map((d) => [d.date.toDateString(), d.close]));
  console.log(`Aligned dataset: ${aligned.length} common trading days`);

  const qqqCloses = aligned.map((d) => d.values.QQQ);
  const vixCloses = aligned.map((d) => d.values.VIX);
  const vix3mCloses = aligned.map((d) => d.values.VIX3M);
  const tnxCloses = aligned.map((d) => d.values.TNX);

  // Pre-compute 20d realized vol (annualized %) for percentile feature
  const realizedVol20: (number | null)[] = qqqCloses.map((_, i) => {
    if (i < 20) return null;
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) rets.push((qqqCloses[j] - qqqCloses[j - 1]) / qqqCloses[j - 1]);
    return stdev(rets) * Math.sqrt(252) * 100;
  });

  // Per-day samples: which bin each signal was in, and the realized forward return.
  // After bin averages are computed, we'll convert these to bin-edge feature vectors
  // and fit a linear regression to predict realized 5d return.
  const samples: { bins: Partial<Record<SignalKey, string>>; forwardRet: number }[] = [];

  // Bin-keyed stats
  const stats: Record<SignalKey, Record<string, { count: number; sumReturn: number; up: number; down: number }>> = {
    vixTerm: {},
    vixSpike: {},
    qqq1dRet: {},
    pctAbove200ma: {},
    realizedVol20Pct: {},
    tnxMom20: {},
    skewLevel: {},
  };

  for (const sk of Object.keys(BIN_DEFS) as SignalKey[]) {
    for (const def of BIN_DEFS[sk]) {
      stats[sk][def.label] = { count: 0, sumReturn: 0, up: 0, down: 0 };
    }
  }

  // Need 252d for vol percentile + 200d MA, and 5 days forward.
  const start = 252;
  const end = aligned.length - FORWARD_DAYS;

  for (let i = start; i < end; i++) {
    const forwardRet = ((qqqCloses[i + FORWARD_DAYS] - qqqCloses[i]) / qqqCloses[i]) * 100;

    // Signal values
    const vixTerm = vixCloses[i] / vix3mCloses[i];
    const vixSpike = ((vixCloses[i] - vixCloses[i - 1]) / vixCloses[i - 1]) * 100;
    const qqq1dRet = ((qqqCloses[i] - qqqCloses[i - 1]) / qqqCloses[i - 1]) * 100;
    const ma200 = sma(qqqCloses, 200, i);
    const pctAbove = ma200 != null ? ((qqqCloses[i] / ma200) - 1) * 100 : null;

    // 20d realized vol percentile vs trailing 252d
    let rvPct: number | null = null;
    const curRv = realizedVol20[i];
    if (curRv != null) {
      const window: number[] = [];
      for (let j = i - 251; j <= i; j++) {
        const v = realizedVol20[j];
        if (v != null) window.push(v);
      }
      if (window.length > 50) {
        const sorted = [...window].sort((a, b) => a - b);
        const rank = sorted.filter((x) => x <= curRv).length;
        rvPct = (rank / sorted.length) * 100;
      }
    }

    const daySample: { bins: Partial<Record<SignalKey, string>>; forwardRet: number } = {
      bins: {},
      forwardRet,
    };
    samples.push(daySample);

    const record = (sk: SignalKey, binLabel: string | null) => {
      if (binLabel == null) return;
      const b = stats[sk][binLabel];
      b.count++;
      b.sumReturn += forwardRet;
      if (forwardRet > 0) b.up++;
      else b.down++;
      daySample.bins[sk] = binLabel;
    };

    record("vixTerm", findBin(BIN_DEFS.vixTerm, vixTerm));
    record("vixSpike", findBin(BIN_DEFS.vixSpike, vixSpike));
    record("qqq1dRet", findBin(BIN_DEFS.qqq1dRet, qqq1dRet));
    if (pctAbove != null) record("pctAbove200ma", findBin(BIN_DEFS.pctAbove200ma, pctAbove));
    if (rvPct != null) record("realizedVol20Pct", findBin(BIN_DEFS.realizedVol20Pct, rvPct));
    if (i >= 20) {
      const tnxMom = tnxCloses[i] - tnxCloses[i - 20];
      record("tnxMom20", findBin(BIN_DEFS.tnxMom20, tnxMom));
    }
    const skewVal = skewMap.get(aligned[i].date.toDateString());
    if (skewVal != null) record("skewLevel", findBin(BIN_DEFS.skewLevel, skewVal));
  }

  // Compute final stats per bin
  const output: Record<SignalKey, { label: string; count: number; avgReturn5d: number; hitRateUp: number; lowConfidence: boolean }[]> = {
    vixTerm: [], vixSpike: [], qqq1dRet: [], pctAbove200ma: [], realizedVol20Pct: [], tnxMom20: [], skewLevel: [],
  };

  const baselineRet = (() => {
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i++) {
      sum += ((qqqCloses[i + FORWARD_DAYS] - qqqCloses[i]) / qqqCloses[i]) * 100;
      n++;
    }
    return { avg: sum / n, n };
  })();

  console.log(`\nBaseline: QQQ avg 5d return = ${baselineRet.avg.toFixed(3)}% over ${baselineRet.n} samples\n`);

  for (const sk of Object.keys(stats) as SignalKey[]) {
    console.log(`── ${sk} ──`);
    for (const def of BIN_DEFS[sk]) {
      const b = stats[sk][def.label];
      const avg = b.count > 0 ? b.sumReturn / b.count : 0;
      const hitRate = b.count > 0 ? (b.up / b.count) * 100 : 0;
      const lowConfidence = b.count < MIN_SAMPLES_PER_BIN;
      output[sk].push({
        label: def.label,
        count: b.count,
        avgReturn5d: Math.round(avg * 1000) / 1000,
        hitRateUp: Math.round(hitRate * 10) / 10,
        lowConfidence,
      });
      console.log(
        `  ${def.label.padEnd(40)} n=${String(b.count).padStart(4)}  avg5d=${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%  up=${hitRate.toFixed(0)}%${lowConfidence ? "  [LOW N]" : ""}`
      );
    }
    console.log("");
  }

  // ── magnitude model: OLS regression of bin-edges → realized 5d return ────
  // For each sample, the feature for signal k is (binAvg_k - baseline) — the
  // per-bin "edge." Days where a signal's bin was missing get edge = 0.
  // Note: bin averages are computed from the same data, so this is in-sample
  // fit — useful as a starting point, but real-world accuracy must be judged
  // by the prospective track-record on the dashboard.
  const FEATURE_SIGNALS: SignalKey[] = [
    "vixTerm", "vixSpike", "qqq1dRet", "pctAbove200ma", "realizedVol20Pct", "tnxMom20", "skewLevel",
  ];
  const binAvg = new Map<string, number>();  // `${signal}::${binLabel}` → avgReturn5d
  for (const sk of FEATURE_SIGNALS) {
    for (const row of output[sk]) {
      binAvg.set(`${sk}::${row.label}`, row.avgReturn5d);
    }
  }
  const edgeFor = (sk: SignalKey, binLabel: string | undefined): number => {
    if (!binLabel) return 0;
    const avg = binAvg.get(`${sk}::${binLabel}`);
    if (avg == null) return 0;
    return avg - baselineRet.avg;
  };

  const X: number[][] = [];  // rows of [1, edge_1, …, edge_9]
  const y: number[] = [];
  for (const s of samples) {
    const row = [1];
    for (const sk of FEATURE_SIGNALS) row.push(edgeFor(sk, s.bins[sk]));
    X.push(row);
    y.push(s.forwardRet);
  }

  const coefVec = solveOLS(X, y);  // length 10: intercept + 9 coefs
  const yPred = X.map((row) => row.reduce((s, x, i) => s + x * coefVec[i], 0));
  const residuals = y.map((yi, i) => yi - yPred[i]);
  const mae = residuals.reduce((s, r) => s + Math.abs(r), 0) / residuals.length;
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const r2 = 1 - ssRes / ssTot;
  // Pearson(yPred, y) = sqrt(R²) only when intercept is fit, but compute directly:
  const yPredMean = yPred.reduce((s, v) => s + v, 0) / yPred.length;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < y.length; i++) {
    const dx = yPred[i] - yPredMean;
    const dy = y[i] - yMean;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const pearson = num / Math.sqrt(dx2 * dy2);

  const coefficients: Record<string, number> = {};
  FEATURE_SIGNALS.forEach((sk, i) => {
    coefficients[sk] = Math.round(coefVec[i + 1] * 10000) / 10000;
  });

  console.log("── Magnitude model (OLS on bin-edges → realized 5d %) ──");
  console.log(`  intercept: ${coefVec[0].toFixed(4)}`);
  FEATURE_SIGNALS.forEach((sk, i) => {
    console.log(`  ${sk.padEnd(18)} coef=${coefVec[i + 1] >= 0 ? "+" : ""}${coefVec[i + 1].toFixed(4)}`);
  });
  console.log(`  n=${y.length}  MAE=${mae.toFixed(3)}%  RMSE=${rmse.toFixed(3)}%  R²=${r2.toFixed(4)}  pearson=${pearson.toFixed(4)}\n`);

  // Ablation: refit dropping one signal at a time
  console.log("── Ablation (drop one signal, refit) ──");
  console.log(`  Full model:        MAE=${mae.toFixed(3)}%  R²=${r2.toFixed(4)}`);
  for (const drop of FEATURE_SIGNALS) {
    const kept = FEATURE_SIGNALS.filter((s) => s !== drop);
    const Xa = samples.map((s) => [1, ...kept.map((sk) => edgeFor(sk, s.bins[sk]))]);
    const beta = solveOLS(Xa, y);
    const yhat = Xa.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0));
    const res = y.map((yi, i) => yi - yhat[i]);
    const maeA = res.reduce((s, r) => s + Math.abs(r), 0) / res.length;
    const ssResA = res.reduce((s, r) => s + r * r, 0);
    const r2A = 1 - ssResA / ssTot;
    const dMae = maeA - mae;
    const dR2 = r2A - r2;
    console.log(
      `  − ${drop.padEnd(18)} MAE=${maeA.toFixed(3)}% (${dMae >= 0 ? "+" : ""}${dMae.toFixed(4)})  R²=${r2A.toFixed(4)} (${dR2 >= 0 ? "+" : ""}${dR2.toFixed(4)})`,
    );
  }
  console.log("");

  const magnitudeModel = {
    intercept: Math.round(coefVec[0] * 10000) / 10000,
    coefficients,
    featureSignals: FEATURE_SIGNALS,
    trainN: y.length,
    mae: Math.round(mae * 1000) / 1000,
    rmse: Math.round(rmse * 1000) / 1000,
    r2: Math.round(r2 * 10000) / 10000,
    pearson: Math.round(pearson * 10000) / 10000,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    yearsHistory: YEARS,
    forwardDays: FORWARD_DAYS,
    minSamplesPerBin: MIN_SAMPLES_PER_BIN,
    totalSamples: baselineRet.n,
    baselineAvgReturn5d: Math.round(baselineRet.avg * 1000) / 1000,
    signals: output,
    magnitudeModel,
  };

  const outPath = resolve(process.cwd(), "src/data/signal-stats.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
