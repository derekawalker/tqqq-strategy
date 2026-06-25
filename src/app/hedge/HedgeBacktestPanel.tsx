"use client";

import { useState, useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Stack,
  Box,
  Text,
  Group,
  Paper,
  Button,
  Alert,
  Center,
  Loader,
  Tooltip,
  SimpleGrid,
  NumberInput,
  Table,
  Switch,
} from "@mantine/core";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ReferenceArea,
} from "recharts";
import { IconAlertTriangle, IconPlayerPlayFilled, IconInfoCircle } from "@tabler/icons-react";
import { useApp } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";

interface CurvePoint {
  date: string;
  withHedge: number;
  naked: number;
  putValue: number;
  netHedgeCash: number;
}

interface Stats {
  maxDrawdownNaked: number;
  maxDrawdownHedged: number;
  drawdownReduced: number;
  totalPremiumPaid: number;
  totalProceeds: number;
  netHedgeCost: number;
  netHedgeCostPct: number;
  peakPutValue: number;
  finalHedged: number;
  finalNaked: number;
  buys: number;
  sells: number;
}

interface BacktestResponse {
  span: { start: string; end: string; tradingDays: number };
  curve: CurvePoint[];
  stats: Stats;
}

interface CrisisPreset {
  label: string;
  desc: string;
  start: string;
  end: string;
}

const CRISES: CrisisPreset[] = [
  { label: "2018 Q4", desc: "Tech selloff — QQQ −23%, TQQQ −55%", start: "2018-09-01", end: "2019-03-31" },
  { label: "COVID crash", desc: "Feb–Mar 2020 — QQQ −28%, TQQQ −70% in 5 weeks", start: "2020-01-15", end: "2020-06-30" },
  { label: "2022 bear", desc: "Rate-hike cycle — QQQ −33%, TQQQ −79% over the year", start: "2022-01-01", end: "2022-12-31" },
  { label: "Full 2020", desc: "Crash + V-shaped recovery — does the hedge give it all back?", start: "2020-01-01", end: "2020-12-31" },
];

