/**
 * What to do today with the hedge — one instruction per contract held, plus the
 * orders still missing.
 *
 * {@link planProgram} and {@link planVixLayer} answer "how much should be on"
 * in aggregate; they say nothing about the specific contracts already open. A
 * long put bought two months ago is a different decision from the one the
 * sizing model would buy now: it has drifted in delta, burned time, and may
 * have already paid. This turns each held position into a verdict — harvest,
 * roll, or hold — and appends what the plans want opened or trimmed.
 *
 * Pure: the caller supplies positions, plans and quotes.
 */

import { bsPutGreeks } from "./blackScholes";
import { ivFor, DIV_YIELD } from "./volModel";
import type { OptionPosition } from "./schwab/parse";
import type { ProgramPlan } from "./putProgram";
import type { VixLayerPlan } from "./vixLayer";

const RISK_FREE = 0.04;

/**
 * A put this deep has stopped being insurance and started being a directional
 * short: most of the convexity is spent, and the next dollar down pays close to
 * one-for-one. Harvest and re-strike instead of riding it back.
 */
export const HARVEST_DELTA = 0.6;

/** A 4x on a tail hedge is the whole point. Take it — spikes mean-revert. */
export const HARVEST_GAIN_PCT = 300;

/** Inside this many days theta bites hardest and gamma is unreliable. Roll. */
export const ROLL_DTE = 21;

/** A weekly VIX move smaller than this is noise, not a signal about pricing. */
const VIX_CLIMATE_BAND = 5;
/** Implied vol below this percentile of its own year is cheap; above the other, dear. */
const IV_RANK_CHEAP = 30;
const IV_RANK_DEAR = 70;

export type BuyClimate = "good" | "neutral" | "poor";

export interface ClimateVerdict {
  climate: BuyClimate;
  message: string;
}

/**
 * Whether protection is cheap today, judged on implied vol rather than price.
 *
 * The program picks strikes by delta, so a move in TQQQ takes the strike with
 * it: at fixed delta the premium scales roughly with `spot x IV x sqrt(time)`,
 * and a fall in spot lowers the dollar cost about as much as it lowers the
 * strike. Direction is close to a non-event on its own — what actually moves
 * the price of a given delta is implied vol, which is why this reads IV rank
 * and ignores the tape. Down days matter only because they drag vol up, and
 * that link is loose enough not to trade on.
 */
export function putBuyClimate(ivRank: number | null): ClimateVerdict {
  if (ivRank == null) {
    return { climate: "neutral", message: "No ^VXN reading — can't tell how vol is priced." };
  }
  const where = `^VXN sits at the ${Math.round(ivRank)}th percentile of its year`;
  if (ivRank <= IV_RANK_CHEAP) {
    return {
      climate: "good",
      message: `Good day to buy puts — ${where}, so a given delta is cheap.`,
    };
  }
  if (ivRank >= IV_RANK_DEAR) {
    return {
      climate: "poor",
      message: `Poor day to buy puts — ${where}; the same delta costs more than usual.`,
    };
  }
  return {
    climate: "neutral",
    message: `Neutral — ${where}, so put premium is near its own average.`,
  };
}

/**
 * Whether convexity is cheap today.
 *
 * Unlike the put sleeve this *is* judged on the underlying's move, because the
 * underlying is volatility itself — VIX falling is the price of convexity
 * falling, not a proxy for it. The entry gate overrides everything: above it,
 * vol has already repriced and buying is paying peak premium for a move
 * underway.
 */
export function vixBuyClimate(
  changePct: number,
  gate?: { vix: number; maxEntryVix: number },
): ClimateVerdict {
  const move = `${Math.abs(changePct).toFixed(1)}%`;
  if (gate && gate.vix >= gate.maxEntryVix) {
    return {
      climate: "poor",
      message: `Poor day to add — VIX ${gate.vix.toFixed(1)} is at or above your ${gate.maxEntryVix} entry cap, so you'd be buying the spike.`,
    };
  }
  if (changePct <= -VIX_CLIMATE_BAND) {
    return {
      climate: "good",
      message: `Good day to buy calls — VIX is down ${move} on the week, so convexity is on sale.`,
    };
  }
  if (changePct >= VIX_CLIMATE_BAND) {
    return {
      climate: "poor",
      message: `Poor day to buy calls — VIX is up ${move} on the week and premium has already repriced.`,
    };
  }
  return {
    climate: "neutral",
    message: "Neutral — VIX has gone nowhere this week, so calls cost about what they did.",
  };
}

