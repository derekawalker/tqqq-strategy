/**
 * Train a Random Forest classifier to predict QQQ 5-day direction.
 *
 * Run with: npx tsx scripts/train-tree-model.ts
 *
 * Outputs src/data/tree-model.json — loaded by the sentiment API route at
 * startup. Re-run monthly or whenever signal-stats.json is regenerated.
 *
 * Features (9):
 *   vixTerm, vixSpike, pctAbove200ma, realizedVol20Pct,
 *   rsi2, inUptrend, hygSpyDiv5d, tnxMom20, tltMom20
 *
 * Target (3-class):
 *   0 = bearish  (realized 5d QQQ < -1.5%)
 *   1 = neutral  (±1.5%)
 *   2 = bullish  (> +1.5%)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import YahooFinance from "yahoo-finance2";
import { RandomForestClassifier } from "ml-random-forest";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YEARS = 5;
const FORWARD_DAYS = 5;
const BULLISH_THRESH = 1.5;
const BEARISH_THRESH = -1.5;
const N_ESTIMATORS = 50;
const FEATURE_NAMES = [
  "vixTerm", "vixSpike", "pctAbove200ma", "realizedVol20Pct",
  "rsi2", "inUptrend", "hygSpyDiv5d", "tnxMom20", "tltMom20",
];

type Series = { date: Date; close: number }[];

async function fetchDaily(symbol: string, years: number): Promise<Series> {
  const period1 = new Date(Date.now() - (years + 1) * 365 * 24 * 60 * 60 * 1000);
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return result.quotes
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: q.date as Date, close: q.close as number }));
}

function alignByDate(series: Record<string, Series>) {
  const maps = Object.fromEntries(
    Object.entries(series).map(([k, s]) => [k, new Map(s.map((d) => [d.date.toDateString(), d.close]))])
  );
  const sets = Object.values(maps).map((m) => new Set(m.keys()));
  const common = [...sets[0]].filter((d) => sets.every((s) => s.has(d)));
  const refKey = Object.keys(series)[0];
  const dates = series[refKey].filter((d) => common.includes(d.date.toDateString())).map((d) => d.date);
  return dates.map((date) => {
    const key = date.toDateString();
    const values: Record<string, number> = {};
    for (const k of Object.keys(series)) values[k] = maps[k].get(key) as number;
    return { date, values };
  });
}

function sma(arr: number[], idx: number, period: number): number | null {
  if (idx < period - 1) return null;
  return arr.slice(idx - period + 1, idx + 1).reduce((s, x) => s + x, 0) / period;
}

function rsiCalc(arr: number[], idx: number, period: number): number | null {
  if (idx < period) return null;
  let gain = 0, loss = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = arr[i] - arr[i - 1];
    if (diff > 0) gain += diff; else loss += Math.abs(diff);
  }
  gain /= period; loss /= period;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function stdev(xs: number[]) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function accuracy(preds: number[], labels: number[]) {
  return preds.filter((p, i) => p === labels[i]).length / preds.length;
}

function confusionMatrix(preds: number[], labels: number[]) {
  const m = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < preds.length; i++) m[labels[i]][preds[i]]++;
  return m;
}

async function main() {
  console.log(`Fetching ${YEARS}y of daily data...`);
  const [qqq, vix, vix3m, hyg, spy, tnx, tlt] = await Promise.all([
    fetchDaily("QQQ",    YEARS),
    fetchDaily("^VIX",   YEARS),
    fetchDaily("^VIX3M", YEARS),
    fetchDaily("HYG",    YEARS),
    fetchDaily("SPY",    YEARS),
    fetchDaily("^TNX",   YEARS),
    fetchDaily("TLT",    YEARS),
  ]);
  const aligned = alignByDate({ QQQ: qqq, VIX: vix, VIX3M: vix3m, HYG: hyg, SPY: spy, TNX: tnx, TLT: tlt });
  console.log(`Aligned: ${aligned.length} days`);

  const q   = aligned.map((d) => d.values.QQQ);
  const v   = aligned.map((d) => d.values.VIX);
  const v3  = aligned.map((d) => d.values.VIX3M);
  const h   = aligned.map((d) => d.values.HYG);
  const s   = aligned.map((d) => d.values.SPY);
  const tnxArr = aligned.map((d) => d.values.TNX);
  const tltArr = aligned.map((d) => d.values.TLT);

  // Pre-compute 20d realized vol series for percentile
  const rv20: (number | null)[] = q.map((_, i) => {
    if (i < 20) return null;
    const rets = q.slice(i - 19, i + 1).map((c, j, a) => j === 0 ? 0 : (c - a[j-1]) / a[j-1]).slice(1);
    return stdev(rets) * Math.sqrt(252) * 100;
  });

  const X: number[][] = [];
  const y: number[] = [];

  const start = 252;
  const end = aligned.length - FORWARD_DAYS;

  for (let i = start; i < end; i++) {
    const fwdRet = ((q[i + FORWARD_DAYS] - q[i]) / q[i]) * 100;
    const label = fwdRet > BULLISH_THRESH ? 2 : fwdRet < BEARISH_THRESH ? 0 : 1;

    const vixTerm = v[i] / v3[i];
    const vixSpike = ((v[i] - v[i-1]) / v[i-1]) * 100;
    const ma200 = sma(q, i, 200);
    const pctAbove = ma200 ? ((q[i] / ma200) - 1) * 100 : 0;
    const inUptrend = ma200 != null && q[i] > ma200 ? 1 : 0;
    const rsi2 = rsiCalc(q, i, 2) ?? 50;
    const hyg5d = ((h[i] - h[i-5]) / h[i-5]) * 100;
    const spy5d = ((s[i] - s[i-5]) / s[i-5]) * 100;
    const hygDiv = hyg5d - spy5d;
    const tnxMom = tnxArr[i] - tnxArr[i-20];
    const tltMom = ((tltArr[i] - tltArr[i-20]) / tltArr[i-20]) * 100;

    // 20d realized vol percentile
    let rvPct = 50;
    const curRv = rv20[i];
    if (curRv != null) {
      const window = rv20.slice(i - 251, i + 1).filter((x): x is number => x != null);
      if (window.length > 50) {
        const sorted = [...window].sort((a, b) => a - b);
        rvPct = (sorted.filter((x) => x <= curRv).length / sorted.length) * 100;
      }
    }

    X.push([vixTerm, vixSpike, pctAbove, rvPct, rsi2, inUptrend, hygDiv, tnxMom, tltMom]);
    y.push(label);
  }

  console.log(`\nDataset: ${X.length} samples`);
  const counts = [0,1,2].map((c) => y.filter((l) => l === c).length);
  console.log(`Class dist: bearish=${counts[0]} (${(counts[0]/y.length*100).toFixed(0)}%)  neutral=${counts[1]} (${(counts[1]/y.length*100).toFixed(0)}%)  bullish=${counts[2]} (${(counts[2]/y.length*100).toFixed(0)}%)`);

  // Time-series split: train on first 80%, test on last 20%
  const splitIdx = Math.floor(X.length * 0.8);
  const Xtrain = X.slice(0, splitIdx), ytrain = y.slice(0, splitIdx);
  const Xtest  = X.slice(splitIdx),   ytest  = y.slice(splitIdx);
  console.log(`Train: ${Xtrain.length}  Test: ${Xtest.length}`);

  console.log(`\nTraining RandomForest (${N_ESTIMATORS} trees)...`);
  const clf = new RandomForestClassifier({
    nEstimators: N_ESTIMATORS,
    maxFeatures: 0.5,
    replacement: true,
    maxDepth: 4,
    minNumSamples: 40,
    seed: 42,
  } as ConstructorParameters<typeof RandomForestClassifier>[0]);
  clf.train(Xtrain, ytrain);

  const trainPreds = clf.predict(Xtrain) as number[];
  const testPreds  = clf.predict(Xtest) as number[];

  console.log(`\nTrain accuracy: ${(accuracy(trainPreds, ytrain) * 100).toFixed(1)}%`);
  console.log(`Test  accuracy: ${(accuracy(testPreds, ytest) * 100).toFixed(1)}%  (baseline majority-class: ${(Math.max(...counts)/y.length*100).toFixed(1)}%)`);

  const cm = confusionMatrix(testPreds, ytest);
  const classNames = ["bearish", "neutral", "bullish"];
  console.log(`\nConfusion matrix (rows=actual, cols=predicted):`);
  console.log(`          ${classNames.map((n) => n.padEnd(9)).join("")}`);
  for (let r = 0; r < 3; r++) {
    const total = cm[r].reduce((s, x) => s + x, 0);
    const pct = total > 0 ? ((cm[r][r] / total) * 100).toFixed(0) : "—";
    console.log(`${classNames[r].padEnd(10)} ${cm[r].map((v) => String(v).padEnd(9)).join("")}  recall=${pct}%`);
  }

  // Per-class precision
  console.log(`\nPer-class precision (test set):`);
  for (let c = 0; c < 3; c++) {
    const predicted = testPreds.filter((p) => p === c).length;
    const correct = testPreds.filter((p, i) => p === c && ytest[i] === c).length;
    const prec = predicted > 0 ? (correct / predicted * 100).toFixed(0) : "—";
    console.log(`  ${classNames[c].padEnd(9)} predicted ${predicted}x → precision ${prec}%`);
  }

  // Export model + metadata
  const payload = {
    trainedAt: new Date().toISOString(),
    yearsData: YEARS,
    nSamples: X.length,
    nEstimators: N_ESTIMATORS,
    featureNames: FEATURE_NAMES,
    classes: [0, 1, 2],
    classNames: ["bearish", "neutral", "bullish"],
    bullishThresh: BULLISH_THRESH,
    bearishThresh: BEARISH_THRESH,
    testAccuracy: accuracy(testPreds, ytest),
    model: clf.toJSON(),
  };

  const outPath = resolve(process.cwd(), "src/data/tree-model.json");
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(`\nWrote ${outPath}  (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
