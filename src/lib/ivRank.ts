/**
 * IV rank: where today's implied-vol proxy (^VXN) sits within its own
 * trailing range. Premium sellers get paid for vol, not direction — IV rank
 * is the signal that should drive *how much* to sell, while price trend only
 * tilts *which side* (puts vs. calls). Pure, no I/O.
 */

/**
 * Percentile rank (0–100) of the last value in `values` against the trailing
 * `window` values (inclusive of itself): 100 = today is the highest vol of
 * the window, 0 = the lowest. Returns null if there isn't at least 2 values
 * to rank against.
 */
export function percentileRank(values: number[], window = 252): number | null {
  if (values.length < 2) return null;
  const slice = values.slice(-window);
  const latest = slice[slice.length - 1];
  const below = slice.filter((v) => v <= latest).length;
  return ((below - 1) / (slice.length - 1)) * 100;
}

export type IvRankGuidance = "rich" | "normal" | "thin";

/** Sizing guidance for a given IV rank, per the roadmap's thresholds. */
export function ivRankGuidance(ivRank: number | null): IvRankGuidance {
  if (ivRank == null) return "normal";
  if (ivRank > 50) return "rich";
  if (ivRank < 20) return "thin";
  return "normal";
}

export const IV_RANK_GUIDANCE_LABEL: Record<IvRankGuidance, string> = {
  rich: "Premium is rich — sell, size up.",
  normal: "Normal — sell selectively.",
  thin: "Premium is thin — sell less or skip this week.",
};
