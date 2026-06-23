"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import {
  Stack,
  Box,
  Text,
  Group,
  Button,
  SegmentedControl,
  SimpleGrid,
  Paper,
  Table,
  ScrollArea,
  Alert,
  Center,
  Loader,
  Tooltip,
  Badge,
  ThemeIcon,
  NumberInput,
  CopyButton,
  ActionIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconInfoCircle,
  IconShield,
  IconShieldOff,
  IconPlayerPlayFilled,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
} from "recharts";
import { useApp, type Account } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";
import type { OptionPosition } from "@/lib/schwab/parse";
import {
  TRANCHES,
  HEDGE_DTE,
  ROLL_AT_DTE,
  buildTranchePlan,
  classifyTranche,
  planAnnualCost,
  type TrancheKey,
  type ChainResolver,
} from "@/lib/hedgeTranches";
import { occSymbol, humanContract } from "@/lib/optionSymbol";

const DEFAULT_BUDGET_PCT = 2; // annual premium budget, % of TQQQ value

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysUntil(expiry: string): number {
  const ms = new Date(expiry + "T23:59:59").getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Nearest 3rd-Friday monthly expiry at least `minDays` calendar days out. */
function nextMonthlyExpiry(minDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + minDays);
  for (let attempt = 0; attempt < 3; attempt++) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const firstFri = 1 + ((5 - firstDow + 7) % 7);
    const thirdFri = new Date(year, month, firstFri + 14);
    if (thirdFri > d) return thirdFri.toISOString().slice(0, 10);
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
  }
  const fb = new Date();
  fb.setDate(fb.getDate() + minDays);
  return fb.toISOString().slice(0, 10);
}

const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtUsd = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
    return { action: "expiring", label: `Expires in ${dte}d — roll immediately`, color: "red" };
  if (gainPct >= 0.5)
    return { action: "close-profit", label: `+${fmtPct(gainPct)} gain — take profit & re-enter`, color: "teal" };
  if (currentQqq !== null && currentQqq < pos.strike * 0.9)
    return { action: "close-profit", label: "Deeply ITM — harvest profit, reset hedge", color: "teal" };
  if (dte <= 21)
    return { action: "roll-soon", label: `${dte}d left — prepare to roll`, color: "yellow" };
  return { action: "hold", label: `${dte}d left — hold`, color: "dimmed" };
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface MarketData {
  qqqPrice: number | null;
  vxnPct: number | null;
  asOf: string | null;
  error?: string;
}

interface ChainQuote {
  strike: number;
  mark: number;
  iv: number | null;
}

interface ChainData {
  connected: boolean;
  expiry: string | null;
  asOf?: string;
  quotes: ChainQuote[];
  error?: string;
}

interface PutHedgeParams {
  moneyness: number;
  dteDays: number;
  rollEveryDays?: number | null;
  coverageRatio: number;
}

interface ResultRow {
  params: PutHedgeParams;
  hedgedMaxDD: number;
  unhedgedMaxDD: number;
  hedgedCagr: number;
  unhedgedCagr: number;
  annualBleed: number;
  ddReduction: number;
  premiumPerYear: number;
  efficiency: number | null;
  protectionPerPremium: number | null;
}

interface FullResult extends ResultRow {
  equity: { date: string; hedged: number; unhedged: number }[];
}

interface LadderResult {
  equity: { date: string; hedged: number; unhedged: number }[];
  hedgedMaxDD: number;
  unhedgedMaxDD: number;
  ddReduction: number;
  annualBleed: number;
  premiumPerYear: number;
  hedgedCagr: number;
}

interface SweepResponse {
  putUnderlying: "QQQ" | "TQQQ";
  span: { start: string; end: string };
  currentMarket?: MarketData;
  unhedged: { cagr: number; maxDD: number };
  recommended?: LadderResult;
  best?: FullResult;
  table?: ResultRow[];
  result?: FullResult;
  error?: string;
}

/** Human label for the recommended ladder, built from the active tranches. */
const LADDER_LABEL = TRANCHES.filter((t) => t.budgetShare > 0)
  .map((t) => `${Math.round((1 - t.moneyness) * 100)}% OTM`)
  .join(" + ");

