import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function main() {
  const period1 = new Date("2024-01-01");
  for (const sym of ["^SKEW", "^VVIX", "^XVZ", "^PCALL", "^SPCALL"]) {
    try {
      const r = await yf.chart(sym, { period1, interval: "1d" });
      const rows = r.quotes.filter((q) => q.close != null);
      console.log(`${sym}: ${rows.length} days  latest=${rows.at(-1)?.close?.toFixed(2)}  date=${rows.at(-1)?.date?.toISOString().slice(0,10)}`);
    } catch { console.log(`${sym}: not available`); }
  }
}
main();
