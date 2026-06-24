"use client";

import { useEffect, useState, useMemo } from "react";
import { Outfit } from "next/font/google";
import {
  Stack,
  Box,
  Text,
  Group,
  SegmentedControl,
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
  Progress,
} from "@mantine/core";

const outfit = Outfit({ subsets: ["latin"] });
import {
  IconAlertTriangle,
  IconInfoCircle,
  IconShield,
  IconShieldOff,
} from "@tabler/icons-react";
import { useApp, type Account } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";
import type { OptionPosition } from "@/lib/schwab/parse";
import {
  TRANCHE_SETS,
  HEDGE_DTE_BY_INSTRUMENT,
  ROLL_AT_DTE,
  buildTranchePlan,
  classifyTranche,
  type TrancheKey,
  type HedgeInstrument,
} from "@/lib/hedgeTranches";

const DEFAULT_BUDGET_PCT = 3; // annual premium budget, % of TQQQ value

// Buy cadence options — how often you place clips (the budget is chunked to match).
const CADENCES = [
  { value: "52", short: "Weekly", label: "week" },
  { value: "26", short: "2 wks", label: "2 weeks" },
  { value: "12", short: "Monthly", label: "month" },
];
const cadenceLabelOf = (buysPerYear: number) =>
  CADENCES.find((c) => c.value === String(buysPerYear))?.label ?? "week";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysUntil(expiry: string): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtUsd = (x: number) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
/** Currency with cents for small (weekly) amounts, whole dollars otherwise. */
const fmtMoney = (x: number) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: x < 100 ? 2 : 0,
  });

// ---------------------------------------------------------------------------
// Close-recommendation logic
// ---------------------------------------------------------------------------

type CloseAction = "expiring" | "close-profit" | "roll-soon" | "hold";
type CloseRec = { action: CloseAction; label: string; color: string };