const fmtEff = (x: number | null) => (x === null || !isFinite(x) ? "∞" : x.toFixed(2));
const fmtRoll = (r?: number | null) => (r == null ? "exp" : `${r}d`);
const otmLabel = (m: number) => `${Math.round((1 - m) * 100)}% OTM`;

/** One-sentence plain-English readout of a backtested configuration. */
function describeConfig(
  c: FullResult,
  unhedgedMaxDD: number,
  instrument: "QQQ" | "TQQQ",
): string {
  const p = c.params;
  const roll = p.rollEveryDays == null ? "held to expiry" : `rolled every ${p.rollEveryDays} days`;
  const buy = `${instrument} puts ${otmLabel(p.moneyness)}, ${p.dteDays} days out, ${roll}, sized ${p.coverageRatio}×`;
  const cut = `cut the worst drop from ${fmtPct(unhedgedMaxDD)} to ${fmtPct(c.hedgedMaxDD)}`;
  const cost =
    c.annualBleed > 0
      ? `cost about ${fmtPct(c.annualBleed)}/yr in returns`
      : `actually added about ${fmtPct(-c.annualBleed)}/yr over this stretch`;
  return `Buy ${buy}. Over this window it ${cut} — and ${cost}.`;
}

/** Header cell with a hover explanation. */
function HeadCell({ label, tip, right }: { label: string; tip: string; right?: boolean }) {
  return (
    <Table.Th ta={right ? "right" : undefined}>
      <Tooltip label={tip} withArrow multiline w={230}>
        <Text span fz="xs" fw={600} style={{ cursor: "help", borderBottom: "1px dotted currentColor" }}>
          {label}
        </Text>
      </Tooltip>
    </Table.Th>
  );
}

// ---------------------------------------------------------------------------
// Per-account recommendation card
// ---------------------------------------------------------------------------

