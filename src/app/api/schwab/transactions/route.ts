import { schwabFetch } from "@/lib/schwab/client";
import { getAccountHashes } from "@/lib/schwab/accounts";

export interface Transaction {
  activityId: number;
  accountNumber: string;
  time: string;
  description: string;
  symbol: string | null;
  amount: number;
  category: "dividend" | "interest";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTransaction(t: any, accountNumber: string): Transaction | null {
  if (t.type !== "DIVIDEND_OR_INTEREST") return null;
  const amount: number = t.netAmount ?? 0;
  if (amount === 0) return null;

  const description: string = t.description ?? "";
  const category: "dividend" | "interest" = description.toUpperCase().includes("DIVIDEND")
    ? "dividend"
    : "interest";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const symbol: string | null = t.transferItems?.[0]?.instrument?.symbol ?? null;

  return {
    activityId: t.activityId,
    accountNumber,
    time: t.time,
    description,
    symbol,
    amount,
    category,
  };
}

async function fetchTransactions(
  accountNumber: string,
  hash: string,
  startDate: string,
  endDate: string,
): Promise<Transaction[]> {
  const res = await schwabFetch(
    `/trader/v1/accounts/${hash}/transactions?startDate=${startDate}&endDate=${endDate}&types=DIVIDEND_OR_INTEREST`
  );
  if (!res.ok) return [];
  const raw = await res.json();
  return (Array.isArray(raw) ? raw : [])
    .map((t) => parseTransaction(t, accountNumber))
    .filter((t): t is Transaction => t !== null);
}

export async function GET() {
  try {
    const hashes = await getAccountHashes();
    const accounts = Object.entries(hashes);

    const days = 365;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split(".")[0] + "Z";
    const end = new Date().toISOString().split(".")[0] + "Z";

    const results = await Promise.all(
      accounts.map(([accountNumber, hash]) =>
        fetchTransactions(accountNumber, hash, start, end)
      )
    );

    const transactions: Transaction[] = results
      .flat()
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return Response.json(transactions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
