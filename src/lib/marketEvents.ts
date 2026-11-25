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

// Source: federalreserve.gov/monetarypolicy/fomccalendars.htm (2026 verified
// 2026-07-02; 2027 read 2026-11-25). All meetings are 2-day sessions; the date
// below is the decision day. The revised 2027 calendar replaces December with
// November and makes October a "Monetary Policy Strategy Meeting" — kept in
// the list since a surprise there can still move IV. Re-check against the Fed
// page: each date is tentative until confirmed at the preceding meeting.
export const FOMC: MarketEvent[] = [
  { date: "2026-01-28", kind: "fomc", label: "FOMC decision" },
  { date: "2026-03-18", kind: "fomc", label: "FOMC decision" },
  { date: "2026-04-29", kind: "fomc", label: "FOMC decision" },
  { date: "2026-06-17", kind: "fomc", label: "FOMC decision" },
  { date: "2026-07-29", kind: "fomc", label: "FOMC decision" },
  { date: "2026-09-16", kind: "fomc", label: "FOMC decision" },
  { date: "2026-10-28", kind: "fomc", label: "FOMC decision" },
  { date: "2026-12-09", kind: "fomc", label: "FOMC decision" },
  { date: "2027-01-27", kind: "fomc", label: "FOMC decision" },
  { date: "2027-03-17", kind: "fomc", label: "FOMC decision" },
  { date: "2027-04-28", kind: "fomc", label: "FOMC decision" },
  { date: "2027-06-09", kind: "fomc", label: "FOMC decision" },
  { date: "2027-07-28", kind: "fomc", label: "FOMC decision" },
  { date: "2027-09-15", kind: "fomc", label: "FOMC decision" },
  { date: "2027-10-27", kind: "fomc", label: "FOMC strategy meeting" },
  { date: "2027-11-17", kind: "fomc", label: "FOMC decision" },
];

// Source: bls.gov/schedule/news_release/cpi.htm (read 2026-11-25; Jan–Jul 2026
// from investing.com, verified 2026-07-02). BLS only lists upcoming releases,
// so Aug–Oct 2026 are omitted — they're past. 8:30 AM ET release.
export const CPI: MarketEvent[] = [
  { date: "2026-01-13", kind: "cpi", label: "CPI release" },
  { date: "2026-02-13", kind: "cpi", label: "CPI release" },
  { date: "2026-03-11", kind: "cpi", label: "CPI release" },
  { date: "2026-04-10", kind: "cpi", label: "CPI release" },
  { date: "2026-05-12", kind: "cpi", label: "CPI release" },
  { date: "2026-06-10", kind: "cpi", label: "CPI release" },
  { date: "2026-07-14", kind: "cpi", label: "CPI release" },
  { date: "2026-11-10", kind: "cpi", label: "CPI release" },
  { date: "2026-12-10", kind: "cpi", label: "CPI release" },
  { date: "2027-01-13", kind: "cpi", label: "CPI release" },
  { date: "2027-02-11", kind: "cpi", label: "CPI release" },
  { date: "2027-03-10", kind: "cpi", label: "CPI release" },
  { date: "2027-04-13", kind: "cpi", label: "CPI release" },
  { date: "2027-05-12", kind: "cpi", label: "CPI release" },
  { date: "2027-06-10", kind: "cpi", label: "CPI release" },
  { date: "2027-07-14", kind: "cpi", label: "CPI release" },
  { date: "2027-08-11", kind: "cpi", label: "CPI release" },
  { date: "2027-09-14", kind: "cpi", label: "CPI release" },
  { date: "2027-10-14", kind: "cpi", label: "CPI release" },
  { date: "2027-11-10", kind: "cpi", label: "CPI release" },
  { date: "2027-12-10", kind: "cpi", label: "CPI release" },
];

export const MARKET_EVENTS: MarketEvent[] = [...FOMC, ...CPI].sort((a, b) =>
  a.date.localeCompare(b.date),
);

/**
 * True when any event kind has no dates left within `horizonDays` of `today`
 * — i.e. the static list needs refreshing. Checked per kind, since one list
 * running dry (CPI went silent for months in 2026) is the failure to catch.
 */
export function calendarNeedsRefresh(
  events: MarketEvent[],
  today: Date,
  horizonDays = 45,
): boolean {
  const kinds: MarketEvent["kind"][] = ["fomc", "cpi"];
  const horizonStr = toDateStr(new Date(today.getTime() + horizonDays * 86_400_000));
  return kinds.some((kind) => {
    const last = events.filter((e) => e.kind === kind).reduce((m, e) => (e.date > m ? e.date : m), "");
    return last < horizonStr;
  });
}

function toDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

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
