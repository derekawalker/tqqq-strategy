/**
 * Push-notification check — polled every 15min, around the clock (TQQQ/QQQ
 * trade the extended 24x5 session, not just RTH), by a free GitHub Actions
 * schedule (.github/workflows/push-check.yml), with a Vercel cron
 * (vercel.json) as a once-daily fallback since Hobby-plan crons are capped at
 * one run/day. Not called by the browser. Computes the four triggers from
 * the roadmap:
 *   - hedge monetize trigger (|delta| >= MONETIZE_DELTA on an open QQQ put)
 *   - roll-due (any open hedge/ladder option at <= ROLL_AT_DTE)
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
import { daysUntil, greeksFor } from "@/lib/hedgeActions";
import { MONETIZE_DELTA, ROLL_AT_DTE, PUT_SPREAD_VXN_THRESHOLD, VIX_PAUSE_THRESHOLD } from "@/lib/hedgeTranches";
import type { OptionPosition } from "@/lib/schwab/parse";

type VxnBand = "calm" | "elevated" | "high" | "panic";

interface PushNotifiedState {
  monetized: string[];
  rollDue: string[];
  itmNearExpiry: string[];
  vxnBand: VxnBand | null;
}

const STATE_KEY = "pushNotifiedState";
const ITM_NEAR_EXPIRY_DTE = 5;
const VXN_ELEVATED_THRESHOLD = 25;

/** Exported for testing — pure band classification used to detect VXN crossings. */
export function vxnBand(vxnPct: number): VxnBand {
  if (vxnPct >= VIX_PAUSE_THRESHOLD) return "panic";
  if (vxnPct >= PUT_SPREAD_VXN_THRESHOLD) return "high";
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

  const [qqq, vxn, accounts, state] = await Promise.all([
    fetchYahooDaily("QQQ", 1),
    fetchYahooDaily("^VXN", 1),
    getAllAccountPositions(),
    readSetting<PushNotifiedState>(STATE_KEY),
  ]);

  const qqqSpot = qqq.at(-1)?.close ?? null;
  const vxnPct = vxn.at(-1)?.close ?? null;
  const allOptions: OptionPosition[] = accounts.flatMap((a) => a.options);

  const prev: PushNotifiedState = state ?? {
    monetized: [], rollDue: [], itmNearExpiry: [], vxnBand: null,
  };
  const next: PushNotifiedState = {
    monetized: [], rollDue: [], itmNearExpiry: [], vxnBand: prev.vxnBand,
  };
  const payloads: PushPayload[] = [];

  // --- Hedge monetize + roll-due (open QQQ puts, i.e. the tail hedge) ---
  const hedgePuts = allOptions.filter((p) => p.underlyingSymbol === "QQQ" && p.longQty > 0);
  for (const pos of hedgePuts) {
    const dte = daysUntil(pos.expiry);
    const greeks = greeksFor(pos, qqqSpot, vxnPct);

    if (greeks !== null && Math.abs(greeks.delta) >= MONETIZE_DELTA) {
      next.monetized.push(pos.symbol);
      if (!prev.monetized.includes(pos.symbol)) {
        payloads.push({
          title: "Hedge: monetize the spike",
          body: `${pos.symbol} — |Δ| ${Math.abs(greeks.delta).toFixed(2)}. Close ~half and stage into the ladder.`,
          url: "/hedge",
          tag: `monetize-${pos.symbol}`,
        });
      }
    }

    if (dte <= ROLL_AT_DTE) {
      next.rollDue.push(pos.symbol);
      if (!prev.rollDue.includes(pos.symbol)) {
        payloads.push({
          title: "Hedge: roll due",
          body: `${pos.symbol} — ${dte}d left. Open the replacement, then close this one.`,
          url: "/hedge",
          tag: `roll-${pos.symbol}`,
        });
      }
    }
  }

  // --- ITM short options near expiry (assignment risk on the TQQQ income book) ---
  const shortOptions = allOptions.filter((p) => p.underlyingSymbol === "TQQQ" && p.shortQty > 0);
  if (shortOptions.length > 0) {
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

  return Response.json({ sent, notifications: payloads.length });
}