function closeRec(pos: OptionPosition, currentQqq: number | null): CloseRec {
  const dte = daysUntil(pos.expiry);
  const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
  const currentValue = pos.marketValue;
  const gainPct = costTotal > 0 ? (currentValue - costTotal) / costTotal : 0;

  if (dte <= 5)
    return {
      action: "expiring",
      label: `Expires in ${dte}d — roll immediately`,
      color: "red",
    };
  if (gainPct >= 0.5)
    return {
      action: "close-profit",
      label: `+${fmtPct(gainPct)} gain — take profit & re-enter`,
      color: "teal",
    };
  if (currentQqq !== null && currentQqq < pos.strike * 0.9)
    return {
      action: "close-profit",
      label: "Deeply ITM — harvest profit, reset hedge",
      color: "teal",
    };
  if (dte <= 21)
    return {
      action: "roll-soon",
      label: `${dte}d left — prepare to roll`,
      color: "yellow",
    };
  return { action: "hold", label: `${dte}d left — hold`, color: "dimmed" };
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface MarketData {
  tqqqPrice: number | null;
  vxnPct: number | null;
  asOf: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Per-account recommendation card
// ---------------------------------------------------------------------------

function AccountRec({
  account,
  tqqqValue,
  instrument,
  spot,
  vxnPct,
  budgetPct,
  buysPerYear,
  cadenceLabel,
  openHedgePuts,
}: {
  account: Account;
  tqqqValue: number;
  instrument: HedgeInstrument;
  spot: number;
  vxnPct: number | null;
  budgetPct: number;
  buysPerYear: number;
  cadenceLabel: string;
  openHedgePuts: OptionPosition[];
}) {
  const plan = buildTranchePlan({
    tqqqValue,
    spot,
    vxnPct,
    annualBudgetPct: budgetPct / 100,
    instrument,
  });

  // Open puts currently held in each tranche, by moneyness of the strike.
  const openByTranche = new Map<TrancheKey, number>();
  for (const p of openHedgePuts) {
    const key = classifyTranche(p.strike / spot, instrument);
    if (key) openByTranche.set(key, (openByTranche.get(key) ?? 0) + p.longQty);
  }

  const suggestedDte = HEDGE_DTE_BY_INSTRUMENT[instrument];

  // A per-buy premium budget per tranche — divisible, so it works at any account
  // size (buy whatever fits at your chosen DTE instead of a whole-contract target).
  const rows = plan.map((t) => ({
    t,
    open: openByTranche.get(t.def.key) ?? 0,
    otmPct: Math.round((1 - t.def.moneyness) * 100),
    perBuy: t.annualBudget / buysPerYear,
  }));

  const openTotal = rows.reduce((s, r) => s + r.open, 0);
  const covered = rows.filter((r) => r.open > 0).length;
  const statusColor =
    covered === 0 ? "red" : covered < rows.length ? "yellow" : "teal";
  const bg = useCardBg(statusColor);
  const perBuyTotal = rows.reduce((s, r) => s + r.perBuy, 0);
  const soonExpiring = openHedgePuts.some(
    (p) => daysUntil(p.expiry) <= ROLL_AT_DTE,
  );

  return (
    <Paper radius={CARD_RADIUS} p="md" style={{ background: bg }}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color={statusColor} radius="xl">
            {covered === rows.length ? (
              <IconShield size={12} />
            ) : (
              <IconShieldOff size={12} />
            )}
          </ThemeIcon>
          <Box>
            <Text size="sm" fw={600} lineClamp={1}>
              {account.accountName}
            </Text>
            <Text size="xs" c="dimmed">
              {fmtUsd(tqqqValue)} TQQQ
            </Text>
          </Box>
        </Group>
        <Badge color={statusColor} variant="light" size="sm">
          {openTotal > 0 ? `${openTotal} open` : "unhedged"}
        </Badge>
      </Group>

      {soonExpiring && (
        <Text size="xs" c="yellow.4" mb="xs">
          A position is within {ROLL_AT_DTE}d of expiry — roll it.
        </Text>
      )}

      <Table fz="xs" verticalSpacing={6} withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={CARD_LABEL_STYLE}>Tranche</Table.Th>
            <Table.Th style={CARD_LABEL_STYLE}>Suggested put</Table.Th>
            <Table.Th ta="right" style={CARD_LABEL_STYLE}>
              Open
            </Table.Th>
            <Table.Th ta="right" style={CARD_LABEL_STYLE}>
              Buy / {cadenceLabel}
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ t, open, otmPct, perBuy }) => (
            <Table.Tr key={t.def.key}>
              <Table.Td>
                <Tooltip label={t.def.desc} withArrow multiline w={200}>
                  <Text size="xs" c={`${t.def.color}.4`} fw={600} span>
                    {t.def.label}
                  </Text>
                </Tooltip>
                <Text size="9px" c="dimmed">
                  {otmPct}% OTM
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">
                  {instrument} ~${t.strike} P
                </Text>
                <Text size="9px" c="dimmed">
                  ≈ ${t.estPremiumPerContract.toFixed(0)}/ct @ {suggestedDte}d
                </Text>
              </Table.Td>
              <Table.Td ta="right" c={open > 0 ? undefined : "dimmed"}>
                {open}
              </Table.Td>
              <Table.Td ta="right" fw={700} c={`${t.def.color}.4`}>
                {fmtMoney(perBuy)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Divider my={6} opacity={0.15} />
      <Text size="9px" c="dimmed">
        Each {cadenceLabel} go to your preferred DTE (~{suggestedDte} suggested)
        and buy as many {instrument}
        puts at each depth as the amount covers; roll at {ROLL_AT_DTE}d.
        Strikes/prices move with {instrument} — the % OTM is what stays fixed.
        Modeled prices · ~{fmtMoney(perBuyTotal)}/{cadenceLabel}({budgetPct}
        %/yr).
      </Text>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Individual put card
// ---------------------------------------------------------------------------

function PutCard({
  pos,
  instrument,
  spot,
}: {
  pos: OptionPosition;
  instrument: HedgeInstrument;
  spot: number | null;
}) {
  const dte = daysUntil(pos.expiry);
  const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
  const currentValue = pos.marketValue;
  const pnl = currentValue - costTotal;
  const pnlPct = costTotal > 0 ? pnl / costTotal : 0;
  const rec = closeRec(pos, spot);
  const trKey = spot ? classifyTranche(pos.strike / spot, instrument) : null;
  const tr = trKey
    ? TRANCHE_SETS[instrument].find((t) => t.key === trKey)
    : null;

  const urgencyColor =
    rec.action === "expiring"
      ? "red"
      : rec.action === "close-profit"
        ? "teal"
        : rec.action === "roll-soon"
          ? "yellow"
          : (tr?.color ?? "violet");

  const bg = useCardBg(urgencyColor);

  const dteColor =
    dte <= 5
      ? "var(--mantine-color-red-4)"
      : dte <= 21
        ? "var(--mantine-color-yellow-4)"
        : "white";

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
      {/* Watermark strike in background */}
      <Box
        aria-hidden
        style={{
          position: "absolute",
          right: -8,
          top: -8,
          fontSize: "6rem",
          fontWeight: 900,
          lineHeight: 1,
          color: "rgba(255,255,255,0.04)",
          fontFamily: outfit.style.fontFamily,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        ${pos.strike.toFixed(0)}
      </Box>

      {/* Strike + DTE hero */}
      <Group justify="space-between" align="flex-end" mb="md" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" style={CARD_LABEL_STYLE}>
            Strike
          </Text>
          <Text
            className={outfit.className}
            style={{
              fontSize: "2.4rem",
              fontWeight: 700,
              lineHeight: 1,
              color: "white",
            }}
          >
            ${pos.strike.toFixed(0)}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {pos.symbol} · {pos.longQty} ct
          </Text>
        </Box>
        <Box ta="right">
          <Text
            className={outfit.className}
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              lineHeight: 1,
              color: dteColor,
            }}
          >
            {dte}
          </Text>
          <Text size="xs" c="dimmed">
            days left
          </Text>
          <Text size="9px" c="dimmed" mt={2}>
            {fmtDate(pos.expiry)}
          </Text>
        </Box>
      </Group>

      <Divider opacity={0.12} mb="sm" />

      {/* Stats row */}
      <Group grow gap="xs" mb="sm">
        <Box>
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>
            Cost
          </Text>
          <Text size="sm" fw={600}>
            {fmtMoney(costTotal)}
          </Text>
        </Box>
        <Box>
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>
            Value
          </Text>
          <Text size="sm" fw={600}>
            {fmtMoney(currentValue)}
          </Text>
        </Box>
        <Box ta="right">
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>
            P&amp;L
          </Text>
          <Text size="sm" fw={700} c={pnl >= 0 ? "teal.4" : "red.4"}>
            {pnl >= 0 ? "+" : ""}
            {fmtMoney(pnl)}
          </Text>
          <Text size="9px" c={pnl >= 0 ? "teal.6" : "red.6"}>
            {pnl >= 0 ? "+" : ""}
            {fmtPct(pnlPct)}
          </Text>
        </Box>
      </Group>

      {/* Recommendation */}
      <Badge
        color={rec.color === "dimmed" ? "gray" : rec.color}
        variant="light"
        size="xs"
        style={{
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {rec.label}
      </Badge>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Empty slot card (tranche with no position yet)
// ---------------------------------------------------------------------------

type TranchePlan = ReturnType<typeof buildTranchePlan>;

function EmptyPutCard({
  tranche,
  instrument,
  perBuy,
  cadenceLabel,
}: {
  tranche: TranchePlan[number];
  instrument: HedgeInstrument;
  perBuy: number;
  cadenceLabel: string;
}) {
  const suggestedDte = HEDGE_DTE_BY_INSTRUMENT[instrument];
  const otmPct = Math.round((1 - tranche.def.moneyness) * 100);

  return (
    <Paper
      radius={CARD_RADIUS}
      p="md"
      style={{
        border: `1px dashed var(--mantine-color-dark-4)`,
        background: "var(--mantine-color-dark-8)",
        position: "relative",
        overflow: "hidden",
        opacity: 0.7,
      }}
    >
      {/* Header */}
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Badge
          color="gray"
          variant="outline"
          size="xs"
          style={{ opacity: 0.6 }}
        >
          {tranche.def.label}
        </Badge>
        <Text size="9px" c="dimmed">
          unfilled
        </Text>
      </Group>

      {/* Ghost strike hero */}
      <Group justify="space-between" align="flex-end" mb="md" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" style={CARD_LABEL_STYLE}>
            Suggested strike
          </Text>
          <Text
            className={outfit.className}
            style={{
              fontSize: "2.4rem",
              fontWeight: 700,
              lineHeight: 1,
              color: "var(--mantine-color-dark-2)",
            }}
          >
            ~${tranche.strike}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {instrument} · {otmPct}% OTM
          </Text>
        </Box>
        <Box ta="right">
          <Text size="xs" c="dimmed" style={CARD_LABEL_STYLE}>
            Target DTE
          </Text>
          <Text
            className={outfit.className}
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              lineHeight: 1,
              color: "var(--mantine-color-dark-2)",
            }}
          >
            {suggestedDte}
          </Text>
          <Text size="xs" c="dimmed">
            days
          </Text>
        </Box>
      </Group>

      <Divider opacity={0.08} mb="sm" />

      {/* Budget */}
      <Group grow gap="xs">
        <Box>
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>
            Buy / {cadenceLabel}
          </Text>
          <Text size="sm" fw={600} c="dark.2">
            {fmtMoney(perBuy)}
          </Text>
        </Box>
        <Box ta="right">
          <Text size="9px" c="dimmed" style={CARD_LABEL_STYLE}>
            Est. premium
          </Text>
          <Text size="sm" fw={600} c="dimmed">
            ~${tranche.estPremiumPerContract.toFixed(0)}/ct
          </Text>
        </Box>
      </Group>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Open hedge puts section
// ---------------------------------------------------------------------------

type GridItem =
  | { type: "real"; pos: OptionPosition }
  | { type: "empty"; tranche: TranchePlan[number] };

type TrancheGroup = {
  tranche: TranchePlan[number];
  items: GridItem[];
};

function OpenHedgePuts({
  puts,
  instrument,
  spot,
  plan,
  buysPerYear,
  cadenceLabel,
  monthlySpend,
}: {
  puts: OptionPosition[];
  instrument: HedgeInstrument;
  spot: number | null;
  plan: TranchePlan | null;
  buysPerYear: number;
  cadenceLabel: string;
  monthlySpend: Map<TrancheKey, number>;
}) {
  // Build groups — one per tranche in plan order, then an optional overflow group
  // for positions that don't classify into any known tranche.
  const groups: TrancheGroup[] = [];
  const unclassified: OptionPosition[] = [];

  if (plan) {
    for (const tranche of plan) {
      const tranchePuts = puts.filter((p) => {
        const key = spot ? classifyTranche(p.strike / spot, instrument) : null;
        return key === tranche.def.key;
      });
      const items: GridItem[] =
        tranchePuts.length > 0
          ? tranchePuts.map((pos) => ({ type: "real", pos }))
          : [{ type: "empty", tranche }];
      groups.push({ tranche, items });
    }
    for (const pos of puts) {
      const key = spot ? classifyTranche(pos.strike / spot, instrument) : null;
      if (!plan.some((t) => t.def.key === key)) unclassified.push(pos);
    }
  }

  const hasContent = groups.length > 0 || puts.length > 0;

  return (
    <Stack gap="md">
      <Text tt="uppercase" fw={600} style={CARD_LABEL_STYLE}>
        Open hedge puts
      </Text>

      {!hasContent && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="gray"
          radius={CARD_RADIUS}
        >
          No open long put positions found. Buy protective puts through your
          broker and they will appear here.
        </Alert>
      )}

      {/* Grouped by tranche when plan is available */}
      {groups.map(({ tranche, items }) => {
        const monthlyBudget = tranche.annualBudget / 12;
        const spent = monthlySpend.get(tranche.def.key) ?? 0;
        const spentPct =
          monthlyBudget > 0 ? Math.min(100, (spent / monthlyBudget) * 100) : 0;
        const remaining = Math.max(0, monthlyBudget - spent);
        const over = spent > monthlyBudget;  // used for badge/text below
        const barColor = tranche.def.color;

        return (
          <Box key={tranche.def.key}>
            <Paper
              radius={CARD_RADIUS}
              p="md"
              style={{
                background: `color-mix(in srgb, var(--mantine-color-${tranche.def.color}-9) 12%, var(--mantine-color-dark-8))`,
                borderLeft: `3px solid var(--mantine-color-${tranche.def.color}-7)`,
              }}
            >
              <Group
                justify="space-between"
                align="flex-start"
                mb={6}
                wrap="wrap"
                gap="xs"
              >
                <Group gap="xs" align="center">
                  <Badge color={tranche.def.color} variant="light" size="sm">
                    {tranche.def.label}
                  </Badge>
                  <Tooltip label={tranche.def.desc} withArrow multiline w={220}>
                    <Text size="xs" c="dimmed" style={{ cursor: "help" }}>
                      {tranche.def.desc}
                    </Text>
                  </Tooltip>
                </Group>
                <Group gap={6} align="baseline">
                  <Text size="xs" fw={600} c={over ? "red.4" : "dimmed"}>
                    {fmtMoney(spent)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    of {fmtMoney(monthlyBudget)}/mo
                  </Text>
                  {over ? (
                    <Badge color="red" variant="light" size="xs">
                      over
                    </Badge>
                  ) : remaining < monthlyBudget * 0.15 ? (
                    <Badge color="yellow" variant="light" size="xs">
                      {fmtMoney(remaining)} left
                    </Badge>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {fmtMoney(remaining)} left
                    </Text>
                  )}
                </Group>
              </Group>
              <Progress
                value={spentPct}
                color={barColor}
                size={3}
                radius="xl"
                mb="md"
                style={{ opacity: 0.4 }}
              />

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {items.map((item, i) =>
                  item.type === "real" ? (
                    <PutCard
                      key={i}
                      pos={item.pos}
                      instrument={instrument}
                      spot={spot}
                    />
                  ) : (
                    <EmptyPutCard
                      key={i}
                      tranche={item.tranche}
                      instrument={instrument}
                      perBuy={item.tranche.annualBudget / buysPerYear}
                      cadenceLabel={cadenceLabel}
                    />
                  ),
                )}
              </SimpleGrid>
            </Paper>
          </Box>
        );
      })}

      {/* Positions that don't match any plan tranche (e.g. old strikes) */}
      {unclassified.length > 0 && (
        <Box>
          <Text size="xs" c="dimmed" mb="xs" style={CARD_LABEL_STYLE}>
            Other
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {unclassified.map((pos, i) => (
              <PutCard key={i} pos={pos} instrument={instrument} spot={spot} />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* No plan yet — just show flat list of real cards */}
      {!plan && puts.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {puts.map((pos, i) => (
            <PutCard key={i} pos={pos} instrument={instrument} spot={spot} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PutHedgePanel() {
  const color = useAccountColor();
  const { activeAccount, balances, allOptionPositions, filledOptionOrders } =
    useApp();

  // Live market data — load on mount for instant recommendations
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);

  useEffect(() => {
    fetch("/api/put-hedge")
      .then((r) => r.json())
      .then((d: MarketData) => {
        if (!d.error) setMarket(d);
      })
      .catch(() => {})
      .finally(() => setMarketLoading(false));
  }, []);

  // The hedge is bought as TQQQ puts (smaller units that fit a weekly budget;
  // priced off the Black-Scholes model at ~3× index IV).
  const instrument: HedgeInstrument = "TQQQ";

  // Long TQQQ put positions across every account.
  const hedgePuts = useMemo(
    () =>
      allOptionPositions.filter(
        (p) =>
          p.underlyingSymbol === instrument &&
          p.putCall === "PUT" &&
          p.longQty > 0,
      ),
    [allOptionPositions],
  );

  // Recommendations are scoped to the account selected app-wide.
  const activeTqqqValue =
    balances.find((b) => b.accountNumber === activeAccount?.accountNumber)
      ?.tqqqValue ?? 0;
  const activePuts = useMemo(
    () =>
      hedgePuts.filter((p) => p.accountNumber === activeAccount?.accountNumber),
    [hedgePuts, activeAccount],
  );

  // Annual premium budget (% of TQQQ value) driving tranche sizing.
  const [budgetPct, setBudgetPct] = useState<number>(DEFAULT_BUDGET_PCT);
  // How often you buy clips — the per-buy budget is the annual budget / buysPerYear.
  const [buysPerYear, setBuysPerYear] = useState<number>(52);

  const spot = market?.tqqqPrice ?? null;
  const cadenceLabel = cadenceLabelOf(buysPerYear);

  const plan = useMemo(
    () =>
      spot !== null && activeTqqqValue > 0
        ? buildTranchePlan({
            tqqqValue: activeTqqqValue,
            spot,
            vxnPct: market?.vxnPct ?? null,
            annualBudgetPct: budgetPct / 100,
            instrument,
          })
        : null,
    [spot, activeTqqqValue, market?.vxnPct, budgetPct, instrument],
  );

  // Sum BUY_TO_OPEN put premiums paid per tranche in the current calendar month.
  const monthlySpend = useMemo(() => {
    const now = new Date();
    const spendMap = new Map<TrancheKey, number>();
    for (const order of filledOptionOrders) {
      if (order.instruction !== "BUY_TO_OPEN") continue;
      const d = new Date(order.time);
      if (
        d.getFullYear() !== now.getFullYear() ||
        d.getMonth() !== now.getMonth()
      )
        continue;
      const m = order.symbol.match(/(\d{6})([CP])(\d{8})$/);
      if (!m || m[2] !== "P") continue;
      const strike = parseInt(m[3], 10) / 1000;
      if (spot === null) continue;
      const key = classifyTranche(strike / spot, instrument);
      if (!key) continue;
      spendMap.set(key, (spendMap.get(key) ?? 0) + Math.abs(order.total));
    }
    return spendMap;
  }, [filledOptionOrders, spot, instrument]);

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>
          Put hedge
        </Text>
        <Text size="sm" c="dimmed">
          Laddered TQQQ-put overlay, tuned for buying dips — it spends on the
          long-bear (crash) and tail (catastrophe) legs rather than insuring the
          ordinary dips you buy. Each account gets a per-buy dollar budget per
          leg; go to your preferred DTE, buy what fits, and roll at{" "}
          {ROLL_AT_DTE} days. Monetize on spikes.
        </Text>
      </Box>

      {/* ── Per-account buy recommendations ── */}
      {marketLoading ? (
        <Center py="md">
          <Group gap="xs">
            <Loader size="xs" color={color} />
            <Text size="sm" c="dimmed">
              Loading market data…
            </Text>
          </Group>
        </Center>
      ) : spot === null ? (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
          radius={CARD_RADIUS}
        >
          Could not fetch the current {instrument} price. Reload to retry.
        </Alert>
      ) : (
        <>
          <Paper
            radius={CARD_RADIUS}
            p="sm"
            style={{
              background:
                "color-mix(in srgb, var(--mantine-color-dark-7) 60%, transparent)",
            }}
          >
            <Group justify="space-between" align="center" wrap="wrap" gap="sm">
              <Group gap={6} align="center">
                <Group gap="xs">
                  <Badge color="blue" variant="light" size="sm">
                    TQQQ ${spot.toFixed(2)}
                  </Badge>
                  {market?.vxnPct != null && (
                    <Badge color="grape" variant="light" size="sm">
                      ^VXN {market.vxnPct.toFixed(1)}%
                    </Badge>
                  )}
                  {market?.asOf && (
                    <Text size="xs" c="dimmed">
                      as of {fmtDate(market.asOf)}
                    </Text>
                  )}
                </Group>
                <Tooltip
                  label="TQQQ premiums are estimated with Black-Scholes at ~3× index IV — treat the ≈$/contract figures as a guide; your broker quote is the truth."
                  withArrow
                  multiline
                  w={250}
                >
                  <Badge color="gray" variant="dot" size="xs">
                    modeled
                  </Badge>
                </Tooltip>
              </Group>
              <Group gap="md" align="center">
                <Group gap="xs" align="center">
                  <Text size="xs" c="dimmed">
                    Buy every
                  </Text>
                  <SegmentedControl
                    size="xs"
                    value={String(buysPerYear)}
                    onChange={(v) => setBuysPerYear(Number(v))}
                    color={color}
                    data={CADENCES.map((c) => ({
                      label: c.short,
                      value: c.value,
                    }))}
                  />
                </Group>
                <Group gap="xs" align="center">
                  <Text size="xs" c="dimmed">
                    Budget
                  </Text>
                  <Tooltip
                    label="Annual premium you're willing to bleed, as a % of TQQQ value. Split 60/40 across the crash and catastrophe legs and divided into a per-buy dollar budget per leg."
                    withArrow
                    multiline
                    w={240}
                  >
                    <NumberInput
                      value={budgetPct}
                      onChange={(v) =>
                        setBudgetPct(
                          typeof v === "number" ? v : DEFAULT_BUDGET_PCT,
                        )
                      }
                      min={0.5}
                      max={8}
                      step={0.5}
                      suffix="%/yr"
                      size="xs"
                      w={110}
                      decimalScale={1}
                    />
                  </Tooltip>
                </Group>
              </Group>
            </Group>
          </Paper>
          {activeAccount && activeTqqqValue > 0 ? (
            <AccountRec
              account={activeAccount}
              tqqqValue={activeTqqqValue}
              instrument={instrument}
              spot={spot}
              vxnPct={market?.vxnPct ?? null}
              budgetPct={budgetPct}
              buysPerYear={buysPerYear}
              cadenceLabel={cadenceLabel}
              openHedgePuts={activePuts}
            />
          ) : (
            <Alert
              color="gray"
              icon={<IconInfoCircle size={16} />}
              radius={CARD_RADIUS}
            >
              No TQQQ holdings in {activeAccount?.accountName ?? "this account"}
              . Switch accounts to size a hedge.
            </Alert>
          )}
        </>
      )}

      {/* ── Open hedge puts with close/roll guidance ── */}
      <OpenHedgePuts
        puts={activePuts}
        instrument={instrument}
        spot={spot}
        plan={plan}
        buysPerYear={buysPerYear}
        cadenceLabel={cadenceLabel}
        monthlySpend={monthlySpend}
      />
    </Stack>
  );
}
