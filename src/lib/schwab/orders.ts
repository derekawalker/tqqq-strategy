import type { RawSchwabOrder } from "./parse";

const MAX_PAGES = 20;

const toSchwabTime = (d: Date) => d.toISOString().split(".")[0] + "Z";

/**
 * Fetch every order entered in [from, to]. Schwab caps how many orders one request returns
 * and silently drops the oldest past the cap, so a year-long window loses its early history
 * once the account has traded enough. Page backward instead: re-request up to the oldest
 * order entered so far until a page brings back nothing new. The bound is inclusive, so
 * pages overlap by that order and are de-duplicated by orderId.
 */
export async function fetchAllOrders(
  fetchPage: (from: string, to: string) => Promise<RawSchwabOrder[]>,
  from: Date,
  to: Date,
): Promise<RawSchwabOrder[]> {
  const byId = new Map<number, RawSchwabOrder>();
  let end = to;
  for (let page = 0; page < MAX_PAGES; page++) {
    const orders = await fetchPage(toSchwabTime(from), toSchwabTime(end));
    let added = 0;
    let oldest = end.getTime();
    for (const o of orders) {
      if (!byId.has(o.orderId)) {
        byId.set(o.orderId, o);
        added++;
      }
      oldest = Math.min(oldest, new Date(o.enteredTime).getTime());
    }
    if (added === 0 || oldest <= from.getTime()) break;
    end = new Date(oldest);
  }
  return [...byId.values()];
}
