/**
 * Web Push sender — thin wrapper around the `web-push` package so callers
 * don't touch VAPID config directly. A subscription is "gone" (404/410) once
 * the browser has unsubscribed or the endpoint has expired; callers should
 * prune those out of the subscription store.
 */

import webpush from "web-push";
import type { PushSubscriptionRecord } from "./pushSubscriptions";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
  if (!publicKey || !privateKey) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** App path to open/focus when the notification is clicked. */
  url?: string;
  /** Notifications sharing a tag replace each other instead of stacking. */
  tag?: string;
}

/** Sends to one subscription. Returns whether the endpoint is gone and should be pruned. */
export async function sendPush(sub: PushSubscriptionRecord, payload: PushPayload): Promise<{ gone: boolean }> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
    );
    return { gone: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    return { gone: statusCode === 404 || statusCode === 410 };
  }
}

/** Sends to every subscription; returns the endpoints that came back gone so callers can prune them. */
export async function broadcastPush(
  subs: PushSubscriptionRecord[],
  payload: PushPayload,
): Promise<string[]> {
  const results = await Promise.all(
    subs.map(async (s) => ({ endpoint: s.endpoint, ...(await sendPush(s, payload)) })),
  );
  return results.filter((r) => r.gone).map((r) => r.endpoint);
}
