/**
 * Lightweight tastytrade account + option-position fetch for callers (the
 * push-notification cron) that don't need the order/transaction history the
 * /api/tastytrade/data route pulls. One positions request per account.
 */

import { tastyFetch } from "./client";
import { hasTastytradeCredentials } from "./config";
import { parseOptionPosition } from "./parse";
import type { OptionPosition } from "@/lib/schwab/parse";

// The account list is fixed for the life of the login, so it doesn't need
// re-fetching on every refresh.
const ACCOUNTS_TTL_MS = 60 * 60 * 1000;
let cachedAccounts: string[] | null = null;
let cachedAccountsAt = 0;

export async function getAccountNumbers(): Promise<string[]> {
  if (cachedAccounts && Date.now() - cachedAccountsAt < ACCOUNTS_TTL_MS) return cachedAccounts;

  const res = await tastyFetch("/customers/me/accounts");
  if (!res.ok) throw new Error(`accounts fetch failed: ${res.status}`);
  const json = await res.json();
  const allowList = process.env.TASTYTRADE_ACCOUNTS
    ? new Set(process.env.TASTYTRADE_ACCOUNTS.split(",").map((s) => s.trim()))
    : null;
  const accounts: string[] = (json.data?.items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((item: any) => !allowList || allowList.has(item.account["account-number"]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => item.account["account-number"] as string);
  cachedAccounts = accounts;
  cachedAccountsAt = Date.now();
  return accounts;
}

/** Current tracked option positions across every linked tastytrade account. */
export async function getAllOptionPositions(): Promise<OptionPosition[]> {
  if (!hasTastytradeCredentials()) return [];
  const accounts = await getAccountNumbers();
  const perAccount = await Promise.all(
    accounts.map(async (accountNumber) => {
      const res = await tastyFetch(`/accounts/${accountNumber}/positions`);
      if (!res.ok) throw new Error(`positions fetch failed for ${accountNumber}: ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = (await res.json()).data?.items ?? [];
      return items
        .map((p) => parseOptionPosition(p, accountNumber, new Map()))
        .filter((p): p is OptionPosition => p !== null);
    }),
  );
  return perAccount.flat();
}
