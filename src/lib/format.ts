/** General number formatter. decimals defaults to 2. */
export const fmt = (n: number, decimals = 2): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** "Jan 1, 2026" */
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "1/1/26" — compact numeric */
export const fmtDateShort = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });

/** YYYY-MM-DD from a Date object */
export const toDateKey = (date: Date): string =>
  date.toLocaleDateString("en-CA");

/** "1/1/26" from a YYYY-MM-DD key string */
export const fmtDateKey = (key: string): string => {
  const d = new Date(key + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
};

/** "2:00 PM" */
export const fmtTime = (ts: string | number): string =>
  new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Mon, Jan 1, 2:00 PM" */
export const fmtDateTime = (ts: string | number): string =>
  new Date(ts).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

/** Sunday YYYY-MM-DD of the week containing the given YYYY-MM-DD key */
export const weekStart = (dateKey: string): string => {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return d.toLocaleDateString("en-CA");
};

/** Returns a mask function. Replaces any string with "••••" when privacyMode is true. */
export const createMask = (privacyMode: boolean) =>
  (val: string): string => (privacyMode ? "••••" : val);
