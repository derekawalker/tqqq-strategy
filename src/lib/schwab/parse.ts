export interface FilledOrder {
  orderId: number;
  accountNumber: string;
  side: "BUY" | "SELL";
  shares: number;
  fillPrice: number;
  total: number;
  time: string;
}

export interface WorkingOrder {
  orderId: number;
  accountNumber: string;
  side: "BUY" | "SELL";
  shares: number;
  limitPrice: number;
  enteredTime: string;
  status: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flattenOrders(orders: any[]): any[] {
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
export function parseFilledOrder(order: any, accountNumber: string): FilledOrder | null {
  if (order.status !== "FILLED") return null;
  const leg = order.orderLegCollection?.[0];
  if (!leg || leg.instrument?.symbol !== "TQQQ" || leg.orderLegType !== "EQUITY") return null;

  const side: "BUY" | "SELL" = leg.instruction === "BUY" ? "BUY" : "SELL";
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
  return { orderId: order.orderId, accountNumber, side, shares: totalShares, fillPrice, total: fillPrice * totalShares, time: order.closeTime };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseWorkingOrder(order: any, accountNumber: string): WorkingOrder | null {
  if (!["WORKING", "QUEUED", "ACCEPTED", "PENDING_ACTIVATION", "AWAITING_PARENT_ORDER"].includes(order.status)) return null;
  const leg = order.orderLegCollection?.[0];
  if (!leg || leg.instrument?.symbol !== "TQQQ" || leg.orderLegType !== "EQUITY") return null;

  const side: "BUY" | "SELL" = leg.instruction === "BUY" ? "BUY" : "SELL";
  return {
    orderId: order.orderId,
    accountNumber,
    side,
    shares: order.quantity,
    limitPrice: order.price ?? 0,
    enteredTime: order.enteredTime,
    status: order.status,
  };
}
