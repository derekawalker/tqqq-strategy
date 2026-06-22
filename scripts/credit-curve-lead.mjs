/**
 * PROTOTYPE / ANALYSIS — does credit-spread widening or yield-curve inversion
 * LEAD equity drawdowns at multi-week / multi-month horizons?
 *
 * This is the methodologically-sound counterpart to the (discarded) 1-day
 * lead-mining experiment. It differs in three ways that matter:
 *
 *   1. HORIZON. We test 21 / 63 / 126 trading-day forward outcomes, not 1 day.
 *      Credit and curve signals are slow macro variables; if they lead, they
 *      lead by weeks-to-months.
 *   2. HISTORY. Credit spread (FRED BAA10Y) + curve (^TNX-^IRX) need no CPER,
 *      so we pull ~1990→now and get many independent regimes, not one year.
 *   3. HONEST STATS. Forward windows overlap, so the naive IC's error bars are
 *      far too tight. We report BOTH the full (overlapping) rank-IC and a
 *      NON-OVERLAPPING IC (sample every `horizon` days) which is the honest one.
 *      And we split TRAIN vs HOLDOUT so we never judge on in-sample fit.
 *
 * Run: node scripts/credit-curve-lead.mjs
 *
 * If a feature's HOLDOUT non-overlapping IC has the right sign and survives,
 * AND the conditional drawdown table shows a real edge, it's worth building
 * into the anomaly page. Otherwise it isn't.
 */

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const START = new Date("1990-01-01");
const HOLDOUT_FROM = "2014-01-01"; // train < this, holdout >= this (puts 2018/COVID/2022 out-of-sample)
const Z_WINDOW = 252; // 1y rolling z-score
const HORIZONS = [21, 63, 126]; // ~1m, ~3m, ~6m
const DD_HORIZON = 63; // window for the conditional drawdown table
const DD_THRESHOLD = -0.1; // "a real drawdown" = forward loss of 10%+

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchYahoo(symbol) {
  const r = await yf.chart(symbol, { period1: START, interval: "1d" });
  return (r.quotes ?? [])
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: q.date.toISOString().slice(0, 10), close: q.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** FRED daily series via the no-key CSV endpoint. */
async function fetchFred(id) {
  const cosd = START.toISOString().slice(0, 10);
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`);
  if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter((c) => c[1] && c[1] !== ".")
    .map((c) => ({ date: c[0].trim(), close: parseFloat(c[1]) }));
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

const mean = (xs) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
const std = (xs) => {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

function rollingZ(series, i, window) {
  if (i < window - 1) return null;
  const w = series.slice(i - window + 1, i + 1);
  if (w.some((x) => !Number.isFinite(x))) return null;
  const s = std(w);
  if (!Number.isFinite(s) || s === 0) return null;
  return (series[i] - mean(w)) / s;
}

function rank(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(values.length);
  for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1;
  return r;
}

/** Spearman rank correlation over aligned [feature, outcome] pairs. */
function spearman(pairs) {
  if (pairs.length < 10) return { ic: NaN, n: pairs.length };
  const ra = rank(pairs.map((p) => p[0]));
  const rb = rank(pairs.map((p) => p[1]));
  const ma = mean(ra),
    mb = mean(rb),
    sa = std(ra),
    sb = std(rb);
  if (sa === 0 || sb === 0) return { ic: NaN, n: pairs.length };
  let s = 0;
  for (let i = 0; i < ra.length; i++) s += (ra[i] - ma) * (rb[i] - mb);
  return { ic: s / ((ra.length - 1) * sa * sb), n: pairs.length };
}

// ---------------------------------------------------------------------------
// Build aligned panel
// ---------------------------------------------------------------------------

/**
 * Align onto SPX trading days with forward-fill. `required` keys gate row
 * completeness; `optional` keys (shorter-history ETFs) are filled when present
 * and left undefined otherwise, so they never truncate the long history that
 * the required macro series (curve, credit spread) actually have.
 */
function alignToSpx(spx, series, required, optional) {
  const maps = {};
  for (const [k, pts] of Object.entries(series)) {
    maps[k] = new Map(pts.map((p) => [p.date, p.close]));
  }
  const last = {};
  const rows = [];
  for (const p of spx) {
    const row = { date: p.date, spx: p.close };
    let ok = true;
    for (const k of required) {
      const v = maps[k].get(p.date);
      if (v != null) last[k] = v;
      if (last[k] == null) ok = false;
      else row[k] = last[k];
    }
    for (const k of optional) {
      const v = maps[k].get(p.date);
      if (v != null) last[k] = v;
      if (last[k] != null) row[k] = last[k];
    }
    if (ok) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Fetching ${START.toISOString().slice(0, 10)} → now ...`);
  const [spx, tnx, irx, baa, hyg, lqd] = await Promise.all([
    fetchYahoo("^GSPC"),
    fetchYahoo("^TNX"),
    fetchYahoo("^IRX"),
    fetchFred("BAA10Y"), // Moody's Baa - 10y Treasury credit spread (pp)
    fetchYahoo("HYG").catch(() => []),
    fetchYahoo("LQD").catch(() => []),
  ]);
  console.log(
    `  spx=${spx.length} tnx=${tnx.length} irx=${irx.length} baa=${baa.length} hyg=${hyg.length} lqd=${lqd.length}`,
  );

  const rows = alignToSpx(spx, { tnx, irx, baa, hyg, lqd }, ["tnx", "irx", "baa"], ["hyg", "lqd"]);
  console.log(`Aligned ${rows.length} trading days (${rows[0].date} → ${rows.at(-1).date})\n`);

  const px = rows.map((r) => r.spx);
  const baaArr = rows.map((r) => r.baa);
  const hlArr = rows.map((r) => (r.lqd > 0 && r.hyg != null ? r.hyg / r.lqd : NaN));

  // --- Features (all causal / point-in-time) ---
  // Stress features: HIGHER = more stress, so we EXPECT negative IC vs forward return.
  const feat = {
    creditZ: rows.map((_, i) => rollingZ(baaArr, i, Z_WINDOW)), // spread level, z-scored
    creditChg63: rows.map((_, i) => (i >= 63 ? baaArr[i] - baaArr[i - 63] : null)), // 3m spread change (pp)
    curveInv: rows.map((r) => -(r.tnx - r.irx)), // inversion: higher = more inverted (10y<3m)
    hygLqdStressZ: rows.map((_, i) => {
      const z = rollingZ(hlArr, i, Z_WINDOW);
      return z == null ? null : -z; // falling HYG/LQD = stress, flip sign so higher = stress
    }),
  };

  // --- Forward outcomes ---
  const fwdRet = (i, h) => (i + h < px.length ? px[i + h] / px[i] - 1 : null);
  const fwdMinRet = (i, h) => {
    if (i + h >= px.length) return null;
    let m = Infinity;
    for (let j = i + 1; j <= i + h; j++) m = Math.min(m, px[j] / px[i] - 1);
    return m;
  };

  const inTrain = (d) => d < HOLDOUT_FROM;

  // ===================================================================
  // 1) Rank-IC of each stress feature vs forward return, by horizon.
  //    Overlapping (biased-tight SE) AND non-overlapping (honest) ICs,
  //    reported separately for TRAIN and HOLDOUT.
  // ===================================================================
  console.log("=".repeat(78));
  console.log("RANK-IC vs forward return  (stress features → expect NEGATIVE IC)");
  console.log("nonOv = non-overlapping sample (every h days) = the honest number");
  console.log("=".repeat(78));

  for (const name of Object.keys(feat)) {
    const f = feat[name];
    console.log(`\n${name}`);
    for (const h of HORIZONS) {
      for (const [label, isTrain] of [
        ["train", true],
        ["holdout", false],
      ]) {
        const all = [];
        const nonOv = [];
        let nextFree = -Infinity;
        for (let i = 0; i < rows.length; i++) {
          if (inTrain(rows[i].date) !== isTrain) continue;
          const fv = f[i];
          const ov = fwdRet(i, h);
          if (fv == null || ov == null) continue;
          all.push([fv, ov]);
          if (i >= nextFree) {
            nonOv.push([fv, ov]);
            nextFree = i + h; // skip ahead a full horizon → independent samples
          }
        }
        const a = spearman(all);
        const b = spearman(nonOv);
        console.log(
          `  h=${String(h).padStart(3)} ${label.padEnd(7)}` +
            ` IC=${fmt(a.ic)} (n=${String(a.n).padStart(4)})` +
            `   nonOv IC=${fmt(b.ic)} (n=${String(b.n).padStart(3)})`,
        );
      }
    }
  }

  // ===================================================================
  // 2) Conditional drawdown table — the practical test.
  //    When a feature is in its top quintile (point-in-time), what's the
  //    chance of a >=10% forward drawdown over the next ~3 months, vs base?
  // ===================================================================
  console.log("\n" + "=".repeat(78));
  console.log(
    `CONDITIONAL: P(forward ${DD_HORIZON}d drawdown ≤ ${(DD_THRESHOLD * 100).toFixed(0)}%)` +
      ` when feature in TOP QUINTILE vs base rate`,
  );
  console.log("(quintile cutoff computed within each split — no look-ahead across splits)");
  console.log("=".repeat(78));

  for (const name of Object.keys(feat)) {
    const f = feat[name];
    console.log(`\n${name}`);
    for (const [label, isTrain] of [
      ["train", true],
      ["holdout", false],
    ]) {
      const obs = [];
      for (let i = 0; i < rows.length; i++) {
        if (inTrain(rows[i].date) !== isTrain) continue;
        const fv = f[i];
        const dd = fwdMinRet(i, DD_HORIZON);
        if (fv == null || dd == null) continue;
        obs.push({ fv, hit: dd <= DD_THRESHOLD });
      }
      if (obs.length < 50) {
        console.log(`  ${label.padEnd(7)} (insufficient data)`);
        continue;
      }
      const cutoff = quantile(
        obs.map((o) => o.fv),
        0.8,
      );
      const top = obs.filter((o) => o.fv >= cutoff);
      const base = obs;
      const pTop = mean(top.map((o) => (o.hit ? 1 : 0)));
      const pBase = mean(base.map((o) => (o.hit ? 1 : 0)));
      const lift = pBase > 0 ? pTop / pBase : NaN;
      console.log(
        `  ${label.padEnd(7)} top-quintile=${pct(pTop)}  base=${pct(pBase)}` +
          `  lift=${Number.isFinite(lift) ? lift.toFixed(2) + "x" : "—"}  (n_top=${top.length})`,
      );
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("READ:");
  console.log("  • A feature is promising only if the HOLDOUT non-overlapping IC keeps the");
  console.log("    expected (negative) sign AND the holdout conditional lift is clearly >1.");
  console.log("  • Tiny non-overlapping n (a few dozen) = treat even 'good' numbers as weak.");
  console.log("  • This is a go/no-go probe, not a backtest. No costs, no position sizing.");
  console.log("=".repeat(78));
}

function quantile(xs, q) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
const fmt = (x) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(3) : "  n/a") + "";
const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(0) + "%" : "n/a").padStart(4);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
