"use client";

import { useEffect, useState, useMemo } from "react";
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
  DCA_WEEKS,
  buildTranchePlan,
  classifyTranche,
  buyWindowStatus,
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

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtUsd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtMoney = (x: number) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: x < 100 ? 2 : 0,
  });

// ---------------------------------------------------------------------------
// Live greeks — modeled off QQQ spot + ^VXN, matching the backtest's pricing.
// ---------------------------------------------------------------------------

/** Greeks for an open put, off current spot + VXN (null when inputs missing). */
function greeksFor(pos: OptionPosition, spot: number | null, vxnPct: number | null): PutGreeks | null {
  if (spot === null || spot <= 0) return null;
  const dte = daysUntil(pos.expiry);
  const moneyness = pos.strike / spot;
  const baseIv = vxnPct != null && vxnPct > 0 ? vxnPct / 100 : 0.22;
  const iv = baseIv * (1 + LIVE_SKEW * Math.max(0, 1 - moneyness)); // QQQ: IV scale 1
  return bsPutGreeks(spot, pos.strike, dte / 365, iv, 0.04, 0.006);
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
}

function TodayPanel({
  plan,
  openPuts,
  qqqSpot,
  vxnPct,
}: {
  plan: TranchePlan[] | null;
  openPuts: OptionPosition[];
  qqqSpot: number | null;
  vxnPct: number | null;
}) {
  const today = useMemo(() => new Date(), []);
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
      });
    } else if (rec.action === "roll-soon") {
      actions.push({
        priority: 2,
        color: "yellow",
        icon: <IconRefresh size={14} />,
        title: `${pos.symbol} — roll soon`,
        detail: `${daysUntil(pos.expiry)}d left (expires ${fmtDate(pos.expiry)}). Open replacement at target DTE, then close this one.`,
      });
    }
  }

  // --- Buy window actions ---
  if (plan) {
    const vxnElevated = vxnPct !== null && vxnPct > VIX_PAUSE_THRESHOLD;

    for (const t of plan) {
      const ws = buyWindowStatus(t.def, today);
      if (!ws.inWindow) continue;

      const strike = qqqSpot !== null ? Math.round(qqqSpot * t.def.moneyness) : t.strike;
      const detail = `QQQ ~$${strike} put · ${t.dte}-day DTE · spend ~${fmtMoney(t.perClipBudget)} this clip`;

      if (vxnElevated) {
        actions.push({
          priority: 3,
          color: "yellow",
          icon: <IconAlertTriangle size={14} />,
          title: `${t.def.label}: clip ${ws.clip}/${DCA_WEEKS} — VXN elevated, defer`,
          detail: `^VXN at ${vxnPct!.toFixed(1)}% (threshold ${VIX_PAUSE_THRESHOLD}%). Wait for vol to settle before buying. ${detail}`,
        });
      } else {
        actions.push({
          priority: 3,
          color: "teal",
          icon: <IconArrowDown size={14} />,
          title: `Buy ${t.def.label}: clip ${ws.clip}/${DCA_WEEKS} — ${ws.periodLabel} window`,
          detail,
        });
      }
    }
  }

  // --- Upcoming windows if nothing active ---
  const activeBuyActions = actions.filter((a) => a.priority === 3);
  if (plan && activeBuyActions.length === 0) {
    const upcoming = plan
      .map((t) => ({ t, ws: buyWindowStatus(t.def, today) }))
      .filter(({ ws }) => !ws.inWindow)
      .sort((a, b) => a.ws.daysUntilNext - b.ws.daysUntilNext);

    for (const { t, ws } of upcoming.slice(0, 2)) {
      const strike = qqqSpot !== null ? Math.round(qqqSpot * t.def.moneyness) : t.strike;
      actions.push({
        priority: 4,
        color: "gray",
        icon: <IconClock size={14} />,
        title: `${t.def.label}: next buy ${ws.periodLabel} 1 (${ws.daysUntilNext}d)`,
        detail: `QQQ ~$${strike} put · ${t.dte}-day DTE · ~${fmtMoney(t.perClipBudget)}/clip over ${DCA_WEEKS} weeks`,
      });
    }
  }

  const sorted = [...actions].sort((a, b) => a.priority - b.priority);
  const bg = useCardBg(sorted[0]?.color ?? "gray");

  if (sorted.length === 0) return null;

  return (
    <Paper radius={CARD_RADIUS} p="md" style={{ background: bg }}>
      <Text size="xs" fw={700} tt="uppercase" style={CARD_LABEL_STYLE} mb="sm">
        Today&apos;s action
      </Text>
      <Stack gap="sm">
        {sorted.map((a, i) => (
          <Group key={i} gap="sm" align="flex-start" wrap="nowrap">
            <ThemeIcon size="sm" variant="light" color={a.color === "dimmed" ? "gray" : a.color} radius="xl" mt={1} style={{ flexShrink: 0 }}>
              {a.icon}
            </ThemeIcon>
            <Box>
              <Text size="sm" fw={600}>{a.title}</Text>
              <Text size="xs" c="dimmed">{a.detail}</Text>
            </Box>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Individual put card
// ---------------------------------------------------------------------------

function PutCard({ pos, spot, vxnPct }: { pos: OptionPosition; spot: number | null; vxnPct: number | null }) {
  const dte = daysUntil(pos.expiry);
  const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
  const pnl = pos.marketValue - costTotal;
  const pnlPct = costTotal > 0 ? pnl / costTotal : 0;
  const greeks = greeksFor(pos, spot, vxnPct);
  const rec = closeRec(pos, spot, greeks);
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
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Empty slot card
// ---------------------------------------------------------------------------

function EmptyPutCard({ tranche, spot }: { tranche: TranchePlan; spot: number | null }) {
  const strike = spot !== null ? Math.round(spot * tranche.def.moneyness) : tranche.strike;
  const otmPct = Math.round((1 - tranche.def.moneyness) * 100);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const windowLabel = tranche.def.buyMonths.map((m) => monthNames[m]).join(" + ") || "—";

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
          <Text size="xs" c="dimmed" mt={2}>{INSTRUMENT} · {otmPct}% OTM</Text>
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
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>~per clip</Text>
          <Text size="sm" fw={600} c="dark.2">{fmtMoney(tranche.perClipBudget)}</Text>
        </Box>
        <Box ta="right">
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>Buy months</Text>
          <Text size="sm" fw={600} c="dimmed">{windowLabel}</Text>
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
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const windowLabel = tranche.def.buyMonths.map((m) => monthNames[m]).join(" + ") || "—";
  const otmPct = Math.round((1 - tranche.def.moneyness) * 100);
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
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>OTM depth</Table.Td>
            <Table.Td fw={600}>{otmPct}%</Table.Td>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Target DTE</Table.Td>
            <Table.Td fw={600}>{tranche.dte}d</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Buy months</Table.Td>
            <Table.Td fw={600}>{windowLabel}</Table.Td>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Per clip</Table.Td>
            <Table.Td fw={600} c={`${tranche.def.color}.4`}>{fmtMoney(tranche.perClipBudget)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Annual budget</Table.Td>
            <Table.Td fw={600}>{fmtUsd(tranche.annualBudget)}</Table.Td>
            <Table.Td c="dimmed" style={CARD_LABEL_STYLE}>Est. carry</Table.Td>
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
}: {
  tqqqValue: number;
  budgetPct: number;
  plan: TranchePlan[] | null;
  vxnPct: number | null;
  qqqSpot: number | null;
  asOf: string | null;
}) {
  const annualBudget = tqqqValue * (budgetPct / 100);
  const openCount = plan ? plan.filter(t => t.targetContracts > 0).length : 0;
  const statusColor = openCount === 0 ? "red" : openCount < (plan?.length ?? 1) ? "yellow" : "teal";

  return (
    <Paper radius={CARD_RADIUS} p="sm" style={{ background: "color-mix(in srgb, var(--mantine-color-dark-7) 60%, transparent)" }}>
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
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PutHedgePanel() {
  const color = useAccountColor();
  const { activeAccount, balances, allOptionPositions } = useApp();

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

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>Put hedge</Text>
        <Text size="sm" c="dimmed">
          QQQ put overlay tuned for a buy-the-dip strategy: 6-month crash puts (Jan + Jul)
          and 1-year catastrophe LEAPS (Jan). Skip ordinary dips — spend on the long-bear tail.
          Roll at {ROLL_AT_DTE}d; take half profit at +{Math.round(PROFIT_TAKE_PCT * 100)}%.
        </Text>
      </Box>

      {/* VXN elevated warning */}
      {market?.vxnPct != null && market.vxnPct > VIX_PAUSE_THRESHOLD && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          ^VXN at {market.vxnPct.toFixed(1)}% — above the {VIX_PAUSE_THRESHOLD}% pause threshold.
          Defer new clips until vol settles; existing positions are fine to hold.
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
          />

          {/* Today's action */}
          {activeTqqqValue > 0 && plan && (
            <TodayPanel
              plan={plan}
              openPuts={activePuts}
              qqqSpot={qqqSpot}
              vxnPct={market?.vxnPct ?? null}
            />
          )}

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
              <Table.Th style={CARD_LABEL_STYLE}>Depth</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>DTE</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Buy schedule</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Budget</Table.Th>
              <Table.Th style={CARD_LABEL_STYLE}>Activates when</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {TRANCHE_SETS[INSTRUMENT].filter((t) => t.budgetShare > 0).map((t) => {
              const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              const schedule = t.buyMonths.length > 0
                ? `${t.buyMonths.map((m) => monthNames[m]).join(" + ")} · 3 clips/window`
                : "—";
              const activates =
                t.key === "crash" ? "QQQ −25% (~TQQQ −55%)" :
                t.key === "catastrophe" ? "QQQ −35% (~TQQQ −75%)" : "—";
              return (
                <Table.Tr key={t.key}>
                  <Table.Td><Badge color={t.color} variant="light" size="xs">{t.label}</Badge></Table.Td>
                  <Table.Td>{Math.round((1 - t.moneyness) * 100)}% OTM</Table.Td>
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
                  Defer new clips when ^VXN &gt; {VIX_PAUSE_THRESHOLD}% · Modeled with Black-Scholes at VXN-implied vol + linear skew
                </Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
