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
  longQty: number;        // > 0 means accidental BUY_TO_OPEN
  marketValue: number;    // current mark (negative = liability)
  averagePrice: number;   // credit received per share when opened
  openedAt: string | null;
}

export interface FilledOptionOrder {
  orderId: number;
  accountNumber: string;
  instruction: "SELL_TO_OPEN" | "BUY_TO_CLOSE" | "BUY_TO_OPEN" | "SELL_TO_CLOSE";
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

export interface ExpiredOptionOrder {
  activityId: number;
  accountNumber: string;
  symbol: string;
  contracts: number;
  time: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseExpiredOptionOrder(tx: any, accountNumber: string): ExpiredOptionOrder | null {
  if (tx.type !== "RECEIVE_AND_DELIVER") return null;
  const desc: string = tx.description ?? "";
  if (!desc.toLowerCase().includes("removed due to expiration")) return null;
  const item = tx.transferItems?.[0];
  if (!item) return null;
  const instr = item.instrument;
  if (instr?.assetType !== "OPTION" || instr?.underlyingSymbol !== "TQQQ") return null;
  return {
    activityId: tx.activityId,
    accountNumber,
    symbol: instr.symbol,
    contracts: item.amount ?? 1,
    time: tx.time,
  };
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
export function parseFilledOptionOrder(order: any, accountNumber: string): FilledOptionOrder[] {
  if (order.status !== "FILLED") return [];

  const legs: any[] = order.orderLegCollection ?? [];
  const optionLegs = legs.filter((leg) =>
    leg.orderLegType === "OPTION" &&
    leg.instrument?.underlyingSymbol === "TQQQ" &&
    ["SELL_TO_OPEN", "BUY_TO_CLOSE", "BUY_TO_OPEN", "SELL_TO_CLOSE"].includes(leg.instruction ?? "")
  );
  if (optionLegs.length === 0) return [];

  // Build per-legId fill totals from execution legs
  const legFills = new Map<number, { totalValue: number; totalContracts: number }>();
  for (const activity of order.orderActivityCollection ?? []) {
    if (activity.executionType !== "FILL") continue;
    for (const execLeg of activity.executionLegs ?? []) {
      const legId: number = execLeg.legId;
      if (!legFills.has(legId)) legFills.set(legId, { totalValue: 0, totalContracts: 0 });
      const fill = legFills.get(legId)!;
      fill.totalValue += execLeg.price * execLeg.quantity;
      fill.totalContracts += execLeg.quantity;
    }
  }

  const result: FilledOptionOrder[] = [];
  for (const leg of optionLegs) {
    const instruction = leg.instruction as FilledOptionOrder["instruction"];
    const symbol: string = leg.instrument?.symbol ?? "";
    const fill = legFills.get(leg.legId);

    let totalValue = 0;
    let totalContracts = 0;
    if (fill) {
      totalValue = fill.totalValue;
      totalContracts = fill.totalContracts;
    } else if (optionLegs.length === 1) {
      // Single-leg order without legId matching — sum all execution legs (fallback)
      for (const activity of order.orderActivityCollection ?? []) {
        if (activity.executionType !== "FILL") continue;
        for (const execLeg of activity.executionLegs ?? []) {
          totalValue += execLeg.price * execLeg.quantity;
          totalContracts += execLeg.quantity;
        }
      }
    }

    if (totalContracts === 0) continue;

    const fillPrice = totalValue / totalContracts;
    const gross = fillPrice * totalContracts * 100;
    const isDebit = instruction === "BUY_TO_CLOSE" || instruction === "BUY_TO_OPEN";
    const total = isDebit ? -gross : gross;

    result.push({ orderId: order.orderId, accountNumber, instruction, symbol, contracts: totalContracts, fillPrice, total, time: order.closeTime });
  }
  return result;
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
