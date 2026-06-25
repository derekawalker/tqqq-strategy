"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Outfit } from "next/font/google";
import {
  Stack,
  Box,
  Text,
  Group,
  Paper,
  Table,
  SimpleGrid,
  Alert,
  Center,
  Loader,
  Tooltip,
  Badge,
  ThemeIcon,
  NumberInput,
  Divider,
  Collapse,
  UnstyledButton,
  Progress,
  Checkbox,
} from "@mantine/core";

const outfit = Outfit({ subsets: ["latin"] });
import {
  IconAlertTriangle,
  IconInfoCircle,
  IconShield,
  IconShieldOff,
  IconClock,
  IconArrowDown,
  IconCurrencyDollar,
  IconRefresh,
  IconChevronDown,
} from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";
import type { OptionPosition } from "@/lib/schwab/parse";
import { bsPutGreeks, type PutGreeks } from "@/lib/putHedge";
import {
  TRANCHE_SETS,
  ROLL_AT_DTE,
  VIX_PAUSE_THRESHOLD,
  PROFIT_TAKE_PCT,
  MONETIZE_DELTA,
  LIVE_SKEW,
  buildTranchePlan,
  classifyTranche,
  type TrancheKey,
  type TranchePlan,
} from "@/lib/hedgeTranches";

const INSTRUMENT = "QQQ" as const;
const DEFAULT_BUDGET_PCT = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysUntil(expiry: string): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** ISO date (YYYY-MM-DD) `days` from today, for formatting a scheduled event. */
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Math.round(days)));
  return d.toISOString().slice(0, 10);
}

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtUsd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtMoney = (x: number) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: x < 100 ? 2 : 0,
  });

/** Buys opened with fewer DTE than this default to *excluded* — they're short-term
 *  trades, not the long-dated hedge. */
const HEDGE_MIN_DTE = 45;

/** Days-to-expiry at purchase: expiry (parsed from the OCC symbol) minus the fill date. */
function dteAtPurchase(symbol: string, time: string): number | null {
  const m = symbol.match(/(\d{2})(\d{2})(\d{2})[CP]\d{8}$/);
  if (!m) return null;
  const expiry = Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], 23, 59, 59);
  return Math.round((expiry - new Date(time).getTime()) / 86_400_000);
}

/** Default include state: count it as the hedge only if opened long-dated (≥ HEDGE_MIN_DTE). */
function autoIncluded(dte: number | null): boolean {
  return dte === null ? true : dte >= HEDGE_MIN_DTE;
}

// ---------------------------------------------------------------------------
// Live greeks — modeled off QQQ spot + ^VXN, matching the backtest's pricing.
// ---------------------------------------------------------------------------

/** Greeks for an open put, off current spot + VXN (null when inputs missing). */
/** Model greeks for any strike/DTE off current spot + VXN (null when inputs missing). */
function modelGreeks(spot: number | null, strike: number, dte: number, vxnPct: number | null): PutGreeks | null {
  if (spot === null || spot <= 0 || strike <= 0) return null;
  const moneyness = strike / spot;
  const baseIv = vxnPct != null && vxnPct > 0 ? vxnPct / 100 : 0.22;
  const iv = baseIv * (1 + LIVE_SKEW * Math.max(0, 1 - moneyness)); // QQQ: IV scale 1
  return bsPutGreeks(spot, strike, Math.max(dte, 0) / 365, iv, 0.04, 0.006);
}

/** Greeks for an open put, off current spot + VXN. */
function greeksFor(pos: OptionPosition, spot: number | null, vxnPct: number | null): PutGreeks | null {
  return modelGreeks(spot, pos.strike, daysUntil(pos.expiry), vxnPct);
}

/** Spacing between staggered buys, as a short human label (e.g. "~every 6 weeks"). */
function spacingLabel(spacingDays: number): string {
  if (spacingDays <= 0) return "—";
  if (spacingDays <= 10) return "~weekly";
  const weeks = Math.round(spacingDays / 7);
  if (weeks < 9) return `~every ${weeks} wks`;
  const months = Math.round(spacingDays / 30);
  return `~every ${months} mo`;
}

// ---------------------------------------------------------------------------
// Close/action recommendation
// ---------------------------------------------------------------------------

type CloseAction = "expiring" | "close-profit" | "roll-soon" | "hold";
type CloseRec = { action: CloseAction; label: string; color: string };

