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
import type { AccountBalance, Transaction, SchwabData } from "@/app/api/schwab/data/route";
import { getCached, setCached } from "@/lib/ttlCache";
import { singleFlight } from "@/lib/singleFlight";

const CACHE_KEY = "tastytrade-data";
const CACHE_TTL_MS = 30_000;

const MONEY_MARKET_SYMBOLS = ["SGOV", "BIL", "SHV"];

const PARTIAL_FILL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Tastytrade sometimes fills a single order in multiple separate order records
 * (e.g., 1 share + 221 shares for a 222-share level). Merge them into one so
 * matchLevel can identify the correct level.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergePartialFills(orders: any[]): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isTqqqEquity = (o: any) =>
    (o.legs ?? []).some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => l["instrument-type"] === "Equity" && l.symbol === "TQQQ",
    );

  const equity = orders
    .filter(isTqqqEquity)
    .sort((a, b) => {
      const ta = new Date(a["terminal-at"] ?? a["received-at"] ?? 0).getTime();
      const tb = new Date(b["terminal-at"] ?? b["received-at"] ?? 0).getTime();
      return ta - tb;
    });
  const other = orders.filter((o) => !isTqqqEquity(o));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = [];
  const used = new Set<number>();

  for (let i = 0; i < equity.length; i++) {
    if (used.has(i)) continue;
    const base = equity[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseLeg = (base.legs ?? []).find((l: any) => l["instrument-type"] === "Equity" && l.symbol === "TQQQ");
    const baseTime = new Date(base["terminal-at"] ?? base["received-at"] ?? 0).getTime();
    const baseAction: string = baseLeg?.action ?? "";
    const baseShares = parseFloat(base.quantity ?? "0");

    const group = [i];
    for (let j = i + 1; j < equity.length; j++) {
      if (used.has(j)) continue;
      const o = equity[j];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oLeg = (o.legs ?? []).find((l: any) => l["instrument-type"] === "Equity" && l.symbol === "TQQQ");
      const oTime = new Date(o["terminal-at"] ?? o["received-at"] ?? 0).getTime();
      if (oTime - baseTime > PARTIAL_FILL_WINDOW_MS) break;
      if ((oLeg?.action ?? "") !== baseAction) continue;
      // Two fills with the same share count are likely duplicate orders, not partial fills of one order.
      if (parseFloat(o.quantity ?? "0") === baseShares) continue;
      group.push(j);
    }

    if (group.length === 1) {
      result.push(base);
    } else {
      // Merge all fills into a single synthetic order
      const combinedFills = group.flatMap((idx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const leg = (equity[idx].legs ?? []).find((l: any) => l["instrument-type"] === "Equity" && l.symbol === "TQQQ");
        return leg?.fills ?? [];
      });
      result.push({
        ...base,
        status: "Filled",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        legs: (base.legs ?? []).map((l: any) => {
          if (l["instrument-type"] === "Equity" && l.symbol === "TQQQ") {
            return { ...l, fills: combinedFills };
          }
          return l;
        }),
        "terminal-at": equity[group[group.length - 1]]["terminal-at"] ?? base["terminal-at"],
      });
      group.forEach((idx) => used.add(idx));
    }
  }

  return [...other, ...result];
}

// The orders endpoint accepts per-page up to 200 (250 is rejected), which halves
// the page count over a 365-day window.
const ORDERS_PER_PAGE = 200;
const PAGE_CONCURRENCY = 8;
const MAX_PAGES = 50; // sanity cap — 10,000 records at ORDERS_PER_PAGE

