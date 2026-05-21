/**
 * Calibrate PAUSE / BOTTOM thresholds for the BUY / PAUSE / BOTTOM verdict.
 *
 * Loads daily_features rows that have both a stored prediction and a realized
 * return, splits them into "train" (older) and "holdout" (most recent ~6 mo),
 * grid-searches threshold combos, and prints what would have worked best on
 * each window.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/calibrate-verdict.ts
 */

import { createClient } from "@supabase/supabase-js";
import {
  loadRecentPredictions,
  type DailyRow,
} from "@/lib/predictionHistory";
import {
  computeBottomIndicators,
  scoreVerdict,
  type Verdict,
  type VerdictInputs,
  type VerdictOutcome,
} from "@/lib/verdict";

// Wire supabase env (predictionHistory uses these directly)
void createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const HOLDOUT_DAYS = 126; // ~6 trading months

// ── candidate threshold grid ──────────────────────────────────────────────────

interface ThresholdSet {
  bottomHitsRequired: number; // 1, 2, or 3
  pauseVolMin: number;        // realizedVol20d threshold
  pauseTnxMomMin: number;     // tnxMom20d threshold (pp)
  pauseRecentRallyMax: number;// qqq5dRet ceiling (above which we skip PAUSE)
  pausePredictedRetMax: number; // predictedRet must be < this for PAUSE
}

const CURRENT: ThresholdSet = {
  bottomHitsRequired: 2,
  pauseVolMin: 25,
  pauseTnxMomMin: 0,
  pauseRecentRallyMax: 1.5,
  pausePredictedRetMax: 0,
};

function buildGrid(): ThresholdSet[] {
  const grid: ThresholdSet[] = [];
  for (const bottomHits of [1, 2, 3]) {
    for (const volMin of [18, 22, 25, 28]) {
      for (const tnxMin of [-0.2, 0, 0.1]) {
        for (const rallyMax of [1.0, 1.5, 2.5, 5.0]) {
          for (const predMax of [-0.1, 0, 0.2]) {
            grid.push({
              bottomHitsRequired: bottomHits,
              pauseVolMin: volMin,
              pauseTnxMomMin: tnxMin,
              pauseRecentRallyMax: rallyMax,
              pausePredictedRetMax: predMax,
            });
          }
        }
      }
    }
  }
  return grid;
}

// ── verdict simulation under a given threshold set ────────────────────────────

function inputsFromRow(row: DailyRow): VerdictInputs {
  return {
    rsi14: row.rsi14,
    vixLevel: row.vixLevel,
    vix1dChange: row.vix1dChange,
    qqq5dRet: row.qqq5dRet,
    daysSinceHigh: row.daysSinceHigh,
    vixTerm: row.vixTerm,
    realizedVol20d: row.realizedVol20d,
    tnxMom20d: row.tnxMom20d,
  };
}

function verdictForRow(row: DailyRow, t: ThresholdSet): Verdict | null {
  if (row.predicted1dRet == null) return null;
  const hits = computeBottomIndicators(inputsFromRow(row)).filter((i) => i.hit).length;
  if (hits >= t.bottomHitsRequired) return "catchup";

  const stress =
    row.realizedVol20d != null && row.realizedVol20d >= t.pauseVolMin &&
    row.tnxMom20d != null && row.tnxMom20d >= t.pauseTnxMomMin;
  const bigRally = row.qqq5dRet != null && row.qqq5dRet > t.pauseRecentRallyMax;
  if (row.predicted1dRet < t.pausePredictedRetMax && stress && !bigRally) {
    return "skip";
  }
  return "dca";
}

interface BucketStats {
  n: number;
  right: number;
  wrong: number;
  neutral: number;
  avgRet: number;
  hitRate: number;
  rightRate: number;
  // Wilson 95% lower bound on right rate
  rightRateLo: number;
}

interface Eval {
  byVerdict: Record<Verdict, BucketStats>;
  // composite score: average realized return earned by following the verdicts
  // — DCA contributes +ret, SKIP contributes -ret (you avoided that day), CATCHUP contributes +ret
  totalEdgePerDay: number;
  // per-call edge for the riskier verdicts (signal strength)
  skipAvgRet: number | null;       // we want this NEGATIVE
  catchupAvgRet: number | null;    // we want this POSITIVE
  skipN: number;
  catchupN: number;
}

function wilsonLower(p: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (center - margin) / denom;
}

