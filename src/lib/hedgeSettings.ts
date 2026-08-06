/**
 * Persisted configuration for the Hedge page's two-layer put program.
 *
 * Stored as a single JSON blob on the account rather than ten separate columns.
 * The cost of that choice is that a settings object saved before a new knob
 * existed will be missing it, so everything reads through
 * {@link mergeHedgeSettings} — never off the raw stored object. Adding a field
 * here is then safe: old accounts silently pick up its default.
 *
 * Values are stored in the units the UI uses (delta *points*, whole percents)
 * so the page can bind sliders directly without converting on every render.
 */

export interface HedgeSettings {
  /** Annual spend as a percent of account value. */
  budgetPct: number;
  /** Share of the budget going to the put layer; the rest funds VIX calls. */
  putSharePct: number;
  /** Target put delta in points — 10 means 0.10. */
  putDelta: number;
  putDte: number;
  /** Coverage may drift this far from target before trading. */
  driftBandPct: number;
  vixDte: number;
  /** VIX call strike, in points above the interpolated forward. */
  vixStrikeOffset: number;
  /** Implied vol of VIX used for pricing, as a whole percent. */
  volOfVol: number;
  /** Refuse to open new VIX positions at or above this spot VIX. */
  maxEntryVix: number;
  /** Flag harvesting the VIX sleeve at or above this spot VIX. */
  monetizeVix: number;
  /**
   * OCC symbols struck off the budget by hand. The automatic rule catches the
   * right *kind* of fill — long VIX, long QQQ/TQQQ puts — but can't know that a
   * particular put was bought for some other reason, so the page lets each lot
   * be unticked and remembers that here.
   */
  excludedSymbols: string[];
}

/** Every knob that is a plain number, and so mergeable by type check alone. */
const NUMERIC_DEFAULTS = {
  budgetPct: 3,
  putSharePct: 80,
  putDelta: 10,
  putDte: 60,
  driftBandPct: 25,
  vixDte: 45,
  vixStrikeOffset: 10,
  volOfVol: 90,
  maxEntryVix: 25,
  monetizeVix: 40,
};

export const NUMERIC_HEDGE_KEYS = Object.keys(NUMERIC_DEFAULTS) as (keyof typeof NUMERIC_DEFAULTS)[];

export const DEFAULT_HEDGE_SETTINGS: HedgeSettings = {
  ...NUMERIC_DEFAULTS,
  excludedSymbols: [],
};

/**
 * Fill any missing or wrongly-typed field from the defaults.
 *
 * Guards against three things at once: an account that has never configured a
 * hedge (null), a blob saved before a field was added (missing key), and a
 * value that came back from JSON as something other than what it should be.
 */
export function mergeHedgeSettings(
  saved: Partial<HedgeSettings> | null | undefined,
): HedgeSettings {
  // A fresh array every time — handing back the default's own would let a
  // caller's edit leak into every account that never set exclusions.
  const out: HedgeSettings = { ...DEFAULT_HEDGE_SETTINGS, excludedSymbols: [] };
  if (!saved) return out;
  for (const key of NUMERIC_HEDGE_KEYS) {
    const v = saved[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  if (Array.isArray(saved.excludedSymbols)) {
    out.excludedSymbols = saved.excludedSymbols.filter((s) => typeof s === "string");
  }
  return out;
}

/** True when the settings differ from the defaults in any field. */
export function isCustomised(s: HedgeSettings): boolean {
  return (
    NUMERIC_HEDGE_KEYS.some((k) => s[k] !== DEFAULT_HEDGE_SETTINGS[k]) ||
    s.excludedSymbols.length > 0
  );
}