/**
 * Fetch every page of a paginated tastytrade endpoint.
 *
 * Page 0's `pagination.total-pages` says exactly how many pages exist, so the
 * rest are requested in bounded-concurrency waves. The previous version probed
 * blindly in fixed batches of 5 until it saw an empty page, which both
 * over-fetched (5 requests minimum for a single-page result) and treated a
 * failed page as end-of-data — silently truncating order history.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages(baseUrl: string, perPage?: number): Promise<any[]> {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const pageUrl = (p: number) =>
    `${baseUrl}${sep}page-offset=${p}${perPage ? `&per-page=${perPage}` : ""}`;

  const getPage = async (p: number) => {
    const res = await tastyFetch(pageUrl(p));
    // Fail loudly: a dropped page would silently corrupt the order ledger.
    if (!res.ok) throw new Error(`page ${p} of ${baseUrl} failed: ${res.status}`);
    const json = await res.json();
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (json?.data?.items ?? []) as any[],
      totalPages: Number(json?.pagination?.["total-pages"] ?? 1),
    };
  };

  const first = await getPage(0);
  const totalPages = Math.min(first.totalPages || 1, MAX_PAGES);
  if (totalPages <= 1) return first.items;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [...first.items];
  for (let start = 1; start < totalPages; start += PAGE_CONCURRENCY) {
    const batch: number[] = [];
    for (let p = start; p < Math.min(start + PAGE_CONCURRENCY, totalPages); p++) batch.push(p);
    const pages = await Promise.all(batch.map(getPage));
    for (const page of pages) all.push(...page.items);
  }
  return all;
}

async function fetchAccountData(accountNumber: string, from365: string, to: string) {
  // Filled orders are paginated — fetch all pages; other endpoints fit in one page
  const [filledRaw, workingRes, positionsRes, rxDeliverRes, moneyMovementRaw, balanceRes] =
    await Promise.all([
      fetchAllPages(`/accounts/${accountNumber}/orders?status[]=Filled&status[]=Partially+Filled&start-date=${from365}&end-date=${to}`, ORDERS_PER_PAGE),
      tastyFetch(`/accounts/${accountNumber}/orders?status[]=Live&status[]=Pending&status[]=Received`),
      tastyFetch(`/accounts/${accountNumber}/positions`),
      tastyFetch(`/accounts/${accountNumber}/transactions?types[]=Receive+Deliver&start-date=${from365}&end-date=${to}`),
      fetchAllPages(`/accounts/${accountNumber}/transactions?types[]=Money+Movement&start-date=${from365}&end-date=${to}`),
      tastyFetch(`/accounts/${accountNumber}/balances`),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workingRaw: any[] = workingRes.ok ? (await workingRes.json()).data?.items ?? [] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positionsRaw: any[] = positionsRes.ok ? (await positionsRes.json()).data?.items ?? [] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rxDeliverRaw: any[] = rxDeliverRes.ok ? (await rxDeliverRes.json()).data?.items ?? [] : [];
  const balanceData = balanceRes.ok ? (await balanceRes.json()).data : null;

  // Build openedAt map from filled option orders (earliest open per symbol).
  // Both directions count: the hedge collar's long put and long call fence are
  // bought to open, and their open date is what groups them into a collar.
  const openedAtMap = new Map<string, string>();
  for (const order of filledRaw) {
    if (order.status !== "Filled") continue;
    for (const leg of order.legs ?? []) {
      if (leg["instrument-type"] !== "Equity Option") continue;
      if (leg.action !== "Sell to Open" && leg.action !== "Buy to Open") continue;
      const sym: string = (leg.symbol as string ?? "").trim();
      const time: string = order["terminal-at"] ?? order["received-at"] ?? "";
      if (!openedAtMap.has(sym) || time < openedAtMap.get(sym)!) {
        openedAtMap.set(sym, time);
      }
    }
  }

  const mergedRaw = mergePartialFills(filledRaw);

  const filled: FilledOrder[] = mergedRaw
    .map((o) => parseFilledOrder(o, accountNumber))
    .filter((o): o is FilledOrder => o !== null);

  const filledOptions: FilledOptionOrder[] = mergedRaw.flatMap((o) =>
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
    const qty = parseFloat(p.quantity ?? "0");
    const multiplier = parseFloat(p.multiplier ?? "1");
    const closePrice = parseFloat(p["close-price"] ?? "0");
    const mv = Math.abs(parseFloat(p["market-value"] ?? "0")) || Math.abs(closePrice * qty * multiplier);
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

  const transactions: Transaction[] = moneyMovementRaw
    .map((tx) => parseTransaction(tx, accountNumber))
    .filter((t): t is Transaction => t !== null);

  return { filled, filledOptions, expiredOptions, working, tqqqShares, tqqqAvgPrice, options: optionsRaw, balance, transactions };
}

// The account list is fixed for the life of the login, so it doesn't need
// re-fetching on every refresh.
const ACCOUNTS_TTL_MS = 60 * 60 * 1000;
let cachedAccounts: string[] | null = null;
let cachedAccountsAt = 0;

async function getAccountNumbers(): Promise<string[]> {
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

async function buildData(): Promise<SchwabData> {
  const accounts = await getAccountNumbers();

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
  // One DXLink connection for every account's positions. Called per account this
  // opened a fresh WebSocket each time, since each account's symbol set missed
  // the marks cache.
  const rawOptionPositions: OptionPosition[] = results.flatMap((r) => r.options);
  const marks = await getOptionMarks(rawOptionPositions.map((p) => p.symbol));
  const optionPositions: OptionPosition[] = rawOptionPositions.map((p) => {
    const mark = marks.get(p.symbol);
    if (mark === undefined) return p;
    const marketValue = p.shortQty > 0
      ? -(mark * 100 * p.shortQty)
      : mark * 100 * p.longQty;
    return { ...p, marketValue };
  });
  const balances: AccountBalance[] = results
    .map((r) => r.balance)
    .filter((b): b is AccountBalance => b !== null);
  const transactions: Transaction[] = results
    .flatMap((r) => r.transactions)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const data: SchwabData = {
    filledOrders,
    filledOptionOrders,
    expiredOptionOrders,
    workingOrders,
    tqqqShares,
    tqqqAvgPrice,
    optionPositions,
    balances,
    transactions,
  };
  return data;
}

// Collapse concurrent cache misses: a page mount plus a manual refresh would
// otherwise each run the whole year-long fan-out.
const buildDataOnce = singleFlight(buildData);

export async function GET(req: Request) {
  if (!process.env.TASTYTRADE_USERNAME) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  // ?fresh=1 (manual refresh) forces a live pull; otherwise reuse the cached payload within the TTL.
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
