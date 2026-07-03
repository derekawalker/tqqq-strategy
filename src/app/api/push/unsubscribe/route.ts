import { removePushSubscription } from "@/lib/pushSubscriptions";

export async function POST(req: Request) {
  const body = await req.json();
  const endpoint: unknown = body?.endpoint;
  if (typeof endpoint !== "string") {
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  await removePushSubscription(endpoint);
  return Response.json({ ok: true });
}
