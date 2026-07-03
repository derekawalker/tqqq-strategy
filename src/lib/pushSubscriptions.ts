/**
 * Web Push subscription store. Piggybacks on the existing generic
 * settings key/value table (src/lib/settings.ts) instead of a new Supabase
 * table — this app only ever has a handful of subscribed devices.
 */

import { readSetting, writeSetting } from "./settings";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const KEY = "pushSubscriptions";

export async function getPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  return (await readSetting<PushSubscriptionRecord[]>(KEY)) ?? [];
}

export async function addPushSubscription(sub: PushSubscriptionRecord): Promise<void> {
  const subs = await getPushSubscriptions();
  if (subs.some((s) => s.endpoint === sub.endpoint)) return;
  await writeSetting(KEY, [...subs, sub]);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const subs = await getPushSubscriptions();
  await writeSetting(KEY, subs.filter((s) => s.endpoint !== endpoint));
}

/** Drop subscriptions the push service reports as gone (404/410) after a send. */
export async function pruneDeadSubscriptions(deadEndpoints: string[]): Promise<void> {
  if (deadEndpoints.length === 0) return;
  const subs = await getPushSubscriptions();
  await writeSetting(KEY, subs.filter((s) => !deadEndpoints.includes(s.endpoint)));
}
