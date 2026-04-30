import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Sorted by QQQ weight %, descending (approximate as of early 2025)
export const QQQ_TOP12 = [
  { symbol: "MSFT", name: "Microsoft",  weight: 8.8 },
  { symbol: "AAPL", name: "Apple",      weight: 8.0 },
  { symbol: "NVDA", name: "NVIDIA",     weight: 7.9 },
  { symbol: "AMZN", name: "Amazon",     weight: 5.3 },
  { symbol: "META", name: "Meta",       weight: 4.9 },
  { symbol: "GOOGL", name: "Alphabet",  weight: 4.5 },
  { symbol: "TSLA", name: "Tesla",      weight: 3.5 },
  { symbol: "AVGO", name: "Broadcom",   weight: 3.2 },
  { symbol: "COST", name: "Costco",     weight: 2.6 },
  { symbol: "NFLX", name: "Netflix",    weight: 2.4 },
  { symbol: "TMUS", name: "T-Mobile",   weight: 2.2 },
  { symbol: "AMD",  name: "AMD",        weight: 2.0 },
];

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

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface SentimentArticle {
  title: string;
  publisher: string;
  providerPublishTime: number;
  sentiment: "positive" | "negative" | "neutral";
  link: string;
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

export interface SentimentData {
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
  rsi: {
    value: number;
    history: HistoryPoint[];
  } | null;
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

export async function GET() {
  try {
    const newsPromises = QQQ_TOP12.map((h) =>
      yf.search(h.name, { newsCount: 5, quotesCount: 0 })
    );
    const earningsPromises = QQQ_TOP12.map((h) =>
      yf.quoteSummary(h.symbol, { modules: ["calendarEvents", "financialData"] })
    );
    const quotePromises = QQQ_TOP12.map((h) =>
      yf.quote(h.symbol, { fields: ["regularMarketChangePercent"] })
    );

    const period14 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const period45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    const [[vixResult, vixQuoteResult, tqqqResult, fgResult, tnxResult, irxResult, pcResult], newsResults, earningsResults, quoteResults] =
      await Promise.all([
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
        ]),
        Promise.allSettled(newsPromises),
        Promise.allSettled(earningsPromises),
        Promise.allSettled(quotePromises),
      ]);

    // VIX
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
        const high52w = vixQuoteResult.status === "fulfilled"
          ? (vixQuoteResult.value.fiftyTwoWeekHigh ?? null)
          : null;
        const low52w = vixQuoteResult.status === "fulfilled"
          ? (vixQuoteResult.value.fiftyTwoWeekLow ?? null)
          : null;
        vix = {
          current: Math.round(current * 100) / 100,
          dayChange: Math.round((current - yesterday) * 100) / 100,
          weekChange: Math.round((current - weekAgo) * 100) / 100,
          monthChange: Math.round((current - monthAgo) * 100) / 100,
          high52w,
          low52w,
          history,
        };
      }
    }

    // RSI from TQQQ daily closes (rolling 14-period RSI for last 14 trading days)
    let rsi: SentimentData["rsi"] = null;
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
    }

    // Fear & Greed
    let fearGreed: SentimentData["fearGreed"] = null;
    if (fgResult.status === "fulfilled" && fgResult.value.ok) {
      try {
        const data = await fgResult.value.json();
        const fg = data?.fear_and_greed;
        const fgHistorical = data?.fear_and_greed_historical?.data;
        if (fg) {
          const history: HistoryPoint[] = Array.isArray(fgHistorical)
            ? (fgHistorical as { x: number; y: number }[])
                .slice(-14)
                .map((d) => ({ t: Math.round(d.x), v: Math.round(d.y) }))
            : [];
          fearGreed = {
            current: Math.round(fg.score),
            previousClose: Math.round(fg.previous_close),
            oneWeekAgo: Math.round(fg.previous_1_week),
            oneMonthAgo: Math.round(fg.previous_1_month),
            rating: fg.rating as string,
            history,
          };
        }
      } catch {
        // F&G unavailable
      }
    }

    // Yield spread (10Y - 3M)
    let yieldSpread: SentimentData["macro"]["yieldSpread"] = null;
    if (tnxResult.status === "fulfilled" && irxResult.status === "fulfilled") {
      const tnxQuotes = tnxResult.value.quotes.filter((q) => q.close != null);
      const irxQuotes = irxResult.value.quotes.filter((q) => q.close != null);
      if (tnxQuotes.length > 0 && irxQuotes.length > 0) {
        // ^TNX and ^IRX are reported as e.g. 43.0 meaning 4.30% — divide by 10
        const tenYear = (tnxQuotes[tnxQuotes.length - 1].close as number) / 10;
        const threeMonth = (irxQuotes[irxQuotes.length - 1].close as number) / 10;
        // Build 14-day spread history by aligning dates
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

    // Put/Call ratio from QQQ nearest expiry
    let putCallRatio: number | null = null;
    if (pcResult.status === "fulfilled") {
      const chain = pcResult.value.options?.[0];
      if (chain) {
        const putVol = chain.puts.reduce((s, p) => s + (p.volume ?? 0), 0);
        const callVol = chain.calls.reduce((s, c) => s + (c.volume ?? 0), 0);
        if (callVol > 0) putCallRatio = Math.round((putVol / callVol) * 100) / 100;
      }
    }

    // FOMC next meeting
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

    // Holdings news + earnings
    const holdings: HoldingSentiment[] = QQQ_TOP12.map((holding, i) => {
      const newsResult = newsResults[i];
      const earningsResult = earningsResults[i];
      const quoteResult = quoteResults[i];
      const dayChangePercent = quoteResult.status === "fulfilled"
        ? (quoteResult.value.regularMarketChangePercent ?? null)
        : null;

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
      if (earningsResult.status === "fulfilled") {
        const cal = earningsResult.value.calendarEvents;
        const fin = earningsResult.value.financialData;
        const dates = cal?.earnings?.earningsDate;
        const nextDate = dates && dates.length > 0 ? (dates[0] as Date).getTime() : null;
        const recommendationMean = fin?.recommendationMean ?? null;
        earnings = { nextDate, recommendationMean };
      }

      // Normalize each signal to [-1, 1], then average whichever are available
      const priceScore = dayChangePercent != null
        ? Math.max(-1, Math.min(1, dayChangePercent / 5))
        : null;
      // recommendationMean: 1=Strong Buy→+1, 3=Hold→0, 5=Sell→-1
      const analystScore = earnings.recommendationMean != null
        ? (3 - earnings.recommendationMean) / 2
        : null;
      const signals = [newsScore, priceScore, analystScore].filter((v): v is number => v != null);
      const score = signals.reduce((a, b) => a + b, 0) / signals.length;

      return { ...holding, score, articleCount: articles.length, articles, dayChangePercent, earnings };
    });

    const payload: SentimentData = {
      fearGreed, vix, rsi,
      macro: { yieldSpread, putCallRatio, fomc },
      holdings,
    };
    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
