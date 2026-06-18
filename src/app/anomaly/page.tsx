"use client";

import { useState, useEffect, useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Paper,
  Stack,
  Text,
  Group,
  Box,
  Skeleton,
  SegmentedControl,
  Badge,
  Center,
  SimpleGrid,
  Accordion,
  List,
  Table,
} from "@mantine/core";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { CARD_RADIUS } from "@/lib/cardStyles";
import {
  CRASH_ENTER,
  CRASH_EXIT,
  BOOM_EUPHORIA_ENTER,
  type AnomalyPoint,
  type SignalKind,
} from "@/lib/anomaly";
import { backtest } from "@/lib/backtest";

interface AnomalyResponse {
  points: AnomalyPoint[];
  asOf: string | null;
  components: Record<string, string>;
}

const SIGNAL_META: Record<SignalKind, { label: string; color: string; action: string }> = {
  crash: { label: "Crash Risk", color: "red", action: "De-risk → rotate to T-bills / cash" },
  boom: { label: "Boom / Risk-On", color: "teal", action: "Add risk → leveraged equity exposure" },
  neutral: { label: "Neutral", color: "gray", action: "Hold benchmark allocation" },
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

/** Group consecutive non-neutral days into shaded spans for the price chart. */
function signalSpans(points: AnomalyPoint[]) {
  const spans: { kind: SignalKind; x1: string; x2: string }[] = [];
  let cur: { kind: SignalKind; x1: string; x2: string } | null = null;
  for (const p of points) {
    if (p.signal === "neutral") {
      if (cur) {
        spans.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur && cur.kind === p.signal) cur.x2 = p.date;
    else {
      if (cur) spans.push(cur);
      cur = { kind: p.signal, x1: p.date, x2: p.date };
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

export default function AnomalyPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [years, setYears] = useState("5");
  const [boomLev, setBoomLev] = useState("3"); // boom-state leverage for the backtest
  // Result is tagged with the `years` it was fetched for, so loading/error are
  // derived (no synchronous setState in the effect body).
  const [result, setResult] = useState<{ years: string; data: AnomalyResponse | null; error: string | null } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/anomaly?years=${years}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setResult({ years, data: null, error: d.error });
        else setResult({ years, data: d, error: null });
      })
      .catch((e) => !cancelled && setResult({ years, data: null, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [years]);

  const data = result?.years === years ? result.data : null;
  const error = result?.years === years ? result.error : null;
  const loading = !result || result.years !== years;

  // Only plot the warm-up-complete portion (where z-scores exist).
  const points = useMemo(() => (data?.points ?? []).filter((p) => p.composite != null), [data]);
  const spans = useMemo(() => signalSpans(points), [points]);
  const latest = points.at(-1) ?? null;
  const meta = SIGNAL_META[latest?.signal ?? "neutral"];

  const bt = useMemo(
    () =>
      points.length > 1
        ? backtest(points, { boomLeverage: Number(boomLev), neutralLeverage: 1, crashLeverage: 0 })
        : null,
    [points, boomLev],
  );

  const spxDomain = useMemo((): [number, number] => {
    if (points.length === 0) return [0, 100];
    const v = points.map((p) => p.spx);
    const min = Math.min(...v);
    const max = Math.max(...v);
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }, [points]);

  const tickFormatter = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">
          Anomaly Radar
        </Text>
        <SegmentedControl
          size="xs"
          value={years}
          onChange={setYears}
          data={[
            { label: "3Y", value: "3" },
            { label: "5Y", value: "5" },
            { label: "10Y", value: "10" },
            { label: "Max", value: "14" },
          ]}
        />
      </Group>

      <Text size="sm" c="dimmed">
        Systemic Fragility &amp; Euphoria Composite (SFEC) — a causal, multi-factor z-score blend of
        volatility term structure, credit, bond vol, breadth, trend and cross-asset momentum.
      </Text>

      {error && (
        <Paper p="md" radius={CARD_RADIUS} bg="red.9">
          <Text c="white">Failed to load data: {error}</Text>
        </Paper>
      )}

      {loading ? (
        <Skeleton height={460} radius={CARD_RADIUS} />
      ) : latest ? (
        <>
          {/* Status banner */}
          <Paper p="lg" radius={CARD_RADIUS} withBorder>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase">
                  Signal · {latest.date && fmtDate(latest.date)}
                </Text>
                <Badge color={meta.color} size="lg" variant="filled">
                  {meta.label}
                </Badge>
                <Text size="xs" c="dimmed">
                  {meta.action}
                </Text>
              </Stack>
              <Stat label="Composite" value={latest.composite} color={latest.composite! >= 0 ? "teal" : "red"} />
              <Stat label="Fragility" value={latest.fragility} color="red" />
              <Stat label="Euphoria" value={latest.euphoria} color="teal" />
            </SimpleGrid>
          </Paper>

          {/* Price chart with signal shading */}
          <Paper p="md" radius={CARD_RADIUS} withBorder>
            <Text size="sm" fw={600} mb="xs">
              S&amp;P 500 with signal regimes
            </Text>
            <Box h={isMobile ? 220 : 280}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="spxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--mantine-color-blue-4)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--mantine-color-blue-4)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                  <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                  <YAxis domain={spxDomain} tickFormatter={(v) => Math.round(v).toString()} fontSize={11} width={48} />
                  <Tooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v) => [Math.round(Number(v)).toLocaleString(), "S&P 500"]}
                    contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                  />
                  {spans.map((s, i) => (
                    <ReferenceArea
                      key={i}
                      x1={s.x1}
                      x2={s.x2}
                      fill={s.kind === "crash" ? "var(--mantine-color-red-6)" : "var(--mantine-color-teal-6)"}
                      fillOpacity={0.15}
                    />
                  ))}
                  <Area type="monotone" dataKey="spx" stroke="var(--mantine-color-blue-4)" strokeWidth={1.5} fill="url(#spxGrad)" />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          {/* Oscillator chart */}
          <Paper p="md" radius={CARD_RADIUS} withBorder>
            <Text size="sm" fw={600} mb="xs">
              Composite oscillator (z-units)
            </Text>
            <Box h={isMobile ? 220 : 280}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--mantine-color-teal-5)" stopOpacity={0.6} />
                      <stop offset="50%" stopColor="var(--mantine-color-teal-5)" stopOpacity={0.05} />
                      <stop offset="100%" stopColor="var(--mantine-color-red-5)" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                  <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                  <YAxis domain={[-4, 4]} fontSize={11} width={48} />
                  <Tooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v, name) => [Number(v).toFixed(2), name]}
                    contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                  />
                  <ReferenceLine y={0} stroke="var(--mantine-color-gray-6)" />
                  <ReferenceLine
                    y={BOOM_EUPHORIA_ENTER}
                    stroke="var(--mantine-color-teal-5)"
                    strokeDasharray="4 4"
                    label={{ value: "boom", fontSize: 10, fill: "var(--mantine-color-teal-4)", position: "insideTopRight" }}
                  />
                  <ReferenceLine
                    y={-CRASH_ENTER}
                    stroke="var(--mantine-color-red-5)"
                    strokeDasharray="4 4"
                    label={{ value: "crash", fontSize: 10, fill: "var(--mantine-color-red-4)", position: "insideBottomRight" }}
                  />
                  <Area type="monotone" dataKey="composite" name="Composite" stroke="var(--mantine-color-gray-3)" strokeWidth={1.5} fill="url(#compGrad)" />
                  <Line type="monotone" dataKey="fragility" name="Fragility" stroke="var(--mantine-color-red-5)" dot={false} strokeWidth={1} />
                  <Line type="monotone" dataKey="euphoria" name="Euphoria" stroke="var(--mantine-color-teal-5)" dot={false} strokeWidth={1} />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
            <Text size="xs" c="dimmed" mt={4}>
              Crash arms at fragility ≥ {CRASH_ENTER} (stands down below {CRASH_EXIT}); boom arms at euphoria ≥{" "}
              {BOOM_EUPHORIA_ENTER}. Both require {2}-day confirmation.
            </Text>
          </Paper>

          {/* Backtest: strategy P&L + leading-indicator event study */}
          {bt && (
            <Paper p="md" radius={CARD_RADIUS} withBorder>
              <Group justify="space-between" align="center" mb="xs">
                <Text size="sm" fw={600}>
                  Backtest &amp; validation
                </Text>
                <Group gap="xs" align="center">
                  <Text size="xs" c="dimmed">
                    Boom leverage
                  </Text>
                  <SegmentedControl
                    size="xs"
                    value={boomLev}
                    onChange={setBoomLev}
                    data={[
                      { label: "1×", value: "1" },
                      { label: "2×", value: "2" },
                      { label: "3×", value: "3" },
                    ]}
                  />
                </Group>
              </Group>

              {/* Equity curve: strategy vs buy & hold (growth of $1) */}
              <Box h={isMobile ? 200 : 260}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={bt.equity} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                    <YAxis tickFormatter={(v) => `${v.toFixed(1)}×`} fontSize={11} width={40} />
                    <Tooltip
                      labelFormatter={(l) => fmtDate(String(l))}
                      formatter={(v, name) => [`${Number(v).toFixed(2)}×`, name]}
                      contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="benchmark" name="Buy & Hold" stroke="var(--mantine-color-gray-5)" dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="strategy" name="Signal Strategy" stroke="var(--mantine-color-violet-4)" dot={false} strokeWidth={1.5} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>

              {/* Risk-adjusted metrics */}
              <Table mt="md" fz="xs" withRowBorders={false} verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Metric</Table.Th>
                    <Table.Th ta="right">Signal Strategy</Table.Th>
                    <Table.Th ta="right">Buy &amp; Hold</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <MetricRow label="Total return" a={bt.strategy.totalReturn} b={bt.benchmark.totalReturn} pct />
                  <MetricRow label="CAGR" a={bt.strategy.cagr} b={bt.benchmark.cagr} pct />
                  <MetricRow label="Annual volatility" a={bt.strategy.annVol} b={bt.benchmark.annVol} pct lowerBetter />
                  <MetricRow label="Max drawdown" a={bt.strategy.maxDrawdown} b={bt.benchmark.maxDrawdown} pct higherBetter />
                  <MetricRow label="Sharpe" a={bt.strategy.sharpe} b={bt.benchmark.sharpe} />
                  <MetricRow label="Sortino" a={bt.strategy.sortino} b={bt.benchmark.sortino} />
                  <MetricRow label="Calmar" a={bt.strategy.calmar} b={bt.benchmark.calmar} />
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt={4}>
                Strategy: crash → cash (earns the 13-week T-bill yield), boom → {boomLev}× equity, neutral → benchmark.
                Positions use the prior day&apos;s signal (1-day execution lag), ignoring fees, slippage and leveraged-ETF
                decay.
              </Text>

              {/* Leading-indicator event study */}
              <Text size="sm" fw={600} mt="lg" mb={4}>
                Is it a leading indicator? — forward S&amp;P 500 returns by signal
              </Text>
              <Table fz="xs" withTableBorder verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Horizon</Table.Th>
                    <Table.Th ta="right" c="red.4">
                      After crash
                    </Table.Th>
                    <Table.Th ta="right" c="teal.4">
                      After boom
                    </Table.Th>
                    <Table.Th ta="right">Neutral</Table.Th>
                    <Table.Th ta="right">All days</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {bt.forward.map((f) => (
                    <Table.Tr key={f.horizon}>
                      <Table.Td>{f.horizon === 5 ? "1 week" : f.horizon === 21 ? "1 month" : f.horizon === 63 ? "3 months" : `${f.horizon}d`}</Table.Td>
                      <Table.Td ta="right">
                        {fmtPct(f.crash)}
                        {f.crashHitRate != null && (
                          <Text span c="dimmed" size="10px">
                            {" "}
                            ({Math.round(f.crashHitRate * 100)}% ↓)
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        {fmtPct(f.boom)}
                        {f.boomHitRate != null && (
                          <Text span c="dimmed" size="10px">
                            {" "}
                            ({Math.round(f.boomHitRate * 100)}% ↑)
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {fmtPct(f.neutral)}
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {fmtPct(f.all)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt={4}>
                Mean forward return of the S&amp;P 500 starting on days in each signal state ({bt.signalDays.crash} crash /{" "}
                {bt.signalDays.boom} boom / {bt.signalDays.neutral} neutral days). The “↓”/“↑” figures are the share of
                crash/boom days actually followed by a decline/gain. A genuine crash lead-indicator would show
                <Text span c="red.4">
                  {" "}
                  negative
                </Text>{" "}
                returns after crash signals; if “after crash” is positive and above the baseline, the signal is
                coincident/contrarian (firing near capitulation lows) rather than leading.
              </Text>
            </Paper>
          )}

          {/* Methodology */}
          <Accordion variant="separated" radius={CARD_RADIUS}>
            <Accordion.Item value="method">
              <Accordion.Control>
                <Text size="sm" fw={600}>
                  How it works &amp; data sources
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Text size="sm" fw={600} c="red.4">
                    Fragility (crash) factors
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>VIX term structure — ^VIX / ^VIX3M (backwardation = near-term panic)</List.Item>
                    <List.Item>Credit stress — falling HYG / LQD ratio</List.Item>
                    <List.Item>Bond volatility — ^MOVE level</List.Item>
                    <List.Item>Equity realized volatility — 20-day ^GSPC</List.Item>
                    <List.Item>Drawdown from the trailing 1-year high</List.Item>
                  </List>
                  <Text size="sm" fw={600} c="teal.4">
                    Euphoria (boom) factors
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>Extension above the 200-day moving average</List.Item>
                    <List.Item>Trend quality — 60-day return ÷ volatility</List.Item>
                    <List.Item>Copper / Gold momentum (CPER / GLD)</List.Item>
                    <List.Item>Stocks-vs-bonds momentum (^GSPC / TLT)</List.Item>
                    <List.Item>RSI(14) distance from neutral</List.Item>
                  </List>
                  <Text size="sm" c="dimmed">
                    Each raw factor is converted to a trailing 252-day z-score (no look-ahead), then
                    equal-weight averaged into the two sub-indices. Composite = euphoria − fragility. A
                    confirmation + hysteresis state machine turns the scores into crash / boom / neutral
                    regimes. All inputs come from free Yahoo Finance daily data.
                  </Text>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      ) : (
        <Center h={300}>
          <Text c="dimmed">No data.</Text>
        </Center>
      )}
    </Stack>
  );
}

function Stat({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="xl" fw={700} c={`${color}.4`}>
        {value == null ? "—" : value.toFixed(2)}
      </Text>
    </Stack>
  );
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

/** One row of the strategy-vs-benchmark metrics table; winner is highlighted. */
function MetricRow({
  label,
  a,
  b,
  pct,
  higherBetter = true,
  lowerBetter = false,
}: {
  label: string;
  a: number;
  b: number;
  pct?: boolean;
  higherBetter?: boolean;
  lowerBetter?: boolean;
}) {
  const fmt = (x: number) => (pct ? `${(x * 100).toFixed(1)}%` : x.toFixed(2));
  const aWins = lowerBetter ? a < b : higherBetter ? a > b : false;
  const win = "var(--mantine-color-teal-4)";
  return (
    <Table.Tr>
      <Table.Td>{label}</Table.Td>
      <Table.Td ta="right" c={aWins ? win : undefined} fw={aWins ? 700 : undefined}>
        {fmt(a)}
      </Table.Td>
      <Table.Td ta="right" c={!aWins ? win : undefined} fw={!aWins ? 700 : undefined}>
        {fmt(b)}
      </Table.Td>
    </Table.Tr>
  );
}
