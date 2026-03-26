import { schwabFetch } from "@/lib/schwab/client";
import { getAccountHashes } from "@/lib/schwab/accounts";

export interface AccountBalance {
  accountNumber: string;
  totalValue: number;
  cash: number;
  tqqqValue: number;
  moneyMarketValue: number;  // SWVXX + SGOV
  optionsValue: number;
  otherValue: number;
  availableFunds: number;
  cashAvailableForTrading: number;
}

const MONEY_MARKET_SYMBOLS = ["SWVXX", "SGOV"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchBalance(accountNumber: string, hash: string): Promise<AccountBalance | null> {
  const res = await schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`);
  if (!res.ok) return null;
  const data = await res.json();

  const account = data?.securitiesAccount;
  if (!account) return null;

  const totalValue: number = account.currentBalances?.liquidationValue ?? 0;
  const availableFunds: number = account.currentBalances?.availableFunds ?? 0;
  const cashAvailableForTrading: number = account.currentBalances?.cashAvailableForTrading ?? 0;
  const cashBalance: number = account.currentBalances?.cashBalance ?? 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = account.positions ?? [];

  let tqqqValue = 0;
  let moneyMarketValue = 0;
  let optionsValue = 0;
  let otherValue = 0;

  for (const p of positions) {
    const symbol: string = p.instrument?.symbol ?? "";
    const assetType: string = p.instrument?.assetType ?? "";
    const mv: number = Math.abs(p.marketValue ?? 0);

    if (symbol === "TQQQ" && assetType !== "OPTION") {
      tqqqValue += mv;
    } else if (MONEY_MARKET_SYMBOLS.includes(symbol)) {
      moneyMarketValue += mv;
    } else if (assetType === "OPTION") {
      optionsValue += mv;
    } else {
      otherValue += mv;
    }
  }

  // Cash = total minus all known position values
  const cash = Math.max(0, cashBalance);

  return {
    accountNumber,
    totalValue,
    cash,
    tqqqValue,
    moneyMarketValue,
    optionsValue,
    otherValue,
    availableFunds,
    cashAvailableForTrading,
  };
}

export async function GET() {
  try {
    const hashes = await getAccountHashes();
    const accounts = Object.entries(hashes);

    const results = await Promise.all(
      accounts.map(([accountNumber, hash]) => fetchBalance(accountNumber, hash))
    );

    const balances = results.filter((b): b is AccountBalance => b !== null);
    return Response.json(balances);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
