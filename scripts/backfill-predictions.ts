/**
 * Backfills predicted_return_5d for all historical rows that have signals JSONB
 * but a null predicted_return_5d — no price data re-fetch needed.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/backfill-predictions.ts
 *   npx tsx --env-file=.env.local scripts/backfill-predictions.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key);
}

type SignalKey =
  | "vixTerm" | "vixSpike" | "rsi2InTrend" | "pctAbove200ma"
  | "realizedVol20Pct" | "hygSpyDiv" | "tnxMom20" | "tltMom20" | "skewLevel";

type MagnitudeModel = {
  intercept: number;
  coefficients: Record<SignalKey, number>;
  featureSignals: SignalKey[];
  mae: number;
  pearson: number;
};

const statsData = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/signal-stats.json"), "utf8")
) as { magnitudeModel: MagnitudeModel };

const MODEL: MagnitudeModel = statsData.magnitudeModel;

function applyModel(signals: Array<{ key: string; vsBaseline: number | null }>): number {
  const byKey = new Map(signals.map((s) => [s.key, s.vsBaseline ?? 0]));
  let sum = MODEL.intercept;
  for (const sk of MODEL.featureSignals) {
    const edge = byKey.get(sk) ?? 0;
    sum += (MODEL.coefficients[sk] ?? 0) * edge;
  }
  return Math.round(sum * 1000) / 1000;
}

async function main() {
  const db = supabase();

  console.log("Fetching rows with null predicted_return_5d...");
  const { data, error } = await db
    .from("sentiment_verdict_history")
    .select("date, signals")
    .is("predicted_return_5d", null)
    .not("signals", "is", null)
    .order("date", { ascending: true });

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    console.log("No rows to update — all already have predicted_return_5d.");
    return;
  }

  console.log(`Found ${data.length} rows to update.`);

  // Compute predictions
  type Update = { date: string; predicted_return_5d: number };
  const updates: Update[] = [];
  for (const row of data) {
    const signals = row.signals as Array<{ key: string; vsBaseline: number | null }>;
    if (!Array.isArray(signals) || signals.length === 0) continue;
    updates.push({
      date: row.date as string,
      predicted_return_5d: applyModel(signals),
    });
  }

  console.log(`\nSample (first 5):`);
  for (const u of updates.slice(0, 5)) {
    console.log(`  ${u.date}  predicted=${u.predicted_return_5d >= 0 ? "+" : ""}${u.predicted_return_5d.toFixed(3)}%`);
  }

  if (DRY_RUN) {
    console.log(`\nDry run — ${updates.length} rows would be updated.`);
    return;
  }

  // Update 10 at a time using parallel .update().eq() calls
  const PARALLEL = 10;
  let updated = 0;
  for (let i = 0; i < updates.length; i += PARALLEL) {
    const batch = updates.slice(i, i + PARALLEL);
    await Promise.all(
      batch.map((u) =>
        db
          .from("sentiment_verdict_history")
          .update({ predicted_return_5d: u.predicted_return_5d })
          .eq("date", u.date)
          .then(({ error: upErr }) => {
            if (upErr) throw new Error(`Update failed for ${u.date}: ${upErr.message}`);
          }),
      ),
    );
    updated += batch.length;
    process.stdout.write(`\rUpdated ${updated} / ${updates.length}...`);
  }

  console.log(`\nDone. ${updated} rows backfilled with predicted_return_5d.`);
  console.log(`Model: intercept=${MODEL.intercept}, MAE=${MODEL.mae}%, pearson=${MODEL.pearson}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