function closeRec(pos: OptionPosition, currentQqq: number | null, greeks: PutGreeks | null): CloseRec {
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

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

interface MarketData {
  qqqPrice: number | null;
  tqqqPrice: number | null;
  vxnPct: number | null;
  asOf: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Today's Action panel
// ---------------------------------------------------------------------------

interface ActionItem {
  priority: number;
  color: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  /** Days until this step is due (0 = act now). */
  daysAway: number;
}

/** Short "Now" / "in N days" label for a step's countdown. */
function awayLabel(daysAway: number): string {
  if (daysAway <= 0) return "Now";
  if (daysAway === 1) return "1 day";
  return `${daysAway} days`;
}

/**
 * Build the prioritized list of hedge actions (rolls, monetize, ladder buys),
 * sorted most-urgent first, each tagged with how many days away it is. Pure.
 */
function buildHedgeActions(
  plan: TranchePlan[] | null,
  openPuts: OptionPosition[],
  qqqSpot: number | null,
  vxnPct: number | null,
): ActionItem[] {
  const actions: ActionItem[] = [];

  // --- Roll / profit alerts on open positions ---
  for (const pos of openPuts) {
    const greeks = greeksFor(pos, qqqSpot, vxnPct);
    const rec = closeRec(pos, qqqSpot, greeks);
    if (rec.action === "expiring") {
      actions.push({
        priority: 0,
        color: "red",
        icon: <IconAlertTriangle size={14} />,
        title: `${pos.symbol} — roll immediately`,
        detail: `Expires ${fmtDate(pos.expiry)} (${daysUntil(pos.expiry)}d). Close and reopen at target DTE for this tranche.`,
        daysAway: 0,
      });
    } else if (rec.action === "close-profit") {
      const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
      const gain = pos.marketValue - costTotal;
      const deltaNote = greeks ? ` (Δ ${Math.abs(greeks.delta).toFixed(2)})` : "";
      actions.push({
        priority: 1,
        color: "teal",
        icon: <IconCurrencyDollar size={14} />,
        title: `${pos.symbol} — monetize the spike`,
        detail: `Up ${fmtPct((pos.marketValue - costTotal) / costTotal)} (+${fmtUsd(gain)})${deltaNote}. Close ~half and stage the proceeds into the dip-ladder in tranches — never deploy it all at once; a 3× ETF can keep halving.`,
        daysAway: 0,
      });
    } else if (rec.action === "roll-soon") {
      actions.push({
        priority: 2,
        color: "yellow",
        icon: <IconRefresh size={14} />,
        title: `${pos.symbol} — roll soon`,
        detail: `${daysUntil(pos.expiry)}d left (expires ${fmtDate(pos.expiry)}). Open replacement at target DTE, then close this one.`,
        daysAway: Math.max(0, daysUntil(pos.expiry) - ROLL_AT_DTE),
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
          priority: 3,
          color: "yellow",
          icon: <IconAlertTriangle size={14} />,
          title: `${t.def.label}: VXN spiking, defer (${haveLabel})`,
          detail: `^VXN at ${vxnPct!.toFixed(1)}% (above ${VIX_PAUSE_THRESHOLD}% panic line). Let the spike settle before adding the crash leg. ${detail}`,
          daysAway: 0,
        });
      } else if (dueNow) {
        actions.push({
          priority: 3,
          color: "teal",
          icon: <IconArrowDown size={14} />,
          title: `Buy ${t.def.label} now — ${haveLabel}`,
          detail,
          daysAway: 0,
        });
      } else {
        const waitDays = Math.max(0, Math.round(t.spacingDays - newestEntryAge));
        actions.push({
          priority: 4,
          color: "gray",
          icon: <IconClock size={14} />,
          title: `${t.def.label}: next buy ${fmtDate(isoInDays(waitDays))} (${haveLabel})`,
          detail: `${detail} · stagger ${spacingLabel(t.spacingDays)}`,
          daysAway: waitDays,
        });
      }
    }
  }

  const sorted = [...actions].sort((a, b) => a.priority - b.priority || a.daysAway - b.daysAway);

  // Ladder full and nothing due — the next buy is the soonest roll-and-replace.
  if (sorted.length === 0 && openPuts.length > 0) {
    const soonest = openPuts.reduce((m, p) => Math.min(m, daysUntil(p.expiry)), Infinity);
    const rollIn = Math.max(0, soonest - ROLL_AT_DTE);
    sorted.push({
      priority: 6,
      color: "gray",
      icon: <IconShield size={14} />,
      title: `Hedge ladder complete — next buy ${fmtDate(isoInDays(rollIn))}`,
      detail: `Soonest put expires in ${soonest}d; roll-and-replace it at ${ROLL_AT_DTE}d left.`,
      daysAway: rollIn,
    });
  }

  return sorted;
}

/**
 * Combined next-steps panel: the prioritized action list with the most-urgent
 * step (the "next step") emphasized at the top, each tagged with its countdown.
 */
function NextStepsPanel({ actions }: { actions: ActionItem[] }) {
  const topColor = actions[0]?.color === "dimmed" ? "gray" : (actions[0]?.color ?? "gray");
  const bg = useCardBg(topColor);
  if (actions.length === 0) return null;
  return (
    <Paper radius={CARD_RADIUS} p="md" style={{ background: bg }}>
      <Text size="xs" fw={700} tt="uppercase" style={CARD_LABEL_STYLE} mb="sm">
        Next steps
      </Text>
      <Stack gap="sm">
        {actions.map((a, i) => {
          const color = a.color === "dimmed" ? "gray" : a.color;
          const isNext = i === 0;
          return (
            <Group key={i} gap="sm" align="flex-start" wrap="nowrap">
              <ThemeIcon
                size={isNext ? "md" : "sm"}
                variant={isNext ? "filled" : "light"}
                color={color}
                radius="xl"
                mt={1}
                style={{ flexShrink: 0 }}
              >
                {a.icon}
              </ThemeIcon>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="sm" fw={isNext ? 700 : 600}>{a.title}</Text>
                  <Badge
                    size={isNext ? "md" : "sm"}
                    color={color}
                    variant={isNext ? "filled" : "light"}
                    style={{ flexShrink: 0 }}
                  >
                    {awayLabel(a.daysAway)}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">{a.detail}</Text>
              </Box>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Individual put card
// ---------------------------------------------------------------------------

function PutCard({ pos, spot, vxnPct }: { pos: OptionPosition; spot: number | null; vxnPct: number | null }) {
  const [showClose, setShowClose] = useState(false);
  const dte = daysUntil(pos.expiry);
  const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
  const pnl = pos.marketValue - costTotal;
  const pnlPct = costTotal > 0 ? pnl / costTotal : 0;
  const greeks = greeksFor(pos, spot, vxnPct);
  const rec = closeRec(pos, spot, greeks);

  // Suggested closing limit: the +PROFIT_TAKE_PCT profit-take target.
  const avgSh = Math.abs(pos.averagePrice);
  const closeLimitSh = avgSh * (1 + PROFIT_TAKE_PCT);
  const markSh = pos.longQty > 0 ? pos.marketValue / (pos.longQty * 100) : 0;
  const trKey = spot ? classifyTranche(pos.strike / spot, INSTRUMENT) : null;
  const tr = trKey ? TRANCHE_SETS[INSTRUMENT].find((t) => t.key === trKey) : null;

  const urgencyColor =
    rec.action === "expiring" ? "red" :
    rec.action === "close-profit" ? "teal" :
    rec.action === "roll-soon" ? "yellow" :
    (tr?.color ?? "violet");

  const bg = useCardBg(urgencyColor);

  const dteColor =
    dte <= 5 ? "var(--mantine-color-red-4)" :
    dte <= 21 ? "var(--mantine-color-yellow-4)" : "white";

  return (
    <Paper
      radius={CARD_RADIUS}
      p="md"
      style={{
        background: bg,
        position: "relative",
        overflow: "hidden",
        border: `1.5px solid color-mix(in srgb, var(--mantine-color-${urgencyColor}-9) 30%, transparent)`,
      }}
    >
      <Box
        aria-hidden
        style={{
          position: "absolute", right: -8, top: -8,
          fontSize: "6rem", fontWeight: 900, lineHeight: 1,
          color: "rgba(255,255,255,0.04)",
          fontFamily: outfit.style.fontFamily,
          pointerEvents: "none", userSelect: "none",
        }}
      >
        ${pos.strike.toFixed(0)}
      </Box>

      <Group justify="space-between" align="flex-end" mb="md" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" style={CARD_LABEL_STYLE}>Strike</Text>
          <Text className={outfit.className} style={{ fontSize: "2.4rem", fontWeight: 700, lineHeight: 1, color: "white" }}>
            ${pos.strike.toFixed(0)}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>{pos.symbol} · {pos.longQty} ct</Text>
        </Box>
        <Box ta="right">
          <Text className={outfit.className} style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1, color: dteColor }}>
            {dte}
          </Text>
          <Text size="xs" c="dimmed">days left</Text>
          <Text size="9px" c="dimmed" mt={2}>{fmtDate(pos.expiry)}</Text>
        </Box>
      </Group>

      <Divider opacity={0.12} mb="sm" />

      <Group grow gap="xs" mb="sm">
        <Box>
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Cost</Text>
          <Text size="sm" fw={600}>{fmtMoney(costTotal)}</Text>
        </Box>
        <Box>
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Value</Text>
          <Text size="sm" fw={600}>{fmtMoney(pos.marketValue)}</Text>
        </Box>
        <Box ta="right">
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>P&amp;L</Text>
          <Text size="sm" fw={700} c={pnl >= 0 ? "teal.4" : "red.4"}>
            {pnl >= 0 ? "+" : ""}{fmtMoney(pnl)}
          </Text>
          <Text size="9px" c={pnl >= 0 ? "teal.6" : "red.6"}>
            {pnl >= 0 ? "+" : ""}{fmtPct(pnlPct)}
          </Text>
        </Box>
      </Group>

      {greeks && (
        <Group gap="lg" mb="sm">
          <Tooltip label="Put delta — how fast this gains as QQQ falls. Monetize trigger fires at |Δ| ≥ 0.45." withArrow multiline w={200}>
            <Box>
              <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Delta</Text>
              <Text size="xs" fw={600}>{greeks.delta.toFixed(2)}</Text>
            </Box>
          </Tooltip>
          <Tooltip label="Theta — daily time decay for the whole position at current vol." withArrow multiline w={200}>
            <Box>
              <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Theta/day</Text>
              <Text size="xs" fw={600} c="red.4">{fmtMoney(greeks.theta * pos.longQty * 100)}</Text>
            </Box>
          </Tooltip>
        </Group>
      )}

      <Badge
        color={rec.color === "dimmed" ? "gray" : rec.color}
        variant="light" size="xs"
        style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {rec.label}
      </Badge>

      {/* Suggested closing price — collapsible */}
      <Divider opacity={0.12} mt="sm" mb={6} />
      <UnstyledButton onClick={() => setShowClose((s) => !s)} style={{ width: "100%" }}>
        <Group justify="space-between" gap={4} wrap="nowrap">
          <Text size="9px" tt="uppercase" c="dimmed" style={CARD_LABEL_STYLE}>
            Suggested close
          </Text>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" fw={700} c="teal.4">${closeLimitSh.toFixed(2)}/sh</Text>
            <IconChevronDown
              size={12}
              style={{ transform: showClose ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--mantine-color-dimmed)" }}
            />
          </Group>
        </Group>
      </UnstyledButton>
      <Collapse in={showClose}>
        <Stack gap={2} mt={6}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">Limit / contract (+{Math.round(PROFIT_TAKE_PCT * 100)}%)</Text>
            <Text size="xs" fw={600} c="teal.4">{fmtMoney(closeLimitSh * 100)}</Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">All {pos.longQty} ct</Text>
            <Text size="xs" fw={600}>{fmtMoney(closeLimitSh * 100 * pos.longQty)}</Text>
          </Group>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">Current mark</Text>
            <Text size="xs" fw={600}>${markSh.toFixed(2)}/sh</Text>
          </Group>
          <Text size="9px" c="dimmed" mt={2}>
            Or sell when |Δ| ≥ {MONETIZE_DELTA} in a selloff. Close ~half and stage into the dip-ladder.
          </Text>
        </Stack>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Empty slot card
// ---------------------------------------------------------------------------

function EmptyPutCard({ tranche, spot }: { tranche: TranchePlan; spot: number | null }) {
  const strike = Math.round(tranche.strike);
  const otmPct = spot !== null && spot > 0
    ? Math.round((1 - tranche.strike / spot) * 100)
    : Math.round((1 - tranche.def.moneyness) * 100);
  const deltaLabel = tranche.def.targetDelta.toFixed(2);

  return (
    <Paper
      radius={CARD_RADIUS} p="md"
      style={{
        border: "1px dashed var(--mantine-color-dark-4)",
        background: "var(--mantine-color-dark-8)",
        position: "relative", overflow: "hidden", opacity: 0.7,
      }}
    >
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Badge color="gray" variant="outline" size="xs" style={{ opacity: 0.6 }}>
          {tranche.def.label}
        </Badge>
        <Text size="9px" c="dimmed">unfilled</Text>
      </Group>

      <Group justify="space-between" align="flex-end" mb="md" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" style={CARD_LABEL_STYLE}>Suggested strike</Text>
          <Text className={outfit.className} style={{ fontSize: "2.4rem", fontWeight: 700, lineHeight: 1, color: "var(--mantine-color-dark-2)" }}>
            ~${strike}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {INSTRUMENT} · {deltaLabel}Δ · ~{otmPct}% OTM
          </Text>
        </Box>
        <Box ta="right">
          <Text size="xs" c="dimmed" style={CARD_LABEL_STYLE}>Target DTE</Text>
          <Text className={outfit.className} style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1, color: "var(--mantine-color-dark-2)" }}>
            {tranche.dte}
          </Text>
          <Text size="xs" c="dimmed">days</Text>
        </Box>
      </Group>

      <Divider opacity={0.08} mb="sm" />

      <Group grow gap="xs">
        <Box>
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Buy / clip</Text>
          <Text size="sm" fw={600} c="dark.2">
            {tranche.clipContracts} ct · {fmtMoney(tranche.perBuyCost)}
          </Text>
        </Box>
        <Box ta="right">
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Stagger</Text>
          <Text size="sm" fw={600} c="dimmed">{spacingLabel(tranche.spacingDays)}</Text>
        </Box>
      </Group>

      <Text size="9px" c="dimmed" mt="sm">
        Snap to the nearest listed strike and check the bid/ask before buying — skip the clip if the
        spread is wide or the strike is thin.
      </Text>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Per-tranche section with open positions
// ---------------------------------------------------------------------------

function TrancheSection({
  tranche,
  puts,
  spot,
  vxnPct,
}: {
  tranche: TranchePlan;
  puts: OptionPosition[];
  spot: number | null;
  vxnPct: number | null;
}) {
  const otmPct = spot !== null && spot > 0
    ? Math.round((1 - tranche.strike / spot) * 100)
    : Math.round((1 - tranche.def.moneyness) * 100);
  const openCount = puts.length;

  return (
    <Paper
      radius={CARD_RADIUS} p="md"
      style={{
        background: `color-mix(in srgb, var(--mantine-color-${tranche.def.color}-9) 12%, var(--mantine-color-dark-8))`,
        borderLeft: `3px solid var(--mantine-color-${tranche.def.color}-7)`,
      }}
    >
      {/* Header */}
      <Group justify="space-between" align="flex-start" mb="md" wrap="wrap" gap="xs">
        <Group gap="xs" align="center">
          <Badge color={tranche.def.color} variant="light" size="sm">{tranche.def.label}</Badge>
          <Tooltip label={tranche.def.desc} withArrow multiline w={220}>
            <Text size="xs" c="dimmed" style={{ cursor: "help" }}>{tranche.def.desc}</Text>
          </Tooltip>
        </Group>
        <Badge color={openCount > 0 ? tranche.def.color : "gray"} variant="dot" size="sm">
          {openCount > 0 ? `${openCount} open` : "none open"}
        </Badge>
      </Group>

      {/* Strategy details row */}
      <Table fz="xs" verticalSpacing={4} withRowBorders={false} mb="md">
        <Table.Tbody>
          <Table.Tr>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Target Δ</Table.Td>
            <Table.Td fw={600}>{tranche.def.targetDelta.toFixed(2)} <Text span size="9px" c="dimmed">(~{otmPct}% OTM)</Text></Table.Td>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Target DTE</Table.Td>
            <Table.Td fw={600}>{tranche.dte}d</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Target ladder</Table.Td>
            <Table.Td fw={600}>{tranche.targetContracts} ct</Table.Td>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Buy / clip</Table.Td>
            <Table.Td fw={600} c={`${tranche.def.color}.4`}>{tranche.clipContracts} ct · {fmtMoney(tranche.perBuyCost)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Stagger</Table.Td>
            <Table.Td fw={600}>{spacingLabel(tranche.spacingDays)}</Table.Td>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Annual carry</Table.Td>
            <Table.Td fw={600} c="dimmed">{fmtUsd(tranche.estAnnualPremium)}/yr</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

      {/* Position cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {puts.length > 0
          ? puts.map((pos, i) => <PutCard key={i} pos={pos} spot={spot} vxnPct={vxnPct} />)
          : <EmptyPutCard tranche={tranche} spot={spot} />
        }
      </SimpleGrid>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Budget summary row
// ---------------------------------------------------------------------------

function BudgetRow({
  tqqqValue,
  budgetPct,
  plan,
  vxnPct,
  qqqSpot,
  asOf,
  spent,
  recovered,
}: {
  tqqqValue: number;
  budgetPct: number;
  plan: TranchePlan[] | null;
  vxnPct: number | null;
  qqqSpot: number | null;
  asOf: string | null;
  spent: number;
  recovered: number;
}) {
  const annualBudget = tqqqValue * (budgetPct / 100);
  const openCount = plan ? plan.filter(t => t.targetContracts > 0).length : 0;
  const statusColor = openCount === 0 ? "red" : openCount < (plan?.length ?? 1) ? "yellow" : "teal";

  const spentPct = annualBudget > 0 ? (spent / annualBudget) * 100 : 0;
  const remaining = annualBudget - spent;
  const meterColor = spentPct >= 100 ? "red" : spentPct >= 80 ? "yellow" : "teal";
  const year = new Date().getFullYear();

  return (
    <Paper radius={CARD_RADIUS} p="sm" style={{ background: "color-mix(in srgb, var(--mantine-color-dark-7) 60%, transparent)" }}>
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="xs" align="center">
            <ThemeIcon size="sm" variant="light" color={statusColor} radius="xl">
              {openCount > 0 ? <IconShield size={12} /> : <IconShieldOff size={12} />}
            </ThemeIcon>
            <Group gap="xs">
              {qqqSpot !== null && (
                <Badge color="blue" variant="light" size="sm">QQQ ${qqqSpot.toFixed(2)}</Badge>
              )}
              {vxnPct !== null && (
                <Badge color={vxnPct > VIX_PAUSE_THRESHOLD ? "red" : "grape"} variant="light" size="sm">
                  ^VXN {vxnPct.toFixed(1)}%
                </Badge>
              )}
              {asOf && <Text size="xs" c="dimmed">as of {fmtDate(asOf)}</Text>}
            </Group>
          </Group>
          <Group gap="md" align="center">
            <Group gap="xs" align="center">
              <Text size="xs" c="dimmed">Annual budget</Text>
              <Text size="xs" fw={700}>{fmtUsd(annualBudget)}</Text>
              <Text size="xs" c="dimmed">·</Text>
              <NumberInput
                value={budgetPct}
                readOnly
                min={0.5} max={8} step={0.5}
                suffix="%/yr" size="xs" w={100} decimalScale={1}
                styles={{ input: { cursor: "default" } }}
              />
            </Group>
          </Group>
        </Group>

        {/* Annual budget spend meter */}
        <Box>
          <Group justify="space-between" gap="xs" mb={4} wrap="wrap">
            <Text size="xs" c="dimmed">
              {year} spent <Text span fw={700} c={`${meterColor}.4`}>{fmtMoney(spent)}</Text> of {fmtUsd(annualBudget)}
              {recovered > 0 && (
                <Text span c="dimmed"> · {fmtMoney(recovered)} recovered</Text>
              )}
            </Text>
            <Text size="xs" c={remaining < 0 ? "red.4" : "dimmed"}>
              {remaining >= 0 ? `${fmtMoney(remaining)} left` : `${fmtMoney(-remaining)} over`} ({Math.round(spentPct)}%)
            </Text>
          </Group>
          <Progress value={Math.min(100, spentPct)} color={meterColor} size="sm" radius="xl" />
        </Box>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Budget orders — pick which QQQ-put buys count toward the budget
// ---------------------------------------------------------------------------

interface BudgetOrder {
  id: number;
  time: string;
  symbol: string;
  strike: number;
  contracts: number;
  premium: number;
  dteAtPurchase: number | null;
  /** True when the DTE rule auto-excludes this buy (short-dated, non-hedge). */
  autoExcluded: boolean;
  included: boolean;
}

/** One selectable buy row (checkbox + details + premium). */
function BudgetOrderRow({ o, onToggle }: { o: BudgetOrder; onToggle: (id: number) => void }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Checkbox
        size="xs"
        checked={o.included}
        onChange={() => onToggle(o.id)}
        label={
          <Text size="xs" c={o.included ? undefined : "dimmed"}>
            {fmtDate(o.time)} · ${o.strike.toFixed(0)} P ×{o.contracts}
            {o.dteAtPurchase !== null && (
              <Text span size="9px" c="dimmed"> · {o.dteAtPurchase}d DTE at buy</Text>
            )}
          </Text>
        }
      />
      <Text size="xs" fw={600} c={o.included ? undefined : "dimmed"} td={o.included ? undefined : "line-through"}>
        {fmtMoney(o.premium)}
      </Text>
    </Group>
  );
}

function BudgetOrdersPanel({ orders, onToggle }: { orders: BudgetOrder[]; onToggle: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  if (orders.length === 0) return null;
  const includedCount = orders.filter((o) => o.included).length;
  const hedgeBuys = orders.filter((o) => !o.autoExcluded);
  const autoExcluded = orders.filter((o) => o.autoExcluded);
  return (
    <Paper radius={CARD_RADIUS} p="sm" withBorder>
      <UnstyledButton onClick={() => setOpen((s) => !s)} style={{ width: "100%" }}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="xs" fw={700} tt="uppercase" style={CARD_LABEL_STYLE}>
            QQQ put buys in budget ({includedCount}/{orders.length})
          </Text>
          <IconChevronDown
            size={14}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--mantine-color-dimmed)" }}
          />
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap={6} mt="xs">
          <Text size="9px" c="dimmed">
            Short-dated buys (under {HEDGE_MIN_DTE}d to expiry) are auto-excluded as non-hedge; check or
            uncheck any to override what counts against this year&apos;s hedge budget.
          </Text>

          {hedgeBuys.length === 0 ? (
            <Text size="xs" c="dimmed">No long-dated hedge buys yet.</Text>
          ) : (
            hedgeBuys.map((o) => <BudgetOrderRow key={o.id} o={o} onToggle={onToggle} />)
          )}

          {/* Auto-excluded short-dated buys — nested accordion under the list */}
          {autoExcluded.length > 0 && (
            <Box mt={4}>
              <Divider mb={6} opacity={0.4} />
              <UnstyledButton onClick={() => setAutoOpen((s) => !s)} style={{ width: "100%" }}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="9px" tt="uppercase" c="dimmed" style={CARD_LABEL_STYLE}>
                    Auto-excluded · short-dated ({autoExcluded.length})
                  </Text>
                  <IconChevronDown
                    size={12}
                    style={{ transform: autoOpen ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--mantine-color-dimmed)" }}
                  />
                </Group>
              </UnstyledButton>
              <Collapse in={autoOpen}>
                <Stack gap={6} mt={6}>
                  {autoExcluded.map((o) => <BudgetOrderRow key={o.id} o={o} onToggle={onToggle} />)}
                </Stack>
              </Collapse>
            </Box>
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PutHedgePanel() {
  const color = useAccountColor();
  const { activeAccount, balances, allOptionPositions, filledOptionOrders, updateAccountSettings } = useApp();

  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [budgetPct] = useState<number>(DEFAULT_BUDGET_PCT);

  useEffect(() => {
    fetch("/api/put-hedge")
      .then((r) => r.json())
      .then((d: MarketData) => { if (!d.error) setMarket(d); })
      .catch(() => {})
      .finally(() => setMarketLoading(false));
  }, []);

  const hedgePuts = useMemo(
    () =>
      allOptionPositions.filter(
        (p) => p.underlyingSymbol === INSTRUMENT && p.putCall === "PUT" && p.longQty > 0,
      ),
    [allOptionPositions],
  );

  const activeTqqqValue =
    balances.find((b) => b.accountNumber === activeAccount?.accountNumber)?.tqqqValue ?? 0;

  const activePuts = useMemo(
    () => hedgePuts.filter((p) => p.accountNumber === activeAccount?.accountNumber),
    [hedgePuts, activeAccount],
  );

  const qqqSpot = market?.qqqPrice ?? null;

  const plan = useMemo(
    () =>
      qqqSpot !== null && activeTqqqValue > 0
        ? buildTranchePlan({
            tqqqValue: activeTqqqValue,
            spot: qqqSpot,
            vxnPct: market?.vxnPct ?? null,
            annualBudgetPct: budgetPct / 100,
            instrument: INSTRUMENT,
          })
        : null,
    [qqqSpot, activeTqqqValue, market?.vxnPct, budgetPct],
  );

  // Group open puts by tranche
  const putsByTranche = useMemo(() => {
    const map = new Map<TrancheKey, OptionPosition[]>();
    for (const pos of activePuts) {
      const key = qqqSpot ? classifyTranche(pos.strike / qqqSpot, INSTRUMENT) : null;
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(pos);
      map.set(key, arr);
    }
    return map;
  }, [activePuts, qqqSpot]);

  // Positions that don't classify into any active tranche
  const unclassified = useMemo(
    () =>
      activePuts.filter((pos) => {
        const key = qqqSpot ? classifyTranche(pos.strike / qqqSpot, INSTRUMENT) : null;
        return key === null || !plan?.some((t) => t.def.key === key);
      }),
    [activePuts, qqqSpot, plan],
  );

  // Prioritized next-steps, shared by the top banner and the full action list.
  const hedgeActions = useMemo(
    () => buildHedgeActions(plan, activePuts, qqqSpot, market?.vxnPct ?? null),
    [plan, activePuts, qqqSpot, market?.vxnPct],
  );

  // Order IDs the user has manually flipped away from their DTE-based default.
  const flippedBudgetIds = useMemo(
    () => new Set(activeAccount?.settings.hedgeBudgetFlippedOrderIds ?? []),
    [activeAccount?.settings.hedgeBudgetFlippedOrderIds],
  );

  // This year's QQQ-put buys, with include state = DTE default XOR manual flip.
  const budgetOrders = useMemo<BudgetOrder[]>(() => {
    const year = new Date().getFullYear();
    return filledOptionOrders
      .filter(
        (o) =>
          o.underlyingSymbol === INSTRUMENT &&
          o.instruction === "BUY_TO_OPEN" &&
          /P\d{8}$/.test(o.symbol) &&
          new Date(o.time).getFullYear() === year,
      )
      .map((o) => {
        const m = o.symbol.match(/P(\d{8})$/);
        const dte = dteAtPurchase(o.symbol, o.time);
        const auto = autoIncluded(dte);
        const included = auto !== flippedBudgetIds.has(o.orderId); // XOR with manual flip
        return {
          id: o.orderId,
          time: o.time,
          symbol: o.symbol,
          strike: m ? parseInt(m[1], 10) / 1000 : 0,
          contracts: o.contracts,
          premium: Math.abs(o.total),
          dteAtPurchase: dte,
          autoExcluded: !auto,
          included,
        };
      })
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [filledOptionOrders, flippedBudgetIds]);

  // YTD hedge spend: premium paid on the *included* buys, less premium recovered
  // by closing those same contracts (matched by OCC symbol).
  const budgetSpent = useMemo(() => {
    const year = new Date().getFullYear();
    const includedSymbols = new Set(budgetOrders.filter((o) => o.included).map((o) => o.symbol));
    const paid = budgetOrders.filter((o) => o.included).reduce((s, o) => s + o.premium, 0);
    let recovered = 0;
    for (const o of filledOptionOrders) {
      if (o.instruction !== "SELL_TO_CLOSE") continue;
      if (!includedSymbols.has(o.symbol)) continue;
      if (new Date(o.time).getFullYear() !== year) continue;
      recovered += Math.abs(o.total);
    }
    return { paid, recovered };
  }, [filledOptionOrders, budgetOrders]);

  const toggleBudgetOrder = useCallback(
    (id: number) => {
      if (!activeAccount) return;
      const cur = new Set(activeAccount.settings.hedgeBudgetFlippedOrderIds ?? []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      updateAccountSettings(activeAccount.accountNumber, { hedgeBudgetFlippedOrderIds: [...cur] });
    },
    [activeAccount, updateAccountSettings],
  );

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>Put hedge</Text>
        <Text size="sm" c="dimmed">
          QQQ put overlay tuned for a buy-the-dip strategy: a ~0.15Δ crash leg (6-month) and a
          ~0.07Δ catastrophe leg (1-year LEAPS). Your budget sets a standing ladder of whole
          contracts per leg; buy them one at a time, spaced evenly so expiries stagger. Skip
          ordinary dips — spend on the long-bear tail. Roll at {ROLL_AT_DTE}d; take half profit
          at +{Math.round(PROFIT_TAKE_PCT * 100)}%.
        </Text>
      </Box>

      {/* Next steps — most-urgent first, each with its countdown */}
      {hedgeActions.length > 0 && <NextStepsPanel actions={hedgeActions} />}

      {/* VXN panic-spike warning */}
      {market?.vxnPct != null && market.vxnPct > VIX_PAUSE_THRESHOLD && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          ^VXN at {market.vxnPct.toFixed(1)}% — above the {VIX_PAUSE_THRESHOLD}% panic line. Defer the
          crash leg until the spike settles, but keep buying the cheap catastrophe leg. Existing
          positions are fine to hold.
        </Alert>
      )}

      {/* Market data + budget */}
      {marketLoading ? (
        <Center py="md">
          <Group gap="xs">
            <Loader size="xs" color={color} />
            <Text size="sm" c="dimmed">Loading market data…</Text>
          </Group>
        </Center>
      ) : qqqSpot === null ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          Could not fetch the current QQQ price. Reload to retry.
        </Alert>
      ) : (
        <>
          <BudgetRow
            tqqqValue={activeTqqqValue}
            budgetPct={budgetPct}
            plan={plan}
            vxnPct={market?.vxnPct ?? null}
            qqqSpot={qqqSpot}
            asOf={market?.asOf ?? null}
            spent={budgetSpent.paid}
            recovered={budgetSpent.recovered}
          />

          <BudgetOrdersPanel orders={budgetOrders} onToggle={toggleBudgetOrder} />

          {activeTqqqValue === 0 && (
            <Alert color="gray" icon={<IconInfoCircle size={16} />} radius={CARD_RADIUS}>
              No TQQQ holdings in {activeAccount?.accountName ?? "this account"}. Switch accounts to size a hedge.
            </Alert>
          )}
        </>
      )}

      {/* Open hedge puts by tranche */}
      {plan && qqqSpot !== null && (
        <Stack gap="md">
          <Text tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>Open hedge puts</Text>

          {plan.map((t) => (
            <TrancheSection
              key={t.def.key}
              tranche={t}
              puts={putsByTranche.get(t.def.key) ?? []}
              spot={qqqSpot}
              vxnPct={market?.vxnPct ?? null}
            />
          ))}

          {unclassified.length > 0 && (
            <Box>
              <Text size="xs" c="dimmed" mb="xs" style={CARD_LABEL_STYLE}>Other / unclassified</Text>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {unclassified.map((pos, i) => (
                  <PutCard key={i} pos={pos} spot={qqqSpot} vxnPct={market?.vxnPct ?? null} />
                ))}
              </SimpleGrid>
            </Box>
          )}

          {plan.every((t) => (putsByTranche.get(t.def.key) ?? []).length === 0) && unclassified.length === 0 && (
            <Alert icon={<IconInfoCircle size={16} />} color="gray" radius={CARD_RADIUS}>
              No open {INSTRUMENT} long puts found. Buy protective puts through your broker and they will appear here.
            </Alert>
          )}
        </Stack>
      )}

      {/* Strategy reference table */}
      <Paper radius={CARD_RADIUS} withBorder>
        <Box px="md" pt="md" pb={6}>
          <Text size="xs" fw={700} tt="uppercase" style={CARD_LABEL_STYLE}>Strategy reference</Text>
        </Box>
        <Table fz="xs" verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={CARD_LABEL_STYLE}>Tranche</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Target Δ</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>DTE</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Buy schedule</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Budget</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Activates when</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {TRANCHE_SETS[INSTRUMENT].filter((t) => t.budgetShare > 0).map((t) => {
              const schedule = `Staggered · roll ${ROLL_AT_DTE}d`;
              const activates =
                t.key === "crash" ? "QQQ −25% (~TQQQ −55%)" :
                t.key === "catastrophe" ? "QQQ −35% (~TQQQ −75%)" : "—";
              return (
                <Table.Tr key={t.key}>
                  <Table.Td><Badge color={t.color} variant="light" size="xs">{t.label}</Badge></Table.Td>
                  <Table.Td>{t.targetDelta.toFixed(2)}Δ</Table.Td>
                  <Table.Td>{t.dte}d</Table.Td>
                  <Table.Td c="dimmed">{schedule}</Table.Td>
                  <Table.Td>{Math.round(t.budgetShare * 100)}% of annual</Table.Td>
                  <Table.Td c="dimmed">{activates}</Table.Td>
                </Table.Tr>
              );
            })}
            <Table.Tr>
              <Table.Td colSpan={6} style={{ paddingTop: 8, paddingBottom: 8 }}>
                <Text size="9px" c="dimmed">
                  Roll at {ROLL_AT_DTE}d DTE · Take half profit at +{Math.round(PROFIT_TAKE_PCT * 100)}% gain ·
                  Defer only the crash leg when ^VXN &gt; {VIX_PAUSE_THRESHOLD}% (catastrophe leg always buys) ·
                  Modeled with Black-Scholes at VXN-implied vol + linear skew
                </Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
