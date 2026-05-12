import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function main() {
  const period1 = new Date("2024-01-01");
  const [qqq, skew] = await Promise.all([
    yf.chart("QQQ",   { period1, interval: "1d" }),
    yf.chart("^SKEW", { period1, interval: "1d" }),
  ]);
  const qDates = new Set(qqq.quotes.filter((q) => q.close != null).map((q) => (q.date as Date).toISOString().slice(0,10)));
  const sDates = new Set(skew.quotes.filter((q) => q.close != null).map((q) => (q.date as Date).toISOString().slice(0,10)));
  const missing = [...qDates].filter((d) => !sDates.has(d)).sort();
  console.log(`QQQ: ${qDates.size}  SKEW: ${sDates.size}  QQQ-not-in-SKEW: ${missing.length}`);
  if (missing.length) console.log("First 10 missing:", missing.slice(0, 10));
}
main();
