/**
 * Evaluate non-price alternative features for QQQ 5d forward return prediction.
 *
 * Run with: npx tsx scripts/evaluate-alt-features.ts
 *
 * Tests:
 *   1. 10y-3m yield spread (^TNX - ^IRX) — inverted = risk-off regime
 *   2. TLT 20d momentum — bonds leading / lagging stocks
 *   3. GLD 20d vs QQQ 20d (gold leading) — risk-off divergence
 *   4. CBOE total put/call ratio (^PCRATIO via yahoo, if available)
 *   5. VIX level absolute (not just spike) — fear regime
 *   6. USD momentum (UUP 20d) — dollar strength = risk-off
 *
 * Reports spearman + quintile avg return for each.
 */

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YEARS = 5;
const FORWARD_DAYS = 5;

type Series = { date: string; close: number }[];

async function tryFetch(symbol: string, years: number): Promise<Series> {
  try {
    const period1 = new Date(Date.now() - (years + 1) * 365 * 24 * 60 * 60 * 1000);
    const result = await yf.chart(symbol, { period1, interval: "1d" });
    const rows = result.quotes
      .filter((q) => q.close != null && q.date != null)
      .map((q) => ({ date: (q.date as Date).toISOString().slice(0, 10), close: q.close as number }));
    console.log(`  ${symbol}: ${rows.length} rows`);
    return rows;
  } catch {
    console.log(`  ${symbol}: FAILED (not available)`);
    return [];
  }
}

function alignByDate(series: Record<string, Series>): { date: string; values: Record<string, number> }[] {
  const maps = Object.fromEntries(
    Object.entries(series).map(([k, s]) => [k, new Map(s.map((d) => [d.date, d.close]))])
  );
  const sets = Object.values(maps).map((m) => new Set(m.keys()));
  const common = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  return common.map((date) => ({
    date,
    values: Object.fromEntries(Object.keys(series).map((k) => [k, maps[k].get(date) as number])),
  }));
}

function rankOf(arr: number[]) {
  const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array(arr.length);
  idx.forEach((p, k) => { r[p.i] = k + 1; });
  return r;
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
  return sorted[base + 1] !== undefined ? sorted[base] + (pos - base) * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function reportFeature(name: string, xs: number[], ys: number[]) {
  const valid = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => isFinite(p.x) && isFinite(p.y));
  if (valid.length < 50) { console.log(`  ${name}: n=${valid.length} — too few`); return; }
  const fx = valid.map((p) => p.x), fy = valid.map((p) => p.y);
  const corr = pearson(fx, fy);
  const spearman = pearson(rankOf(fx), rankOf(fy));
  const baseline = fy.reduce((s, y) => s + y, 0) / fy.length;
  const sorted = [...fx].sort((a, b) => a - b);
  const [q20, q40, q60, q80] = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(sorted, q));
  const bins = ["Q1", "Q2", "Q3", "Q4", "Q5"].map(() => [] as number[]);
  for (const p of valid) {
    const b = p.x <= q20 ? 0 : p.x <= q40 ? 1 : p.x <= q60 ? 2 : p.x <= q80 ? 3 : 4;
    bins[b].push(p.y);
  }
  console.log(`\n  ${name}  (n=${fx.length})`);
  console.log(`    pearson=${corr.toFixed(3)}   spearman=${spearman.toFixed(3)}`);
  const labels = [`Q1(≤${q20.toFixed(2)})`, "Q2", "Q3", "Q4", `Q5(>${q80.toFixed(2)})`];
  for (let i = 0; i < 5; i++) {
    const b = bins[i];
    const avg = b.reduce((s, y) => s + y, 0) / b.length;
    const up = (b.filter((y) => y > 0).length / b.length) * 100;
    const edge = avg - baseline;
    console.log(`    ${labels[i].padEnd(16)} n=${String(b.length).padStart(3)}  avg=${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%  edge=${edge >= 0 ? "+" : ""}${edge.toFixed(2)}%  up=${up.toFixed(0)}%`);
  }
}