function evaluate(rows: DailyRow[], t: ThresholdSet): Eval {
  const empty = (): BucketStats => ({
    n: 0, right: 0, wrong: 0, neutral: 0,
    avgRet: 0, hitRate: 0, rightRate: 0, rightRateLo: 0,
  });
  const byVerdict: Record<Verdict, BucketStats> = {
    dca: empty(), skip: empty(), catchup: empty(),
  };
  let edgeSum = 0;
  let edgeN = 0;
  for (const row of rows) {
    if (row.realized1dRet == null) continue;
    const v = verdictForRow(row, t);
    if (!v) continue;
    const outcome: VerdictOutcome = scoreVerdict(v, row.realized1dRet);
    const b = byVerdict[v];
    b.n++;
    b.avgRet += row.realized1dRet;
    if (outcome === "right") b.right++;
    else if (outcome === "wrong") b.wrong++;
    else b.neutral++;

    // Edge contribution: how much following the verdict beat being long every day.
    // DCA: full exposure (=realized).
    // SKIP: zero exposure (=0). Skipping a down day → 0 > -ret = positive edge.
    // CATCHUP: full exposure (=realized).
    // Edge per day = (chosen) - (always-long baseline = realized) for SKIP only.
    if (v === "skip") edgeSum += -row.realized1dRet; // you avoided this day
    edgeN++;
  }
  for (const v of ["dca", "skip", "catchup"] as Verdict[]) {
    const b = byVerdict[v];
    if (b.n > 0) {
      b.avgRet = b.avgRet / b.n;
      b.hitRate = b.right / b.n;
      b.rightRate = b.right / b.n;
      b.rightRateLo = wilsonLower(b.rightRate, b.n);
    }
  }
  return {
    byVerdict,
    totalEdgePerDay: edgeN > 0 ? edgeSum / edgeN : 0,
    skipAvgRet: byVerdict.skip.n > 0 ? byVerdict.skip.avgRet : null,
    catchupAvgRet: byVerdict.catchup.n > 0 ? byVerdict.catchup.avgRet : null,
    skipN: byVerdict.skip.n,
    catchupN: byVerdict.catchup.n,
  };
}

// ── ranking ───────────────────────────────────────────────────────────────────

interface Scored {
  t: ThresholdSet;
  train: Eval;
  holdout: Eval;
  score: number;
}

// Composite score:
//   reward SKIP avg < 0 (with a min-N gate)
//   reward CATCHUP avg > 0 (with a min-N gate)
//   small bonus for higher-frequency SKIP if it stays negative
function compositeScore(e: Eval): number {
  let score = 0;
  if (e.skipN >= 5 && e.skipAvgRet != null) {
    score += -e.skipAvgRet * 2; // negative skip ret → positive score
    score += Math.log10(e.skipN) * 0.1;
  } else {
    score -= 0.5; // too few SKIPs to trust
  }
  if (e.catchupN >= 5 && e.catchupAvgRet != null) {
    score += e.catchupAvgRet * 1.5;
  } else if (e.catchupN > 0) {
    score += (e.catchupAvgRet ?? 0) * 0.5;
  }
  return score;
}

// ── formatting ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  if (v == null) return "    —";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`.padStart(7);
}

function describe(t: ThresholdSet): string {
  return `bot≥${t.bottomHitsRequired}  vol≥${t.pauseVolMin}  tnx≥${t.pauseTnxMomMin >= 0 ? "+" : ""}${t.pauseTnxMomMin.toFixed(1)}  rally<${t.pauseRecentRallyMax.toFixed(1)}%  pred<${t.pausePredictedRetMax >= 0 ? "+" : ""}${t.pausePredictedRetMax.toFixed(1)}%`;
}