export type HedgeTodoKind = "harvest" | "roll" | "open" | "trim" | "hold";

/** Which sleeve a row belongs to — the page colours by this. */
export type HedgeLayer = "put" | "vix";

export interface HedgeTodo {
  kind: HedgeTodoKind;
  layer: HedgeLayer;
  /** OCC symbol when this row is about a held position, else null. */
  symbol: string | null;
  /** "TQQQ $56 put" / "VIX 25 call". */
  label: string;
  /** Imperative headline. */
  title: string;
  detail: string;
  contracts: number;
  /** Below here: only set for rows about a position already held. */
  daysToExpiry: number | null;
  /** Delta magnitude, 0–1. Null when it can't be modeled (the VIX sleeve). */
  delta: number | null;
  /** Current mark of the whole position. */
  value: number | null;
  /** Open P/L against what was paid. */
  pl: number | null;
  gainPct: number | null;
}

export interface HedgeReviewInput {
  /** The full position list; long TQQQ puts and long VIX calls are picked out. */
  positions: OptionPosition[];
  putPlan: ProgramPlan | null;
  vixPlan: VixLayerPlan | null;
  tqqqSpot: number;
  baseIv: number;
  /** Tenor the program rolls back to. */
  putDte: number;
  vixDte: number;
  vix: number | null;
  monetizeVix: number;
  now?: Date;
}

const PRIORITY: Record<HedgeTodoKind, number> = {
  harvest: 0,
  roll: 1,
  open: 2,
  trim: 3,
  hold: 4,
};

