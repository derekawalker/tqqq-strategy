import { tastyFetch } from "@/lib/tastytrade/client";

export async function GET() {
  if (!process.env.TASTYTRADE_USERNAME) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  try {
    const res = await tastyFetch("/customers/me/accounts");
    if (!res.ok) {
      return Response.json({ error: "upstream_error" }, { status: res.status });
    }
    const json = await res.json();
    const allowList = process.env.TASTYTRADE_ACCOUNTS
      ? new Set(process.env.TASTYTRADE_ACCOUNTS.split(",").map((s) => s.trim()))
      : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = (json.data?.items ?? [])
      .filter((item: any) => !allowList || allowList.has(item.account["account-number"]))
      .map((item: any) => ({
        accountNumber: item.account["account-number"],
        nickName: item.account.nickname || item.account["account-number"],
      }));
    return Response.json(accounts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
