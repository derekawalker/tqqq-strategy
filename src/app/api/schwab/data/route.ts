import { isTrackedOptionUnderlying } from "@/lib/trackedSymbols";
import { DEMO_DATA } from "@/lib/demo-data";
import { schwabFetch } from "@/lib/schwab/client";
import { getAccountHashes } from "@/lib/schwab/accounts";
import { fetchAllOrders } from "@/lib/schwab/orders";
import { getCached, setCached } from "@/lib/ttlCache";
import { loadAccountHistory, optionOpenDates, type AccountHistory } from "@/lib/accountHistory";
import { singleFlight } from "@/lib/singleFlight";
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
  category: "dividend" | "interest" | "transfer";
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

const toSchwabTime = (d: Date) => d.toISOString().split(".")[0] + "Z";

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

/** Fills, option fills, expirations and dividends/interest in [from, to] — the part stored by accountHistory. */
async function fetchHistory(accountNumber: string, hash: string, fromDate: Date, toDate: Date): Promise<AccountHistory> {
  const from = toSchwabTime(fromDate);
  const to = toSchwabTime(toDate);
  const [filledRaw, rxDeliverRes, divIntRes, tradeRes] = await Promise.all([
    fetchAllOrders(async (f, until) => {
      const res = await schwabFetch(`/trader/v1/accounts/${hash}/orders?fromEnteredTime=${f}&toEnteredTime=${until}&status=FILLED`);
      if (!res.ok) throw new Error(`Schwab filled orders request failed: ${res.status}`);
      return res.json();
    }, fromDate, toDate),
    schwabFetch(`/trader/v1/accounts/${hash}/transactions?startDate=${from}&endDate=${to}&types=RECEIVE_AND_DELIVER`),
    schwabFetch(`/trader/v1/accounts/${hash}/transactions?startDate=${from}&endDate=${to}&types=DIVIDEND_OR_INTEREST`),
    schwabFetch(`/trader/v1/accounts/${hash}/transactions?startDate=${from}&endDate=${to}&types=TRADE`),
  ]);
  // A failed request must fail the load: an empty list here would be stored as "no history".
  for (const res of [rxDeliverRes, divIntRes, tradeRes]) {
    if (!res.ok) throw new Error(`Schwab transactions request failed: ${res.status}`);
  }
  const rxDeliverRaw = await rxDeliverRes.json();
  const divIntRaw = await divIntRes.json();
  const tradeRaw = await tradeRes.json();

  // Build fee maps from TRADE transactions.
  // Fees are transferItems entries with a feeType field (COMMISSION, OPT_REG_FEE, SEC_FEE, TAF_FEE, etc.)
  // For equity orders: keyed by orderId alone (single instrument per order).
  // For option orders: keyed by "orderId_symbol" so each leg gets its own exact fees.
  const feeByOrderId = new Map<number, number>();          // equity
  const feeByOrderIdSymbol = new Map<string, number>();    // options
  for (const tx of Array.isArray(tradeRaw) ? tradeRaw : []) {
    const orderId: number = tx.orderId;
    if (!orderId) continue;
    let txFees = 0;
    for (const item of tx.transferItems ?? []) {
      if (item.feeType && typeof item.amount === "number" && item.amount > 0) {
        txFees += item.amount;
      }
    }
    if (txFees === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optionItem = tx.transferItems?.find((i: any) => i.instrument?.assetType === "OPTION");
    if (optionItem) {
      const symbol: string = (optionItem.instrument.symbol as string).trim();
      const key = `${orderId}_${symbol}`;
      feeByOrderIdSymbol.set(key, (feeByOrderIdSymbol.get(key) ?? 0) - txFees);
    } else {
      feeByOrderId.set(orderId, (feeByOrderId.get(orderId) ?? 0) - txFees);
    }
  }

  const flatFilled = flattenOrders(filledRaw);
  // Each Schwab order is one level: a partial fill arrives as one order with several
  // executions, which parseFilledOrder already sums. Separate orders are never merged —
  // levels that fill together on a gap would otherwise collapse into one unmatched lot.
  const filled = flatFilled
    .map((o) => parseFilledOrder(o, accountNumber))
    .filter((o): o is FilledOrder => o !== null)
    .map((o) => ({ ...o, fees: feeByOrderId.get(o.orderId) ?? 0 }));

  // Look up fees per leg by orderId+symbol (exact match, no proration needed)
  const filledOptions = flatFilled
    .flatMap((o) => parseFilledOptionOrder(o, accountNumber))
    .map((o) => ({ ...o, fees: feeByOrderIdSymbol.get(`${o.orderId}_${o.symbol.trim()}`) ?? 0 }));

  // --- Expired options from RECEIVE_AND_DELIVER ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expiredOptions: ExpiredOptionOrder[] = (Array.isArray(rxDeliverRaw) ? rxDeliverRaw as any[] : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((tx: any) => parseExpiredOptionOrder(tx, accountNumber))
    .filter((o): o is ExpiredOptionOrder => o !== null);

  // Transactions: dividends + interest
  const transactions: Transaction[] = (Array.isArray(divIntRaw) ? divIntRaw : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => parseTransaction(t, accountNumber))
    .filter((t): t is Transaction => t !== null);

  return { filled, filledOptions, expiredOptions, transactions };
}

async function fetchAccountData(accountNumber: string, hash: string, from365: string, to: string) {
  const [history, workingRes, pendingRes, positionsRes] = await Promise.all([
    loadAccountHistory("schwab", accountNumber, (f, t) => fetchHistory(accountNumber, hash, f, t)),
    schwabFetch(`/trader/v1/accounts/${hash}/orders?fromEnteredTime=${from365}&toEnteredTime=${to}&status=WORKING`),
    schwabFetch(`/trader/v1/accounts/${hash}/orders?fromEnteredTime=${from365}&toEnteredTime=${to}&status=PENDING_ACTIVATION`),
    schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`),
  ]);
  const { filled, filledOptions, expiredOptions, transactions } = history;

  const workingRaw = [
    ...(workingRes.ok ? await workingRes.json() : []),
    ...(pendingRes.ok ? await pendingRes.json() : []),
  ];
  const positionsData = positionsRes.ok ? await positionsRes.json() : null;

  const working = flattenOrders(Array.isArray(workingRaw) ? workingRaw : [])
    .map((o) => parseWorkingOrder(o, accountNumber))
    .filter((o): o is WorkingOrder => o !== null);

  // --- Positions (shared for snapshot + balances) ---
  const account = positionsData?.securitiesAccount;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = account?.positions ?? [];

  // Snapshot: TQQQ shares + option positions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tqqqPosition = positions.find((p: any) => p.instrument?.symbol === "TQQQ");
  const tqqqShares: number = tqqqPosition?.longQuantity ?? 0;
  const tqqqAvgPrice: number = tqqqPosition?.averagePrice ?? 0;

  // Earliest open per symbol, in both directions: the hedge collar's long put
  // and long call fence are bought to open, and their open date is what groups
  // them into a collar.
  const optionOpenDatesBySymbol = optionOpenDates(filledOptions);

  const options: OptionPosition[] = positions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) =>
      p.instrument?.assetType === "OPTION" &&
      isTrackedOptionUnderlying(p.instrument?.underlyingSymbol) &&
      ((p.shortQuantity ?? 0) > 0 || (p.longQuantity ?? 0) > 0)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        accountNumber, symbol: sym,
        underlyingSymbol: p.instrument?.underlyingSymbol ?? "TQQQ",
        putCall, strike, expiry,
        shortQty: p.shortQuantity ?? 0, longQty: p.longQuantity ?? 0,
        marketValue: p.marketValue ?? 0, averagePrice: p.averagePrice ?? 0,
        openedAt: optionOpenDatesBySymbol.get(sym) ?? null,
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

  return { filled, filledOptions, expiredOptions, working, tqqqShares, tqqqAvgPrice, options, balance, transactions };
}

const CACHE_KEY = "schwab-data";
const CACHE_TTL_MS = 30_000;

async function buildData(): Promise<SchwabData> {
  const hashes = await getAccountHashes();
  const accounts = Object.entries(hashes);

  const now = new Date();
  const to = toSchwabTime(now);
  const from365 = toSchwabTime(new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000));

  const results = await Promise.all(
    accounts.map(([accountNumber, hash]) => fetchAccountData(accountNumber, hash, from365, to))
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

  const data: SchwabData = {
    filledOrders, filledOptionOrders, expiredOptionOrders, workingOrders,
    tqqqShares, tqqqAvgPrice, optionPositions, balances, transactions,
  };
  return data;
}

// Collapse concurrent cache misses: a page mount plus a manual refresh would
// otherwise each run the whole year-long fan-out.
const buildDataOnce = singleFlight(buildData);

export async function GET(req: Request) {
  if (process.env.DEMO_MODE === "true") {
    return Response.json(DEMO_DATA satisfies SchwabData);
  }

  // The manual "Refresh accounts" action sends ?fresh=1 to force a live pull; mount/focus refreshes
  // reuse the cached payload within the TTL to avoid re-scanning a year of history each time.
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh) {
    const cached = getCached<SchwabData>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) return Response.json(cached);
  }

  try {
    const data = await buildDataOnce();
    setCached(CACHE_KEY, data);
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
