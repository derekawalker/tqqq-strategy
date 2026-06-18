import YahooFinance from "yahoo-finance2";
import { alignSeries, computeAnomaly, type AnomalyPoint, type SeriesPoint } from "@/lib/anomaly";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Raw Yahoo tickers backing each aligned field. All are free daily series.
const TICKERS = {
  spx: "^GSPC", // S&P 500 (benchmark / price axis)
  vix: "^VIX", // 30d implied vol
  vix3m: "^VIX3M", // 3m implied vol (term-structure denominator)
  move: "^MOVE", // Treasury implied vol
  hyg: "HYG", // high-yield corporate bond ETF
  lqd: "LQD", // investment-grade corporate bond ETF
  tlt: "TLT", // 20y+ Treasury ETF
  tnx: "^TNX", // 10y yield
  irx: "^IRX", // 13w T-bill yield
  cper: "CPER", // copper ETF
  gld: "GLD", // gold ETF
} as const;

type Field = keyof typeof TICKERS;

export interface AnomalyResponse {
  points: AnomalyPoint[];
  asOf: string | null;
  components: Record<Field, string>;
}

async function fetchSeries(symbol: string, period1: Date): Promise<SeriesPoint[]> {
  const result = await yf.chart(symbol, { period1, interval: "1d" });
  return (result.quotes ?? [])
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: (q.date as Date).toISOString().slice(0, 10), close: q.close as number }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Default ~3 years so the 252-day z-score window leaves ~2 years of live signal.
  // Cap at 14y: CPER (copper ETF) inception is late-2011, the binding constraint.
  const years = Math.min(Math.max(Number(searchParams.get("years")) || 3, 2), 14);
  const period1 = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000);

  try {
    const fields = Object.keys(TICKERS) as Field[];
    const fetched = await Promise.all(fields.map((f) => fetchSeries(TICKERS[f], period1)));

    const series = {} as Record<Field, SeriesPoint[]>;
    fields.forEach((f, i) => (series[f] = fetched[i]));

    const rows = alignSeries(series);
    const points = computeAnomaly(rows);

    return Response.json({
      points,
      asOf: points.at(-1)?.date ?? null,
      components: TICKERS,
    } satisfies AnomalyResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
