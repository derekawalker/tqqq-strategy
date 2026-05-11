import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Sorted by QQQ weight %, descending (approximate as of early 2025)
export const QQQ_HOLDINGS = [
  { symbol: "MSFT",  name: "Microsoft",  weight: 8.8 },
  { symbol: "AAPL",  name: "Apple",      weight: 8.0 },
  { symbol: "NVDA",  name: "NVIDIA",     weight: 7.9 },
  { symbol: "AMZN",  name: "Amazon",     weight: 5.3 },
  { symbol: "META",  name: "Meta",       weight: 4.9 },
  { symbol: "GOOGL", name: "Alphabet",   weight: 4.5 },
  { symbol: "TSLA",  name: "Tesla",      weight: 3.5 },
  { symbol: "AVGO",  name: "Broadcom",   weight: 3.2 },
  { symbol: "COST",  name: "Costco",     weight: 2.6 },
  { symbol: "NFLX",  name: "Netflix",    weight: 2.4 },
  { symbol: "TMUS",  name: "T-Mobile",   weight: 2.2 },
  { symbol: "AMD",   name: "AMD",        weight: 2.0 },
];

export const QQQ_TOP12 = QQQ_HOLDINGS;

const POSITIVE_WORDS = [
  "beat", "surge", "rally", "soar", "record", "gain", "rise", "bullish",
  "upgrade", "strong", "growth", "profit", "exceed", "outperform", "boost",
  "recovery", "milestone", "expansion", "positive", "high", "buy",
];

const NEGATIVE_WORDS = [
  "miss", "crash", "fall", "drop", "plunge", "decline", "bearish", "downgrade",
  "weak", "loss", "disappoint", "warning", "risk", "concern", "threat",
  "slowdown", "recession", "layoff", "cut", "below", "underperform", "sell",
  "negative", "low", "fear", "tariff", "lawsuit", "investigation",
];

