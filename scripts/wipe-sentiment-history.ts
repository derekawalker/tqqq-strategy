/**
 * One-off: delete all rows from sentiment_verdict_history.
 * Run with: npx tsx --env-file=.env.local scripts/wipe-sentiment-history.ts
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(url, key);

  const { count: before } = await db
    .from("sentiment_verdict_history")
    .select("*", { count: "exact", head: true });
  console.log(`Rows before delete: ${before}`);

  const { error } = await db
    .from("sentiment_verdict_history")
    .delete()
    .gte("date", "1900-01-01");
  if (error) throw error;

  const { count: after } = await db
    .from("sentiment_verdict_history")
    .select("*", { count: "exact", head: true });
  console.log(`Rows after delete: ${after}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
