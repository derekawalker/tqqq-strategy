import { tastyFetch } from "@/lib/tastytrade/client";

type Side = "BUY" | "SELL";

function limitOrder(side: Side, shares: unknown, price: unknown) {
  return {
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
}

const isSide = (s: unknown): s is Side => s === "BUY" || s === "SELL";

export async function POST(req: Request) {
  try {
    // `trigger` (optional) makes this a one-triggers-other order: the trigger order
    // works first, and the main order is only sent once the trigger fills.
    const { accountNumber, side, shares, price, trigger } = await req.json();

    if (!accountNumber || !side || !shares || price == null) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isSide(side)) {
      return Response.json({ error: "side must be BUY or SELL" }, { status: 400 });
    }
    if (trigger && (!isSide(trigger.side) || !trigger.shares || trigger.price == null)) {
      return Response.json({ error: "trigger needs side, shares and price" }, { status: 400 });
    }

    const order = limitOrder(side, shares, price);
    const res = trigger
      ? await tastyFetch(`/accounts/${accountNumber}/complex-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "OTO",
            "trigger-order": limitOrder(trigger.side, trigger.shares, trigger.price),
            orders: [order],
          }),
        })
      : await tastyFetch(`/accounts/${accountNumber}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order),
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
