/**
 * Evaluate candidate features for predictive power on QQQ forward 5d return.
 *
 * Run with: npx tsx scripts/evaluate-candidate-features.ts
 *
 * Tests new candidates alongside existing signals over 5y history. Reports:
 *   - pearson correlation of raw feature value with forward 5d return
 *   - per-quintile avg return + hit-rate
 * No state is written — this is purely evaluation.
 */

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YEARS = 5;
const FORWARD_DAYS = 5;

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

function rsi(closes: number[], period: number, idx: number): number | null {
  if (idx < period) return null;
  let gain = 0, loss = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
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

function pearson(xs: number[], ys: number[]) {
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return num / Math.sqrt(dx2 * dy2);
}

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function reportFeature(name: string, xs: number[], ys: number[]) {
  const valid = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => isFinite(p.x) && isFinite(p.y));
  const fx = valid.map((p) => p.x);
  const fy = valid.map((p) => p.y);
  if (fx.length < 50) {
    console.log(`${name.padEnd(28)}  n=${fx.length} — too few samples`);
    return;
  }
  const corr = pearson(fx, fy);
  // Spearman (rank-correlation) — robust to outliers / non-linearity
  const rankOf = (arr: number[]) => {
    const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array(arr.length);
    idx.forEach((p, k) => { r[p.i] = k + 1; });
    return r;
  };
  const spearman = pearson(rankOf(fx), rankOf(fy));

  const sorted = [...fx].sort((a, b) => a - b);
  const q20 = quantile(sorted, 0.2);
  const q40 = quantile(sorted, 0.4);
  const q60 = quantile(sorted, 0.6);
  const q80 = quantile(sorted, 0.8);
  const bins: { label: string; ys: number[] }[] = [
    { label: `Q1 (≤${q20.toFixed(2)})`, ys: [] },
    { label: `Q2`, ys: [] },
    { label: `Q3`, ys: [] },
    { label: `Q4`, ys: [] },
    { label: `Q5 (>${q80.toFixed(2)})`, ys: [] },
  ];
  for (const p of valid) {
    let b: number;
    if (p.x <= q20) b = 0;
    else if (p.x <= q40) b = 1;
    else if (p.x <= q60) b = 2;
    else if (p.x <= q80) b = 3;
    else b = 4;
    bins[b].ys.push(p.y);
  }
  console.log(`\n${name}  (n=${fx.length})`);
  console.log(`  pearson=${corr.toFixed(3)}   spearman=${spearman.toFixed(3)}`);
  const baseline = fy.reduce((s, y) => s + y, 0) / fy.length;
  for (const b of bins) {
    const avg = b.ys.reduce((s, y) => s + y, 0) / b.ys.length;
    const up = (b.ys.filter((y) => y > 0).length / b.ys.length) * 100;
    const edge = avg - baseline;
    console.log(`  ${b.label.padEnd(16)} n=${String(b.ys.length).padStart(3)}  avg5d=${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%  edge=${edge >= 0 ? "+" : ""}${edge.toFixed(2)}%  up=${up.toFixed(0)}%`);
  }
}

