import { tastyFetch } from "@/lib/tastytrade/client";
import { getOptionMarks } from "@/lib/tastytrade/quotes";
import {
  parseFilledOrder,
  parseFilledOptionOrder,
  parseWorkingOrder,
  parseOptionPosition,
  parseExpiredOptionOrder,
  parseTransaction,
  FilledOrder,
  FilledOptionOrder,
  WorkingOrder,
  OptionPosition,
  ExpiredOptionOrder,
} from "@/lib/tastytrade/parse";
import type { AccountBalance, Transaction } from "@/app/api/schwab/data/route";

const MONEY_MARKET_SYMBOLS = ["SGOV", "BIL", "SHV"];

async function fetchAccountData(accountNumber: string, from365: string, to: string) {
  const [filledRes, workingRes, positionsRes, rxDeliverRes, divIntRes, balanceRes] =
    await Promise.all([
      tastyFetch(`/accounts/${accountNumber}/orders?status[]=Filled&start-date=${from365}&end-date=${to}`),
      tastyFetch(`/accounts/${accountNumber}/orders?status[]=Live&status[]=Pending&status[]=Received`),
      tastyFetch(`/accounts/${accountNumber}/positions`),
      tastyFetch(`/accounts/${accountNumber}/transactions?types[]=Receive+Deliver&start-date=${from365}&end-date=${to}`),
      tastyFetch(`/accounts/${accountNumber}/transactions?types[]=Dividend&types[]=Interest&start-date=${from365}&end-date=${to}`),
      tastyFetch(`/accounts/${accountNumber}/balances`),
    ]);

  // Fetch real-time marks in parallel with processing below

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filledRaw: any[] = filledRes.ok ? (await filledRes.json()).data?.items ?? [] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workingRaw: any[] = workingRes.ok ? (await workingRes.json()).data?.items ?? [] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positionsRaw: any[] = positionsRes.ok ? (await positionsRes.json()).data?.items ?? [] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rxDeliverRaw: any[] = rxDeliverRes.ok ? (await rxDeliverRes.json()).data?.items ?? [] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const divIntRaw: any[] = divIntRes.ok ? (await divIntRes.json()).data?.items ?? [] : [];
  const balanceData = balanceRes.ok ? (await balanceRes.json()).data : null;

  // Build openedAt map from filled option orders (earliest Sell to Open per symbol)
  const openedAtMap = new Map<string, string>();
  for (const order of filledRaw) {
    if (order.status !== "Filled") continue;
    for (const leg of order.legs ?? []) {
      if (leg["instrument-type"] !== "Equity Option") continue;
      if (leg.action !== "Sell to Open") continue;
      const sym: string = (leg.symbol as string ?? "").trim();
      const time: string = order["terminal-at"] ?? order["received-at"] ?? "";
      if (!openedAtMap.has(sym) || time < openedAtMap.get(sym)!) {
        openedAtMap.set(sym, time);
      }
    }
  }

  const filled: FilledOrder[] = filledRaw
    .map((o) => parseFilledOrder(o, accountNumber))
    .filter((o): o is FilledOrder => o !== null);

  const filledOptions: FilledOptionOrder[] = filledRaw.flatMap((o) =>
    parseFilledOptionOrder(o, accountNumber),
  );

  const working: WorkingOrder[] = workingRaw
    .map((o) => parseWorkingOrder(o, accountNumber))
    .filter((o): o is WorkingOrder => o !== null);

  const expiredOptions: ExpiredOptionOrder[] = rxDeliverRaw
    .map((tx) => parseExpiredOptionOrder(tx, accountNumber))
    .filter((o): o is ExpiredOptionOrder => o !== null);

  const optionsRaw: OptionPosition[] = positionsRaw
    .map((p) => parseOptionPosition(p, accountNumber, openedAtMap))
    .filter((p): p is OptionPosition => p !== null);

  // Apply real-time marks from DXLink
  const marks = await getOptionMarks(optionsRaw.map((p) => p.symbol));
  const options: OptionPosition[] = optionsRaw.map((p) => {
    const mark = marks.get(p.symbol);
    if (mark === undefined) return p;
    const marketValue = p.shortQty > 0
      ? -(mark * 100 * p.shortQty)
      : mark * 100 * p.longQty;
    return { ...p, marketValue };
  });

  // TQQQ equity position
  const tqqqPos = positionsRaw.find(
    (p) => p["instrument-type"] === "Equity" && p.symbol === "TQQQ",
  );
  const tqqqShares: number = tqqqPos ? parseFloat(tqqqPos.quantity ?? "0") : 0;
  const tqqqAvgPrice: number = tqqqPos
    ? parseFloat(tqqqPos["average-open-price"] ?? "0")
    : 0;

  // Balance breakdown from positions
  let tqqqValue = 0, moneyMarketValue = 0, optionsValue = 0, otherValue = 0;
  for (const p of positionsRaw) {
    const sym: string = p.symbol ?? "";
    const type: string = p["instrument-type"] ?? "";
    const mv = Math.abs(parseFloat(p["market-value"] ?? "0"));
    if (sym === "TQQQ" && type === "Equity") tqqqValue += mv;
    else if (MONEY_MARKET_SYMBOLS.includes(sym)) moneyMarketValue += mv;
    else if (type === "Equity Option") optionsValue += mv;
    else otherValue += mv;
  }

  const balance: AccountBalance | null = balanceData
    ? {
        accountNumber,
        totalValue: parseFloat(balanceData["net-liquidating-value"] ?? "0"),
        cash: Math.max(0, parseFloat(balanceData["cash-balance"] ?? "0")),
        tqqqValue,
        moneyMarketValue,
        optionsValue,
        otherValue,
        availableFunds: parseFloat(balanceData["equity-buying-power"] ?? "0"),
        cashAvailableForTrading: parseFloat(balanceData["equity-buying-power"] ?? "0"),
      }
    : null;

  const transactions: Transaction[] = divIntRaw
    .map((tx) => parseTransaction(tx, accountNumber))
    .filter((t): t is Transaction => t !== null);

  return { filled, filledOptions, expiredOptions, working, tqqqShares, tqqqAvgPrice, options, balance, transactions };
}