async function main() {
  console.log("Fetching data...");
  const [qqq, tnx, irx, tlt, gld, uup, pcr] = await Promise.all([
    tryFetch("QQQ",      YEARS),
    tryFetch("^TNX",     YEARS),  // 10y treasury yield
    tryFetch("^IRX",     YEARS),  // 13-week T-bill yield
    tryFetch("TLT",      YEARS),  // 20y bond ETF
    tryFetch("GLD",      YEARS),  // gold
    tryFetch("UUP",      YEARS),  // USD index ETF
    tryFetch("^PCRATIO", YEARS),  // CBOE total put/call (may fail)
  ]);

  // Align QQQ + everything that fetched
  const available: Record<string, Series> = { QQQ: qqq };
  if (tnx.length) available.TNX = tnx;
  if (irx.length) available.IRX = irx;
  if (tlt.length) available.TLT = tlt;
  if (gld.length) available.GLD = gld;
  if (uup.length) available.UUP = uup;
  if (pcr.length) available.PCR = pcr;

  const aligned = alignByDate(available);
  console.log(`\nAligned: ${aligned.length} trading days\n`);

  const q = aligned.map((d) => d.values.QQQ);
  const start = 30;  // enough for 20d lookback
  const end = aligned.length - FORWARD_DAYS;
  const targets: number[] = [];
  const features: Record<string, number[]> = {
    yieldSpread10m3: [], tnxLevel: [], tnxMom20: [],
    tltMom20: [], tltVsQqqMom20: [],
    gldMom20: [], gldVsQqqMom20: [],
    uupMom20: [],
    pcrRaw: [], pcrMa5: [],
  };

  for (let i = start; i < end; i++) {
    const fwd = ((q[i + FORWARD_DAYS] - q[i]) / q[i]) * 100;
    targets.push(fwd);
    const d = aligned[i].values;

    // Yield spread: 10y minus 3m (basis points proxy)
    const spread = (available.TNX && available.IRX)
      ? (d.TNX ?? NaN) - (d.IRX ?? NaN) / 4  // IRX is annualised discount %, rough
      : NaN;
    features.yieldSpread10m3.push(spread);
    features.tnxLevel.push(d.TNX ?? NaN);

    const tnxArr = aligned.slice(0, i + 1).map((x) => x.values.TNX ?? NaN);
    features.tnxMom20.push(i >= 20 ? tnxArr[i] - tnxArr[i - 20] : NaN);

    const tltArr = aligned.slice(0, i + 1).map((x) => x.values.TLT ?? NaN);
    const qArr   = q.slice(0, i + 1);
    const tltMom = (available.TLT && i >= 20) ? ((tltArr[i] - tltArr[i - 20]) / tltArr[i - 20]) * 100 : NaN;
    const qMom   = (i >= 20) ? ((qArr[i] - qArr[i - 20]) / qArr[i - 20]) * 100 : NaN;
    features.tltMom20.push(tltMom);
    features.tltVsQqqMom20.push(isFinite(tltMom) && isFinite(qMom) ? tltMom - qMom : NaN);

    const gldArr = aligned.slice(0, i + 1).map((x) => x.values.GLD ?? NaN);
    const gldMom = (available.GLD && i >= 20) ? ((gldArr[i] - gldArr[i - 20]) / gldArr[i - 20]) * 100 : NaN;
    features.gldMom20.push(gldMom);
    features.gldVsQqqMom20.push(isFinite(gldMom) && isFinite(qMom) ? gldMom - qMom : NaN);

    const uupArr = aligned.slice(0, i + 1).map((x) => x.values.UUP ?? NaN);
    features.uupMom20.push((available.UUP && i >= 20) ? ((uupArr[i] - uupArr[i - 20]) / uupArr[i - 20]) * 100 : NaN);

    features.pcrRaw.push(d.PCR ?? NaN);
    // 5d MA of put/call — smooths noise
    if (available.PCR && i >= 5) {
      const pcrSlice = aligned.slice(i - 4, i + 1).map((x) => x.values.PCR ?? NaN).filter(isFinite);
      features.pcrMa5.push(pcrSlice.length > 0 ? pcrSlice.reduce((s, x) => s + x, 0) / pcrSlice.length : NaN);
    } else {
      features.pcrMa5.push(NaN);
    }
  }

  const baseline = targets.reduce((s, y) => s + y, 0) / targets.length;
  console.log(`=== Alt-feature evaluation: ${targets.length} samples ===`);
  console.log(`Baseline avg 5d return: ${baseline.toFixed(3)}%\n`);
  console.log(`── Treasury / bonds ──`);
  if (available.TNX && available.IRX) reportFeature("yieldSpread (10y-3m)", features.yieldSpread10m3, targets);
  if (available.TNX) { reportFeature("TNX level", features.tnxLevel, targets); reportFeature("TNX 20d change", features.tnxMom20, targets); }
  if (available.TLT) { reportFeature("TLT 20d mom", features.tltMom20, targets); reportFeature("TLT vs QQQ 20d", features.tltVsQqqMom20, targets); }
  console.log(`\n── Gold / dollar ──`);
  if (available.GLD) { reportFeature("GLD 20d mom", features.gldMom20, targets); reportFeature("GLD vs QQQ 20d", features.gldVsQqqMom20, targets); }
  if (available.UUP) reportFeature("UUP (USD) 20d mom", features.uupMom20, targets);
  console.log(`\n── Put/call ──`);
  if (available.PCR) { reportFeature("put/call raw", features.pcrRaw, targets); reportFeature("put/call 5d MA", features.pcrMa5, targets); }
  else console.log(`  ^PCRATIO not available via Yahoo`);
  console.log(`\nDone. |spearman| > 0.10 with monotonic quintile pattern = worth adding.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
