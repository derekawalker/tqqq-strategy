/**
 * Prioritized QQQ put-hedge action list (rolls, monetize, ladder buys) — pure
 * logic extracted from the Hedge page's Put Hedge panel so the same list can
 * feed both that panel and the dashboard's unified action queue
 * (dashboardActions.ts) without duplicating the rules.
 */

import { fmtDate } from "./format";
import type { OptionPosition } from "./schwab/parse";
import { bsPutGreeks, type PutGreeks } from "./putHedge";
import {
  VIX_PAUSE_THRESHOLD,
  PROFIT_TAKE_PCT,
  MONETIZE_DELTA,
  ROLL_AT_DTE,
  LIVE_SKEW,
  classifyTranche,
  type TranchePlan,
} from "./hedgeTranches";

const INSTRUMENT = "QQQ" as const;

export function daysUntil(expiry: string): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const fmtUsd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtMoney = (x: number) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: x < 100 ? 2 : 0,
  });

/** Model greeks for any strike/DTE off current spot + VXN (null when inputs missing). */
export function modelGreeks(spot: number | null, strike: number, dte: number, vxnPct: number | null): PutGreeks | null {
  if (spot === null || spot <= 0 || strike <= 0) return null;
  const moneyness = strike / spot;
  const baseIv = vxnPct != null && vxnPct > 0 ? vxnPct / 100 : 0.22;
  const iv = baseIv * (1 + LIVE_SKEW * Math.max(0, 1 - moneyness)); // QQQ: IV scale 1
  return bsPutGreeks(spot, strike, Math.max(dte, 0) / 365, iv, 0.04, 0.006);
}

/** Greeks for an open put, off current spot + VXN. */
export function greeksFor(pos: OptionPosition, spot: number | null, vxnPct: number | null): PutGreeks | null {
  return modelGreeks(spot, pos.strike, daysUntil(pos.expiry), vxnPct);
}

export type CloseAction = "expiring" | "close-profit" | "roll-soon" | "hold";
export interface CloseRec { action: CloseAction; label: string; color: string }

export function closeRec(pos: OptionPosition, currentQqq: number | null, greeks: PutGreeks | null): CloseRec {
  const dte = daysUntil(pos.expiry);
  const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
  const gainPct = costTotal > 0 ? (pos.marketValue - costTotal) / costTotal : 0;

  if (dte <= 5)
    return { action: "expiring", label: `Expires in ${dte}d — roll immediately`, color: "red" };
  if (greeks !== null && Math.abs(greeks.delta) >= MONETIZE_DELTA)
    return { action: "close-profit", label: `Δ ${Math.abs(greeks.delta).toFixed(2)} — monetize, stage into ladder`, color: "teal" };
  if (gainPct >= PROFIT_TAKE_PCT)
    return { action: "close-profit", label: `+${fmtPct(gainPct)} gain — close half, stage into ladder`, color: "teal" };
  if (currentQqq !== null && currentQqq < pos.strike * 0.88)
    return { action: "close-profit", label: "Deeply ITM — harvest, stage into ladder", color: "teal" };
  if (dte <= ROLL_AT_DTE)
    return { action: "roll-soon", label: `${dte}d left — prepare to roll`, color: "yellow" };
  return { action: "hold", label: `${dte}d left — hold`, color: "dimmed" };
}

/** Spacing between staggered buys, as a short human label (e.g. "~every 6 weeks"). */
export function spacingLabel(spacingDays: number): string {
  if (spacingDays <= 0) return "—";
  if (spacingDays <= 10) return "~weekly";
  const weeks = Math.round(spacingDays / 7);
  if (weeks < 9) return `~every ${weeks} wks`;
  const months = Math.round(spacingDays / 30);
  return `~every ${months} mo`;
}

/** Icon/UI hint for an action item — the UI layer maps this to a real icon component. */
export type HedgeActionKind = "expiring" | "monetize" | "roll-soon" | "roll-later" | "vxn-defer" | "buy-now" | "buy-later";

export interface HedgeActionItem {
  kind: HedgeActionKind;
  priority: number;
  color: string;
  title: string;
  detail: string;
  /** Days until this step is due (0 = act now). */
  daysAway: number;
}

/**
 * Build the prioritized list of hedge actions (rolls, monetize, ladder buys),
 * sorted most-urgent first, each tagged with how many days away it is. Pure.
 */
