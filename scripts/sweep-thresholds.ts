/**
 * Sweep verdict threshold parameters against realized history.
 * Run with: npx tsx --env-file=.env.local scripts/sweep-thresholds.ts
 */

import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STRONG = 0.3;
const BASELINE = 0.356;

async function main() {
  const { data } = await db
    .from("sentiment_verdict_history")
    .select("realized_return_5d_qqq, expected_return_5d, signals")
    .not("realized_return_5d_qqq", "is", null)
    .order("date", { ascending: true });

  const rows = data ?? [];
  console.log(`n=${rows.length} rows with realized returns\n`);

  function evaluate(minUp: number, maxDown: number, minEdge: number) {
    let lN=0, lH=0, sN=0, sH=0, cN=0, cH=0;
    for (const r of rows) {
      const signals = r.signals as Array<{ informational?: boolean; lowConfidence: boolean; avgReturn5d: number | null }>;
      let up = 0, down = 0;
      for (const s of signals) {
        if (s.informational || s.lowConfidence || s.avgReturn5d == null) continue;
        const edge = s.avgReturn5d - BASELINE;
        if (edge > STRONG) up++;
        else if (edge < -STRONG) down++;
      }
      const edge = (r.expected_return_5d as number) - BASELINE;
      const rr = r.realized_return_5d_qqq as number;
      let pred: string;
      if (up >= minUp && down <= maxDown && edge >= minEdge)        pred = "long";
      else if (down >= minUp && up <= maxDown && -edge >= minEdge)  pred = "short";
      else                                                           pred = "chop";

      if (pred === "long")  { lN++; if (rr > 1.5)          lH++; }
      else if (pred === "short") { sN++; if (rr < -1.5)    sH++; }
      else                  { cN++; if (Math.abs(rr) <= 1.5) cH++; }
    }
    const hr = (n: number, h: number) => n ? `${String(h).padStart(2)}/${String(n).padStart(3)} ${((h/n)*100).toFixed(0).padStart(3)}%` : "  — ";
    const total = lN + sN + cN;
    const bullPct = ((lN/total)*100).toFixed(0).padStart(2);
    const bearPct = ((sN/total)*100).toFixed(0).padStart(2);
    return `bull${bullPct}% bear${bearPct}%  |  long ${hr(lN,lH)}  short ${hr(sN,sH)}  chop ${hr(cN,cH)}`;
  }

  console.log("minUp maxDown minEdge  frequency          hit-rates");
  console.log("─".repeat(80));
  for (const minUp of [2, 3, 4]) {
    for (const maxDown of [0, 1]) {
      for (const minEdge of [0, 0.05, 0.10]) {
        const label = `  ≥${minUp}up  ≤${maxDown}dn  e≥${minEdge.toFixed(2)}`;
        console.log(`${label}   ${evaluate(minUp, maxDown, minEdge)}`);
      }
    }
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