function printEval(label: string, e: Eval): void {
  const skip = e.byVerdict.skip;
  const catchup = e.byVerdict.catchup;
  const dca = e.byVerdict.dca;
  console.log(`  ${label}:`);
  console.log(`    DCA      n=${String(dca.n).padStart(4)}  avgRet=${fmtPct(dca.n > 0 ? dca.avgRet : null)}  right=${(dca.rightRate * 100).toFixed(0)}%`);
  console.log(`    SKIP     n=${String(skip.n).padStart(4)}  avgRet=${fmtPct(skip.n > 0 ? skip.avgRet : null)}  right=${(skip.rightRate * 100).toFixed(0)}% (Wilson lo ${(skip.rightRateLo * 100).toFixed(0)}%)`);
  console.log(`    CATCHUP  n=${String(catchup.n).padStart(4)}  avgRet=${fmtPct(catchup.n > 0 ? catchup.avgRet : null)}  right=${(catchup.rightRate * 100).toFixed(0)}% (Wilson lo ${(catchup.rightRateLo * 100).toFixed(0)}%)`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Pull everything; loadRecentPredictions caps at limit.
  const all = await loadRecentPredictions(2000);
  const withRealized = all.filter((r) => r.realized1dRet != null && r.predicted1dRet != null);
  // loadRecentPredictions returns newest-first. Reverse to oldest-first for split.
  withRealized.reverse();

  console.log(`\nLoaded ${withRealized.length} prediction rows with realized returns`);
  if (withRealized.length === 0) {
    console.log("Nothing to calibrate.");
    return;
  }

  const splitIdx = Math.max(0, withRealized.length - HOLDOUT_DAYS);
  const train = withRealized.slice(0, splitIdx);
  const holdout = withRealized.slice(splitIdx);
  console.log(`Train: ${train.length} rows (${train[0]?.date} → ${train.at(-1)?.date})`);
  console.log(`Holdout: ${holdout.length} rows (${holdout[0]?.date} → ${holdout.at(-1)?.date})\n`);

  // ── baseline (current thresholds) ───────────────────────────────────────────
  console.log("═".repeat(80));
  console.log("CURRENT THRESHOLDS");
  console.log("═".repeat(80));
  console.log(`  ${describe(CURRENT)}`);
  printEval("Train", evaluate(train, CURRENT));
  printEval("Holdout", evaluate(holdout, CURRENT));

  // ── grid search ─────────────────────────────────────────────────────────────
  const grid = buildGrid();
  console.log(`\nGrid: ${grid.length} parameter combos\n`);

  const scored: Scored[] = grid.map((t) => {
    const trainEval = evaluate(train, t);
    const holdoutEval = evaluate(holdout, t);
    return {
      t,
      train: trainEval,
      holdout: holdoutEval,
      score: compositeScore(trainEval), // rank on train, validate on holdout
    };
  });

  // Filter: only combos with min SKIP and CATCHUP frequencies on train
  // (otherwise we're picking accidental winners with tiny samples).
  const candidates = scored.filter(
    (s) => s.train.skipN >= 8 && s.train.catchupN >= 5,
  );
  candidates.sort((a, b) => b.score - a.score);

  console.log("═".repeat(80));
  console.log(`TOP 10 BY TRAIN SCORE (filtered: train skipN≥8, catchupN≥5) — ${candidates.length} candidates`);
  console.log("═".repeat(80));
  for (const c of candidates.slice(0, 10)) {
    console.log(`\nscore=${c.score.toFixed(3)}  ${describe(c.t)}`);
    printEval("Train  ", c.train);
    printEval("Holdout", c.holdout);
  }

  // ── re-rank by holdout score and show top 5 ─────────────────────────────────
  const byHoldout = [...candidates].sort(
    (a, b) => compositeScore(b.holdout) - compositeScore(a.holdout),
  );
  console.log("\n" + "═".repeat(80));
  console.log("TOP 5 BY HOLDOUT SCORE (sanity check — should overlap with train top)");
  console.log("═".repeat(80));
  for (const c of byHoldout.slice(0, 5)) {
    console.log(`\nholdoutScore=${compositeScore(c.holdout).toFixed(3)}  trainScore=${c.score.toFixed(3)}  ${describe(c.t)}`);
    printEval("Train  ", c.train);
    printEval("Holdout", c.holdout);
  }

  // ── intersection: combos in top 20 on BOTH train and holdout ────────────────
  const trainTop = new Set(candidates.slice(0, 20).map((c) => JSON.stringify(c.t)));
  const robust = byHoldout
    .slice(0, 20)
    .filter((c) => trainTop.has(JSON.stringify(c.t)));
  console.log("\n" + "═".repeat(80));
  console.log(`ROBUST PICKS (top 20 on BOTH train and holdout) — ${robust.length} combos`);
  console.log("═".repeat(80));
  for (const c of robust.slice(0, 5)) {
    console.log(`\n${describe(c.t)}`);
    printEval("Train  ", c.train);
    printEval("Holdout", c.holdout);
  }
  if (robust.length === 0) {
    console.log("\nNo combos appear in the top 20 of both windows.");
    console.log("This usually means the optimal thresholds are unstable — keep the current ones.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
