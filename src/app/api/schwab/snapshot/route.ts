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

export interface Snapshot {
  filledOrders: FilledOrder[];
  filledOptionOrders: FilledOptionOrder[];
  expiredOptionOrders: ExpiredOptionOrder[];
  workingOrders: WorkingOrder[];
  tqqqShares: Record<string, number>;
  tqqqAvgPrice: Record<string, number>;
  optionPositions: OptionPosition[];
}

async function fetchAccountData(
  accountNumber: string,
  hash: string,
  fromIso: string,
  toIso: string
): Promise<{ filled: FilledOrder[]; filledOptions: FilledOptionOrder[]; expiredOptions: ExpiredOptionOrder[]; working: WorkingOrder[]; tqqqShares: number; tqqqAvgPrice: number; options: OptionPosition[] }> {
  const [filledRes, workingRes, pendingRes, positionsRes, txRes] = await Promise.all([
    schwabFetch(
      `/trader/v1/accounts/${hash}/orders?fromEnteredTime=${fromIso}&toEnteredTime=${toIso}&status=FILLED`
    ),
    schwabFetch(
      `/trader/v1/accounts/${hash}/orders?fromEnteredTime=${fromIso}&toEnteredTime=${toIso}&status=WORKING`
    ),
    schwabFetch(
      `/trader/v1/accounts/${hash}/orders?fromEnteredTime=${fromIso}&toEnteredTime=${toIso}&status=PENDING_ACTIVATION`
    ),
    schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`),
    schwabFetch(
      `/trader/v1/accounts/${hash}/transactions?startDate=${fromIso}&endDate=${toIso}&types=RECEIVE_AND_DELIVER`
    ),
  ]);

  const filledRaw = filledRes.ok ? await filledRes.json() : [];
  const workingRaw = [
    ...(workingRes.ok ? await workingRes.json() : []),
    ...(pendingRes.ok ? await pendingRes.json() : []),
  ];
  const positionsData = positionsRes.ok ? await positionsRes.json() : null;
  const txRaw = txRes.ok ? await txRes.json() : [];

  const flatFilled = flattenOrders(Array.isArray(filledRaw) ? filledRaw : []);
  const filled = flatFilled
    .map((o) => parseFilledOrder(o, accountNumber))
    .filter((o): o is FilledOrder => o !== null);
  const filledOptions = flatFilled
    .map((o) => parseFilledOptionOrder(o, accountNumber))
    .filter((o): o is FilledOptionOrder => o !== null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expiredOptions: ExpiredOptionOrder[] = (Array.isArray(txRaw) ? txRaw : [] as any[])
    .map((tx: any) => parseExpiredOptionOrder(tx, accountNumber))
    .filter((o): o is ExpiredOptionOrder => o !== null);

  const working = flattenOrders(Array.isArray(workingRaw) ? workingRaw : [])
    .map((o) => parseWorkingOrder(o, accountNumber))
    .filter((o): o is WorkingOrder => o !== null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = positionsData?.securitiesAccount?.positions ?? [];
  const tqqqPosition = positions.find((p: any) => p.instrument?.symbol === "TQQQ");
  const tqqqShares: number = tqqqPosition?.longQuantity ?? 0;
  const tqqqAvgPrice: number = tqqqPosition?.averagePrice ?? 0;

  // Build a map of option symbol → earliest sell-to-open close time from order history
  const optionOpenDates = new Map<string, string>();
  for (const order of flattenOrders(Array.isArray(filledRaw) ? filledRaw : [])) {
    if (order.status !== "FILLED") continue;
    const leg = order.orderLegCollection?.[0];
    if (!leg || leg.orderLegType !== "OPTION" || leg.instruction !== "SELL_TO_OPEN") continue;
    const sym: string = leg.instrument?.symbol;
    if (!sym) continue;
    // Keep the earliest (oldest) open date
    if (!optionOpenDates.has(sym) || order.closeTime < optionOpenDates.get(sym)!) {
      optionOpenDates.set(sym, order.closeTime);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: OptionPosition[] = positions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) =>
      p.instrument?.assetType === "OPTION" &&
      p.instrument?.underlyingSymbol === "TQQQ" &&
      (p.shortQuantity ?? 0) > 0
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any): OptionPosition | null => {
      const sym: string = p.instrument?.symbol ?? "";

      // Parse OCC symbol: "TQQQ  260327C00050000"
      //   chars 0-5:  underlying (padded)
      //   chars 6-11: YYMMDD
      //   char  12:   C or P
      //   chars 13-20: strike * 1000
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
        accountNumber,
        symbol: sym,
        putCall,
        strike,
        expiry,
        shortQty: p.shortQuantity ?? 0,
        marketValue: p.marketValue ?? 0,
        averagePrice: p.averagePrice ?? 0,
        openedAt: optionOpenDates.get(sym) ?? null,
      };
    })
    .filter((p): p is OptionPosition => p !== null);

  return { filled, filledOptions, expiredOptions, working, tqqqShares, tqqqAvgPrice, options };
}

export async function GET() {
  try {
    const hashes = await getAccountHashes();
    const accounts = Object.entries(hashes);

    const days = 90;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split(".")[0] + "Z";
    const to = new Date().toISOString().split(".")[0] + "Z";

    const results = await Promise.all(
      accounts.map(([accountNumber, hash]) =>
        fetchAccountData(accountNumber, hash, from, to)
      )
    );

    const filledOrders: FilledOrder[] = results
      .flatMap((r) => r.filled)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    const filledOptionOrders: FilledOptionOrder[] = results
      .flatMap((r) => r.filledOptions)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    const workingOrders: WorkingOrder[] = results
      .flatMap((r) => r.working)
      .sort(
        (a, b) =>
          new Date(b.enteredTime).getTime() - new Date(a.enteredTime).getTime()
      );

    const tqqqShares: Record<string, number> = Object.fromEntries(
      accounts.map(([accountNumber], i) => [accountNumber, results[i].tqqqShares])
    );

    const tqqqAvgPrice: Record<string, number> = Object.fromEntries(
      accounts.map(([accountNumber], i) => [accountNumber, results[i].tqqqAvgPrice])
    );

    const optionPositions: OptionPosition[] = results.flatMap((r) => r.options);

    const expiredOptionOrders: ExpiredOptionOrder[] = results
      .flatMap((r) => r.expiredOptions)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return Response.json({ filledOrders, filledOptionOrders, expiredOptionOrders, workingOrders, tqqqShares, tqqqAvgPrice, optionPositions } satisfies Snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
