/**
 * Lightweight current-positions fetch — just today's option book + TQQQ
 * value, for callers (like the push-notification cron check) that don't need
 * the year of order/transaction history the main /api/schwab/data route
 * pulls. One request per account instead of seven.
 */

import { schwabFetch } from "./client";
import { getAccountHashes } from "./accounts";
import type { OptionPosition } from "./parse";
import { isTrackedOptionUnderlying } from "@/lib/trackedSymbols";

export interface AccountPositions {
  accountNumber: string;
  tqqqValue: number;
  options: OptionPosition[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOptionPosition(p: any, accountNumber: string): OptionPosition | null {
  const sym: string = p.instrument?.symbol ?? "";
  const occMatch = sym.match(/^.{6}(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  let strike: number = p.instrument?.strikePrice ?? 0;
  let expiry: string = (p.instrument?.expirationDate as string)?.slice(0, 10) ?? "";
  if (occMatch) {
    const [, yy, mm, dd, , strikeRaw] = occMatch;
    if (!strike) strike = parseInt(strikeRaw, 10) / 1000;
    if (!expiry) expiry = `20${yy}-${mm}-${dd}`;
  }
  if (!strike) return null;
  const putCallRaw: string = p.instrument?.putCall ?? (occMatch?.[4] === "C" ? "CALL" : "PUT");
  const putCall: "CALL" | "PUT" = putCallRaw === "CALL" ? "CALL" : "PUT";
  return {
    accountNumber, symbol: sym,
    underlyingSymbol: p.instrument?.underlyingSymbol ?? "TQQQ",
    putCall, strike, expiry,
    shortQty: p.shortQuantity ?? 0, longQty: p.longQuantity ?? 0,
    marketValue: p.marketValue ?? 0, averagePrice: p.averagePrice ?? 0,
    openedAt: null,
  };
}

async function fetchAccountPositions(accountNumber: string, hash: string): Promise<AccountPositions> {
  const res = await schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = res.ok ? (await res.json())?.securitiesAccount?.positions ?? [] : [];

  const options = positions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) =>
      p.instrument?.assetType === "OPTION" &&
      isTrackedOptionUnderlying(p.instrument?.underlyingSymbol) &&
      ((p.shortQuantity ?? 0) > 0 || (p.longQuantity ?? 0) > 0)
    )
    .map((p) => parseOptionPosition(p, accountNumber))
    .filter((p): p is OptionPosition => p !== null);

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
