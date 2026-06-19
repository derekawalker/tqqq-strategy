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
  ReferenceDot,
} from "recharts";
import { CARD_RADIUS } from "@/lib/cardStyles";
import {
  CRASH_ENTER,
  CRASH_EXIT,
  BOOM_EUPHORIA_ENTER,
  DEFAULT_PARAMS,
  type AnomalyPoint,
  type SignalKind,
} from "@/lib/anomaly";
import { backtest, strategyOptionsFor, tradeSignals, DEEP_BUY_Z, type StrategyMode } from "@/lib/backtest";
import { dailyAdvice, backtestAdvice, type AdvicePoint, type Stance } from "@/lib/advice";

interface AnomalyResponse {
  points: AnomalyPoint[];
  asOf: string | null;
  components: Record<string, string>;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

// --- Fear & Greed scale -----------------------------------------------------
// Map the composite (euphoria − fragility, ~[-5,+5]) onto a 0–100 meter:
// 0 = extreme fear (deep capitulation, a buy zone), 100 = extreme greed.
function greedScore(composite: number): number {
  return Math.max(0, Math.min(100, Math.round(50 + composite * 10)));
}
function greedLabel(score: number): string {
  if (score < 20) return "Extreme Fear";
  if (score < 40) return "Fear";
  if (score < 60) return "Neutral";
  if (score < 80) return "Greed";
  return "Extreme Greed";
}
function zoneColor(score: number): string {
  if (score < 20) return "red";
  if (score < 40) return "orange";
  if (score < 60) return "yellow";
  if (score < 80) return "lime";
  return "green";
}

function adviceHeadline(a: AdvicePoint): string {
  if (a.action === "get-out") return "GET OUT OF THE MARKET";
  if (a.action === "get-back-in") return "GET BACK IN";
  if (a.action === "reduce-risk") return "REDUCE RISK — CREDIT STRESS";
  if (a.action === "restore-risk") return "RESTORE FULL EQUITY";
  if (a.stance === "out") return "STAY OUT — HOLD CASH";
  return a.creditStress ? "HOLD REDUCED EQUITY" : "TRADE AS NORMAL";
}

const ACTION_LABEL: Record<AdvicePoint["action"], string> = {
  "normal": "—",
  "get-out": "Got out",
  "get-back-in": "Got back in",
  "reduce-risk": "Reduced risk",
  "restore-risk": "Restored equity",
};

/** Mantine color name for today's advice state. */
function adviceColor(a: AdvicePoint): string {
  if (a.action === "get-out") return "red";
  if (a.action === "get-back-in" || a.action === "restore-risk") return "teal";
  if (a.action === "reduce-risk") return "orange";
  if (a.stance === "out" || a.creditStress) return "orange";
  return "green";
}

/** Dark card tinted by the advice color, with gloss + shadow (matches useCardBg). */
function heroCardStyle(color: string) {
  const gloss = "linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 14%, rgba(255,255,255,0) 26%)";
  const base = `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${color}-8) 35%, var(--mantine-color-dark-8)) 0%, var(--mantine-color-dark-8) 100%)`;
  return {
    background: `${gloss}, ${base}`,
    boxShadow: "0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)",
    border: "none",
  };
}

/** Semicircular fear/greed gauge with a needle. score 0..100. */
function FearGreedGauge({ score, isMobile }: { score: number; isMobile: boolean }) {
  const w = isMobile ? 220 : 250;
  const cx = w / 2;
  const cy = w / 2;
  const r = w / 2 - 18;
  const band = 16;
  const polar = (deg: number, rad: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const arc = (a0: number, a1: number, rad: number): string => {
    const [x0, y0] = polar(a0, rad);
    const [x1, y1] = polar(a1, rad);
    return `M ${x0} ${y0} A ${rad} ${rad} 0 ${a1 - a0 <= 180 ? 0 : 1} 1 ${x1} ${y1}`;
  };
  const zones = ["red-6", "orange-6", "yellow-6", "lime-6", "green-6"];
  // score 0 -> 270° (left), 50 -> 360° (top), 100 -> 450°/90° (right)
  const needle = 270 + (score / 100) * 180;
  const [nx, ny] = polar(needle, r - band - 2);
  const height = cy + 30;
  const label = greedLabel(score);
  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Fear & Greed ${score}, ${label}`}>
      {zones.map((z, i) => (
        <path key={i} d={arc(270 + i * 36, 270 + (i + 1) * 36, r)} fill="none" stroke={`var(--mantine-color-${z})`} strokeWidth={band} />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--mantine-color-gray-1)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={6} fill="var(--mantine-color-gray-1)" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={isMobile ? 32 : 40} fontWeight={800} fill="#fff">
        {score}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fontSize={13} fontWeight={700} fill={`var(--mantine-color-${zoneColor(score)}-4)`}>
        {label}
      </text>
    </svg>
  );
}

/** Contiguous spans of the advice equity matching a predicate, for chart shading. */
function spansWhere(
  equity: { date: string; stance: Stance; exposure: number }[],
  pred: (e: { stance: Stance; exposure: number }) => boolean,
) {
  const spans: { x1: string; x2: string }[] = [];
  let cur: { x1: string; x2: string } | null = null;
  for (const e of equity) {
    if (pred(e)) {
      if (cur) cur.x2 = e.date;
      else cur = { x1: e.date, x2: e.date };
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);
  return spans;
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
  const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
  const [years, setYears] = useState("5");
  const [mode, setMode] = useState<StrategyMode>("contrarian");
  const [lev, setLev] = useState("1");
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

  const fullPoints = useMemo(() => data?.points ?? [], [data]);
  const advice = useMemo(() => (fullPoints.length ? dailyAdvice(fullPoints) : []), [fullPoints]);
  const adviceBt = useMemo(() => (advice.length ? backtestAdvice(advice, fullPoints) : null), [advice, fullPoints]);
  const today = advice.at(-1) ?? null;
  const lastChange = useMemo(() => [...advice].reverse().find((a) => a.action !== "normal") ?? null, [advice]);

  const points = useMemo(() => (data?.points ?? []).filter((p) => p.composite != null), [data]);
  const spans = useMemo(() => signalSpans(points), [points]);
  const markers = useMemo(() => tradeSignals(points), [points]);
  const latest = points.at(-1) ?? null;

  const bt = useMemo(
    () => (points.length > 1 ? backtest(points, strategyOptionsFor(mode, Number(lev))) : null),
    [points, mode, lev],
  );

  const spxDomain = useMemo((): [number, number] => {
    if (points.length === 0) return [0, 100];
    const v = points.map((p) => p.spx);
    const min = Math.min(...v);
    const max = Math.max(...v);
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }, [points]);

  const tickFormatter = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  const score = latest?.composite != null ? greedScore(latest.composite) : 50;
  const advColor = today ? adviceColor(today) : "gray";

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

      {error && (
        <Paper p="md" radius={CARD_RADIUS} bg="red.9">
          <Text c="white">Failed to load data: {error}</Text>
        </Paper>
      )}

      {loading ? (
        <Skeleton height={420} radius={CARD_RADIUS} />
      ) : latest && today ? (
        <>
          {/* ---- Hero: Fear & Greed meter + today's advice ---- */}
          <Paper p="lg" radius={CARD_RADIUS} style={heroCardStyle(advColor)}>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" style={{ alignItems: "center" }}>
              <Center>
                <Stack gap={2} align="center">
                  <Text size="xs" tt="uppercase" fw={600} c="gray.5" style={{ letterSpacing: "0.12em" }}>
                    Fear &amp; Greed
                  </Text>
                  <FearGreedGauge score={score} isMobile={isMobile} />
                </Stack>
              </Center>

              <Stack gap={6}>
                <Text size="xs" c="gray.5" tt="uppercase" fw={600} style={{ letterSpacing: "0.1em" }}>
                  Today&apos;s advice · {fmtDate(today.date)}
                </Text>
                <Text size={isMobile ? "26px" : "32px"} fw={800} c={`${advColor}.4`} lh={1.1}>
                  {adviceHeadline(today)}
                </Text>
                <Text size="sm" c="gray.3">
                  {today.reason}
                </Text>
                <Group gap="lg" mt={4}>
                  <Text size="xs" c="gray.4">
                    Recommended equity: <b>{Math.round(today.exposure * 100)}%</b>
                  </Text>
                  {lastChange && (
                    <Text size="xs" c="gray.4">
                      Last change: <b>{ACTION_LABEL[lastChange.action]}</b> · {fmtDate(lastChange.date)}
                    </Text>
                  )}
                </Group>
                <Text size="xs" c="gray.6" mt={2}>
                  composite {latest.composite!.toFixed(1)} · fragility {latest.fragility?.toFixed(1)} · euphoria{" "}
                  {latest.euphoria?.toFixed(1)}
                </Text>
              </Stack>
            </SimpleGrid>
          </Paper>

          {/* ---- Backtest: following the signals ---- */}
          {adviceBt && adviceBt.equity.length > 1 && (
            <Paper p="md" radius={CARD_RADIUS} withBorder>
              <Text size="sm" fw={600} mb={2}>
                If you&apos;d followed the signals
              </Text>
              <Text size="xs" c="dimmed" mb="sm">
                $1 invested when the advice says &quot;in&quot;, in T-bills when &quot;out&quot;, half-weight during a
                credit-stress regime — vs. buy &amp; hold.
              </Text>
              <Box h={isMobile ? 200 : 260}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={adviceBt.equity} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                    <YAxis tickFormatter={(v) => `${v.toFixed(1)}×`} fontSize={11} width={40} />
                    <Tooltip
                      labelFormatter={(l) => fmtDate(String(l))}
                      formatter={(v, name) => [`${Number(v).toFixed(2)}×`, name]}
                      contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                    />
                    {spansWhere(adviceBt.equity, (e) => e.stance === "out").map((s, i) => (
                      <ReferenceArea key={`o${i}`} x1={s.x1} x2={s.x2} fill="var(--mantine-color-gray-5)" fillOpacity={0.2} />
                    ))}
                    {spansWhere(adviceBt.equity, (e) => e.stance === "in" && e.exposure < 1).map((s, i) => (
                      <ReferenceArea key={`r${i}`} x1={s.x1} x2={s.x2} fill="var(--mantine-color-orange-5)" fillOpacity={0.18} />
                    ))}
                    <Line type="monotone" dataKey="benchmark" name="Buy & Hold" stroke="var(--mantine-color-gray-5)" dot={false} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="strategy" name="Follow signals" stroke="var(--mantine-color-teal-4)" dot={false} strokeWidth={1.5} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt="sm">
                <SummaryStat label="Total return" follow={adviceBt.strategy.totalReturn} hold={adviceBt.benchmark.totalReturn} pct higherBetter />
                <SummaryStat label="CAGR" follow={adviceBt.strategy.cagr} hold={adviceBt.benchmark.cagr} pct higherBetter />
                <SummaryStat label="Max drawdown" follow={adviceBt.strategy.maxDrawdown} hold={adviceBt.benchmark.maxDrawdown} pct higherBetter />
                <SummaryStat label="Sharpe" follow={adviceBt.strategy.sharpe} hold={adviceBt.benchmark.sharpe} higherBetter />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="sm">
                Gray = out of market; orange = reduced (credit stress). {adviceBt.switches} changes; avg equity exposure{" "}
                {(adviceBt.pctInMarket * 100).toFixed(0)}%. Ignores fees, slippage and taxes.
              </Text>
            </Paper>
          )}

          {/* ---- Details (collapsed) ---- */}
          <Accordion variant="separated" radius={CARD_RADIUS} multiple>
            <Accordion.Item value="signals">
              <Accordion.Control>
                <Text size="sm" fw={600}>
                  S&amp;P 500 with buy / sell signals
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Group gap="md" mb="xs">
                  <Group gap={4}>
                    <Box style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "8px solid var(--mantine-color-teal-4)" }} />
                    <Text size="xs" c="dimmed">
                      Buy (composite ≤ {DEEP_BUY_Z}, turning up)
                    </Text>
                  </Group>
                  <Group gap={4}>
                    <Box style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "8px solid var(--mantine-color-red-4)" }} />
                    <Text size="xs" c="dimmed">
                      Sell (greed)
                    </Text>
                  </Group>
                </Group>
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
                      {markers.map((mk, i) => (
                        <ReferenceDot
                          key={i}
                          x={mk.date}
                          y={mk.spx}
                          r={0}
                          ifOverflow="extendDomain"
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          shape={(props: any) => {
                            const { cx, cy } = props;
                            if (cx == null || cy == null) return <g />;
                            const buy = mk.action === "buy";
                            const color = buy ? "var(--mantine-color-teal-4)" : "var(--mantine-color-red-4)";
                            const d = buy
                              ? `M ${cx} ${cy + 4} L ${cx - 5} ${cy + 12} L ${cx + 5} ${cy + 12} Z`
                              : `M ${cx} ${cy - 4} L ${cx - 5} ${cy - 12} L ${cx + 5} ${cy - 12} Z`;
                            return <path d={d} fill={color} stroke="var(--mantine-color-dark-7)" strokeWidth={0.5} />;
                          }}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="oscillator">
              <Accordion.Control>
                <Text size="sm" fw={600}>
                  Composite oscillator (z-units)
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
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
                      <YAxis domain={[-6, 4]} fontSize={11} width={48} />
                      <Tooltip
                        labelFormatter={(l) => fmtDate(String(l))}
                        formatter={(v, name) => [Number(v).toFixed(2), name]}
                        contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                      />
                      <ReferenceLine y={0} stroke="var(--mantine-color-gray-6)" />
                      <ReferenceLine y={BOOM_EUPHORIA_ENTER} stroke="var(--mantine-color-teal-5)" strokeDasharray="4 4" label={{ value: "boom", fontSize: 10, fill: "var(--mantine-color-teal-4)", position: "insideTopRight" }} />
                      <ReferenceLine y={-CRASH_ENTER} stroke="var(--mantine-color-red-5)" strokeDasharray="4 4" label={{ value: "crash", fontSize: 10, fill: "var(--mantine-color-red-4)", position: "insideBottomRight" }} />
                      <ReferenceLine y={DEEP_BUY_Z} stroke="var(--mantine-color-teal-4)" strokeDasharray="4 4" label={{ value: "buy zone", fontSize: 10, fill: "var(--mantine-color-teal-4)", position: "insideBottomRight" }} />
                      <Area type="monotone" dataKey="composite" name="Composite" stroke="var(--mantine-color-gray-3)" strokeWidth={1.5} fill="url(#compGrad)" />
                      <Line type="monotone" dataKey="fragility" name="Fragility" stroke="var(--mantine-color-red-5)" dot={false} strokeWidth={1} />
                      <Line type="monotone" dataKey="euphoria" name="Euphoria" stroke="var(--mantine-color-teal-5)" dot={false} strokeWidth={1} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <Text size="xs" c="dimmed" mt={4}>
                  Crash arms at fragility ≥ {CRASH_ENTER} (stands down below {CRASH_EXIT}); boom arms at euphoria ≥{" "}
                  {BOOM_EUPHORIA_ENTER}. Green BUY markers fire when the composite hits the buy zone (≤ {DEEP_BUY_Z}) and
                  price then turns back up.
                </Text>
              </Accordion.Panel>
            </Accordion.Item>

            {bt && (
              <Accordion.Item value="strategy">
                <Accordion.Control>
                  <Text size="sm" fw={600}>
                    Strategy explorer &amp; leading-indicator test
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Group gap="md" align="center" mb="xs" wrap="wrap">
                    <Group gap={6} align="center">
                      <Text size="xs" c="dimmed">
                        Strategy
                      </Text>
                      <SegmentedControl
                        size="xs"
                        value={mode}
                        onChange={(v) => setMode(v as StrategyMode)}
                        data={[
                          { label: "Contrarian", value: "contrarian" },
                          { label: "Trend", value: "trend" },
                        ]}
                      />
                    </Group>
                    <Group gap={6} align="center">
                      <Text size="xs" c="dimmed">
                        Leverage
                      </Text>
                      <SegmentedControl
                        size="xs"
                        value={lev}
                        onChange={setLev}
                        data={[
                          { label: "1×", value: "1" },
                          { label: "2×", value: "2" },
                          { label: "3×", value: "3" },
                        ]}
                      />
                    </Group>
                  </Group>
                  <Box h={isMobile ? 200 : 240}>
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
                        <Line type="monotone" dataKey="strategy" name="Strategy" stroke="var(--mantine-color-violet-4)" dot={false} strokeWidth={1.5} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Box>
                  <Table mt="md" fz="xs" withRowBorders={false} verticalSpacing={4}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Metric</Table.Th>
                        <Table.Th ta="right">Strategy</Table.Th>
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
                  <Text size="sm" fw={600} mt="lg" mb={4}>
                    Forward S&amp;P 500 returns by signal
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
                        <Table.Th ta="right">All days</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {bt.forward.map((f) => (
                        <Table.Tr key={f.horizon}>
                          <Table.Td>{f.horizon === 5 ? "1 week" : f.horizon === 21 ? "1 month" : "3 months"}</Table.Td>
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
                            {fmtPct(f.all)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <Text size="xs" c="dimmed" mt={4}>
                    The composite is contrarian: &quot;after crash&quot; returns are positive and above the all-day
                    baseline (it fires near capitulation lows), and euphoria precedes below-average returns.
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
            )}

            <Accordion.Item value="method">
              <Accordion.Control>
                <Text size="sm" fw={600}>
                  How it works &amp; data sources
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Text size="sm" c="dimmed">
                    Systemic Fragility &amp; Euphoria Composite (SFEC): a causal, multi-factor z-score blend. The Fear
                    &amp; Greed meter maps the composite onto 0–100 (0 = extreme fear / deep capitulation, 100 = extreme
                    greed).
                  </Text>
                  <Text size="sm" fw={600} c="red.4">
                    Fragility (fear) factors
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>VIX term structure — ^VIX / ^VIX3M</List.Item>
                    <List.Item>Credit stress — HYG / LQD momentum</List.Item>
                    <List.Item>Equity realized volatility — 20-day ^GSPC</List.Item>
                    <List.Item>Drawdown from the trailing 1-year high</List.Item>
                  </List>
                  <Text size="sm" fw={600} c="teal.4">
                    Euphoria (greed) factors
                  </Text>
                  <List size="sm" spacing={4}>
                    <List.Item>Extension above the 200-day moving average</List.Item>
                    <List.Item>Trend quality — 60-day return ÷ volatility</List.Item>
                    <List.Item>Stocks-vs-bonds momentum (^GSPC / TLT)</List.Item>
                    <List.Item>RSI(14) distance from neutral</List.Item>
                  </List>
                  <Text size="sm" c="dimmed">
                    Each factor → trailing {DEFAULT_PARAMS.zWindow}-day z-score (no look-ahead), IC-weighted into the two
                    sub-indices. Advice: get out on a trend break (200-day average), get back in on a composite
                    capitulation extreme, and halve exposure during a Baa credit-spread stress regime (FRED). All data
                    is free (Yahoo Finance + FRED). This is a contrarian / mean-reversion tool, not a leading crash
                    predictor; it ignores fees and taxes.
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

/** Compact follow-vs-hold stat for the backtest summary grid. */
function SummaryStat({
  label,
  follow,
  hold,
  pct,
  higherBetter = true,
}: {
  label: string;
  follow: number;
  hold: number;
  pct?: boolean;
  higherBetter?: boolean;
}) {
  const fmt = (x: number) => (pct ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : x.toFixed(2));
  const win = higherBetter ? follow > hold : follow < hold;
  return (
    <Stack gap={0}>
      <Text size="10px" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
        {label}
      </Text>
      <Text size="lg" fw={700} c={win ? "teal.4" : undefined}>
        {fmt(follow)}
      </Text>
      <Text size="10px" c="dimmed">
        hold {fmt(hold)}
      </Text>
    </Stack>
  );
}

/** One row of the strategy-vs-benchmark metrics table; winner highlighted. */
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
