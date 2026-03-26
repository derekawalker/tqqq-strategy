export interface FilledOrder {
  orderId: number;
  accountNumber: string;
  side: "BUY" | "SELL";
  shares: number;
  fillPrice: number;
  total: number;
  time: string;
}

export interface OptionPosition {
  accountNumber: string;
  symbol: string;
  putCall: "CALL" | "PUT";
  strike: number;
  expiry: string;         // "YYYY-MM-DD"
  shortQty: number;
  marketValue: number;    // current mark (negative = liability)
  averagePrice: number;   // credit received per share when opened
  openedAt: string | null;
}

export interface FilledOptionOrder {
  orderId: number;
  accountNumber: string;
  instruction: "SELL_TO_OPEN" | "BUY_TO_CLOSE";
  symbol: string;
  contracts: number;
  fillPrice: number;  // per share (×100 for total per contract)
  total: number;      // positive = credit received, negative = debit paid
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
export function parseFilledOptionOrder(order: any, accountNumber: string): FilledOptionOrder | null {
  if (order.status !== "FILLED") return null;
  const leg = order.orderLegCollection?.[0];
  if (!leg || leg.orderLegType !== "OPTION") return null;
  if (leg.instrument?.underlyingSymbol !== "TQQQ") return null;

  const rawInstruction: string = leg.instruction ?? "";
  if (rawInstruction !== "SELL_TO_OPEN" && rawInstruction !== "BUY_TO_CLOSE") return null;
  const instruction = rawInstruction as "SELL_TO_OPEN" | "BUY_TO_CLOSE";

  const symbol: string = leg.instrument?.symbol ?? "";
  let totalValue = 0;
  let totalContracts = 0;
  for (const activity of order.orderActivityCollection ?? []) {
    if (activity.executionType !== "FILL") continue;
    for (const execLeg of activity.executionLegs ?? []) {
      totalValue += execLeg.price * execLeg.quantity;
      totalContracts += execLeg.quantity;
    }
  }
  if (totalContracts === 0) return null;

  const fillPrice = totalValue / totalContracts;
  const gross = fillPrice * totalContracts * 100;
  const total = instruction === "SELL_TO_OPEN" ? gross : -gross;

  return { orderId: order.orderId, accountNumber, instruction, symbol, contracts: totalContracts, fillPrice, total, time: order.closeTime };
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