async function main() {
  console.log(`Fetching ${YEARS}y of daily history...`);
  const [qqq, vix, vix3m, hyg, spy] = await Promise.all([
    fetchDaily("QQQ",   YEARS),
    fetchDaily("^VIX",  YEARS),
    fetchDaily("^VIX3M", YEARS),
    fetchDaily("HYG",   YEARS),
    fetchDaily("SPY",   YEARS),
  ]);
  const aligned = alignByDate({ QQQ: qqq, VIX: vix, VIX3M: vix3m, HYG: hyg, SPY: spy });
  console.log(`Aligned: ${aligned.length} trading days`);

  const q = aligned.map((d) => d.values.QQQ);
  const v = aligned.map((d) => d.values.VIX);
  const v3 = aligned.map((d) => d.values.VIX3M);
  const h = aligned.map((d) => d.values.HYG);
  const s = aligned.map((d) => d.values.SPY);

  // Build feature & target arrays at each valid day
  const start = 252;  // need 252d for high-water mark
  const end = aligned.length - FORWARD_DAYS;

  const features: Record<string, number[]> = {
    // existing
    vixTerm: [], vixSpike: [], rsi2: [], pctAbove200ma: [], hygSpyDiv5d: [],
    // candidates
    qqqMom20: [], qqqMom50: [], qqqMom10: [],
    realizedVol20: [], realizedVol20Pct: [],
    drawdownFrom252Hi: [],
    daysSince252Lo: [],
    vixLevel: [],
    qqqVsSpyMom20: [],
  };
  const targets: number[] = [];

  // Pre-compute 20d realized vol series for percentile
  const realizedVolSeries: (number | null)[] = q.map((_, i) => {
    if (i < 20) return null;
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) rets.push((q[j] - q[j - 1]) / q[j - 1]);
    return stdev(rets) * Math.sqrt(252) * 100;
  });

  for (let i = start; i < end; i++) {
    const forwardRet = ((q[i + FORWARD_DAYS] - q[i]) / q[i]) * 100;

    // Existing signals
    const vixTerm = v[i] / v3[i];
    const vixSpike = ((v[i] - v[i - 1]) / v[i - 1]) * 100;
    const ma200 = sma(q, 200, i);
    const pctAbove200 = ma200 != null ? ((q[i] / ma200) - 1) * 100 : NaN;
    const rsi2 = rsi(q, 2, i);
    const hyg5d = ((h[i] - h[i - 5]) / h[i - 5]) * 100;
    const spy5d = ((s[i] - s[i - 5]) / s[i - 5]) * 100;
    const hygDiv = hyg5d - spy5d;

    // Candidates
    const mom20 = ((q[i] - q[i - 20]) / q[i - 20]) * 100;
    const mom50 = ((q[i] - q[i - 50]) / q[i - 50]) * 100;
    const mom10 = ((q[i] - q[i - 10]) / q[i - 10]) * 100;
    const rv20 = realizedVolSeries[i] ?? NaN;
    // percentile of current rv20 vs trailing 252d of rv20
    let rv20Pct = NaN;
    if (i >= 252 && isFinite(rv20)) {
      const window: number[] = [];
      for (let j = i - 251; j <= i; j++) {
        const v = realizedVolSeries[j];
        if (v != null && isFinite(v)) window.push(v);
      }
      window.sort((a, b) => a - b);
      const rank = window.filter((x) => x <= rv20).length;
      rv20Pct = (rank / window.length) * 100;
    }
    // drawdown from 252d high
    let hi252 = -Infinity;
    for (let j = i - 251; j <= i; j++) if (q[j] > hi252) hi252 = q[j];
    const dd = ((q[i] / hi252) - 1) * 100;
    // days since 252d low
    let loIdx = i;
    let lo = q[i];
    for (let j = i - 251; j <= i; j++) if (q[j] < lo) { lo = q[j]; loIdx = j; }
    const daysSinceLo = i - loIdx;
    // QQQ momentum minus SPY momentum (Naz strength)
    const spyMom20 = ((s[i] - s[i - 20]) / s[i - 20]) * 100;
    const qqqVsSpy = mom20 - spyMom20;

    features.vixTerm.push(vixTerm);
    features.vixSpike.push(vixSpike);
    features.rsi2.push(rsi2 ?? NaN);
    features.pctAbove200ma.push(pctAbove200);
    features.hygSpyDiv5d.push(hygDiv);
    features.qqqMom20.push(mom20);
    features.qqqMom50.push(mom50);
    features.qqqMom10.push(mom10);
    features.realizedVol20.push(rv20);
    features.realizedVol20Pct.push(rv20Pct);
    features.drawdownFrom252Hi.push(dd);
    features.daysSince252Lo.push(daysSinceLo);
    features.vixLevel.push(v[i]);
    features.qqqVsSpyMom20.push(qqqVsSpy);
    targets.push(forwardRet);
  }

  console.log(`\n=== Feature evaluation: ${targets.length} samples, target = QQQ ${FORWARD_DAYS}d forward return ===`);
  console.log(`Baseline avg target: ${(targets.reduce((s, y) => s + y, 0) / targets.length).toFixed(3)}%   stdev: ${stdev(targets).toFixed(2)}%`);

  console.log(`\n── Existing signals (sanity check) ──`);
  reportFeature("vixTerm",        features.vixTerm,        targets);
  reportFeature("vixSpike",       features.vixSpike,       targets);
  reportFeature("rsi2",           features.rsi2,           targets);
  reportFeature("pctAbove200ma",  features.pctAbove200ma,  targets);
  reportFeature("hygSpyDiv5d",    features.hygSpyDiv5d,    targets);

  console.log(`\n── Candidates ──`);
  reportFeature("qqqMom10",         features.qqqMom10,         targets);
  reportFeature("qqqMom20",         features.qqqMom20,         targets);
  reportFeature("qqqMom50",         features.qqqMom50,         targets);
  reportFeature("realizedVol20",    features.realizedVol20,    targets);
  reportFeature("realizedVol20Pct", features.realizedVol20Pct, targets);
  reportFeature("drawdownFrom252Hi",features.drawdownFrom252Hi,targets);
  reportFeature("daysSince252Lo",   features.daysSince252Lo,   targets);
  reportFeature("vixLevel",         features.vixLevel,         targets);
  reportFeature("qqqVsSpyMom20",    features.qqqVsSpyMom20,    targets);

  console.log(`\nDone. |spearman| > ~0.1 with monotonic quintile pattern = worth wiring in.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
