/**
 * Push-notification check — polled every 15min, around the clock (TQQQ/QQQ
 * trade the extended 24x5 session, not just RTH), by a free GitHub Actions
 * schedule (.github/workflows/push-check.yml), with a Vercel cron
 * (vercel.json) as a once-daily fallback since Hobby-plan crons are capped at
 * one run/day. Not called by the browser. Computes the triggers from the
 * roadmap:
 *   - ITM short options near expiry (assignment risk)
 *   - ^VXN threshold-band crossings
 * and sends a Web Push notification for anything newly true, deduping via a
 * small state blob in the settings table so the same event doesn't re-fire
 * every cron tick.
 */

import { fetchYahooDaily } from "@/lib/yahoo";
import { getAllAccountPositions } from "@/lib/schwab/positions";
import { getPushSubscriptions, pruneDeadSubscriptions } from "@/lib/pushSubscriptions";
import { broadcastPush, type PushPayload } from "@/lib/webpush";
import { readSetting, writeSetting } from "@/lib/settings";
import type { OptionPosition } from "@/lib/schwab/parse";

type VxnBand = "calm" | "elevated" | "high" | "panic";

interface PushNotifiedState {
  itmNearExpiry: string[];
  vxnBand: VxnBand | null;
  /** True while the broker link is failing, so the alert fires once per outage. */
  schwabDown?: boolean;
}

const STATE_KEY = "pushNotifiedState";
const ITM_NEAR_EXPIRY_DTE = 5;
/** ^VXN levels that separate the notification bands. */
const VXN_ELEVATED_THRESHOLD = 25;
const VXN_HIGH_THRESHOLD = 35;
const VXN_PANIC_THRESHOLD = 50;

/** Calendar days until an option's expiry, floored at 0. */
function daysUntil(expiry: string): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * Exported for testing — the notification a change in broker health warrants.
 *
 * Schwab refresh tokens expire after seven days and can only be renewed by
 * clicking through the auth flow, so this *will* happen periodically. Losing the
 * link is worth interrupting for: while it's down the position-based alerts are
 * silently not running, which is indistinguishable from nothing being wrong.
 */
export function brokerHealthPayload(wasDown: boolean, isDown: boolean): PushPayload | null {
  if (isDown && !wasDown) {
    return {
      title: "Schwab connection lost",
      body: "Position alerts are paused until you reconnect — the refresh token has expired.",
      url: "/",
      tag: "schwab-auth",
    };
  }
  if (!isDown && wasDown) {
    return {
      title: "Schwab reconnected",
      body: "Position alerts are running again.",
      url: "/",
      tag: "schwab-auth",
    };
  }
  return null;
}

/** Exported for testing — pure band classification used to detect VXN crossings. */
export function vxnBand(vxnPct: number): VxnBand {
  if (vxnPct >= VXN_PANIC_THRESHOLD) return "panic";
  if (vxnPct >= VXN_HIGH_THRESHOLD) return "high";
  if (vxnPct >= VXN_ELEVATED_THRESHOLD) return "elevated";
  return "calm";
}

