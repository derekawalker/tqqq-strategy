import { NextRequest } from "next/server";
import { schwabFetch } from "@/lib/schwab/client";
import { getAccountHashes } from "@/lib/schwab/accounts";

export interface FilledOrder {
  orderId: number;
  accountNumber: string;
  side: "BUY" | "SELL";
  shares: number;
  fillPrice: number;
  total: number;
  time: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenOrders(orders: any[]): any[] {
  const result: any[] = [];
  for (const order of orders) {
    result.push(order);
    if (order.childOrderStrategies?.length) {
      result.push(...flattenOrders(order.childOrderStrategies));
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFilledOrder(order: any, accountNumber: string): FilledOrder | null {
  if (order.status !== "FILLED") return null;

  const leg = order.orderLegCollection?.[0];
  if (!leg || leg.instrument?.symbol !== "TQQQ") return null;
  if (leg.orderLegType !== "EQUITY") return null;

  const side = leg.instruction === "BUY" ? "BUY" : "SELL";

  // Calculate weighted average fill price from execution legs
  let totalValue = 0;
  let totalShares = 0;
  for (const activity of order.orderActivityCollection ?? []) {
    if (activity.executionType !== "FILL") continue;
    for (const execLeg of activity.executionLegs ?? []) {
      totalValue += execLeg.price * execLeg.quantity;
      totalShares += execLeg.quantity;
    }
  }

  if (totalShares === 0) return null;

  const fillPrice = totalValue / totalShares;

  return {
    orderId: order.orderId,
    accountNumber,
    side,
    shares: totalShares,
    fillPrice,
    total: fillPrice * totalShares,
    time: order.closeTime,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accountNumber = searchParams.get("accountNumber");
  const days = parseInt(searchParams.get("days") ?? "60", 10);

  if (!accountNumber) {
    return Response.json({ error: "accountNumber required" }, { status: 400 });
  }

  try {
    const hashes = await getAccountHashes();
    const hash = hashes[accountNumber];
    if (!hash) return Response.json({ error: "Account not found" }, { status: 404 });

    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split(".")[0] + "Z";
    const to = new Date().toISOString().split(".")[0] + "Z";

    const res = await schwabFetch(
      `/trader/v1/accounts/${hash}/orders?fromEnteredTime=${from}&toEnteredTime=${to}&status=FILLED`
    );
    if (!res.ok) throw new Error(`Schwab orders API: ${res.status}`);

    const raw = await res.json();
    const orders: FilledOrder[] = flattenOrders(Array.isArray(raw) ? raw : [])
      .map((o) => parseFilledOrder(o, accountNumber))
      .filter((o): o is FilledOrder => o !== null)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return Response.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
