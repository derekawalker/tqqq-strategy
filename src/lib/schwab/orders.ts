import type { RawSchwabOrder } from "./parse";

const MAX_PAGES = 20;
// Schwab answers each orders request in 1–8s, so the year is split into windows fetched in
// parallel rather than paged back sequentially from today (which took up to ~25s per account).
const WINDOW_MS = 30 * 864e5;

const toSchwabTime = (d: Date) => d.toISOString().split(".")[0] + "Z";

/**
 * Fetch every order entered in [from, to]. Schwab caps how many orders one request returns
 * and silently drops the oldest past the cap, so a long window loses its early history
 * once the account has traded enough. The range is split into ~30-day windows fetched in
 * parallel, and each window pages backward: re-request up to the oldest order entered so far
 * until a page brings back nothing new. Bounds are inclusive, so pages and adjacent windows
 * overlap at their edges and are de-duplicated by orderId.
 */
export async function fetchAllOrders(
  fetchPage: (from: string, to: string) => Promise<RawSchwabOrder[]>,
  from: Date,
  to: Date,
): Promise<RawSchwabOrder[]> {
  const windows: [Date, Date][] = [];
  for (let end = to.getTime(); end > from.getTime(); end -= WINDOW_MS) {
    windows.push([new Date(Math.max(end - WINDOW_MS, from.getTime())), new Date(end)]);
  }
  if (windows.length === 0) windows.push([from, to]);

  const byId = new Map<number, RawSchwabOrder>();
  const perWindow = await Promise.all(
    windows.map(([start, end]) => fetchWindow(fetchPage, start, end)),
  );
  for (const orders of perWindow) {
    for (const o of orders) if (!byId.has(o.orderId)) byId.set(o.orderId, o);
  }
  return [...byId.values()];
}

async function fetchWindow(
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