const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;
const usdSigned = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString()}`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

const tickFormatter = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

export default function HedgeBacktestPanel() {
  const color = useAccountColor();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { activeAccount, balances } = useApp();

  const activeTqqqValue =
    balances.find((b) => b.accountNumber === activeAccount?.accountNumber)?.tqqqValue ?? 0;

  const [tqqqValue, setTqqqValue] = useState<number>(activeTqqqValue > 0 ? Math.round(activeTqqqValue) : 300_000);
  const [budgetPct, setBudgetPct] = useState<number>(3);
  const [gateEnabled, setGateEnabled] = useState<boolean>(true);
  const [vxnGate, setVxnGate] = useState<number>(50);
  const [activeCrisis, setActiveCrisis] = useState<CrisisPreset>(CRISES[1]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  async function run(preset: CrisisPreset) {
    setActiveCrisis(preset);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hedge-backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: preset.start,
          endDate: preset.end,
          tqqqStartValue: tqqqValue,
          annualBudgetPct: budgetPct / 100,
          // Off → a threshold VXN never reaches, so buys never pause.
          vxnPauseThreshold: gateEnabled ? vxnGate : 999,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Backtest failed.");
        setResult(null);
      } else {
        setResult(data as BacktestResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // Normalize both curves to % of starting value for the chart.
  const chartData = useMemo(() => {
    if (!result || result.curve.length === 0) return [];
    const startNaked = result.curve[0].naked || 1;
    return result.curve.map((p) => ({
      date: p.date,
      Hedged: (p.withHedge / startNaked) * 100,
      Naked: (p.naked / startNaked) * 100,
      put: p.putValue,
    }));
  }, [result]);

  // Shade where the puts carried meaningful value (the protection kicked in).
  const protectionSpans = useMemo(() => {
    if (!result) return [];
    const spans: { x1: string; x2: string }[] = [];
    const threshold = result.stats.peakPutValue * 0.2;
    let start: string | null = null;
    for (const p of result.curve) {
      if (p.putValue >= threshold && threshold > 0) {
        if (!start) start = p.date;
      } else if (start) {
        spans.push({ x1: start, x2: p.date });
        start = null;
      }
    }
    if (start) spans.push({ x1: start, x2: result.curve[result.curve.length - 1].date });
    return spans;
  }, [result]);

  const s = result?.stats;

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>Hedge backtest</Text>
        <Text size="sm" c="dimmed">
          Replays the QQQ put overlay over real QQQ / TQQQ / ^VXN history and isolates what it
          would have done to a static TQQQ position — drawdown spared vs. premium bled. Puts are
          priced with Black-Scholes off ^VXN (QQQ&apos;s own vol index) with a skew term; the VXN
          spike in each selloff is what drives the payoff.
        </Text>
      </Box>

      {/* Inputs */}
      <Paper radius={CARD_RADIUS} p="md" withBorder>
        <Group align="flex-end" gap="md" wrap="wrap">
          <NumberInput
            label="TQQQ position hedged"
            value={tqqqValue}
            onChange={(v) => setTqqqValue(typeof v === "number" ? v : 300_000)}
            min={10_000} step={10_000} thousandSeparator="," prefix="$" size="sm" w={200}
          />
          <NumberInput
            label="Annual budget"
            value={budgetPct}
            onChange={(v) => setBudgetPct(typeof v === "number" ? v : 3)}
            min={0.5} max={8} step={0.5} suffix="%/yr" size="sm" w={140} decimalScale={1}
          />
          <Tooltip
            label="When on, the overlay stops buying while ^VXN is above this level (don't overpay for vol in a spike). Turning it off — or raising it — keeps buying through a slow bear like 2022, where VXN sits elevated the whole way down and the gate otherwise leaves you nearly unhedged."
            withArrow multiline w={280}
          >
            <Box>
              <Switch
                label="VXN buy gate"
                checked={gateEnabled}
                onChange={(e) => setGateEnabled(e.currentTarget.checked)}
                color={color}
                size="sm"
                mb={6}
              />
            </Box>
          </Tooltip>
          <NumberInput
            label="Pause above"
            value={vxnGate}
            onChange={(v) => setVxnGate(typeof v === "number" ? v : 25)}
            min={15} max={80} step={1} suffix="% VXN" size="sm" w={130}
            disabled={!gateEnabled}
          />
        </Group>

        <Group gap="xs" wrap="wrap" mt="md" align="center">
          <Text size="xs" c="dimmed">Replay (or re-run after changing inputs):</Text>
          {CRISES.map((c) => (
            <Tooltip key={c.label} label={c.desc} withArrow multiline w={240}>
              <Button
                size="xs"
                variant={activeCrisis.label === c.label ? "filled" : "light"}
                color={activeCrisis.label === c.label ? color : "gray"}
                leftSection={<IconPlayerPlayFilled size={12} />}
                onClick={() => run(c)}
                loading={loading && activeCrisis.label === c.label}
              >
                {c.label}
              </Button>
            </Tooltip>
          ))}
        </Group>
      </Paper>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          {error}
        </Alert>
      )}

      {loading && (
        <Center py="xl">
          <Group gap="xs">
            <Loader size="sm" color={color} />
            <Text c="dimmed">Pulling history &amp; replaying the overlay…</Text>
          </Group>
        </Center>
      )}

      {result && s && !loading && (
        <>
          {/* Verdict cards */}
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <VerdictCard
              label="Max drawdown"
              primary={pct1(s.maxDrawdownHedged)}
              secondary={`naked ${pct1(s.maxDrawdownNaked)}`}
              hint="Worst peak-to-trough on the hedged book vs. the unhedged TQQQ position."
              good={s.drawdownReduced > 0}
            />
            <VerdictCard
              label="Drawdown spared"
              primary={`${s.drawdownReduced >= 0 ? "+" : ""}${pct1(s.drawdownReduced)}`}
              secondary="hedged − naked"
              hint="How many points of drawdown the overlay removed. Positive = the hedge helped."
              good={s.drawdownReduced > 0}
            />
            <VerdictCard
              label="Net hedge cost"
              primary={usdSigned(-s.netHedgeCost)}
              secondary={pct1(-s.netHedgeCostPct) + " of position"}
              hint="Premium paid, less proceeds harvested and value still in open puts. Negative = the hedge cost you money over the window; positive = it more than paid for itself."
              good={s.netHedgeCost < 0}
            />
            <VerdictCard
              label="Peak put value"
              primary={usd(s.peakPutValue)}
              secondary={`${s.buys} buys · ${s.sells} sells`}
              hint="Largest mark the puts reached — the dry powder available to refill the dip-ladder at the bottom."
              good={s.peakPutValue > 0}
            />
          </SimpleGrid>

          {/* Equity chart */}
          <Paper radius={CARD_RADIUS} withBorder p="md">
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">% of starting value — hedged vs. naked TQQQ</Text>
              <Text size="xs" c="dimmed">
                {fmtDate(result.span.start)} → {fmtDate(result.span.end)} · {result.span.tradingDays} days
              </Text>
            </Group>
            <Box h={isMobile ? 260 : 340}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                  <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                  <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} fontSize={11} width={48} domain={["auto", "auto"]} />
                  <ChartTooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={({ active, label, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div style={{ background: "var(--mantine-color-dark-7)", padding: "8px 12px", borderRadius: 8, fontSize: 11 }}>
                          <div style={{ color: "var(--mantine-color-dimmed)", marginBottom: 4 }}>{fmtDate(String(label))}</div>
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {payload.map((e: any) => (
                            <div key={e.name} style={{ color: e.stroke ?? e.color }}>
                              {e.name}: {Number(e.value).toFixed(1)}%
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  {protectionSpans.map((sp, i) => (
                    <ReferenceArea key={i} x1={sp.x1} x2={sp.x2} fill="var(--mantine-color-teal-5)" fillOpacity={0.08} strokeOpacity={0} />
                  ))}
                  <Line type="monotone" dataKey="Hedged" name="Hedged" stroke="var(--mantine-color-teal-4)" dot={false} strokeWidth={1.75} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Naked" name="Naked TQQQ" stroke="var(--mantine-color-gray-5)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
            <Text size="9px" c="dimmed" mt={4}>
              Shaded = put overlay carried meaningful mark value (protection active).
            </Text>
          </Paper>

          {/* Detail stats */}
          <Paper radius={CARD_RADIUS} withBorder>
            <Table fz="sm" striped>
              <Table.Tbody>
                <DetailRow label="Premium paid (total)" value={usd(s.totalPremiumPaid)} />
                <DetailRow label="Proceeds harvested (monetize + roll)" value={usd(s.totalProceeds)} />
                <DetailRow label="Final equity — hedged" value={usd(s.finalHedged)} />
                <DetailRow label="Final equity — naked" value={usd(s.finalNaked)} />
                <DetailRow
                  label="Hedge net effect on final equity"
                  value={usdSigned(s.finalHedged - s.finalNaked)}
                  color={s.finalHedged >= s.finalNaked ? "teal.4" : "red.4"}
                />
              </Table.Tbody>
            </Table>
          </Paper>

          <Alert color="gray" icon={<IconInfoCircle size={16} />} radius={CARD_RADIUS}>
            <Text size="xs">
              Modeled, not historical option prices: premiums come from Black-Scholes at the VXN-implied
              vol of the day plus a linear skew — real deep-OTM puts can be richer still. Treat the
              drawdown-spared figure as directional, and remember a V-shaped recovery (try Full 2020)
              hands back unrealized put value if you don&apos;t monetize the spike.
            </Text>
          </Alert>
        </>
      )}
    </Stack>
  );
}

function VerdictCard({
  label, primary, secondary, hint, good,
}: {
  label: string; primary: string; secondary: string; hint: string; good: boolean;
}) {
  return (
    <Paper radius={CARD_RADIUS} p="md" withBorder>
      <Group gap={4} mb={2}>
        <Text size="9px" c="dimmed" tt="uppercase" style={CARD_LABEL_STYLE}>{label}</Text>
        <Tooltip label={hint} withArrow multiline w={230}>
          <IconInfoCircle size={11} style={{ cursor: "help", color: "var(--mantine-color-dimmed)" }} />
        </Tooltip>
      </Group>
      <Text fw={700} size="xl" c={good ? "teal.4" : "red.4"}>{primary}</Text>
      <Text size="xs" c="dimmed">{secondary}</Text>
    </Paper>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Table.Tr>
      <Table.Td c="dimmed">{label}</Table.Td>
      <Table.Td ta="right" fw={600} c={color}>{value}</Table.Td>
    </Table.Tr>
  );
}