/** Calendar days from `now` to an expiry date, floored at 0. */
export function daysUntil(expiry: string, now: Date): number {
  const [y, m, d] = expiry.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const end = new Date(y, m - 1, d).getTime();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "TQQQ $56 put · Apr 17" */
export function positionLabel(pos: OptionPosition): string {
  const [, m, d] = pos.expiry.split("-").map(Number);
  const when = m && d ? ` · ${MONTHS[m - 1]} ${d}` : "";
  return `${pos.underlyingSymbol} $${pos.strike} ${pos.putCall === "PUT" ? "put" : "call"}${when}`;
}

function ct(n: number): string {
  return `${n} contract${n === 1 ? "" : "s"}`;
}

/**
 * Verdict for each long hedge position, then the plans' outstanding orders.
 * Ordered most urgent first.
 */
export function hedgeTodos(input: HedgeReviewInput): HedgeTodo[] {
  const {
    positions,
    putPlan,
    vixPlan,
    tqqqSpot,
    baseIv,
    putDte,
    vixDte,
    vix,
    monetizeVix,
    now = new Date(),
  } = input;

  const todos: HedgeTodo[] = [];

  for (const pos of positions) {
    if (pos.longQty <= 0) continue;
    const isPut = pos.underlyingSymbol === "TQQQ" && pos.putCall === "PUT";
    const isVixCall = pos.underlyingSymbol.includes("VIX") && pos.putCall === "CALL";
    if (!isPut && !isVixCall) continue;

    const dte = daysUntil(pos.expiry, now);
    const cost = pos.averagePrice * 100 * pos.longQty;
    const value = pos.marketValue;
    const pl = value - cost;
    const gainPct = cost > 0 ? (pl / cost) * 100 : null;
    const label = positionLabel(pos);

    // Only the TQQQ leg has a model here: VIX options price off futures the app
    // doesn't carry, so that sleeve is judged on spot VIX and the clock alone.
    const delta =
      isPut && tqqqSpot > 0 && baseIv > 0 && dte > 0
        ? Math.abs(
            bsPutGreeks(
              tqqqSpot,
              pos.strike,
              dte / 365,
              ivFor(baseIv, pos.strike / tqqqSpot),
              RISK_FREE,
              DIV_YIELD.TQQQ,
            ).delta,
          )
        : null;

    const base = {
      symbol: pos.symbol,
      layer: (isPut ? "put" : "vix") as HedgeLayer,
      label,
      contracts: pos.longQty,
      daysToExpiry: dte,
      delta,
      value,
      pl,
      gainPct,
    };

    const richDelta = delta != null && delta >= HARVEST_DELTA;
    const richGain = gainPct != null && gainPct >= HARVEST_GAIN_PCT;
    const vixSpiked = isVixCall && vix != null && vix >= monetizeVix;

    if (richDelta || richGain || vixSpiked) {
      const why =
        vixSpiked && vix != null
          ? `VIX ${vix.toFixed(1)} is at or above the ${monetizeVix} harvest level.`
          : richDelta && delta != null
            ? `Δ${delta.toFixed(2)} is past ${HARVEST_DELTA} — this is a directional short now, not insurance.`
            : `Up ${gainPct?.toFixed(0)}% on the premium paid — past the ${HARVEST_GAIN_PCT}% harvest line.`;
      todos.push({
        ...base,
        kind: "harvest",
        title: `Harvest ${ct(pos.longQty)} — ${label}`,
        detail: `${why} Sell to close and put the proceeds back into a fresh ${isPut ? `${putDte}d` : `${vixDte}d`} strike.`,
      });
      continue;
    }

    if (dte <= ROLL_DTE) {
      todos.push({
        ...base,
        kind: "roll",
        title: `Roll ${ct(pos.longQty)} — ${label}`,
        detail: `${dte}d left, inside the ${ROLL_DTE}d window where decay is steepest. Close and reopen at ${
          isPut && putPlan ? `$${putPlan.strike.toFixed(0)} / ${putDte}d` : `${vixDte}d`
        }.`,
      });
      continue;
    }

    todos.push({
      ...base,
      kind: "hold",
      title: `Hold ${ct(pos.longQty)} — ${label}`,
      detail:
        delta != null
          ? `Δ${delta.toFixed(2)}, ${dte}d left — inside the working range.`
          : `${dte}d left — inside the working range.`,
    });
  }

  // ── what the plans still want done ────────────────────────────────────────
  if (putPlan && putPlan.action !== "hold" && putPlan.actionContracts > 0) {
    const buying = putPlan.action === "buy";
    todos.push({
      kind: buying ? "open" : "trim",
      layer: "put",
      symbol: null,
      label: `TQQQ $${putPlan.strike.toFixed(0)} put`,
      title: `${buying ? "Open" : "Close"} ${ct(putPlan.actionContracts)} — TQQQ $${putPlan.strike.toFixed(0)} put, ${putDte}d`,
      detail: buying
        ? `Δ${Math.abs(putPlan.delta).toFixed(2)}, ~$${putPlan.pricePerContract.toFixed(0)} per contract — ${
            putPlan.targetContracts
          } is the budgeted target and coverage is ${putPlan.driftPct.toFixed(0)}% below it.`
        : `Coverage is ${putPlan.driftPct.toFixed(0)}% above the ${putPlan.targetContracts}-contract target — sell the excess rather than carry it.`,
      contracts: putPlan.actionContracts,
      daysToExpiry: null,
      delta: Math.abs(putPlan.delta),
      value: null,
      pl: null,
      gainPct: null,
    });
  }

  if (vixPlan && vixPlan.action !== "hold" && vixPlan.actionContracts > 0) {
    const buying = vixPlan.action === "buy";
    todos.push({
      kind: buying ? "open" : "trim",
      layer: "vix",
      symbol: null,
      label: `VIX ${vixPlan.strike} call`,
      title: `${buying ? "Open" : "Close"} ${ct(vixPlan.actionContracts)} — VIX ${vixPlan.strike} call, ${vixDte}d`,
      detail: `${vixPlan.note} ~$${vixPlan.pricePerContract.toFixed(0)} per contract against a ${vixPlan.forward.toFixed(1)} forward.`,
      contracts: vixPlan.actionContracts,
      daysToExpiry: null,
      delta: null,
      value: null,
      pl: null,
      gainPct: null,
    });
  }

  return todos.sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || (a.daysToExpiry ?? 999) - (b.daysToExpiry ?? 999),
  );
}
