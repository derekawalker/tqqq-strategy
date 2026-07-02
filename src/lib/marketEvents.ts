/**
 * Known market-moving event dates (FOMC decisions, CPI releases) — TQQQ has
 * no earnings of its own, but its IV lives on these prints. Selling short-
 * dated premium across one is the classic mistake: IV crushes afterward
 * either way, but a surprise print can gap the underlying hard enough to
 * blow through a strike that looked safe the day before.
 *
 * Dates are a maintained static list, not fetched live — the Fed and BLS
 * publish each year's schedule well in advance, so refresh this file
 * periodically rather than build a live calendar integration for ~20
 * dates/year. Sources noted per list.
 */

export interface MarketEvent {
  /** YYYY-MM-DD — the decision/release day (for FOMC, the second day of the meeting). */
  date: string;
  kind: "fomc" | "cpi";
  label: string;
}

// Source: federalreserve.gov/monetarypolicy/fomccalendars.htm (verified 2026-07-02).
// All 8 meetings/year are 2-day sessions; the date below is the decision day.
export const FOMC_2026: MarketEvent[] = [
  { date: "2026-01-28", kind: "fomc", label: "FOMC decision" },
  { date: "2026-03-18", kind: "fomc", label: "FOMC decision" },
  { date: "2026-04-29", kind: "fomc", label: "FOMC decision" },
  { date: "2026-06-17", kind: "fomc", label: "FOMC decision" },
  { date: "2026-07-29", kind: "fomc", label: "FOMC decision" },
  { date: "2026-09-16", kind: "fomc", label: "FOMC decision" },
  { date: "2026-10-28", kind: "fomc", label: "FOMC decision" },
  { date: "2026-12-09", kind: "fomc", label: "FOMC decision" },
];

// Source: investing.com CPI economic calendar (verified 2026-07-02) — bls.gov
// blocks automated fetches. Only Jan–Jul 2026 could be confirmed; add
// Aug–Dec once published at bls.gov/schedule/news_release/cpi.htm (BLS
// typically posts the full-year schedule well in advance).
export const CPI_2026: MarketEvent[] = [
  { date: "2026-01-13", kind: "cpi", label: "CPI release" },
  { date: "2026-02-13", kind: "cpi", label: "CPI release" },
  { date: "2026-03-11", kind: "cpi", label: "CPI release" },
  { date: "2026-04-10", kind: "cpi", label: "CPI release" },
  { date: "2026-05-12", kind: "cpi", label: "CPI release" },
  { date: "2026-06-10", kind: "cpi", label: "CPI release" },
  { date: "2026-07-14", kind: "cpi", label: "CPI release" },
];

export const MARKET_EVENTS: MarketEvent[] = [...FOMC_2026, ...CPI_2026].sort((a, b) =>
  a.date.localeCompare(b.date),
);

export interface UpcomingEvent extends MarketEvent {
  /** Calendar days from `today` to the event (0 = today). */
  daysAway: number;
}

/**
 * The nearest upcoming event within `lookaheadDays` of `today`, or null if
 * none (including when the static list is stale and has nothing left in
 * range — this fails silent rather than showing wrong information).
 */
export function nextEvent(
  events: MarketEvent[],
  today: Date,
  lookaheadDays = 3,
): UpcomingEvent | null {
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const upcoming = events
    .map((e) => {
      const [y, m, d] = e.date.split("-").map(Number);
      const eventMs = Date.UTC(y, m - 1, d);
      return { ...e, daysAway: Math.round((eventMs - todayMs) / 86_400_000) };
    })
    .filter((e) => e.daysAway >= 0 && e.daysAway <= lookaheadDays)
    .sort((a, b) => a.daysAway - b.daysAway);
  return upcoming[0] ?? null;
}

const GUIDANCE: Record<MarketEvent["kind"], string> = {
  fomc: "Elevated premium, but a surprise can gap the underlying — avoid opening short-dated positions into the print.",
  cpi: "IV often ticks up ahead of the print — fine to sell into it, but size down on very short-dated strikes.",
};

export function eventGuidance(kind: MarketEvent["kind"]): string {
  return GUIDANCE[kind];
}