export async function GET(req: Request) {
  // Vercel's cron infra automatically attaches `Authorization: Bearer <CRON_SECRET>`
  // to scheduled invocations when a CRON_SECRET env var is set on the project —
  // no secret needs to live in vercel.json or get passed as a query param.
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subs = await getPushSubscriptions();
  if (subs.length === 0) return Response.json({ sent: 0, reason: "no subscriptions" });

  // ?test=1 sends a canned notification immediately, bypassing all the real
  // trigger logic below — lets you verify VAPID keys, the browser
  // subscription, and the service worker's push handler are wired up
  // correctly without waiting for an actual delta/DTE/VXN condition to fire.
  if (new URL(req.url).searchParams.get("test") === "1") {
    const dead = await broadcastPush(subs, {
      title: "Test notification",
      body: "If you can see this, push is wired up correctly.",
      url: "/",
      tag: "test",
    });
    await pruneDeadSubscriptions(dead);
    return Response.json({ sent: subs.length, test: true });
  }

  // Each source is caught on its own: an expired Schwab token must not take the
  // ^VXN alert down with it, and a throw here would surface only as an opaque
  // red X on the cron that fires it.
  const [vxn, accountsResult, state] = await Promise.all([
    fetchYahooDaily("^VXN", 1).catch(() => []),
    getAllAccountPositions().then(
      (accounts) => ({ ok: true as const, accounts }),
      (err: unknown) => {
        console.error("Schwab positions failed:", err);
        return { ok: false as const };
      },
    ),
    readSetting<PushNotifiedState>(STATE_KEY),
  ]);

  const vxnPct = vxn.at(-1)?.close ?? null;
  const allOptions: OptionPosition[] = accountsResult.ok
    ? accountsResult.accounts.flatMap((a) => a.options)
    : [];

  const prev: PushNotifiedState = state ?? { itmNearExpiry: [], vxnBand: null };
  const next: PushNotifiedState = {
    // With no position feed, carry the flagged contracts forward untouched —
    // clearing them would re-fire every one of them as "new" on reconnect.
    itmNearExpiry: accountsResult.ok ? [] : prev.itmNearExpiry,
    vxnBand: prev.vxnBand,
    schwabDown: !accountsResult.ok,
  };
  const payloads: PushPayload[] = [];

  const brokerPayload = brokerHealthPayload(prev.schwabDown === true, !accountsResult.ok);
  if (brokerPayload) payloads.push(brokerPayload);

  // --- ITM short options near expiry (assignment risk on the TQQQ income book) ---
  const shortOptions = allOptions.filter((p) => p.underlyingSymbol === "TQQQ" && p.shortQty > 0);
  if (accountsResult.ok && shortOptions.length > 0) {
    const tqqq = await fetchYahooDaily("TQQQ", 1);
    const tqqqSpot = tqqq.at(-1)?.close ?? null;
    if (tqqqSpot !== null) {
      for (const pos of shortOptions) {
        const dte = daysUntil(pos.expiry);
        if (dte > ITM_NEAR_EXPIRY_DTE) continue;
        const itm = pos.putCall === "CALL" ? tqqqSpot > pos.strike : tqqqSpot < pos.strike;
        if (!itm) continue;
        next.itmNearExpiry.push(pos.symbol);
        if (!prev.itmNearExpiry.includes(pos.symbol)) {
          payloads.push({
            title: "Options: ITM near expiry",
            body: `${pos.symbol} — ${dte}d left and in the money. Assignment risk — close or roll.`,
            url: "/options",
            tag: `itm-${pos.symbol}`,
          });
        }
      }
    }
  }

  // --- ^VXN threshold-band crossings ---
  if (vxnPct !== null) {
    const band = vxnBand(vxnPct);
    next.vxnBand = band;
    if (prev.vxnBand !== null && prev.vxnBand !== band) {
      payloads.push({
        title: "^VXN threshold crossed",
        body: `^VXN ${vxnPct.toFixed(1)} — moved from ${prev.vxnBand} to ${band}.`,
        url: "/sentiment",
        tag: "vxn-band",
      });
    }
  }

  await writeSetting(STATE_KEY, next);

  let sent = 0;
  let deadEndpoints: string[] = [];
  for (const payload of payloads) {
    deadEndpoints = deadEndpoints.concat(await broadcastPush(subs, payload));
    sent += subs.length;
  }
  await pruneDeadSubscriptions([...new Set(deadEndpoints)]);

  // Always 200 once authorized: the check ran and did what it could, and a
  // failing HTTP status on the cron says nothing about which part broke.
  return Response.json({
    sent,
    notifications: payloads.length,
    schwab: accountsResult.ok ? "ok" : "auth-failed",
    vxn: vxnPct,
  });
}
