/**
 * CLI backtest engine. The simulation logic now lives in src/lib/backtest.ts (pure) and the Yahoo
 * fetchers in src/lib/marketData.ts — both shared with the /api/backtest route. This module just
 * re-exports those for the CLI scripts (backtest.ts / optimize.ts / checkConfig.ts) and adds the
 * Supabase-backed account lookup, which only the CLI needs.
 */
import { createClient } from "@supabase/supabase-js";

export * from "../src/lib/backtest";
export { type Interval, type DateRange, dailyCloses, intradayBars } from "../src/lib/marketData";

export interface AccountCfg { accountNumber: string; startingCash: number; sellPct: number; R: number }

export async function getSettings(account: string): Promise<AccountCfg> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("settings").select("value").eq("key", "accounts").single();
  const accts = (data?.value ?? []) as Array<{ accountNumber: string; settings: Record<string, number> }>;
  const a = accts.find((x) => x.accountNumber === account) ?? accts[0];
  const s = a.settings;
  return { accountNumber: a.accountNumber, startingCash: s.levelStartingCash, sellPct: s.sellPercentage, R: s.reductionFactor };
}
