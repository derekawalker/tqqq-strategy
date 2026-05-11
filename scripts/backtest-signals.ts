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

function rsi(closes: number[], period: number, idx: number): number | null {
  if (idx < period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  gain /= period;
  loss /= period;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function sma(closes: number[], period: number, idx: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += closes[i];
  return sum / period;
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
  rsi2InTrend: [
    { label: "Uptrend, RSI(2) <10 (oversold)",  min: 0,   max: 10 },
    { label: "Uptrend, RSI(2) 10–90",           min: 10,  max: 90 },
    { label: "Uptrend, RSI(2) >90 (overbought)", min: 90, max: 100 },
    { label: "Downtrend (any RSI)",             min: -1,  max: -1 },
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
  hygSpyDiv: [
    { label: "<-1.5% (credit lagging)",  min: -Infinity, max: -1.5 },
    { label: "-1.5% – -0.5%",            min: -1.5,      max: -0.5 },
    { label: "-0.5% – 0.5%",             min: -0.5,      max: 0.5 },
    { label: "0.5% – 1.5%",              min: 0.5,       max: 1.5 },
    { label: ">1.5% (credit leading)",   min: 1.5,       max: Infinity },
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
  const [qqq, vix, vix3m, hyg, spy] = await Promise.all([
    fetchDaily("QQQ",   YEARS),
    fetchDaily("^VIX",  YEARS),
    fetchDaily("^VIX3M", YEARS),
    fetchDaily("HYG",   YEARS),
    fetchDaily("SPY",   YEARS),
  ]);

  console.log(`QQQ: ${qqq.length} days, VIX: ${vix.length}, VIX3M: ${vix3m.length}, HYG: ${hyg.length}, SPY: ${spy.length}`);

  const aligned = alignByDate({ QQQ: qqq, VIX: vix, VIX3M: vix3m, HYG: hyg, SPY: spy });
  console.log(`Aligned dataset: ${aligned.length} common trading days`);

  const qqqCloses = aligned.map((d) => d.values.QQQ);
  const vixCloses = aligned.map((d) => d.values.VIX);
  const vix3mCloses = aligned.map((d) => d.values.VIX3M);
  const hygCloses = aligned.map((d) => d.values.HYG);
  const spyCloses = aligned.map((d) => d.values.SPY);

  // Pre-compute 20d realized vol (annualized %) for percentile feature
  const realizedVol20: (number | null)[] = qqqCloses.map((_, i) => {
    if (i < 20) return null;
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) rets.push((qqqCloses[j] - qqqCloses[j - 1]) / qqqCloses[j - 1]);
    return stdev(rets) * Math.sqrt(252) * 100;
  });

  // Bin-keyed stats
  const stats: Record<SignalKey, Record<string, { count: number; sumReturn: number; up: number; down: number }>> = {
    vixTerm: {},
    vixSpike: {},
    rsi2InTrend: {},
    pctAbove200ma: {},
    realizedVol20Pct: {},
    hygSpyDiv: {},
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
    const ma200 = sma(qqqCloses, 200, i);
    const pctAbove = ma200 != null ? ((qqqCloses[i] / ma200) - 1) * 100 : null;
    const inUptrend = ma200 != null && qqqCloses[i] > ma200;
    const rsi2 = rsi(qqqCloses, 2, i);
    const hyg5d = ((hygCloses[i] - hygCloses[i - 5]) / hygCloses[i - 5]) * 100;
    const spy5d = ((spyCloses[i] - spyCloses[i - 5]) / spyCloses[i - 5]) * 100;
    const hygDiv = hyg5d - spy5d;

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

    const record = (sk: SignalKey, binLabel: string | null) => {
      if (binLabel == null) return;
      const b = stats[sk][binLabel];
      b.count++;
      b.sumReturn += forwardRet;
      if (forwardRet > 0) b.up++;
      else b.down++;
    };

    record("vixTerm", findBin(BIN_DEFS.vixTerm, vixTerm));
    record("vixSpike", findBin(BIN_DEFS.vixSpike, vixSpike));
    if (pctAbove != null) record("pctAbove200ma", findBin(BIN_DEFS.pctAbove200ma, pctAbove));
    if (rvPct != null) record("realizedVol20Pct", findBin(BIN_DEFS.realizedVol20Pct, rvPct));
    if (rsi2 != null) {
      if (!inUptrend) {
        record("rsi2InTrend", "Downtrend (any RSI)");
      } else if (rsi2 < 10) {
        record("rsi2InTrend", "Uptrend, RSI(2) <10 (oversold)");
      } else if (rsi2 > 90) {
        record("rsi2InTrend", "Uptrend, RSI(2) >90 (overbought)");
      } else {
        record("rsi2InTrend", "Uptrend, RSI(2) 10–90");
      }
    }
    record("hygSpyDiv", findBin(BIN_DEFS.hygSpyDiv, hygDiv));
  }

  // Compute final stats per bin
  const output: Record<SignalKey, { label: string; count: number; avgReturn5d: number; hitRateUp: number; lowConfidence: boolean }[]> = {
    vixTerm: [], vixSpike: [], rsi2InTrend: [], pctAbove200ma: [], realizedVol20Pct: [], hygSpyDiv: [],
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

  const payload = {
    generatedAt: new Date().toISOString(),
    yearsHistory: YEARS,
    forwardDays: FORWARD_DAYS,
    minSamplesPerBin: MIN_SAMPLES_PER_BIN,
    totalSamples: baselineRet.n,
    baselineAvgReturn5d: Math.round(baselineRet.avg * 1000) / 1000,
    signals: output,
  };

  const outPath = resolve(process.cwd(), "src/data/signal-stats.json");
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
