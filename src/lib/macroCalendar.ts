// FOMC decision dates and CPI release dates.
// Update annually: FOMC schedule at federalreserve.gov, CPI at bls.gov/schedule/news_release/cpi.htm
// Dates are the DAY OF the announcement (FOMC rate decision day; CPI release morning).

export type MacroEventType = "FOMC" | "CPI";

export interface MacroEvent {
  date: string;   // YYYY-MM-DD
  type: MacroEventType;
  label: string;  // human-readable, e.g. "FOMC rate decision"
}

const EVENTS: MacroEvent[] = [
  // ── 2021 ──────────────────────────────────────────────────────────────────
  { date: "2021-01-13", type: "CPI",  label: "CPI (Dec 2020)" },
  { date: "2021-01-27", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-02-10", type: "CPI",  label: "CPI (Jan 2021)" },
  { date: "2021-03-10", type: "CPI",  label: "CPI (Feb 2021)" },
  { date: "2021-03-17", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-04-13", type: "CPI",  label: "CPI (Mar 2021)" },
  { date: "2021-04-28", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-05-12", type: "CPI",  label: "CPI (Apr 2021)" },
  { date: "2021-06-10", type: "CPI",  label: "CPI (May 2021)" },
  { date: "2021-06-16", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-07-13", type: "CPI",  label: "CPI (Jun 2021)" },
  { date: "2021-07-28", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-08-11", type: "CPI",  label: "CPI (Jul 2021)" },
  { date: "2021-09-14", type: "CPI",  label: "CPI (Aug 2021)" },
  { date: "2021-09-22", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-10-13", type: "CPI",  label: "CPI (Sep 2021)" },
  { date: "2021-11-03", type: "FOMC", label: "FOMC rate decision" },
  { date: "2021-11-10", type: "CPI",  label: "CPI (Oct 2021)" },
  { date: "2021-12-10", type: "CPI",  label: "CPI (Nov 2021)" },
  { date: "2021-12-15", type: "FOMC", label: "FOMC rate decision" },

  // ── 2022 ──────────────────────────────────────────────────────────────────
  { date: "2022-01-12", type: "CPI",  label: "CPI (Dec 2021)" },
  { date: "2022-01-26", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-02-10", type: "CPI",  label: "CPI (Jan 2022)" },
  { date: "2022-03-10", type: "CPI",  label: "CPI (Feb 2022)" },
  { date: "2022-03-16", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-04-12", type: "CPI",  label: "CPI (Mar 2022)" },
  { date: "2022-05-04", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-05-11", type: "CPI",  label: "CPI (Apr 2022)" },
  { date: "2022-06-10", type: "CPI",  label: "CPI (May 2022)" },
  { date: "2022-06-15", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-07-13", type: "CPI",  label: "CPI (Jun 2022)" },
  { date: "2022-07-27", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-08-10", type: "CPI",  label: "CPI (Jul 2022)" },
  { date: "2022-09-13", type: "CPI",  label: "CPI (Aug 2022)" },
  { date: "2022-09-21", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-10-13", type: "CPI",  label: "CPI (Sep 2022)" },
  { date: "2022-11-02", type: "FOMC", label: "FOMC rate decision" },
  { date: "2022-11-10", type: "CPI",  label: "CPI (Oct 2022)" },
  { date: "2022-12-13", type: "CPI",  label: "CPI (Nov 2022)" },
  { date: "2022-12-14", type: "FOMC", label: "FOMC rate decision" },

  // ── 2023 ──────────────────────────────────────────────────────────────────
  { date: "2023-01-12", type: "CPI",  label: "CPI (Dec 2022)" },
  { date: "2023-02-01", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-02-14", type: "CPI",  label: "CPI (Jan 2023)" },
  { date: "2023-03-14", type: "CPI",  label: "CPI (Feb 2023)" },
  { date: "2023-03-22", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-04-12", type: "CPI",  label: "CPI (Mar 2023)" },
  { date: "2023-05-03", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-05-10", type: "CPI",  label: "CPI (Apr 2023)" },
  { date: "2023-06-13", type: "CPI",  label: "CPI (May 2023)" },
  { date: "2023-06-14", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-07-12", type: "CPI",  label: "CPI (Jun 2023)" },
  { date: "2023-07-26", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-08-10", type: "CPI",  label: "CPI (Jul 2023)" },
  { date: "2023-09-13", type: "CPI",  label: "CPI (Aug 2023)" },
  { date: "2023-09-20", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-10-12", type: "CPI",  label: "CPI (Sep 2023)" },
  { date: "2023-11-01", type: "FOMC", label: "FOMC rate decision" },
  { date: "2023-11-14", type: "CPI",  label: "CPI (Oct 2023)" },
  { date: "2023-12-12", type: "CPI",  label: "CPI (Nov 2023)" },
  { date: "2023-12-13", type: "FOMC", label: "FOMC rate decision" },

  // ── 2024 ──────────────────────────────────────────────────────────────────
  { date: "2024-01-11", type: "CPI",  label: "CPI (Dec 2023)" },
  { date: "2024-01-31", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-02-13", type: "CPI",  label: "CPI (Jan 2024)" },
  { date: "2024-03-12", type: "CPI",  label: "CPI (Feb 2024)" },
  { date: "2024-03-20", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-04-10", type: "CPI",  label: "CPI (Mar 2024)" },
  { date: "2024-05-01", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-05-15", type: "CPI",  label: "CPI (Apr 2024)" },
  { date: "2024-06-12", type: "CPI",  label: "CPI (May 2024)" },
  { date: "2024-06-12", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-07-11", type: "CPI",  label: "CPI (Jun 2024)" },
  { date: "2024-07-31", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-08-14", type: "CPI",  label: "CPI (Jul 2024)" },
  { date: "2024-09-11", type: "CPI",  label: "CPI (Aug 2024)" },
  { date: "2024-09-18", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-10-10", type: "CPI",  label: "CPI (Sep 2024)" },
  { date: "2024-11-07", type: "FOMC", label: "FOMC rate decision" },
  { date: "2024-11-13", type: "CPI",  label: "CPI (Oct 2024)" },
  { date: "2024-12-11", type: "CPI",  label: "CPI (Nov 2024)" },
  { date: "2024-12-18", type: "FOMC", label: "FOMC rate decision" },

  // ── 2025 ──────────────────────────────────────────────────────────────────
  { date: "2025-01-15", type: "CPI",  label: "CPI (Dec 2024)" },
  { date: "2025-01-29", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-02-12", type: "CPI",  label: "CPI (Jan 2025)" },
  { date: "2025-03-12", type: "CPI",  label: "CPI (Feb 2025)" },
  { date: "2025-03-19", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-04-10", type: "CPI",  label: "CPI (Mar 2025)" },
  { date: "2025-05-07", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-05-13", type: "CPI",  label: "CPI (Apr 2025)" },
  { date: "2025-06-11", type: "CPI",  label: "CPI (May 2025)" },
  { date: "2025-06-18", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-07-15", type: "CPI",  label: "CPI (Jun 2025)" },
  { date: "2025-07-30", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-08-12", type: "CPI",  label: "CPI (Jul 2025)" },
  { date: "2025-09-10", type: "CPI",  label: "CPI (Aug 2025)" },
  { date: "2025-09-17", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-10-14", type: "CPI",  label: "CPI (Sep 2025)" },
  { date: "2025-10-29", type: "FOMC", label: "FOMC rate decision" },
  { date: "2025-11-12", type: "CPI",  label: "CPI (Oct 2025)" },
  { date: "2025-12-10", type: "CPI",  label: "CPI (Nov 2025)" },
  { date: "2025-12-10", type: "FOMC", label: "FOMC rate decision" },

  // ── 2026 ──────────────────────────────────────────────────────────────────
  { date: "2026-01-14", type: "CPI",  label: "CPI (Dec 2025)" },
  { date: "2026-01-28", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-02-11", type: "CPI",  label: "CPI (Jan 2026)" },
  { date: "2026-03-11", type: "CPI",  label: "CPI (Feb 2026)" },
  { date: "2026-03-18", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-04-10", type: "CPI",  label: "CPI (Mar 2026)" },
  { date: "2026-04-29", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-05-13", type: "CPI",  label: "CPI (Apr 2026)" },
  { date: "2026-06-10", type: "CPI",  label: "CPI (May 2026)" },
  { date: "2026-06-10", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-07-14", type: "CPI",  label: "CPI (Jun 2026)" },
  { date: "2026-07-29", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-08-12", type: "CPI",  label: "CPI (Jul 2026)" },
  { date: "2026-09-09", type: "CPI",  label: "CPI (Aug 2026)" },
  { date: "2026-09-16", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-10-13", type: "CPI",  label: "CPI (Sep 2026)" },
  { date: "2026-10-28", type: "FOMC", label: "FOMC rate decision" },
  { date: "2026-11-12", type: "CPI",  label: "CPI (Oct 2026)" },
  { date: "2026-12-09", type: "CPI",  label: "CPI (Nov 2026)" },
  { date: "2026-12-09", type: "FOMC", label: "FOMC rate decision" },
];

const EVENT_SET = new Set(EVENTS.map((e) => e.date));
const EVENT_MAP = new Map<string, MacroEvent[]>();
for (const e of EVENTS) {
  const arr = EVENT_MAP.get(e.date) ?? [];
  arr.push(e);
  EVENT_MAP.set(e.date, arr);
}

// Returns events whose date falls within the given set of date strings (YYYY-MM-DD).
export function getEventsInWindow(windowDates: string[]): MacroEvent[] {
  const results: MacroEvent[] = [];
  for (const d of windowDates) {
    const evts = EVENT_MAP.get(d);
    if (evts) results.push(...evts);
  }
  return results;
}

// Returns upcoming events within the next nTradingDays from today,
// given an ordered array of all known upcoming trading day strings.
export function getUpcomingEvents(tradingDays: string[], fromDate: string, nDays = 5): MacroEvent[] {
  const startIdx = tradingDays.findIndex((d) => d > fromDate);
  if (startIdx === -1) return [];
  const window = tradingDays.slice(startIdx, startIdx + nDays);
  return getEventsInWindow(window);
}

export function eventRiskBin(eventCount: number): string {
  if (eventCount === 0) return "No events";
  if (eventCount === 1) return "1 event";
  return "2+ events";
}
