/**
 * Validation for the order routes' JSON bodies. These values become a real
 * order (and get interpolated into the upstream URL path), so reject anything
 * malformed here rather than let a UI bug or bad cast reach the broker.
 */

// tastytrade account numbers are short alphanumerics (e.g. "5WT00001").
const ACCOUNT_RE = /^[A-Za-z0-9]{4,20}$/;
const ORDER_ID_RE = /^[0-9]{1,20}$/;

export interface PlaceOrderInput {
  accountNumber: string;
  side: "BUY" | "SELL";
  shares: number;
  price: number;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function validAccount(v: unknown): v is string {
  return typeof v === "string" && ACCOUNT_RE.test(v);
}

export function validatePlaceOrder(body: unknown): Validated<PlaceOrderInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!validAccount(b.accountNumber)) return { ok: false, error: "Invalid accountNumber" };
  if (b.side !== "BUY" && b.side !== "SELL") return { ok: false, error: "side must be BUY or SELL" };
  const shares = Number(b.shares);
  if (b.shares == null || !Number.isInteger(shares) || shares <= 0) {
    return { ok: false, error: "shares must be a positive whole number" };
  }
  const price = Number(b.price);
  if (b.price == null || !Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "price must be a positive number" };
  }
  return { ok: true, value: { accountNumber: b.accountNumber, side: b.side, shares, price } };
}

export function validateCancelOrder(body: unknown): Validated<{ accountNumber: string; orderId: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!validAccount(b.accountNumber)) return { ok: false, error: "Invalid accountNumber" };
  const orderId = typeof b.orderId === "number" ? String(b.orderId) : b.orderId;
  if (typeof orderId !== "string" || !ORDER_ID_RE.test(orderId)) return { ok: false, error: "Invalid orderId" };
  return { ok: true, value: { accountNumber: b.accountNumber, orderId } };
}
