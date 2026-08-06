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
}

export const DEFAULT_HEDGE_SETTINGS: HedgeSettings = {
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

/**
 * Fill any missing or non-numeric field from the defaults.
 *
 * Guards against three things at once: an account that has never configured a
 * hedge (null), a blob saved before a field was added (missing key), and a
 * value that came back from JSON as something other than a number.
 */
export function mergeHedgeSettings(
  saved: Partial<HedgeSettings> | null | undefined,
): HedgeSettings {
  const out = { ...DEFAULT_HEDGE_SETTINGS };
  if (!saved) return out;
  for (const key of Object.keys(DEFAULT_HEDGE_SETTINGS) as (keyof HedgeSettings)[]) {
    const v = saved[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** True when the settings differ from the defaults in any field. */
export function isCustomised(s: HedgeSettings): boolean {
  return (Object.keys(DEFAULT_HEDGE_SETTINGS) as (keyof HedgeSettings)[]).some(
    (k) => s[k] !== DEFAULT_HEDGE_SETTINGS[k],
  );
}
