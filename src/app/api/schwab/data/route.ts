import { DEMO_DATA } from "@/lib/demo-data";
import { schwabFetch } from "@/lib/schwab/client";
import { getAccountHashes } from "@/lib/schwab/accounts";
import {
  flattenOrders,
  parseFilledOrder,
  parseFilledOptionOrder,
  parseWorkingOrder,
  parseExpiredOptionOrder,
  FilledOrder,
  FilledOptionOrder,
  WorkingOrder,
  OptionPosition,
  ExpiredOptionOrder,
} from "@/lib/schwab/parse";

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

export interface Transaction {
  activityId: number;
  accountNumber: string;
  time: string;
  description: string;
  symbol: string | null;
  amount: number;
  category: "dividend" | "interest";
}

export interface SchwabData {
  filledOrders: FilledOrder[];
  filledOptionOrders: FilledOptionOrder[];
  expiredOptionOrders: ExpiredOptionOrder[];
  workingOrders: WorkingOrder[];
  tqqqShares: Record<string, number>;
  tqqqAvgPrice: Record<string, number>;
  optionPositions: OptionPosition[];
  balances: AccountBalance[];
  transactions: Transaction[];
}

const MONEY_MARKET_SYMBOLS = ["SWVXX", "SGOV"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTransaction(t: any, accountNumber: string): Transaction | null {
  if (t.type !== "DIVIDEND_OR_INTEREST") return null;
  const amount: number = t.netAmount ?? 0;
  if (amount === 0) return null;

  const description: string = t.description ?? "";
  // Only actual bank interest (1099-INT) is "interest"; everything else — including
  // money market fund distributions — is a dividend (1099-DIV) for tax purposes.
  const category: "dividend" | "interest" = description.toUpperCase().startsWith("BANK INT") ? "interest" : "dividend";

  // transferItems only ever contains CURRENCY_USD — no ticker is available from the API.
  return { activityId: t.activityId, accountNumber, time: t.time, description, symbol: null, amount, category };
}

async function fetchAccountData(
  accountNumber: string,
  hash: string,
  from90: string,
  to: string,
  from365: string,
) {
  const [filledRes, workingRes, pendingRes, positionsRes, rxDeliverRes, divIntRes, tradeRes] = await Promise.all([
    schwabFetch(`/trader/v1/accounts/${hash}/orders?fromEnteredTime=${from90}&toEnteredTime=${to}&status=FILLED`),
    schwabFetch(`/trader/v1/accounts/${hash}/orders?fromEnteredTime=${from90}&toEnteredTime=${to}&status=WORKING`),
    schwabFetch(`/trader/v1/accounts/${hash}/orders?fromEnteredTime=${from90}&toEnteredTime=${to}&status=PENDING_ACTIVATION`),
    schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`),
    schwabFetch(`/trader/v1/accounts/${hash}/transactions?startDate=${from90}&endDate=${to}&types=RECEIVE_AND_DELIVER`),
    schwabFetch(`/trader/v1/accounts/${hash}/transactions?startDate=${from365}&endDate=${to}&types=DIVIDEND_OR_INTEREST`),
    schwabFetch(`/trader/v1/accounts/${hash}/transactions?startDate=${from90}&endDate=${to}&types=TRADE`),
  ]);

  const filledRaw = filledRes.ok ? await filledRes.json() : [];
  const workingRaw = [
    ...(workingRes.ok ? await workingRes.json() : []),
    ...(pendingRes.ok ? await pendingRes.json() : []),
  ];
  const positionsData = positionsRes.ok ? await positionsRes.json() : null;
  const rxDeliverRaw = rxDeliverRes.ok ? await rxDeliverRes.json() : [];
  const divIntRaw = divIntRes.ok ? await divIntRes.json() : [];
  const tradeRaw = tradeRes.ok ? await tradeRes.json() : [];

  // Build orderId → total fees (negative) from TRADE transactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feeByOrderId = new Map<number, number>();
  for (const tx of Array.isArray(tradeRaw) ? tradeRaw : []) {
    const rawId = tx.orderId;
    const orderId = typeof rawId === "string" ? parseInt(rawId, 10) : (rawId as number);
    if (!orderId || isNaN(orderId)) continue;
    const f = tx.fees ?? {};
    const total = -(
      (f.commission     ?? 0) +
      (f.secFee         ?? 0) +
      (f.tafFee         ?? 0) +
      (f.optRegFee      ?? 0) +
      (f.additionalFee  ?? 0)
    );
    feeByOrderId.set(orderId, (feeByOrderId.get(orderId) ?? 0) + total);
  }

  // --- Orders ---
  const flatFilled = flattenOrders(Array.isArray(filledRaw) ? filledRaw : []);
  const filled = flatFilled
    .map((o) => parseFilledOrder(o, accountNumber))
    .filter((o): o is FilledOrder => o !== null)
    .map((o) => ({ ...o, fees: feeByOrderId.get(o.orderId) ?? 0 }));

  const filledOptionsRaw = flatFilled.flatMap((o) => parseFilledOptionOrder(o, accountNumber));
  // Prorate fees across legs of the same order by contracts
  const optionOrderContracts = new Map<number, number>();
  for (const o of filledOptionsRaw) {
    optionOrderContracts.set(o.orderId, (optionOrderContracts.get(o.orderId) ?? 0) + o.contracts);
  }
  const filledOptions = filledOptionsRaw.map((o) => {
    const orderFees = feeByOrderId.get(o.orderId) ?? 0;
    const totalContracts = optionOrderContracts.get(o.orderId) ?? o.contracts;
    return { ...o, fees: orderFees * (o.contracts / totalContracts) };
  });
  const working = flattenOrders(Array.isArray(workingRaw) ? workingRaw : [])
    .map((o) => parseWorkingOrder(o, accountNumber))
    .filter((o): o is WorkingOrder => o !== null);

  // --- Expired options from RECEIVE_AND_DELIVER ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expiredOptions: ExpiredOptionOrder[] = (Array.isArray(rxDeliverRaw) ? rxDeliverRaw as any[] : [])
    .map((tx: any) => parseExpiredOptionOrder(tx, accountNumber))
    .filter((o): o is ExpiredOptionOrder => o !== null);

  // --- Positions (shared for snapshot + balances) ---
  const account = positionsData?.securitiesAccount;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = account?.positions ?? [];

  // Snapshot: TQQQ shares + option positions
  const tqqqPosition = positions.find((p: any) => p.instrument?.symbol === "TQQQ");
  const tqqqShares: number = tqqqPosition?.longQuantity ?? 0;
  const tqqqAvgPrice: number = tqqqPosition?.averagePrice ?? 0;

  const optionOpenDates = new Map<string, string>();
  for (const order of flatFilled) {
    if (order.status !== "FILLED") continue;
    const leg = order.orderLegCollection?.[0];
    if (!leg || leg.orderLegType !== "OPTION" || leg.instruction !== "SELL_TO_OPEN") continue;
    const sym: string = leg.instrument?.symbol;
    if (!sym) continue;
    if (!optionOpenDates.has(sym) || order.closeTime < optionOpenDates.get(sym)!) {
      optionOpenDates.set(sym, order.closeTime);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: OptionPosition[] = positions
    .filter((p: any) =>
      p.instrument?.assetType === "OPTION" &&
      p.instrument?.underlyingSymbol === "TQQQ" &&
      ((p.shortQuantity ?? 0) > 0 || (p.longQuantity ?? 0) > 0)
    )
    .map((p: any): OptionPosition | null => {
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
        accountNumber, symbol: sym, putCall, strike, expiry,
        shortQty: p.shortQuantity ?? 0, longQty: p.longQuantity ?? 0,
        marketValue: p.marketValue ?? 0, averagePrice: p.averagePrice ?? 0,
        openedAt: optionOpenDates.get(sym) ?? null,
      };
    })
    .filter((p): p is OptionPosition => p !== null);

  // Balances: from positions data
  let tqqqValue = 0, moneyMarketValue = 0, optionsValue = 0, otherValue = 0;
  for (const p of positions) {
    const symbol: string = p.instrument?.symbol ?? "";
    const assetType: string = p.instrument?.assetType ?? "";
    const mv: number = Math.abs(p.marketValue ?? 0);
    if (symbol === "TQQQ" && assetType !== "OPTION") tqqqValue += mv;
    else if (MONEY_MARKET_SYMBOLS.includes(symbol)) moneyMarketValue += mv;
    else if (assetType === "OPTION") optionsValue += mv;
    else otherValue += mv;
  }
  const balance: AccountBalance | null = account ? {
    accountNumber,
    totalValue: account.currentBalances?.liquidationValue ?? 0,
    cash: Math.max(0, account.currentBalances?.cashBalance ?? 0),
    tqqqValue,
    moneyMarketValue,
    optionsValue,
    otherValue,
    availableFunds: account.currentBalances?.buyingPowerNonMarginableTrade ?? 0,
    cashAvailableForTrading: account.currentBalances?.buyingPowerNonMarginableTrade ?? 0,
  } : null;

  // Transactions: dividends + interest
  const transactions: Transaction[] = (Array.isArray(divIntRaw) ? divIntRaw : [])
    .map((t: any) => parseTransaction(t, accountNumber))
    .filter((t): t is Transaction => t !== null);

  return { filled, filledOptions, expiredOptions, working, tqqqShares, tqqqAvgPrice, options, balance, transactions };
}

export async function GET() {
  if (process.env.DEMO_MODE === "true") {
    return Response.json(DEMO_DATA satisfies SchwabData);
  }

  try {
    const hashes = await getAccountHashes();
    const accounts = Object.entries(hashes);

    const now = new Date();
    const to = now.toISOString().split(".")[0] + "Z";
    const from90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split(".")[0] + "Z";
    const from365 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split(".")[0] + "Z";

    const results = await Promise.all(
      accounts.map(([accountNumber, hash]) => fetchAccountData(accountNumber, hash, from90, to, from365))
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
      accounts.map(([num], i) => [num, results[i].tqqqShares])
    );
    const tqqqAvgPrice: Record<string, number> = Object.fromEntries(
      accounts.map(([num], i) => [num, results[i].tqqqAvgPrice])
    );
    const optionPositions: OptionPosition[] = results.flatMap((r) => r.options);
    const balances: AccountBalance[] = results.map((r) => r.balance).filter((b): b is AccountBalance => b !== null);
    const transactions: Transaction[] = results
      .flatMap((r) => r.transactions)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return Response.json({
      filledOrders, filledOptionOrders, expiredOptionOrders, workingOrders,
      tqqqShares, tqqqAvgPrice, optionPositions, balances, transactions,
    } satisfies SchwabData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
