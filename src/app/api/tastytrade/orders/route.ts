import { tastyOrderFetch, tastyFetch, SANDBOX } from "@/lib/tastytrade/client";
import { readSetting } from "@/lib/settings";

export async function POST(req: Request) {
  try {
    const { accountNumber, side, shares, price } = await req.json();

    if (!accountNumber || !side || !shares || price == null) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (side !== "BUY" && side !== "SELL") {
      return Response.json({ error: "side must be BUY or SELL" }, { status: 400 });
    }

    const body = {
      "time-in-force": "GTC Ext Overnight",
      "order-type": "Limit",
      "price": Number(price).toFixed(2),
      "price-effect": side === "BUY" ? "Debit" : "Credit",
      legs: [
        {
          "instrument-type": "Equity",
          symbol: "TQQQ",
          quantity: Number(shares),
          action: side === "BUY" ? "Buy to Open" : "Sell to Close",
        },
      ],
    };

    const sandbox = (await readSetting<boolean>("sandbox_orders")) ?? SANDBOX;
    const targetAccount = sandbox
      ? (process.env.TASTYTRADE_SANDBOX_ACCOUNT ?? accountNumber)
      : accountNumber;
    const res = await tastyOrderFetch(`/accounts/${targetAccount}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, sandbox);

    const json = await res.json();
    if (!res.ok) {
      return Response.json({ error: json }, { status: res.status });
    }
    return Response.json({ ...json, sandbox });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { accountNumber, orderId } = await req.json();
    if (!accountNumber || !orderId) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    const res = await tastyFetch(`/accounts/${accountNumber}/orders/${orderId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = await res.json();
      return Response.json({ error: json }, { status: res.status });
    }
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
