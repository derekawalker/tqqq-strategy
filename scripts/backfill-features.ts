/**
 * One-time backfill: fetches 5 years of daily history and populates
 * the daily_features table in Supabase with feature vectors + realized returns.
 *
 * Run once before the first retrain:
 *   npx tsx scripts/backfill-features.ts
 *
 * After this, the daily Retrain button keeps the table up to date.
 */

import YahooFinance from "yahoo-finance2";
import { createClient } from "@supabase/supabase-js";
import { computeFeaturesAt, alignSeries } from "@/lib/features";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YEARS = 5;

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`Fetching ${YEARS}y of daily history...`);
  const period1 = new Date(Date.now() - (YEARS * 365 + 30) * 24 * 60 * 60 * 1000);

  const [qqqR, vixR, vix3mR, tnxR, skewR] = await Promise.all([
    yf.chart("QQQ",    { period1, interval: "1d" }),
    yf.chart("^VIX",   { period1, interval: "1d" }),
    yf.chart("^VIX3M", { period1, interval: "1d" }),
    yf.chart("^TNX",   { period1, interval: "1d" }),
    yf.chart("^SKEW",  { period1, interval: "1d" }),
  ]);

  const toSeries = (r: typeof qqqR) =>
    r.quotes
      .filter((q) => q.close != null && q.date != null)
      .map((q) => ({
        date: (q.date as Date).toISOString().slice(0, 10),
        close: q.close as number,
      }));

  const qqq   = toSeries(qqqR);
  const vix   = toSeries(vixR);
  const vix3m = toSeries(vix3mR);
  const tnx   = toSeries(tnxR);
  const skew  = toSeries(skewR);

  console.log(`QQQ: ${qqq.length} days, VIX: ${vix.length}, VIX3M: ${vix3m.length}, TNX: ${tnx.length}, SKEW: ${skew.length}`);

  const { dates, qqqCloses, vixCloses, vix3mCloses, tnxCloses, skewByDate } =
    alignSeries(qqq, vix, vix3m, tnx, skew);

  console.log(`Aligned dataset: ${dates.length} common trading days`);

  // Build a map of QQQ closes by date for computing realized returns
  const qqqByDate = new Map(qqq.map((d) => [d.date, d.close]));
  const tradingDays = dates; // already sorted ascending

  let computed = 0;
  const records = [];

  for (let i = 0; i < dates.length; i++) {
    const f = computeFeaturesAt(
      i, qqqCloses, vixCloses, vix3mCloses, tnxCloses,
      skewByDate.get(dates[i]) ?? null,
      dates[i],
    );
    if (!f) continue;

    // realized_1d_ret for date D = next trading day's return relative to D's close
    const nextDate = tradingDays[i + 1];
    const nextClose = nextDate ? qqqByDate.get(nextDate) : undefined;
    const realized1dRet = nextClose != null
      ? Math.round(((nextClose - f.qqqClose) / f.qqqClose) * 100 * 10000) / 10000
      : null;

    records.push({
      date: f.date,
      qqq_close: f.qqqClose,
      qqq_1d_ret: f.qqq1dRet,
      qqq_3d_ret: f.qqq3dRet,
      qqq_5d_ret: f.qqq5dRet,
      vix_level: f.vixLevel,
      vix_1d_change: f.vix1dChange,
      vix_term: f.vixTerm,
      pct_above_200ma: f.pctAbove200ma,
      realized_vol_20d: f.realizedVol20d,
      tnx_mom_20d: f.tnxMom20d,
      skew_level: f.skewLevel,
      realized_1d_ret: realized1dRet,
      updated_at: new Date().toISOString(),
    });
    computed++;
  }

  console.log(`Computed features for ${computed} days. Upserting to Supabase...`);

  // Upsert in batches of 100
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { error } = await supabase
      .from("daily_features")
      .upsert(batch, { onConflict: "date" });
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed:`, error.message);
    } else {
      upserted += batch.length;
      process.stdout.write(`\r  ${upserted}/${records.length} rows upserted`);
    }
  }
  console.log(`\nDone. ${upserted} rows upserted to daily_features.`);
  console.log(`\nNext step: click "Retrain & refresh" in the app to fit the model.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