export function buildHedgeActions(
  plan: TranchePlan[] | null,
  openPuts: OptionPosition[],
  qqqSpot: number | null,
  vxnPct: number | null,
): HedgeActionItem[] {
  const actions: HedgeActionItem[] = [];

  // --- Roll / profit alerts on open positions ---
  for (const pos of openPuts) {
    const greeks = greeksFor(pos, qqqSpot, vxnPct);
    const rec = closeRec(pos, qqqSpot, greeks);
    if (rec.action === "expiring") {
      actions.push({
        kind: "expiring",
        priority: 0,
        color: "red",
        title: `${pos.symbol} — roll immediately`,
        detail: `Expires ${fmtDate(pos.expiry)} (${daysUntil(pos.expiry)}d). Close and reopen at target DTE for this tranche.`,
        daysAway: 0,
      });
    } else if (rec.action === "close-profit") {
      const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
      const gain = pos.marketValue - costTotal;
      const deltaNote = greeks ? ` (Δ ${Math.abs(greeks.delta).toFixed(2)})` : "";
      actions.push({
        kind: "monetize",
        priority: 1,
        color: "teal",
        title: `${pos.symbol} — monetize the spike`,
        detail: `Up ${fmtPct((pos.marketValue - costTotal) / costTotal)} (+${fmtUsd(gain)})${deltaNote}. Close ~half and stage the proceeds into the dip-ladder in tranches — never deploy it all at once; a 3× ETF can keep halving.`,
        daysAway: 0,
      });
    } else if (rec.action === "roll-soon") {
      actions.push({
        kind: "roll-soon",
        priority: 2,
        color: "yellow",
        title: `${pos.symbol} — roll soon`,
        detail: `${daysUntil(pos.expiry)}d left (expires ${fmtDate(pos.expiry)}). Open replacement at target DTE, then close this one.`,
        daysAway: Math.max(0, daysUntil(pos.expiry) - ROLL_AT_DTE),
      });
    } else {
      // Healthy — forward-looking: when it reaches the roll line.
      const rollIn = Math.max(0, daysUntil(pos.expiry) - ROLL_AT_DTE);
      actions.push({
        kind: "roll-later",
        priority: 5,
        color: "gray",
        title: `${pos.symbol} — reaches ${ROLL_AT_DTE}d DTE, roll`,
        detail: `Expires ${fmtDate(pos.expiry)} (${daysUntil(pos.expiry)}d). Hold until the roll line, then roll-and-replace.`,
        daysAway: rollIn,
      });
    }
  }

  // --- Ladder-building buys (gap-driven, whole contracts, staggered) ---
  if (plan && qqqSpot !== null) {
    const vxnSpiking = vxnPct !== null && vxnPct > VIX_PAUSE_THRESHOLD;

    for (const t of plan) {
      if (t.targetContracts <= 0) continue;

      // What's already held in this leg, and how recently the newest was opened.
      const legPuts = openPuts.filter((p) => classifyTranche(p.strike / qqqSpot, INSTRUMENT) === t.def.key);
      const openContracts = legPuts.reduce((s, p) => s + p.longQty, 0);
      if (openContracts >= t.targetContracts) continue; // ladder full — rolls maintain it

      // Entry ≈ expiry − target DTE; newest entry's age in days.
      const newestEntryAge = legPuts.length > 0
        ? Math.min(...legPuts.map((p) => t.dte - daysUntil(p.expiry)))
        : Infinity;

      const strike = Math.round(t.strike);
      const deltaTag = ` · ${t.def.targetDelta.toFixed(2)}Δ`;
      const buyLabel = t.clipContracts === 1 ? "1 contract" : `${t.clipContracts} contracts`;
      const haveLabel = `have ${openContracts}/${t.targetContracts}`;
      const detail = `QQQ ~$${strike} put${deltaTag} · ${t.dte}-day DTE · buy ${buyLabel} (~${fmtMoney(t.perBuyCost)}) · ${haveLabel}`;

      // Soft gate: only the crash leg defers, and only on a true panic spike.
      // The catastrophe leg is a cheap lottery ticket — always keep buying it.
      const gated = vxnSpiking && t.def.key !== "catastrophe";
      const dueNow = openContracts === 0 || newestEntryAge >= t.spacingDays;

      if (gated) {
        actions.push({
          kind: "vxn-defer",
          priority: 3,
          color: "yellow",
          title: `${t.def.label}: VXN spiking, defer (${haveLabel})`,
          detail: `^VXN at ${vxnPct!.toFixed(1)}% (above ${VIX_PAUSE_THRESHOLD}% panic line). Let the spike settle before adding the crash leg. ${detail}`,
          daysAway: 0,
        });
      } else if (dueNow) {
        actions.push({
          kind: "buy-now",
          priority: 3,
          color: "teal",
          title: `Buy ${t.def.label} now — ${haveLabel}`,
          detail,
          daysAway: 0,
        });
      } else {
        const waitDays = Math.max(0, Math.round(t.spacingDays - newestEntryAge));
        actions.push({
          kind: "buy-later",
          priority: 4,
          color: "gray",
          title: `${t.def.label}: next buy (${haveLabel})`,
          detail: `${detail} · stagger ${spacingLabel(t.spacingDays)}`,
          daysAway: waitDays,
        });
      }
    }
  }

  // Chronological agenda — soonest first; ties broken by urgency.
  return [...actions].sort((a, b) => a.daysAway - b.daysAway || a.priority - b.priority);
}
