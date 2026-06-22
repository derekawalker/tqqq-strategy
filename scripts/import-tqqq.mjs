/**
 * One-time import of TQQQ 5-min bars from Polygon flat files into Supabase.
 * Iterates day-files from TQQQ inception (2010-02-11) through today, downloads
 * each .csv.gz, filters for TQQQ rows, and upserts into tqqq_bars.
 *
 * Usage:
 *   dotenv -e .env.local -- node scripts/import-tqqq.mjs
 *
 * Re-running is safe — it skips dates already in the DB and upserts are idempotent.
 * Progress is printed as each day completes.
 */

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { gunzipSync } from "zlib";
import { createClient } from "@supabase/supabase-js";

const s3 = new S3Client({
  endpoint: "https://files.massive.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MASSIVE_KEY_ID?.trim(),
    secretAccessKey: process.env.MASSIVE_ACCESS_KEY?.trim(),
  },
  forcePathStyle: true,
  // SDK v3 defaults to computing checksums for all requests, which breaks
  // non-AWS S3-compatible endpoints. Only send checksums when required.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ─── helpers ─────────────────────────────────────────────────────────────────

function dateRange(from, to) {
  const dates = [];
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (cur <= end) {
    const d = cur.toISOString().slice(0, 10);
    dates.push(d);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function keyForDate(date) {
  const [y, m] = date.split("-");
  return `us_stocks_sip/minute_aggs_v1/${y}/${m}/${date}.csv.gz`;
}

async function fileExists(key) {
  try {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: "flatfiles", Prefix: key, MaxKeys: 1,
    }));
    return (res.Contents?.length ?? 0) > 0;
  } catch { return false; }
}

async function downloadAndFilter(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: "flatfiles", Key: key }));
  const bytes = await res.Body.transformToByteArray();
  const text = gunzipSync(bytes).toString("utf8");
  const lines = text.split("\n");
  // Header: ticker,volume,open,close,high,low,window_start,transactions
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith("TQQQ,")) continue;
    const [, volume, open, close, high, low, window_start] = line.split(",");
    const t = Math.floor(Number(window_start) / 1_000_000); // ns → ms
    if (!t || !close) continue;
    rows.push({ t, o: Number(open), h: Number(high), l: Number(low), c: Number(close), v: Number(volume) });
  }
  return rows;
}

async function upsert(rows) {
  if (rows.length === 0) return;
  const { error } = await sb.from("tqqq_bars").upsert(rows, { onConflict: "t" });
  if (error) throw new Error(`Supabase: ${error.message}`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

// --from YYYY-MM-DD overrides the DB resume date (useful after a truncate or plan change).
const fromArg = process.argv.find(a => a.startsWith("--from="))?.split("=")[1];

// Find the latest date already in the DB so we can skip ahead.
const { data: latestRow } = await sb.from("tqqq_bars").select("t").order("t", { ascending: false }).limit(1).single();
const latestMs = latestRow?.t ?? 0;
const resumeDate = fromArg ?? (latestMs
  ? new Date(latestMs).toISOString().slice(0, 10)
  : "2010-02-11");

const today = new Date().toISOString().slice(0, 10);
const dates = dateRange(resumeDate, today);

console.log(`Resuming from ${resumeDate}. ${dates.length} days to process through ${today}.\n`);

let totalBars = 0;
let daysProcessed = 0;
let daysSkipped = 0;

for (const date of dates) {
  const key = keyForDate(date);
  const exists = await fileExists(key);
  if (!exists) { daysSkipped++; continue; } // weekend / holiday

  try {
    const rows = await downloadAndFilter(key);
    await upsert(rows);
    totalBars += rows.length;
    daysProcessed++;
    process.stdout.write(`\r${date}  bars: ${rows.length}  total: ${totalBars.toLocaleString()}  days: ${daysProcessed}`);
  } catch (err) {
    console.error(`\nError on ${date}: ${err.message}`);
    // Continue — re-running will retry failed dates.
  }
}

console.log(`\n\nDone. ${daysProcessed} days imported, ${daysSkipped} skipped (weekends/holidays), ${totalBars.toLocaleString()} bars total.`);