function scoreHeadline(title: string): "positive" | "negative" | "neutral" {
  const lower = title.toLowerCase();
  const pos = POSITIVE_WORDS.filter((w) => lower.includes(w)).length;
  const neg = NEGATIVE_WORDS.filter((w) => lower.includes(w)).length;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

// Wilder's smoothed RSI (EMA-based average gain/loss)
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface SentimentArticle {
  title: string;
  publisher: string;
  providerPublishTime: number;
  sentiment: "positive" | "negative" | "neutral";
  link: string;
}

export interface HoldingSignals {
  volumeRatio: number | null;        // today vol / 3-month avg vol
  goldenCross: boolean | null;       // 50-day MA > 200-day MA
  momentum52w: number | null;        // 52-week price return (%) — display only
  priceVs50dPct: number | null;      // % above/below 50-day MA (used in scoring)
  shortFloatPct: number | null;      // short interest as % of float
  shortRatio: number | null;         // days to cover
  insiderBuys90d: number;            // open-market insider purchases in last 90 days
  insiderSells90d: number;           // open-market insider sales in last 90 days
  epsRevision30d: number | null;     // % change in current-Q EPS estimate vs 30 days ago
  epsRevisionsUp30d: number | null;  // # analysts raising estimate (30d)
  epsRevisionsDown30d: number | null;// # analysts cutting estimate (30d)
}

export interface HoldingSentiment {
  symbol: string;
  name: string;
  weight: number;
  score: number;
  articleCount: number;
  articles: SentimentArticle[];
  dayChangePercent: number | null;
  earnings: {
    nextDate: number | null;
    recommendationMean: number | null;
  };
  signals: HoldingSignals;
}

export interface HistoryPoint { t: number; v: number }

// FOMC meeting end dates (second day of each meeting = rate decision day)
const FOMC_DATES = [
  new Date("2025-01-29"), new Date("2025-03-19"), new Date("2025-05-07"),
  new Date("2025-06-18"), new Date("2025-07-30"), new Date("2025-09-17"),
  new Date("2025-10-29"), new Date("2025-12-10"),
  new Date("2026-01-28"), new Date("2026-03-18"), new Date("2026-04-29"),
  new Date("2026-06-10"), new Date("2026-07-29"), new Date("2026-09-16"),
  new Date("2026-10-28"), new Date("2026-12-09"),
];

export interface TqqqSignals {
  momentum5d: number | null;
  momentum20d: number | null;
  priceVs20dMa: number | null;
}

export interface SentimentData {
  cachedAt: number;
  tqqqSignals: TqqqSignals | null;
  skew: { current: number; history: HistoryPoint[] } | null;
  earningsRiskCount: number;
  fearGreed: {
    current: number;
    previousClose: number;
    oneWeekAgo: number;
    oneMonthAgo: number;
    rating: string;
    history: HistoryPoint[];
  } | null;
  vix: {
    current: number;
    dayChange: number;
    weekChange: number;
    monthChange: number;
    high52w: number | null;
    low52w: number | null;
    history: HistoryPoint[];
  } | null;
  rsi: { value: number; history: HistoryPoint[] } | null;
  macro: {
    yieldSpread: {
      tenYear: number;
      threeMonth: number;
      spread: number;
      history: HistoryPoint[];
    } | null;
    putCallRatio: number | null;
    fomc: {
      nextDate: number;
      daysUntil: number;
      daysSinceLast: number;
      label: string;
    } | null;
  };
  holdings: HoldingSentiment[];
}

// ── in-memory cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
let cachedPayload: SentimentData | null = null;
let cachedAt = 0;

// ── per-stock helpers ──────────────────────────────────────────────────────

const QUOTE_FIELDS = [
  "regularMarketPrice",
  "regularMarketChangePercent",
  "regularMarketVolume",
  "averageDailyVolume3Month",
  "fiftyDayAverage",
  "twoHundredDayAverage",
  "fiftyTwoWeekChangePercent",
] as const;

const SUMMARY_MODULES = [
  "calendarEvents",
  "financialData",
  "defaultKeyStatistics",
  "insiderTransactions",
  "earningsTrend",
] as const;

async function fetchStockBatch(stocks: typeof QQQ_HOLDINGS) {
  const [newsResults, earningsResults, quoteResults] = await Promise.all([
    Promise.allSettled(stocks.map((h) => yf.search(h.name, { newsCount: 5, quotesCount: 0 }))),
    Promise.allSettled(stocks.map((h) => yf.quoteSummary(h.symbol, { modules: [...SUMMARY_MODULES] }))),
    Promise.allSettled(stocks.map((h) => yf.quote(h.symbol, { fields: [...QUOTE_FIELDS] }))),
  ]);
  return { newsResults, earningsResults, quoteResults };
}

type BatchResults = Awaited<ReturnType<typeof fetchStockBatch>>;

function processHolding(
  holding: (typeof QQQ_HOLDINGS)[number],
  newsResult: BatchResults["newsResults"][number],
  earningsResult: BatchResults["earningsResults"][number],
  quoteResult: BatchResults["quoteResults"][number],
): HoldingSentiment {
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const summary = earningsResult.status === "fulfilled" ? earningsResult.value : null;
  const dayChangePercent = quote?.regularMarketChangePercent ?? null;

  const news = newsResult.status === "fulfilled" ? (newsResult.value.news ?? []) : [];
  const articles: SentimentArticle[] = news.slice(0, 5).map((article) => ({
    title: article.title,
    publisher: article.publisher,
    providerPublishTime: (article.providerPublishTime as Date).getTime(),
    sentiment: scoreHeadline(article.title),
    link: article.link,
  }));
  const pos = articles.filter((a) => a.sentiment === "positive").length;
  const neg = articles.filter((a) => a.sentiment === "negative").length;
  const newsScore = articles.length > 0 ? (pos - neg) / articles.length : 0;

  let earnings: HoldingSentiment["earnings"] = { nextDate: null, recommendationMean: null };
  if (summary) {
    const dates = summary.calendarEvents?.earnings?.earningsDate;
    const nextDate = dates && dates.length > 0 ? (dates[0] as Date).getTime() : null;
    earnings = {
      nextDate,
      recommendationMean: summary.financialData?.recommendationMean ?? null,
    };
  }

  const volumeRatio =
    quote?.regularMarketVolume != null && quote?.averageDailyVolume3Month
      ? Math.round((quote.regularMarketVolume / quote.averageDailyVolume3Month) * 100) / 100
      : null;

  const goldenCross =
    quote?.fiftyDayAverage != null && quote?.twoHundredDayAverage != null
      ? quote.fiftyDayAverage > quote.twoHundredDayAverage
      : null;

  const momentum52w =
    quote?.fiftyTwoWeekChangePercent != null
      ? Math.round(quote.fiftyTwoWeekChangePercent * 10) / 10
      : null;

  const priceVs50dPct =
    quote?.regularMarketPrice != null && quote?.fiftyDayAverage != null && quote.fiftyDayAverage > 0
      ? Math.round(((quote.regularMarketPrice / quote.fiftyDayAverage) - 1) * 1000) / 10
      : null;

  const keyStats = summary?.defaultKeyStatistics ?? null;
  const shortFloatPct =
    keyStats?.shortPercentOfFloat != null
      ? Math.round(keyStats.shortPercentOfFloat * 1000) / 10
      : null;
  const shortRatio =
    keyStats?.shortRatio != null ? Math.round(keyStats.shortRatio * 10) / 10 : null;

  const cutoff90d = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let insiderBuys90d = 0;
  let insiderSells90d = 0;
  for (const tx of summary?.insiderTransactions?.transactions ?? []) {
    if (!tx.startDate || (tx.startDate as Date).getTime() < cutoff90d) continue;
    const text = (tx.transactionText ?? "").toLowerCase();
    if (text.includes("purchase")) insiderBuys90d++;
    else if (text.includes("sale") || text.includes("sell")) insiderSells90d++;
  }

  const trendData = summary?.earningsTrend?.trend ?? [];
  const currentQTrend = trendData.find((t) => t.period === "0q") ?? trendData[0] ?? null;
  let epsRevision30d: number | null = null;
  if (currentQTrend?.epsTrend) {
    const cur = currentQTrend.epsTrend.current;
    const ago30 = currentQTrend.epsTrend["30daysAgo"];
    if (cur != null && ago30 != null && ago30 !== 0) {
      epsRevision30d = Math.round(((cur - ago30) / Math.abs(ago30)) * 1000) / 10;
    }
  }
  const epsRevisionsUp30d = currentQTrend?.epsRevisions?.upLast30days ?? null;
  const epsRevisionsDown30d = currentQTrend?.epsRevisions?.downLast30days ?? null;

  const signals: HoldingSignals = {
    volumeRatio, goldenCross, momentum52w, priceVs50dPct,
    shortFloatPct, shortRatio, insiderBuys90d, insiderSells90d,
    epsRevision30d, epsRevisionsUp30d, epsRevisionsDown30d,
  };

  const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
  const priceScore = dayChangePercent != null ? clamp(dayChangePercent / 5) : null;
  const analystScore = earnings.recommendationMean != null
    ? (3 - earnings.recommendationMean) / 2 : null;
  const maScore = goldenCross != null ? (goldenCross ? 1 : -1) : null;
  const priceVs50dScore = priceVs50dPct != null ? clamp(priceVs50dPct / 20) : null;
  const epsScore = epsRevision30d != null ? clamp(epsRevision30d / 15) : null;
  const insiderTotal = insiderBuys90d + insiderSells90d;
  const insiderScore = insiderTotal > 0
    ? (insiderBuys90d - insiderSells90d) / insiderTotal : null;

  const weightedSignals = [
    { v: epsScore,        w: 0.25 },
    { v: priceVs50dScore, w: 0.20 },
    { v: analystScore,    w: 0.18 },
    { v: newsScore,       w: 0.15 },
    { v: maScore,         w: 0.10 },
    { v: insiderScore,    w: 0.08 },
    { v: priceScore,      w: 0.04 },
  ].filter((s): s is { v: number; w: number } => s.v != null);
  const totalWeight = weightedSignals.reduce((a, s) => a + s.w, 0);
  const score = totalWeight > 0
    ? weightedSignals.reduce((a, s) => a + s.v * s.w, 0) / totalWeight : 0;

  return { ...holding, score, articleCount: articles.length, articles, dayChangePercent, earnings, signals };
}

// ── route ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    if (cachedPayload && Date.now() - cachedAt < CACHE_TTL_MS) {
      return Response.json(cachedPayload);
    }

    const period14 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const period45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    const [
      [vixResult, vixQuoteResult, tqqqResult, fgResult, tnxResult, irxResult, pcResult, skewResult],
      batch1,
    ] = await Promise.all([
      Promise.allSettled([
        yf.chart("^VIX", { period1: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), interval: "1d" }),
        yf.quote("^VIX", { fields: ["fiftyTwoWeekHigh", "fiftyTwoWeekLow"] }),
        yf.chart("TQQQ", { period1: period45, interval: "1d" }),
        fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://edition.cnn.com/",
          },
        }),
        yf.chart("^TNX", { period1: period14, interval: "1d" }),
        yf.chart("^IRX", { period1: period14, interval: "1d" }),
        yf.options("QQQ"),
        yf.chart("^SKEW", { period1: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), interval: "1d" }),
      ]),
      fetchStockBatch(QQQ_HOLDINGS),
    ]);

    // ── process market data ────────────────────────────────────────────────

    let vix: SentimentData["vix"] = null;
    if (vixResult.status === "fulfilled") {
      const quotes = vixResult.value.quotes.filter((q) => q.close != null);
      if (quotes.length >= 2) {
        const current = quotes[quotes.length - 1].close as number;
        const yesterday = quotes[quotes.length - 2].close as number;
        const weekAgo = quotes[Math.max(0, quotes.length - 6)].close as number;
        const monthAgo = quotes[Math.max(0, quotes.length - 22)].close as number;
        const history: HistoryPoint[] = quotes.slice(-14).map((q) => ({
          t: (q.date as Date).getTime(),
          v: Math.round((q.close as number) * 100) / 100,
        }));
        vix = {
          current: Math.round(current * 100) / 100,
          dayChange: Math.round((current - yesterday) * 100) / 100,
          weekChange: Math.round((current - weekAgo) * 100) / 100,
          monthChange: Math.round((current - monthAgo) * 100) / 100,
          high52w: vixQuoteResult.status === "fulfilled" ? (vixQuoteResult.value.fiftyTwoWeekHigh ?? null) : null,
          low52w: vixQuoteResult.status === "fulfilled" ? (vixQuoteResult.value.fiftyTwoWeekLow ?? null) : null,
          history,
        };
      }
    }

    let rsi: SentimentData["rsi"] = null;
    let tqqqSignals: SentimentData["tqqqSignals"] = null;
    if (tqqqResult.status === "fulfilled") {
      const rawQuotes = tqqqResult.value.quotes.filter((q) => q.close != null);
      const closes = rawQuotes.map((q) => q.close as number);
      const rsiHistory: HistoryPoint[] = [];
      for (let i = Math.max(15, closes.length - 13); i <= closes.length; i++) {
        const slice = closes.slice(0, i);
        const t = (rawQuotes[i - 1].date as Date).getTime();
        rsiHistory.push({ t, v: Math.round(calcRSI(slice) * 10) / 10 });
      }
      rsi = { value: rsiHistory[rsiHistory.length - 1]?.v ?? 50, history: rsiHistory };
      if (closes.length >= 21) {
        const last = closes[closes.length - 1];
        const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        tqqqSignals = {
          momentum5d: Math.round(((last / closes[closes.length - 6]) - 1) * 1000) / 10,
          momentum20d: Math.round(((last / closes[closes.length - 21]) - 1) * 1000) / 10,
          priceVs20dMa: Math.round(((last / ma20) - 1) * 1000) / 10,
        };
      }
    }

    let fearGreed: SentimentData["fearGreed"] = null;
    if (fgResult.status === "fulfilled" && fgResult.value.ok) {
      try {
        const data = await fgResult.value.json();
        const fg = data?.fear_and_greed;
        const fgHistorical = data?.fear_and_greed_historical?.data;
        if (fg) {
          fearGreed = {
            current: Math.round(fg.score),
            previousClose: Math.round(fg.previous_close),
            oneWeekAgo: Math.round(fg.previous_1_week),
            oneMonthAgo: Math.round(fg.previous_1_month),
            rating: fg.rating as string,
            history: Array.isArray(fgHistorical)
              ? (fgHistorical as { x: number; y: number }[])
                  .slice(-14)
                  .map((d) => ({ t: Math.round(d.x), v: Math.round(d.y) }))
              : [],
          };
        }
      } catch { /* F&G unavailable */ }
    }

    let yieldSpread: SentimentData["macro"]["yieldSpread"] = null;
    if (tnxResult.status === "fulfilled" && irxResult.status === "fulfilled") {
      const tnxQuotes = tnxResult.value.quotes.filter((q) => q.close != null);
      const irxQuotes = irxResult.value.quotes.filter((q) => q.close != null);
      if (tnxQuotes.length > 0 && irxQuotes.length > 0) {
        const tenYear = (tnxQuotes[tnxQuotes.length - 1].close as number) / 10;
        const threeMonth = (irxQuotes[irxQuotes.length - 1].close as number) / 10;
        const irxByDate = new Map(
          irxQuotes.map((q) => [(q.date as Date).toDateString(), (q.close as number) / 10])
        );
        const history: HistoryPoint[] = tnxQuotes.slice(-14).flatMap((q) => {
          const irx = irxByDate.get((q.date as Date).toDateString());
          if (irx == null) return [];
          return [{ t: (q.date as Date).getTime(), v: Math.round(((q.close as number) / 10 - irx) * 100) / 100 }];
        });
        yieldSpread = {
          tenYear: Math.round(tenYear * 100) / 100,
          threeMonth: Math.round(threeMonth * 100) / 100,
          spread: Math.round((tenYear - threeMonth) * 100) / 100,
          history,
        };
      }
    }

    let putCallRatio: number | null = null;
    if (pcResult.status === "fulfilled") {
      const chains = (pcResult.value.options ?? []).slice(0, 3);
      let putOI = 0, callOI = 0;
      for (const chain of chains) {
        putOI += chain.puts.reduce((s, p) => s + (p.openInterest ?? 0), 0);
        callOI += chain.calls.reduce((s, c) => s + (c.openInterest ?? 0), 0);
      }
      if (callOI > 0) putCallRatio = Math.round((putOI / callOI) * 100) / 100;
    }

    let skew: SentimentData["skew"] = null;
    if (skewResult.status === "fulfilled") {
      const quotes = skewResult.value.quotes.filter((q) => q.close != null);
      if (quotes.length > 0) {
        const history: HistoryPoint[] = quotes.slice(-14).map((q) => ({
          t: (q.date as Date).getTime(),
          v: Math.round((q.close as number) * 10) / 10,
        }));
        skew = { current: history[history.length - 1].v, history };
      }
    }

    const now = Date.now();
    const nextFomc = FOMC_DATES.find((d) => d.getTime() > now) ?? null;
    const lastFomc = [...FOMC_DATES].reverse().find((d) => d.getTime() <= now) ?? null;
    const fomc = nextFomc
      ? {
          nextDate: nextFomc.getTime(),
          daysUntil: Math.ceil((nextFomc.getTime() - now) / 86400000),
          daysSinceLast: lastFomc ? Math.floor((now - lastFomc.getTime()) / 86400000) : 0,
          label: nextFomc.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        }
      : null;

    // ── process holdings ───────────────────────────────────────────────────

    const holdings: HoldingSentiment[] = QQQ_HOLDINGS.map((h, i) =>
      processHolding(h, batch1.newsResults[i], batch1.earningsResults[i], batch1.quoteResults[i])
    );

    const earningsWindow = now + 10 * 24 * 60 * 60 * 1000;
    const earningsRiskCount = holdings.filter(
      (h) => h.earnings.nextDate != null && h.earnings.nextDate <= earningsWindow
    ).length;

    const payload: SentimentData = {
      cachedAt: now,
      tqqqSignals, skew, earningsRiskCount,
      fearGreed, vix, rsi,
      macro: { yieldSpread, putCallRatio, fomc },
      holdings,
    };

    cachedPayload = payload;
    cachedAt = now;

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
