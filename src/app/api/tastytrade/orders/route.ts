import { tastyFetch } from "@/lib/tastytrade/client";
import { validateCancelOrder, validatePlaceOrder } from "@/lib/tastytrade/orderInput";
import { getAccountNumbers } from "@/lib/tastytrade/positions";

/** Orders only go to linked accounts (honours the TASTYTRADE_ACCOUNTS allow-list). */
async function unknownAccount(accountNumber: string): Promise<Response | null> {
  const accounts = await getAccountNumbers();
  return accounts.includes(accountNumber)
    ? null
    : Response.json({ error: "Unknown account" }, { status: 403 });
}

export async function POST(req: Request) {
  try {
    const input = validatePlaceOrder(await req.json().catch(() => null));
    if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
    const { accountNumber, side, shares, price } = input.value;
    const denied = await unknownAccount(accountNumber);
    if (denied) return denied;

    const body = {
      "time-in-force": "GTC Ext Overnight",
      "order-type": "Limit",
      "price": price.toFixed(2),
      "price-effect": side === "BUY" ? "Debit" : "Credit",
      legs: [
        {
          "instrument-type": "Equity",
          symbol: "TQQQ",
          quantity: shares,
          action: side === "BUY" ? "Buy to Open" : "Sell to Close",
        },
      ],
    };

    const res = await tastyFetch(`/accounts/${accountNumber}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    const input = validateCancelOrder(await req.json().catch(() => null));
    if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
    const { accountNumber, orderId } = input.value;
    const denied = await unknownAccount(accountNumber);
    if (denied) return denied;
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
