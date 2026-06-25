/**
 * Hedge-overlay backtest.
 *
 * POST { startDate, endDate, tqqqStartValue, annualBudgetPct, ...cfg }
 *   → replays the QQQ put overlay over historical QQQ/TQQQ/^VXN daily bars and
 *     returns the hedged-vs-naked equity curves plus the verdict stats.
 */

import { fetchYahooDailyRange } from "@/lib/yahoo";
import { runHedgeBacktest, type HedgeBar, type HedgeBacktestConfig } from "@/lib/hedgeBacktest";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const startDate: string | undefined = body.startDate;
    const endDate: string | undefined = body.endDate;

    if (!startDate || !endDate) {
      return Response.json({ error: "startDate and endDate are required." }, { status: 400 });
    }

    const tqqqStartValue = Number(body.tqqqStartValue) > 0 ? Number(body.tqqqStartValue) : 300_000;
    const annualBudgetPct = Number(body.annualBudgetPct) > 0 ? Number(body.annualBudgetPct) : 0.03;

    // Daily bars for the exact window. Must use period1/period2 — range=max
    // silently returns monthly bars, which produce a useless all-zeros backtest.
    const [qqqRaw, tqqqRaw, vxnRaw] = await Promise.all([
      fetchYahooDailyRange("QQQ", startDate, endDate),
      fetchYahooDailyRange("TQQQ", startDate, endDate),
      fetchYahooDailyRange("^VXN", startDate, endDate),
    ]);

    const qqq: HedgeBar[] = qqqRaw.map((b) => ({ date: b.date, close: b.close }));
    const tqqq: HedgeBar[] = tqqqRaw.map((b) => ({ date: b.date, close: b.close }));
    const vxnByDate = new Map(vxnRaw.map((b) => [b.date, b.close]));

    if (qqq.length === 0 || tqqq.length === 0) {
      return Response.json(
        { error: "No price history for the requested window." },
        { status: 400 },
      );
    }

    const cfg: HedgeBacktestConfig = {
      instrument: "QQQ",
      tqqqStartValue,
      annualBudgetPct,
      rollAtDte: Number(body.rollAtDte) > 0 ? Number(body.rollAtDte) : 21,
      monetizeDelta: Number(body.monetizeDelta) > 0 ? Number(body.monetizeDelta) : 0.45,
      monetizeGainPct: Number(body.monetizeGainPct) > 0 ? Number(body.monetizeGainPct) : 1.5,
      vxnPauseThreshold: Number(body.vxnPauseThreshold) > 0 ? Number(body.vxnPauseThreshold) : 25,
    };

    const result = runHedgeBacktest(qqq, tqqq, vxnByDate, cfg);

    return Response.json({
      span: { start: qqq[0].date, end: qqq[qqq.length - 1].date, tradingDays: qqq.length },
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hedge backtest failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
