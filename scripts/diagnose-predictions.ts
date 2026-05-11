/**
 * Diagnose predicted vs realized 5d QQQ returns.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/diagnose-predictions.ts
 *
 * Reports:
 *   - n, pearson correlation
 *   - direction hit-rate (sign match) overall and by verdict
 *   - linear fit:  realized = a + b * predicted
 *   - average predicted/realized magnitudes (to show scale gap)
 *   - per-signal hit-rate on bin's avgReturn5d sign vs realized
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Row {
  date: string;
  verdict: "lean-long" | "lean-short" | "chop";
  expected_return_5d: number;
  edge: number;
  realized_return_5d_qqq: number | null;
  signals: Array<{ key: string; avgReturn5d: number | null; binLabel: string | null }>;
}

function mean(xs: number[]) { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function stdev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
function pearson(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return num / Math.sqrt(dx2 * dy2);
}
function linfit(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = num / den;
  return { a: my - b * mx, b };
}
function pct(n: number, d: number) { return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`; }
function fmt(x: number, digits = 3) { return x.toFixed(digits); }

async function main() {
  const { data, error } = await sb
    .from("sentiment_verdict_history")
    .select("date, verdict, expected_return_5d, edge, realized_return_5d_qqq, signals")
    .not("realized_return_5d_qqq", "is", null)
    .order("date", { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as Row[];
  if (rows.length < 5) {
    console.log(`Only ${rows.length} realized rows — need more data.`);
    return;
  }

  const predicted = rows.map((r) => r.expected_return_5d);
  const realized = rows.map((r) => r.realized_return_5d_qqq as number);
  const edges = rows.map((r) => r.edge);

  console.log(`\n=== Diagnostic: predicted vs realized 5d QQQ return ===`);
  console.log(`Window: ${rows[0].date} → ${rows[rows.length - 1].date}   n=${rows.length}`);

  console.log(`\n— Scale —`);
  console.log(`predicted: mean=${fmt(mean(predicted))}%  stdev=${fmt(stdev(predicted))}%  range=[${fmt(Math.min(...predicted))}, ${fmt(Math.max(...predicted))}]`);
  console.log(`realized:  mean=${fmt(mean(realized))}%  stdev=${fmt(stdev(realized))}%  range=[${fmt(Math.min(...realized))}, ${fmt(Math.max(...realized))}]`);
  console.log(`scale ratio (stdev realized / predicted): ${fmt(stdev(realized) / stdev(predicted), 1)}×`);

  console.log(`\n— Correlation —`);
  console.log(`pearson(predicted, realized) = ${fmt(pearson(predicted, realized))}`);
  console.log(`pearson(edge,      realized) = ${fmt(pearson(edges, realized))}`);

  console.log(`\n— Linear fit  realized = a + b·predicted —`);
  const { a, b } = linfit(predicted, realized);
  console.log(`a=${fmt(a)}  b=${fmt(b, 2)}   (if b ≈ 1 model is well-scaled; if b >> 1, predicted is just compressed)`);

  console.log(`\n— Direction hit-rate (sign of predicted edge vs realized) —`);
  const directional = rows.filter((r) => Math.abs(r.edge) > 0.001);
  const dirHits = directional.filter((r) => Math.sign(r.edge) === Math.sign(r.realized_return_5d_qqq as number)).length;
  console.log(`overall: ${dirHits}/${directional.length} = ${pct(dirHits, directional.length)}   (50% = coin flip)`);

  // baseline: always-long
  const upN = realized.filter((r) => r > 0).length;
  console.log(`baseline always-long: ${pct(upN, realized.length)}`);

  console.log(`\n— By verdict —`);
  for (const v of ["lean-long", "lean-short", "chop"] as const) {
    const sub = rows.filter((r) => r.verdict === v);
    if (sub.length === 0) { console.log(`${v.padEnd(11)} n=0`); continue; }
    const subReal = sub.map((r) => r.realized_return_5d_qqq as number);
    const hits = sub.filter((r) => {
      const rr = r.realized_return_5d_qqq as number;
      if (v === "lean-long") return rr > 0;
      if (v === "lean-short") return rr < 0;
      return Math.abs(rr) < 1;
    }).length;
    console.log(`${v.padEnd(11)} n=${String(sub.length).padStart(3)}  avg realized=${fmt(mean(subReal)).padStart(7)}%  hit-rate=${pct(hits, sub.length)}`);
  }

  console.log(`\n— Per-signal direction hit-rate (sign of bin avgReturn5d vs realized) —`);
  const signalKeys = new Set<string>();
  for (const r of rows) for (const s of r.signals ?? []) signalKeys.add(s.key);
  for (const key of signalKeys) {
    let n = 0, hits = 0, sumEdge = 0, sumReal = 0, n2 = 0;
    const xs: number[] = [], ys: number[] = [];
    for (const r of rows) {
      const s = (r.signals ?? []).find((x) => x.key === key);
      if (!s || s.avgReturn5d == null) continue;
      const rr = r.realized_return_5d_qqq as number;
      xs.push(s.avgReturn5d); ys.push(rr);
      sumEdge += s.avgReturn5d; sumReal += rr; n2++;
      if (Math.abs(s.avgReturn5d - 0.353) < 0.01) continue;  // skip near-baseline
      n++;
      if (Math.sign(s.avgReturn5d - 0.353) === Math.sign(rr)) hits++;
    }
    const corr = xs.length > 1 ? pearson(xs, ys) : NaN;
    console.log(`${key.padEnd(14)} n=${String(n).padStart(3)}  dir hit (vs baseline)=${pct(hits, n)}  pearson=${isFinite(corr) ? fmt(corr) : "n/a"}`);
  }

  console.log(`\n— Calibrated forecast preview —`);
  console.log(`Applying linfit to predicted: realized̂ = ${fmt(a)} + ${fmt(b, 2)} · predicted`);
  const calibrated = predicted.map((p) => a + b * p);
  const calCorr = pearson(calibrated, realized);
  console.log(`pearson after calibration: ${fmt(calCorr)}   (same as before — calibration only rescales)`);
  console.log(`calibrated predicted range: [${fmt(Math.min(...calibrated))}, ${fmt(Math.max(...calibrated))}]`);
}

main().catch((e) => { console.error(e); process.exit(1); });
