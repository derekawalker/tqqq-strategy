import { addPushSubscription, type PushSubscriptionRecord } from "@/lib/pushSubscriptions";

export async function POST(req: Request) {
  const body = await req.json();
  const endpoint: unknown = body?.endpoint;
  const keys: unknown = body?.keys;
  if (
    typeof endpoint !== "string" ||
    typeof (keys as { p256dh?: unknown })?.p256dh !== "string" ||
    typeof (keys as { auth?: unknown })?.auth !== "string"
  ) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const sub: PushSubscriptionRecord = {
    endpoint,
    keys: { p256dh: (keys as { p256dh: string }).p256dh, auth: (keys as { auth: string }).auth },
  };
  await addPushSubscription(sub);
  return Response.json({ ok: true });
}
