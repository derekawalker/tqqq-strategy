import { schwabFetch } from "@/lib/schwab/client";
import { getAccountHashes } from "@/lib/schwab/accounts";
import {
  flattenOrders,
  parseFilledOrder,
  parseWorkingOrder,
  FilledOrder,
  WorkingOrder,
} from "@/lib/schwab/parse";

export interface Snapshot {
  filledOrders: FilledOrder[];
  workingOrders: WorkingOrder[];
  tqqqShares: Record<string, number>; // accountNumber → TQQQ long shares
}

async function fetchAccountData(
  accountNumber: string,
  hash: string,
  fromIso: string,
  toIso: string
): Promise<{ filled: FilledOrder[]; working: WorkingOrder[]; tqqqShares: number }> {
  const [filledRes, workingRes, positionsRes] = await Promise.all([
    schwabFetch(
      `/trader/v1/accounts/${hash}/orders?fromEnteredTime=${fromIso}&toEnteredTime=${toIso}&status=FILLED`
    ),
    schwabFetch(
      `/trader/v1/accounts/${hash}/orders?fromEnteredTime=${fromIso}&toEnteredTime=${toIso}&status=WORKING`
    ),
    schwabFetch(`/trader/v1/accounts/${hash}?fields=positions`),
  ]);

  const filledRaw = filledRes.ok ? await filledRes.json() : [];
  const workingRaw = workingRes.ok ? await workingRes.json() : [];
  const positionsData = positionsRes.ok ? await positionsRes.json() : null;

  const filled = flattenOrders(Array.isArray(filledRaw) ? filledRaw : [])
    .map((o) => parseFilledOrder(o, accountNumber))
    .filter((o): o is FilledOrder => o !== null);

  const working = flattenOrders(Array.isArray(workingRaw) ? workingRaw : [])
    .map((o) => parseWorkingOrder(o, accountNumber))
    .filter((o): o is WorkingOrder => o !== null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positions: any[] = positionsData?.securitiesAccount?.positions ?? [];
  const tqqqPosition = positions.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => p.instrument?.symbol === "TQQQ"
  );
  const tqqqShares: number = tqqqPosition?.longQuantity ?? 0;

  return { filled, working, tqqqShares };
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

    const workingOrders: WorkingOrder[] = results
      .flatMap((r) => r.working)
      .sort(
        (a, b) =>
          new Date(b.enteredTime).getTime() - new Date(a.enteredTime).getTime()
      );

    const tqqqShares: Record<string, number> = Object.fromEntries(
      accounts.map(([accountNumber], i) => [accountNumber, results[i].tqqqShares])
    );

    return Response.json({ filledOrders, workingOrders, tqqqShares } satisfies Snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
