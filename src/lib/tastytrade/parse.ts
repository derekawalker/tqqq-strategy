import type {
  FilledOrder,
  FilledOptionOrder,
  WorkingOrder,
  OptionPosition,
  ExpiredOptionOrder,
} from "@/lib/schwab/parse";

export type { FilledOrder, FilledOptionOrder, WorkingOrder, OptionPosition, ExpiredOptionOrder };

// Parses the trailing YYMMDDCPPPPPPPP portion of a tastytrade OCC symbol.
// tastytrade symbols look like "TQQQ  250117C00085000" (root padded to 6 chars).
function parseOccTail(sym: string): { putCall: "CALL" | "PUT"; strike: number; expiry: string } | null {
  const m = sym.match(/(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, date, pc, strikeRaw] = m;
  return {
    putCall: pc === "C" ? "CALL" : "PUT",
    strike: parseInt(strikeRaw, 10) / 1000,
    expiry: `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`,
  };
}

function actionToInstruction(action: string): FilledOptionOrder["instruction"] | null {
  switch (action) {
    case "Sell to Open": return "SELL_TO_OPEN";
    case "Buy to Close": return "BUY_TO_CLOSE";
    case "Buy to Open": return "BUY_TO_OPEN";
    case "Sell to Close": return "SELL_TO_CLOSE";
    default: return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legFillTotals(leg: any): { totalValue: number; totalQty: number } {
  let totalValue = 0, totalQty = 0;
  for (const fill of leg.fills ?? []) {
    const qty = parseFloat(fill.quantity ?? "0");
    const price = parseFloat(fill["fill-price"] ?? "0");
    totalQty += qty;
    totalValue += qty * price;
  }
  return { totalValue, totalQty };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseFilledOrder(order: any, accountNumber: string): FilledOrder | null {
  if (order.status !== "Filled") return null;
  const legs: any[] = order.legs ?? [];
  const leg = legs.find((l) => l["instrument-type"] === "Equity" && l.symbol === "TQQQ");
  if (!leg) return null;

  const { totalValue, totalQty } = legFillTotals(leg);
  if (totalQty === 0) return null;

  const side: "BUY" | "SELL" = (leg.action as string).startsWith("Buy") ? "BUY" : "SELL";
  const fillPrice = totalValue / totalQty;
  return {
    orderId: order.id,
    accountNumber,
    side,
    shares: totalQty,
    fillPrice,
    total: fillPrice * totalQty,
    fees: 0,
    time: order["terminal-at"] ?? order["received-at"],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseFilledOptionOrder(order: any, accountNumber: string): FilledOptionOrder[] {
  if (order.status !== "Filled") return [];
  const result: FilledOptionOrder[] = [];
  for (const leg of order.legs ?? []) {
    if (leg["instrument-type"] !== "Equity Option") continue;
    const sym: string = leg.symbol ?? "";
    if (!sym.includes("TQQQ")) continue;
    const instruction = actionToInstruction(leg.action ?? "");
    if (!instruction) continue;
    const { totalValue, totalQty } = legFillTotals(leg);
    if (totalQty === 0) continue;
    const fillPrice = totalValue / totalQty;
    const gross = fillPrice * totalQty * 100;
    const isDebit = instruction === "BUY_TO_CLOSE" || instruction === "BUY_TO_OPEN";
    result.push({
      orderId: order.id,
      accountNumber,
      instruction,
      symbol: sym.trim(),
      contracts: totalQty,
      fillPrice,
      total: isDebit ? -gross : gross,
      fees: 0,
      time: order["terminal-at"] ?? order["received-at"],
    });
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseWorkingOrder(order: any, accountNumber: string): WorkingOrder | null {
  if (!["Live", "Pending", "Received", "Routed"].includes(order.status)) return null;
  const legs: any[] = order.legs ?? [];
  const leg = legs.find((l) => l["instrument-type"] === "Equity" && l.symbol === "TQQQ");
  if (!leg) return null;
  const side: "BUY" | "SELL" = (leg.action as string).startsWith("Buy") ? "BUY" : "SELL";
  return {
    orderId: order.id,
    accountNumber,
    side,
    shares: parseFloat(leg.quantity ?? "0"),
    limitPrice: parseFloat(order.price ?? "0"),
    enteredTime: order["received-at"] ?? order["updated-at"],
    status: order.status,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOptionPosition(
  pos: any,
  accountNumber: string,
  openedAtMap: Map<string, string>,
): OptionPosition | null {
  if (pos["instrument-type"] !== "Equity Option") return null;
  if (pos["underlying-symbol"] !== "TQQQ") return null;
  const sym: string = pos.symbol ?? "";
  const parsed = parseOccTail(sym);
  if (!parsed) return null;
  const qty = parseFloat(pos.quantity ?? "0");
  const direction: string = pos["quantity-direction"] ?? "";
  const shortQty = direction === "Short" ? qty : 0;
  const longQty = direction === "Long" ? qty : 0;
  if (shortQty === 0 && longQty === 0) return null;
  const closePrice = parseFloat(pos["close-price"] ?? "0");
  const multiplier = parseFloat(pos["multiplier"] ?? "100");
  // Short options are a liability — negative market value matches Schwab's convention
  const marketValue = direction === "Short"
    ? -(closePrice * multiplier * qty)
    : closePrice * multiplier * qty;
  return {
    accountNumber,
    symbol: sym.trim(),
    putCall: parsed.putCall,
    strike: parsed.strike,
    expiry: parsed.expiry,
    shortQty,
    longQty,
    marketValue,
    averagePrice: parseFloat(pos["average-open-price"] ?? "0"),
    openedAt: openedAtMap.get(sym.trim()) ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseExpiredOptionOrder(tx: any, accountNumber: string): ExpiredOptionOrder | null {
  if (tx["transaction-type"] !== "Receive Deliver") return null;
  if (tx["transaction-sub-type"] !== "Expiration") return null;
  const legs: any[] = tx.legs ?? [];
  const leg = legs.find((l) => {
    const sym: string = l.symbol ?? "";
    return l["instrument-type"] === "Equity Option" && sym.includes("TQQQ");
  });
  if (!leg) return null;
  return {
    activityId: tx.id,
    accountNumber,
    symbol: (leg.symbol as string).trim(),
    contracts: Math.abs(parseFloat(leg.quantity ?? "1")),
    time: tx["executed-at"],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTransaction(tx: any, accountNumber: string) {
  const type: string = tx["transaction-type"] ?? "";
  if (type !== "Dividend" && type !== "Interest") return null;
  const netValue = parseFloat(tx["net-value"] ?? "0");
  if (netValue === 0) return null;
  const effect: string = tx["net-value-effect"] ?? "Credit";
  const amount = effect === "Debit" ? -netValue : netValue;
  const category: "dividend" | "interest" = type === "Interest" ? "interest" : "dividend";
  const legs: any[] = tx.legs ?? [];
  const symbol: string | null = legs[0]?.symbol ?? null;
  return {
    activityId: tx.id,
    accountNumber,
    time: tx["executed-at"],
    description: tx.description ?? "",
    symbol,
    amount,
    category,
  };
}