function AccountRec({
  account,
  tqqqValue,
  qqqPrice,
  vxnPct,
  budgetPct,
  openHedgePuts,
  resolver,
  liveExpiry,
}: {
  account: Account;
  tqqqValue: number;
  qqqPrice: number;
  vxnPct: number | null;
  budgetPct: number;
  openHedgePuts: OptionPosition[];
  resolver?: ChainResolver;
  liveExpiry?: string | null;
}) {
  const plan = buildTranchePlan({
    tqqqValue,
    qqqPrice,
    vxnPct,
    annualBudgetPct: budgetPct / 100,
    resolver,
  });
  const anyLive = plan.some((t) => t.live);
  // Live marks carry their own expiry; otherwise target the nearest monthly ≥55d out.
  const expiry = anyLive && liveExpiry ? liveExpiry : nextMonthlyExpiry(HEDGE_DTE - 5);

  // Open contracts currently held in each tranche, by moneyness of the strike.
  const openByTranche = new Map<TrancheKey, number>();
  for (const p of openHedgePuts) {
    const key = classifyTranche(p.strike / qqqPrice);
    if (key) openByTranche.set(key, (openByTranche.get(key) ?? 0) + p.longQty);
  }

  // Per-tranche display rows + the exact contract to buy.
  const rows = plan.map((t) => {
    const open = openByTranche.get(t.def.key) ?? 0;
    const buyNow = Math.min(t.weeklyContracts, Math.max(0, t.targetContracts - open));
    return {
      t,
      open,
      buyNow,
      otmPct: Math.round((1 - t.def.moneyness) * 100),
      human: humanContract("QQQ", expiry, "P", t.strike),
      occ: occSymbol("QQQ", expiry, "P", t.strike),
    };
  });
  const orders = rows.filter((r) => r.buyNow > 0);

  const targetTotal = plan.reduce((s, t) => s + t.targetContracts, 0);
  const openTotal = [...openByTranche.values()].reduce((s, n) => s + n, 0);
  const isHedged = targetTotal > 0 && openTotal >= Math.ceil(targetTotal * 0.75);
  const soonExpiring = openHedgePuts.some((p) => daysUntil(p.expiry) <= ROLL_AT_DTE);
  const annualCost = planAnnualCost(plan);

  return (
    <Paper withBorder radius={CARD_RADIUS} p="md">
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color={isHedged ? "teal" : "red"} radius="xl">
            {isHedged ? <IconShield size={12} /> : <IconShieldOff size={12} />}
          </ThemeIcon>
          <Box>
            <Text size="sm" fw={600} lineClamp={1}>{account.accountName}</Text>
            <Text size="xs" c="dimmed">{fmtUsd(tqqqValue)} TQQQ</Text>
          </Box>
        </Group>
        <Badge color={isHedged ? "teal" : "red"} variant="light" size="sm">
          {openTotal > 0 ? `${openTotal} / ${targetTotal}` : "unhedged"}
        </Badge>
      </Group>

      {soonExpiring && (
        <Text size="xs" c="yellow.4" mb="xs">
          A position is within {ROLL_AT_DTE}d of expiry — roll it to the next monthly.
        </Text>
      )}

      <Table fz="xs" verticalSpacing={4} withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tranche</Table.Th>
            <Table.Th ta="right">Strike</Table.Th>
            <Table.Th ta="right">Open</Table.Th>
            <Table.Th ta="right">Target</Table.Th>
            <Table.Th ta="right">Buy now</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ t, open, buyNow, otmPct }) => (
            <Table.Tr key={t.def.key}>
              <Table.Td>
                <Tooltip label={t.def.desc} withArrow multiline w={200}>
                  <Text size="xs" c={`${t.def.color}.4`} fw={600} span>{t.def.label}</Text>
                </Tooltip>
                <Text size="9px" c="dimmed">{otmPct}% OTM</Text>
              </Table.Td>
              <Table.Td ta="right">${t.strike}</Table.Td>
              <Table.Td ta="right" c={open > 0 ? undefined : "dimmed"}>{open}</Table.Td>
              <Table.Td ta="right">{t.targetContracts}</Table.Td>
              <Table.Td ta="right" fw={700} c={buyNow > 0 ? `${t.def.color}.4` : "dimmed"}>
                {buyNow > 0 ? `+${buyNow}` : open >= t.targetContracts ? "✓" : "—"}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {orders.length > 0 && (
        <Box mt="sm">
          <Text size="xs" fw={600} mb={4}>This week&apos;s orders</Text>
          <Stack gap={4}>
            {orders.map(({ t, buyNow, human, occ }) => (
              <Group key={t.def.key} gap={6} wrap="nowrap" justify="space-between">
                <Text size="xs">
                  Buy <Text span fw={700} c={`${t.def.color}.4`}>{buyNow}×</Text> {human}
                </Text>
                <Group gap={4} wrap="nowrap">
                  <Text size="9px" c="dimmed" ff="monospace">{occ}</Text>
                  <CopyButton value={occ}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? "Copied" : "Copy OCC symbol"} withArrow>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color={copied ? "teal" : "gray"}
                          onClick={copy}
                        >
                          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </CopyButton>
                </Group>
              </Group>
            ))}
          </Stack>
        </Box>
      )}

      <Text size="9px" c="dimmed" mt={6}>
        Same day each week · {HEDGE_DTE} DTE · exp {fmtDate(expiry)} · roll at {ROLL_AT_DTE}d ·
        {anyLive ? " live marks · " : " modeled · "}
        est. carry ~{fmtUsd(annualCost)}/yr ({((annualCost / Math.max(tqqqValue, 1)) * 100).toFixed(1)}%)
      </Text>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Open hedge puts table
// ---------------------------------------------------------------------------

