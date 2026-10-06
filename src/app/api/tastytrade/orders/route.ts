import { tastyFetch } from "@/lib/tastytrade/client";

type Side = "BUY" | "SELL";

/**
 * A limit order, or — with `stop` — a stop-limit that rests untriggered until the
 * price reaches the limit. Stops only trigger in the regular session, so they can't
 * carry the extended-hours time-in-force the plain limits use.
 */
function buildOrder(side: Side, shares: unknown, price: unknown, stop: boolean) {
  const limit = Number(price).toFixed(2);
  return {
    "time-in-force": stop ? "GTC" : "GTC Ext Overnight",
    "order-type": stop ? "Stop Limit" : "Limit",
    "price": limit,
    ...(stop ? { "stop-trigger": limit } : {}),
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
}

export async function POST(req: Request) {
  try {
    const { accountNumber, side, shares, price, stop } = await req.json();

    if (!accountNumber || !side || !shares || price == null) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (side !== "BUY" && side !== "SELL") {
      return Response.json({ error: "side must be BUY or SELL" }, { status: 400 });
    }

    const res = await tastyFetch(`/accounts/${accountNumber}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildOrder(side, shares, price, stop === true)),
    });

    const json = await res.json();
    if (!res.ok) {
      return Response.json({ error: json }, { status: res.status });
    }
    return Response.json(json);
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
