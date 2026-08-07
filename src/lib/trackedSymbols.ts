/**
 * Which option underlyings the app carries at all.
 *
 * Both brokers return every option in the account, and the parsers throw away
 * anything outside this list — so a contract that fails here is invisible to
 * the whole app, not merely to one page. That made the hedge's VIX sleeve
 * unbuildable: its fills and positions were dropped before any page saw them.
 *
 * The ladder trades TQQQ. The hedge buys TQQQ and QQQ puts, and VIX calls.
 * VIX lists under several roots — VIX, VIXW for weeklies, and $VIX at some
 * brokers — so it matches on prefix rather than an exact name.
 */
export function isTrackedOptionUnderlying(symbol: string | null | undefined): boolean {
  const s = (symbol ?? "").replace(/^\$/, "").toUpperCase();
  return s === "TQQQ" || s === "QQQ" || s.startsWith("VIX");
}

/**
 * Whether a broker's instrument type is an option this app can read.
 *
 * VIX options are index options, which brokers may or may not label "Equity
 * Option" — matching the suffix takes both. Futures options are excluded by
 * name: /VX carries a different multiplier and a symbol format the OCC parsers
 * would silently misread.
 */
export function isReadableOptionType(instrumentType: string | null | undefined): boolean {
  const t = instrumentType ?? "";
  return t.endsWith("Option") && t !== "Future Option";
}