function OpenHedgePuts({
  puts,
  qqqPrice,
}: {
  puts: OptionPosition[];
  qqqPrice: number | null;
}) {
  if (puts.length === 0) {
    return (
      <Alert icon={<IconInfoCircle size={16} />} color="gray" radius={CARD_RADIUS}>
        No open long put positions found. Buy protective puts through your broker and they will appear here.
      </Alert>
    );
  }

  return (
    <Paper withBorder radius={CARD_RADIUS} p="md">
      <Text size="sm" fw={600} mb="xs">Open hedge puts</Text>
      <ScrollArea>
        <Table fz="xs" verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Account</Table.Th>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Tranche</Table.Th>
              <Table.Th ta="right">Strike</Table.Th>
              <Table.Th>Expiry</Table.Th>
              <Table.Th ta="right">DTE</Table.Th>
              <Table.Th ta="right">Qty</Table.Th>
              <Table.Th ta="right">Cost</Table.Th>
              <Table.Th ta="right">Value</Table.Th>
              <Table.Th ta="right">P&amp;L</Table.Th>
              <Table.Th>Recommendation</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {puts.map((pos, i) => {
              const dte = daysUntil(pos.expiry);
              const costTotal = Math.abs(pos.averagePrice) * pos.longQty * 100;
              const currentValue = pos.marketValue;
              const pnl = currentValue - costTotal;
              const rec = closeRec(pos, qqqPrice);
              const trKey = qqqPrice ? classifyTranche(pos.strike / qqqPrice) : null;
              const tr = trKey ? TRANCHES.find((t) => t.key === trKey) : null;
              return (
                <Table.Tr key={i}>
                  <Table.Td>{pos.accountNumber.slice(-4)}</Table.Td>
                  <Table.Td>{pos.symbol}</Table.Td>
                  <Table.Td>
                    {tr ? (
                      <Badge color={tr.color} variant="light" size="xs">{tr.label}</Badge>
                    ) : (
                      <Text size="xs" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">${pos.strike.toFixed(0)}</Table.Td>
                  <Table.Td>{fmtDate(pos.expiry)}</Table.Td>
                  <Table.Td ta="right" c={dte <= 5 ? "red" : dte <= 21 ? "yellow" : undefined}>
                    {dte}
                  </Table.Td>
                  <Table.Td ta="right">{pos.longQty}</Table.Td>
                  <Table.Td ta="right">${costTotal.toFixed(0)}</Table.Td>
                  <Table.Td ta="right">${currentValue.toFixed(0)}</Table.Td>
                  <Table.Td ta="right" c={pnl >= 0 ? "teal" : "red"}>
                    {pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={rec.color === "dimmed" ? "gray" : rec.color} variant="light" size="xs">
                      {rec.label}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PutHedgePanel() {
  const color = useAccountColor();
  const { activeAccount, balances, allOptionPositions } = useApp();

  // Live market data — load on mount for instant recommendations
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);

  useEffect(() => {
    fetch("/api/put-hedge")
      .then((r) => r.json())
      .then((d: MarketData) => { if (!d.error) setMarket(d); })
      .catch(() => {})
      .finally(() => setMarketLoading(false));
  }, []);

  // Live option chain (Schwab). Silently absent → tranche sizing uses the model.
  const [chain, setChain] = useState<ChainData | null>(null);

  useEffect(() => {
    fetch("/api/put-hedge/chain")
      .then((r) => r.json())
      .then((d: ChainData) => { if (d.connected && d.quotes?.length) setChain(d); })
      .catch(() => {});
  }, []);

  // Resolve a tranche's ideal strike to the nearest live, quotable contract.
  const resolver = useMemo<ChainResolver | undefined>(() => {
    const quotes = chain?.quotes;
    if (!quotes?.length) return undefined;
    return (ideal: number) => {
      let best: ChainQuote | null = null;
      let gap = Infinity;
      for (const q of quotes) {
        const g = Math.abs(q.strike - ideal);
        if (g < gap) { gap = g; best = q; }
      }
      return best ? { strike: best.strike, mark: best.mark, iv: best.iv } : null;
    };
  }, [chain]);

  // All long put positions across every account
  const hedgePuts = useMemo(
    () => allOptionPositions.filter((p) => p.putCall === "PUT" && p.longQty > 0),
    [allOptionPositions],
  );

  // Recommendations are scoped to the account selected app-wide.
  const activeTqqqValue =
    balances.find((b) => b.accountNumber === activeAccount?.accountNumber)?.tqqqValue ?? 0;
  const activePuts = useMemo(
    () => hedgePuts.filter((p) => p.accountNumber === activeAccount?.accountNumber),
    [hedgePuts, activeAccount],
  );

  // Annual premium budget (% of TQQQ value) driving tranche sizing.
  const [budgetPct, setBudgetPct] = useState<number>(DEFAULT_BUDGET_PCT);

  // Backtest sweep state
  const [years, setYears] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sweepData, setSweepData] = useState<SweepResponse | null>(null);
  const [curve, setCurve] = useState<FullResult | null>(null);
  // Headline shows the recommended ladder by default; a clicked sweep row
  // switches to that single config until "Recommended ladder" is clicked.
  const [showRec, setShowRec] = useState(true);

  const runSweep = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/put-hedge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ years: Number(years) }),
      });
      const json: SweepResponse = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
      setSweepData(json);
      setCurve(json.best ?? null);
      setShowRec(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
      setSweepData(null);
      setCurve(null);
    } finally {
      setLoading(false);
    }
  }, [years]);

  const selectRow = useCallback(
    async (params: PutHedgeParams) => {
      try {
        const res = await fetch("/api/put-hedge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ years: Number(years), params }),
        });
        const json: SweepResponse = await res.json();
        if (res.ok && json.result) { setCurve(json.result); setShowRec(false); }
      } catch { /* keep current */ }
    },
    [years],
  );

  const qqqPrice = market?.qqqPrice ?? sweepData?.currentMarket?.qqqPrice ?? null;

  // Headline reads from the recommended ladder by default, or the clicked config.
  const recLadder = sweepData?.recommended ?? null;
  const display = showRec && recLadder ? recLadder : curve;
  const isLadder = !!(showRec && recLadder);

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>Put hedge</Text>
        <Text size="sm" c="dimmed">
          Laddered QQQ-put overlay for TQQQ, tuned for buying dips — it spends on the long-bear
          (crash) and tail (catastrophe) legs rather than insuring the ordinary dips you buy.
          Sized for the selected account from your premium budget, capped by sane notional
          coverage. Buy the weekly clip, hold to a {ROLL_AT_DTE}-day roll, and monetize on spikes.
        </Text>
      </Box>

      {/* ── Per-account buy recommendations ── */}
      {marketLoading ? (
        <Center py="md">
          <Group gap="xs">
            <Loader size="xs" color={color} />
            <Text size="sm" c="dimmed">Loading market data…</Text>
          </Group>
        </Center>
      ) : qqqPrice === null ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          Could not fetch current QQQ price. Reload to retry.
        </Alert>
      ) : (
        <>
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
            <Group gap={6} align="center">
              <Text size="xs" c="dimmed">
                QQQ ${qqqPrice.toFixed(2)}{market?.vxnPct != null ? ` · ^VXN ${market.vxnPct.toFixed(1)}%` : ""}
                {market?.asOf ? ` · as of ${fmtDate(market.asOf)}` : ""}
              </Text>
              <Tooltip
                label={
                  resolver
                    ? "Premiums priced off live Schwab option marks."
                    : "Schwab not connected — premiums use the Black-Scholes model off ^VXN. Connect Schwab for live marks."
                }
                withArrow
                multiline
                w={240}
              >
                <Badge color={resolver ? "teal" : "gray"} variant="light" size="xs">
                  {resolver ? "live marks" : "modeled"}
                </Badge>
              </Tooltip>
            </Group>
            <Group gap="xs" align="center">
              <Text size="xs" c="dimmed">Premium budget</Text>
              <Tooltip
                label="Annual premium you're willing to bleed, as a % of TQQQ value. Split 60/40 across the crash and catastrophe tranches, then capped by each tranche's notional ceiling — so you may spend less than this."
                withArrow
                multiline
                w={240}
              >
                <NumberInput
                  value={budgetPct}
                  onChange={(v) => setBudgetPct(typeof v === "number" ? v : DEFAULT_BUDGET_PCT)}
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
          {activeAccount && activeTqqqValue > 0 ? (
            <AccountRec
              account={activeAccount}
              tqqqValue={activeTqqqValue}
              qqqPrice={qqqPrice}
              vxnPct={market?.vxnPct ?? sweepData?.currentMarket?.vxnPct ?? null}
              budgetPct={budgetPct}
              openHedgePuts={activePuts}
              resolver={resolver}
              liveExpiry={chain?.expiry ?? null}
            />
          ) : (
            <Alert color="gray" icon={<IconInfoCircle size={16} />} radius={CARD_RADIUS}>
              No TQQQ holdings in {activeAccount?.accountName ?? "this account"}. Switch accounts to
              size a hedge.
            </Alert>
          )}
        </>
      )}

      {/* ── Open hedge puts with close/roll guidance ── */}
      <OpenHedgePuts puts={activePuts} qqqPrice={qqqPrice} />

      {/* ── Parameter sweep ── */}
      <Box>
        <Text size="sm" fw={600} mb={4}>Parameter sweep</Text>
        <Text size="xs" c="dimmed" mb="md">
          Backtests QQQ-put hedges across strike depth / DTE / roll cadence / size and ranks them by
          drawdown avoided per dollar of annual premium. Click a row to chart that config.
        </Text>
        <Group gap="lg" align="flex-end" wrap="wrap">
          <Box>
            <Text size="xs" c="dimmed" mb={6}>Lookback</Text>
            <SegmentedControl
              value={years}
              onChange={setYears}
              color={color}
              data={[
                { label: "3y", value: "3" },
                { label: "5y", value: "5" },
                { label: "10y", value: "10" },
              ]}
            />
          </Box>
          <Button
            leftSection={<IconPlayerPlayFilled size={14} />}
            onClick={runSweep}
            loading={loading}
            color={color}
          >
            Run sweep
          </Button>
        </Group>
      </Box>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          {error}
        </Alert>
      )}

      {loading && !sweepData && (
        <Center py="xl">
          <Loader color={color} />
        </Center>
      )}

      {sweepData?.best && display && (
        <>
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600} c={isLadder ? color : undefined}>
              {isLadder
                ? `Recommended ladder · QQQ puts ${LADDER_LABEL} · ${HEDGE_DTE} DTE · roll ${ROLL_AT_DTE}d`
                : "Selected configuration"}
            </Text>
            {!isLadder && recLadder && (
              <Button size="xs" variant="subtle" color={color} onClick={() => setShowRec(true)}>
                ← Recommended ladder
              </Button>
            )}
          </Group>

          <Alert color={color} variant="light" icon={<IconInfoCircle size={16} />} radius={CARD_RADIUS}>
            <Text size="sm">
              {isLadder
                ? `Over this window the ladder cut the worst drop from ${fmtPct(sweepData.unhedged.maxDD)} to ${fmtPct(display.hedgedMaxDD)} — ${display.annualBleed > 0 ? `costing about ${fmtPct(display.annualBleed)}/yr in returns` : `actually adding about ${fmtPct(-display.annualBleed)}/yr over this stretch`}. Sized at the tranche coverage caps; click any row below to compare a single config.`
                : describeConfig(curve!, sweepData.unhedged.maxDD, sweepData.putUnderlying)}
            </Text>
          </Alert>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <Metric label="Worst drop, no hedge" value={fmtPct(sweepData.unhedged.maxDD)} />
            <Metric label="Worst drop, hedged" value={fmtPct(display.hedgedMaxDD)} accent={color} />
            <Metric label="Drop avoided" value={fmtPct(display.ddReduction)} accent={color} />
            <Metric label="Cost to returns / yr" value={fmtPct(display.annualBleed)} />
          </SimpleGrid>

          <Paper withBorder radius={CARD_RADIUS} p="md">
            <Text size="sm" fw={600} mb={4}>
              Hedged vs buy &amp; hold — growth of $1 ({fmtDate(sweepData.span.start)} →{" "}
              {fmtDate(sweepData.span.end)})
            </Text>
            <Box h={300}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={display.equity} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={48} />
                  <YAxis scale="log" domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={48} />
                  <ChartTooltip
                    formatter={(v) => `$${Number(v).toFixed(2)}`}
                    labelFormatter={(l) => fmtDate(String(l))}
                  />
                  <Line type="monotone" dataKey="unhedged" stroke="#888" dot={false} name="Buy & hold" />
                  <Line
                    type="monotone"
                    dataKey="hedged"
                    stroke={`var(--mantine-color-${color}-6)`}
                    dot={false}
                    name="Hedged"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          <Paper withBorder radius={CARD_RADIUS} p="md">
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>Ranked configurations</Text>
              <Text size="xs" c="dimmed">click a row to chart it</Text>
            </Group>
            <ScrollArea>
              <Table highlightOnHover striped withTableBorder verticalSpacing="xs" fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <HeadCell label="Strike" tip="How far below today's price the put strike sits. 15% OTM = strike 15% under spot. Deeper is cheaper but only pays in a bigger drop." />
                    <HeadCell label="Days out" tip="Days to expiration when you buy the put." />
                    <HeadCell label="Roll" tip="How often you replace the put. 'exp' means hold it all the way to expiration." />
                    <HeadCell label="Size" tip="How much protection you buy — QQQ notional as a multiple of your TQQQ. Higher = more cover and more cost." />
                    <HeadCell right label="Worst drop" tip="The worst peak-to-trough loss with this hedge on, over the backtest window. Closer to 0 is better." />
                    <HeadCell right label="Drop avoided" tip="How much shallower the worst drop became versus unhedged buy & hold." />
                    <HeadCell right label="Cost/yr" tip="Annual return given up to run the hedge. Negative means it added return over this path." />
                    <HeadCell right label="Premium/yr" tip="Cash spent on puts per year, as a % of the portfolio." />
                    <HeadCell right label="Score" tip="Protection score: drop avoided per 1% of return given up. Higher is better. ∞ = the hedge also added return on this path." />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sweepData.table?.map((r, i) => {
                    const active =
                      !showRec &&
                      curve?.params.moneyness === r.params.moneyness &&
                      curve?.params.dteDays === r.params.dteDays &&
                      curve?.params.rollEveryDays === r.params.rollEveryDays &&
                      curve?.params.coverageRatio === r.params.coverageRatio;
                    return (
                      <Table.Tr
                        key={i}
                        onClick={() => selectRow(r.params)}
                        style={{
                          cursor: "pointer",
                          background: active ? `var(--mantine-color-${color}-light)` : undefined,
                        }}
                      >
                        <Table.Td>{otmLabel(r.params.moneyness)}</Table.Td>
                        <Table.Td>{r.params.dteDays}d</Table.Td>
                        <Table.Td>{fmtRoll(r.params.rollEveryDays)}</Table.Td>
                        <Table.Td>{r.params.coverageRatio}×</Table.Td>
                        <Table.Td ta="right">{fmtPct(r.hedgedMaxDD)}</Table.Td>
                        <Table.Td ta="right">{fmtPct(r.ddReduction)}</Table.Td>
                        <Table.Td ta="right">{fmtPct(r.annualBleed)}</Table.Td>
                        <Table.Td ta="right">{fmtPct(r.premiumPerYear)}</Table.Td>
                        <Table.Td ta="right">{fmtEff(r.efficiency)}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          <Alert color="gray" icon={<IconInfoCircle size={16} />} radius={CARD_RADIUS}>
            <Text size="xs">
              This backtest always prices premiums with Black-Scholes off ^VXN — there is no
              historical option-chain data, so even when the buy recommendation above uses live
              Schwab marks, these results do not. VXN is 30-day index IV; pricing 60–90d puts ignores
              vol term structure, and TQQQ IV is a 3× proxy (real costs usually higher). A ∞ score
              means the hedge added return over this specific path — regime-dependent, not a guarantee.
            </Text>
          </Alert>
        </>
      )}
    </Stack>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Paper withBorder radius={CARD_RADIUS} p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="lg" fw={700} c={accent}>{value}</Text>
    </Paper>
  );
}
