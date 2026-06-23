/**
 * Option-contract identifiers for display and order entry.
 *
 * `occSymbol` builds the standard OCC 21-character symbol most brokers accept;
 * `humanContract` builds a readable label. Both are pure.
 */

export type OptionType = "P" | "C";

/**
 * OCC option symbol: root left-justified to 6 chars, then YYMMDD, then P/C,
 * then strike × 1000 zero-padded to 8 digits.
 *
 *   occSymbol("QQQ", "2026-08-21", "P", 553) → "QQQ   260821P00553000"
 */
export function occSymbol(root: string, expiry: string, type: OptionType, strike: number): string {
  const r = root.toUpperCase().padEnd(6, " ");
  const [y, m, d] = expiry.split("-");
  const date = `${y.slice(2)}${m}${d}`;
  const strikePart = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");
  return `${r}${date}${type}${strikePart}`;
}

/**
 * Readable contract label, e.g. `QQQ Aug 21 '26 $553 P`. Fractional strikes
 * keep their decimal (e.g. `$552.5`).
 */
export function humanContract(
  root: string,
  expiry: string,
  type: OptionType,
  strike: number,
): string {
  const dt = new Date(expiry + "T12:00:00Z");
  const mon = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = dt.getUTCDate();
  const yr = `'${expiry.slice(2, 4)}`;
  const strikeStr = Number.isInteger(strike) ? `$${strike}` : `$${strike}`;
  return `${root.toUpperCase()} ${mon} ${day} ${yr} ${strikeStr} ${type}`;
}
