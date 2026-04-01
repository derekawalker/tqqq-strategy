import { DEMO_ACCOUNTS } from "@/lib/demo-data";
import { schwabFetch } from "@/lib/schwab/client";

export interface SchwabAccount {
  accountNumber: string;
  nickName: string;
}

export async function GET() {
  if (process.env.DEMO_MODE === "true") {
    return Response.json(DEMO_ACCOUNTS satisfies SchwabAccount[]);
  }

  try {
    const res = await schwabFetch("/trader/v1/userPreference");
    if (!res.ok) throw new Error(`Schwab userPreference API: ${res.status}`);
    const data = await res.json();
    const accounts: SchwabAccount[] = (data.accounts ?? []).map(
      (a: { accountNumber: string; nickName?: string }) => ({
        accountNumber: String(a.accountNumber),
        nickName: a.nickName ?? `Account ${a.accountNumber}`,
      })
    );
    return Response.json(accounts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