export async function GET() {
  if (!process.env.TASTYTRADE_USERNAME) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const res = await tastyFetch("/customers/me/accounts");
    if (!res.ok) throw new Error(`accounts fetch failed: ${res.status}`);
    const json = await res.json();
    const allowList = process.env.TASTYTRADE_ACCOUNTS
      ? new Set(process.env.TASTYTRADE_ACCOUNTS.split(",").map((s) => s.trim()))
      : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts: string[] = (json.data?.items ?? [])
      .filter((item: any) => !allowList || allowList.has(item.account["account-number"]))
      .map((item: any) => item.account["account-number"] as string);

    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from365 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const results = await Promise.all(
      accounts.map((accountNumber) => fetchAccountData(accountNumber, from365, to)),
    );

    const filledOrders: FilledOrder[] = results
      .flatMap((r) => r.filled)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const filledOptionOrders: FilledOptionOrder[] = results
      .flatMap((r) => r.filledOptions)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const expiredOptionOrders: ExpiredOptionOrder[] = results
      .flatMap((r) => r.expiredOptions)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const workingOrders: WorkingOrder[] = results
      .flatMap((r) => r.working)
      .sort((a, b) => new Date(b.enteredTime).getTime() - new Date(a.enteredTime).getTime());
    const tqqqShares: Record<string, number> = Object.fromEntries(
      accounts.map((num, i) => [num, results[i].tqqqShares]),
    );
    const tqqqAvgPrice: Record<string, number> = Object.fromEntries(
      accounts.map((num, i) => [num, results[i].tqqqAvgPrice]),
    );
    const optionPositions: OptionPosition[] = results.flatMap((r) => r.options);
    const balances: AccountBalance[] = results
      .map((r) => r.balance)
      .filter((b): b is AccountBalance => b !== null);
    const transactions: Transaction[] = results
      .flatMap((r) => r.transactions)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return Response.json({
      filledOrders,
      filledOptionOrders,
      expiredOptionOrders,
      workingOrders,
      tqqqShares,
      tqqqAvgPrice,
      optionPositions,
      balances,
      transactions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
