/**
 * Lightweight current-positions fetch — just today's option book + TQQQ
 * value, for callers (like the push-notification cron check) that don't need
 * the year of order/transaction history the main /api/schwab/data route
 * pulls. One request per account instead of seven.
 */

import { schwabFetch } from "./client";
import { getAccountHashes } from "./accounts";
import { parseOptionPositions, type OptionPosition } from "./parse";

export interface AccountPositions {
  accountNumber: string;
  tqqqValue: number;
  options: OptionPosition[];
}

async function fetchAccountPositions(accountNumber: string, hash: string): Promise<AccountPositions> {
  const res = await schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = res.ok ? (await res.json())?.securitiesAccount?.positions ?? [] : [];

  const options = parseOptionPositions(positions, accountNumber);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tqqqPosition = positions.find((p: any) => p.instrument?.symbol === "TQQQ");
  const tqqqValue = Math.abs(tqqqPosition?.marketValue ?? 0);

  return { accountNumber, tqqqValue, options };
}

/** Current option positions + TQQQ value across every linked account. */
export async function getAllAccountPositions(): Promise<AccountPositions[]> {
  const hashes = await getAccountHashes();
  return Promise.all(
    Object.entries(hashes).map(([accountNumber, hash]) => fetchAccountPositions(accountNumber, hash))
  );
}
