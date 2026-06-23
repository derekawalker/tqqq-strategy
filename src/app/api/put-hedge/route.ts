/**
 * Put-hedge backtest route.
 *
 * GET  → current QQQ price + ^VXN level (for live recommendations, no auth needed beyond middleware)
 * POST → backtest sweep or single-config curve
 *
 * Premiums are modeled with Black-Scholes using ^VXN as the implied-vol input.
 */

import { fetchYahooDaily } from "@/lib/yahoo";
import {
  alignHedgeBars,
  simulatePutHedge,
  simulateLadderHedge,
  sweepPutHedge,
  type LadderLeg,
  type PutHedgeParams,
  type PutHedgeResult,
  type SweepGrid,
} from "@/lib/putHedge";
import { TRANCHES, HEDGE_DTE, ROLL_AT_DTE } from "@/lib/hedgeTranches";

// The hedge is always QQQ puts against a held TQQQ position.
const QQQ_COVERAGE = [1, 2, 3, 4];
const QQQ_DIVIDEND_YIELD = 0.006;

// The recommended ladder = the active tranches at their target coverage caps,
// 60 DTE, rolled at 21d — i.e. exactly the strategy the buy panel sizes.
const RECOMMENDED_LEGS: LadderLeg[] = TRANCHES.filter((t) => t.budgetShare > 0).map((t) => ({
  moneyness: t.moneyness,
  dteDays: HEDGE_DTE,
  rollEveryDays: ROLL_AT_DTE,
  coverageRatio: t.maxCoverage,
}));

function summarize(r: PutHedgeResult) {
  const { equity: _equity, ...rest } = r;
  return rest;
}

/** GET: current QQQ price and ^VXN level — used for live recommendations. */
export async function GET() {
  try {
    const [qqq, vxn] = await Promise.all([
      fetchYahooDaily("QQQ", 1),
      fetchYahooDaily("^VXN", 1),
    ]);
    return Response.json({
      qqqPrice: qqq.at(-1)?.close ?? null,
      vxnPct: vxn.at(-1)?.close ?? null,
      asOf: qqq.at(-1)?.date ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch market data";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const years: number = Number(body.years) > 0 ? Number(body.years) : 10;

    const [tqqq, putBars, vxn] = await Promise.all([
      fetchYahooDaily("TQQQ", years),
      fetchYahooDaily("QQQ", years),
      fetchYahooDaily("^VXN", years),
    ]);

    if (tqqq.length === 0 || putBars.length === 0 || vxn.length === 0) {
      return Response.json({ error: "Missing price data from upstream" }, { status: 502 });
    }

    const ivByDate = new Map(vxn.map((b) => [b.date, b.close / 100]));

    const bars = alignHedgeBars(tqqq, putBars, ivByDate);
    if (bars.length < 30) {
      return Response.json({ error: "Not enough overlapping data to backtest" }, { status: 502 });
    }

    const span = { start: bars[0].date, end: bars[bars.length - 1].date };
    const lastBar = bars[bars.length - 1];
    const currentMarket = {
      qqqPrice: lastBar.putClose,
      vxnPct: vxn.at(-1)?.close ?? null,
      asOf: lastBar.date,
    };
    const unhedgedRef = simulatePutHedge(bars, { moneyness: 0.9, dteDays: 30, coverageRatio: 0 });

    if (body.params) {
      const params: PutHedgeParams = { dividendYield: QQQ_DIVIDEND_YIELD, costBps: 75, ...body.params };
      const result = simulatePutHedge(bars, params);
      return Response.json({
        putUnderlying: "QQQ",
        span,
        currentMarket,
        unhedged: { cagr: unhedgedRef.unhedgedCagr, maxDD: unhedgedRef.unhedgedMaxDD },
        result,
      });
    }

    const grid: SweepGrid = {
      // Spans the 3-tranche ladder: deep-OTM catastrophe (0.65) through near-money (0.95).
      moneyness: [0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
      dteDays: [30, 45, 60, 90],
      rollEveryDays: [null, 21],
      coverageRatio: QQQ_COVERAGE,
      dividendYield: QQQ_DIVIDEND_YIELD,
      costBps: 75,
    };
    const ranked = sweepPutHedge(bars, grid);
    if (ranked.length === 0) {
      return Response.json({ error: "No protective configuration found" }, { status: 200 });
    }

    // The strategy the buy panel actually recommends, backtested as one ladder.
    const recommended = simulateLadderHedge(bars, RECOMMENDED_LEGS, {
      dividendYield: QQQ_DIVIDEND_YIELD,
      costBps: 75,
    });

    return Response.json({
      putUnderlying: "QQQ",
      span,
      currentMarket,
      unhedged: { cagr: unhedgedRef.unhedgedCagr, maxDD: unhedgedRef.unhedgedMaxDD },
      recommended,
      best: ranked[0],
      table: ranked.slice(0, 15).map(summarize),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Put-hedge backtest failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
