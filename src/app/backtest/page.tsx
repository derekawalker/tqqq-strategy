"use client";

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Paper,
  Stack,
  Text,
  Group,
  Box,
  SimpleGrid,
  NumberInput,
  TextInput,
  Button,
  Alert,
  Center,
  Loader,
  Table,
  ScrollArea,
  Tabs,
  Tooltip,
  Switch,
  Collapse,
  Divider,
  Menu,
  Checkbox,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconPlayerPlayFilled,
  IconInfoCircle,
  IconCopy,
  IconChevronDown,
} from "@tabler/icons-react";
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
import { useApp } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cacheGet(key: string): BacktestResponse | null {
  try {
    const raw = localStorage.getItem(`bt:${key}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: BacktestResponse };
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(`bt:${key}`); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(key: string, data: BacktestResponse) {
  try { localStorage.setItem(`bt:${key}`, JSON.stringify({ ts: Date.now(), data })); } catch { /* quota exceeded — skip */ }
}

/** Group a throttle curve into contiguous restricted spans for ReferenceArea shading. */
function throttleSpans(curve: { date: string; value: number }[]) {
  const spans: { x1: string; x2: string; opacity: number }[] = [];
  let start: string | null = null;
  let minT = 1;
  for (const { date, value } of curve) {
    if (value < 1) {
      if (!start) { start = date; minT = value; }
      else minT = Math.min(minT, value);
    } else if (start) {
      spans.push({ x1: start, x2: date, opacity: (1 - minT) * 0.18 });
      start = null; minT = 1;
    }
  }
  if (start && curve.length > 0)
    spans.push({ x1: start, x2: curve[curve.length - 1].date, opacity: (1 - minT) * 0.18 });
  return spans;
}

const TIMEFRAMES = [
  { value: "intraday", label: "6mo intraday", note: "5-min bars · Schwab / Polygon" },
  { value: "1y",       label: "1Y daily",      note: "daily bars · Yahoo Finance" },
  { value: "3y",       label: "3Y daily",      note: "daily bars · Yahoo Finance" },
  { value: "5y",       label: "5Y daily",      note: "daily bars · Yahoo Finance" },
  { value: "10y",      label: "10Y daily",     note: "daily bars · Yahoo Finance" },
  { value: "max",      label: "Max daily",     note: "since inception (2010) · Yahoo Finance" },
] as const;

type Timeframe = (typeof TIMEFRAMES)[number]["value"];

interface PeriodPreset { label: string; desc: string; start: string; end: string; tf: Timeframe }

const PERIOD_PRESETS: PeriodPreset[] = [
  { label: "COVID crash",     desc: "TQQQ −75% in 23 days",                start: "2020-01-15", end: "2020-05-01", tf: "10y" },
  { label: "Full 2020",       desc: "Crash + full V-shaped recovery",       start: "2020-01-01", end: "2020-12-31", tf: "10y" },
  { label: "Post-COVID bull", desc: "TQQQ +1000% run Apr 2020 → Nov 2021", start: "2020-04-01", end: "2021-11-30", tf: "10y" },
  { label: "2022 bear",       desc: "Rate hike cycle, TQQQ −77%",           start: "2022-01-01", end: "2022-12-31", tf: "5y"  },
  { label: "Rate hike cycle", desc: "Full hike cycle Nov 2021 → Dec 2022",  start: "2021-11-01", end: "2022-12-31", tf: "10y" },
  { label: "2018 Q4",         desc: "Sharp tech selloff −40% then recovery",start: "2018-09-01", end: "2019-03-31", tf: "10y" },
  { label: "2015–16 chop",    desc: "China scare + oil crash, sideways",    start: "2015-07-01", end: "2016-03-31", tf: "max" },
  { label: "2011 volatility", desc: "Euro debt crisis, extreme chop",       start: "2011-05-01", end: "2012-02-28", tf: "max" },
];

const SCENARIO_COLORS = [
  "var(--mantine-color-teal-4)",
  "var(--mantine-color-orange-4)",
  "var(--mantine-color-violet-4)",
];

// Mantine dot-notation versions of the same colors (for component color props).
const SCENARIO_MANTINE_COLORS = ["teal.4", "orange.4", "violet.4"];

interface CurvePoint { date: string; value: number }
interface DailyRow { date: string; buys: number; sells: number; profit: number; balance: number }

interface ScenarioResult {
  label: string;
  stats: {
    finalValue: number; totalReturn: number; maxDrawdown: number;
    realizedProfit: number; buys: number; sells: number; peakInvested: number;
  };
  strategy: CurvePoint[];
  daily: DailyRow[];
  signalCurve?: { date: string; value: number }[];
  strategyLabels?: string[];
}

interface TqqqPricePoint {
  date: string;
  value: number;
  sma50: number | null;
  sma200: number | null;
}

interface BacktestResponse {
  span: { earliest: string | null; latest: string | null; tradingDays: number; bars: number; barFreq?: string };
  benchmark: CurvePoint[];
  tqqqPrice: TqqqPricePoint[];
  scenarios: ScenarioResult[];
}

interface ScenarioInputs {
  label: string;
  startingCash: number | "";
  sellPct: number | "";
  reductionFactor: number | "";
  // Ladder shape
  stepPct: number | "";
  levels: number | "";
  reanchorPct: number | "";
  slippageBps: number | "";
  // MA gate with hysteresis
  maGateEnabled: boolean;
  maStopPeriod: number | "";
  maResumePeriod: number | "";
  // VIX gate with hysteresis
  vixGateEnabled: boolean;
  vixStop: number | "";
  vixResume: number | "";
  // Balance gate
  balanceGateEnabled: boolean;
  balanceGatePct: number | "";
  balanceResumeReboundPct: number | "";
  // Reserve tranches
  reserveEnabled: boolean;
  reservePct: number | "";
  tranche1Pct: number | "";
  tranche2Pct: number | "";
}

function defaultScenario(label: string): ScenarioInputs {
  return {
    label,
    startingCash: "", sellPct: "", reductionFactor: "",
    stepPct: 1, levels: 88, reanchorPct: 0, slippageBps: 0,
    maGateEnabled: false, maStopPeriod: 200, maResumePeriod: 200,
    vixGateEnabled: false, vixStop: 25, vixResume: 20,
    balanceGateEnabled: false, balanceGatePct: 85, balanceResumeReboundPct: 5,
    reserveEnabled: false, reservePct: 20, tranche1Pct: 15, tranche2Pct: 30,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct = (v: number, decimals = 1) =>
  `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
const pctUnsigned = (v: number, decimals = 1) => `${(v * 100).toFixed(decimals)}%`;
const pctRaw = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function groupProfits(daily: DailyRow[], keyFn: (date: string) => string): number[] {
  const groups = new Map<string, number>();
  for (const row of daily) {
    const key = keyFn(row.date);
    groups.set(key, (groups.get(key) ?? 0) + row.profit);
  }
  return [...groups.values()];
}

function weekKey(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

function profitStats(values: number[]): { low: number; avg: number; high: number } {
  if (values.length === 0) return { low: 0, avg: 0, high: 0 };
  return {
    low: Math.min(...values),
    high: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

const STAT_ROWS: { key: keyof ScenarioResult["stats"]; label: string; fmt: (v: number) => string }[] = [
  { key: "finalValue",     label: "Final value",     fmt: usd },
  { key: "totalReturn",    label: "Total return",    fmt: pct },
  { key: "maxDrawdown",    label: "Max drawdown",    fmt: (v) => pct(v) },
  { key: "realizedProfit", label: "Realized profit", fmt: usd },
  { key: "buys",           label: "Buys",            fmt: (v) => v.toLocaleString() },
  { key: "sells",          label: "Sells",           fmt: (v) => v.toLocaleString() },
  { key: "peakInvested",  label: "Peak invested",   fmt: pctUnsigned },
];

// ---------------------------------------------------------------------------
// Strategy section component
// ---------------------------------------------------------------------------

function StrategySection({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Group justify="space-between" wrap="nowrap">
        <Text size="xs" fw={500} c={enabled ? undefined : "dimmed"}>
          {label}
        </Text>
        <Switch checked={enabled} onChange={onToggle} size="xs" />
      </Group>
      <Collapse in={enabled}>
        <Stack gap={4} mt={6}>
          {children}
        </Stack>
      </Collapse>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Chart panel — memoized so form-input re-renders don't touch Recharts
// ---------------------------------------------------------------------------

type PricePoint = { date: string; price: number; sma50: number | null; sma200: number | null };
type ChartRow = Record<string, string | number>;

interface ChartPanelProps {
  result: BacktestResponse;
  isMobile: boolean;
  color: string;
  priceChartData: PricePoint[];
  chartData: ChartRow[];
  ma50: boolean;
  ma200: boolean;
  onMa50Change: (v: boolean) => void;
  onMa200Change: (v: boolean) => void;
  signalVisible: boolean[];
  onSignalVisibleChange: (i: number, checked: boolean) => void;
  zoomedRange: [string, string] | null;
  onZoomChange: (range: [string, string] | null) => void;
}

const tickFormatter = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

const ChartPanel = memo(function ChartPanel({
  result, isMobile, priceChartData, chartData,
  ma50, ma200, onMa50Change, onMa200Change,
  signalVisible, onSignalVisibleChange,
  zoomedRange, onZoomChange,
}: ChartPanelProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectStart, setSelectStart] = useState<string | null>(null);
  const [selectEnd, setSelectEnd] = useState<string | null>(null);

  const displayPriceData = useMemo(() => {
    if (!zoomedRange) return priceChartData;
    const [a, b] = zoomedRange;
    return priceChartData.filter((d) => d.date >= a && d.date <= b);
  }, [priceChartData, zoomedRange]);

  const displayChartData = useMemo(() => {
    if (!zoomedRange) return chartData;
    const [a, b] = zoomedRange;
    return chartData.filter((d) => String(d.date) >= a && String(d.date) <= b);
  }, [chartData, zoomedRange]);

  const spansByScenario = useMemo(
    () => result.scenarios.map((sc) => (sc.signalCurve ? throttleSpans(sc.signalCurve) : [])),
    [result.scenarios],
  );

  // Per-scenario date → throttle lookup for tooltip descriptions.
  const signalMaps = useMemo(
    () => result.scenarios.map((sc) => {
      const m = new Map<string, number>();
      for (const { date, value } of sc.signalCurve ?? []) m.set(date, value);
      return m;
    }),
    [result.scenarios],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceTooltip = useCallback(({ active, label, payload }: any) => {
    if (!active || !label) return null;
    const date = String(label);
    const shadingRows = result.scenarios
      .map((sc, i) => {
        const t = signalMaps[i].get(date);
        if (t === undefined || t >= 1) return null;
        const buysText = t === 0 ? "paused" : `at ${(t * 100).toFixed(0)}%`;
        const strategies = sc.strategyLabels?.join(" · ") ?? "";
        return (
          <div key={sc.label} style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length], marginTop: 4 }}>
            {sc.label}: buys {buysText}{strategies ? ` — ${strategies}` : ""}
          </div>
        );
      })
      .filter(Boolean);
    return (
      <div style={{ background: "var(--mantine-color-dark-7)", padding: "8px 12px", borderRadius: 8, fontSize: 10 }}>
        <div style={{ color: "var(--mantine-color-dimmed)", marginBottom: 4 }}>{fmtDate(date)}</div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload?.map((e: any) => (
          <div key={e.name} style={{ color: e.stroke ?? e.color }}>
            {e.name === "price" ? "TQQQ" : e.name}: ${Number(e.value).toFixed(2)}
          </div>
        ))}
        {shadingRows}
      </div>
    );
  }, [result.scenarios, signalMaps]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const equityTooltip = useCallback(({ active, label, payload }: any) => {
    if (!active || !label) return null;
    const date = String(label);
    const shadingRows = result.scenarios
      .map((sc, i) => {
        const t = signalMaps[i].get(date);
        if (t === undefined || t >= 1) return null;
        const buysText = t === 0 ? "paused" : `at ${(t * 100).toFixed(0)}%`;
        const strategies = sc.strategyLabels?.join(" · ") ?? "";
        return (
          <div key={sc.label} style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length], marginTop: 4 }}>
            {sc.label}: buys {buysText}{strategies ? ` — ${strategies}` : ""}
          </div>
        );
      })
      .filter(Boolean);
    return (
      <div style={{ background: "var(--mantine-color-dark-7)", padding: "8px 12px", borderRadius: 8, fontSize: 10 }}>
        <div style={{ color: "var(--mantine-color-dimmed)", marginBottom: 4 }}>{fmtDate(date)}</div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload?.map((e: any) => (
          <div key={e.name} style={{ color: e.stroke ?? e.color }}>
            {e.name}: {Number(e.value).toFixed(1)}%
          </div>
        ))}
        {shadingRows}
      </div>
    );
  }, [result.scenarios, signalMaps]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMouseDown = (e: any) => {
    const label = e?.activeLabel as string | undefined;
    if (label) { setSelectStart(label); setIsSelecting(true); }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMouseMove = (e: any) => {
    if (!isSelecting) return;
    const label = e?.activeLabel as string | undefined;
    if (label) setSelectEnd(label);
  };
  const handleMouseUp = () => {
    if (isSelecting && selectStart && selectEnd && selectStart !== selectEnd) {
      const [a, b] = [selectStart, selectEnd].sort();
      onZoomChange([a, b]);
    }
    setIsSelecting(false);
    setSelectStart(null);
    setSelectEnd(null);
  };
  const handleMouseLeave = () => {
    setIsSelecting(false);
    setSelectStart(null);
    setSelectEnd(null);
  };

  const selectionArea = isSelecting && selectStart && selectEnd && selectStart !== selectEnd ? (
    <ReferenceArea
      x1={selectStart < selectEnd ? selectStart : selectEnd}
      x2={selectStart < selectEnd ? selectEnd : selectStart}
      fill="var(--mantine-color-blue-5)"
      fillOpacity={0.15}
      strokeOpacity={0}
    />
  ) : null;

  return (
    <Paper radius={CARD_RADIUS} withBorder style={{ overflow: "hidden" }}>
      {/* Price chart header */}
      <Group justify="space-between" px="md" pt="md" pb={4}>
        <Text size="xs" c="dimmed">TQQQ price</Text>
        <Group gap="md">
          {result.scenarios.filter((sc) => sc.signalCurve).length > 0 && (
            <Group gap="xs">
              {result.scenarios.map((sc, i) =>
                sc.signalCurve ? (
                  <Checkbox
                    key={sc.label}
                    label={sc.label}
                    size="xs"
                    checked={signalVisible[i]}
                    onChange={(e) => onSignalVisibleChange(i, e.currentTarget.checked)}
                    color={SCENARIO_MANTINE_COLORS[i] ?? "gray"}
                  />
                ) : null
              )}
            </Group>
          )}
          <Checkbox label="50 MA" size="xs" checked={ma50} onChange={(e) => onMa50Change(e.currentTarget.checked)} color="orange" />
          <Checkbox label="200 MA" size="xs" checked={ma200} onChange={(e) => onMa200Change(e.currentTarget.checked)} color="red" />
        </Group>
      </Group>

      {/* Price chart */}
      {priceChartData.length > 0 && (
        <Box h={isMobile ? 110 : 160} style={{ cursor: "crosshair" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={displayPriceData}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
              <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={60} fontSize={10} hide />
              <YAxis tickFormatter={(v) => `$${v.toFixed(0)}`} fontSize={10} width={48} domain={["auto", "auto"]} />
              <ChartTooltip content={priceTooltip} />
              <Line type="monotone" dataKey="price" name="price" stroke="var(--mantine-color-blue-4)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              {ma50 && <Line type="monotone" dataKey="sma50" name="50 MA" stroke="var(--mantine-color-orange-4)" dot={false} strokeWidth={1.25} strokeDasharray="4 2" isAnimationActive={false} connectNulls />}
              {ma200 && <Line type="monotone" dataKey="sma200" name="200 MA" stroke="var(--mantine-color-red-4)" dot={false} strokeWidth={1.25} strokeDasharray="4 2" isAnimationActive={false} connectNulls />}
              {spansByScenario.map((spans, i) =>
                signalVisible[i] && spans.map((span, j) => (
                  <ReferenceArea
                    key={`${result.scenarios[i].label}-${j}`}
                    x1={span.x1}
                    x2={span.x2}
                    fill={SCENARIO_COLORS[i % SCENARIO_COLORS.length]}
                    fillOpacity={span.opacity}
                    strokeOpacity={0}
                  />
                ))
              )}
              {selectionArea}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      )}

      <Divider />

      {/* Equity curve header */}
      <Group justify="space-between" px="md" pt={6} pb={4}>
        <Text size="xs" c="dimmed">% return vs. buy &amp; hold</Text>
        {zoomedRange && (
          <Button size="xs" variant="subtle" color="gray" onClick={() => onZoomChange(null)}>
            Reset zoom
          </Button>
        )}
      </Group>

      {/* Equity curve */}
      <Box h={isMobile ? 240 : 320} style={{ cursor: "crosshair" }} px="md" pb="md">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={displayChartData}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
            <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} fontSize={11} width={52} domain={["auto", "auto"]} />
            <ChartTooltip content={equityTooltip} />
            {result.scenarios.map((sc, i) => (
              <Line key={sc.label} type="monotone" dataKey={sc.label} name={sc.label} stroke={SCENARIO_COLORS[i % SCENARIO_COLORS.length]} dot={false} strokeWidth={1.75} isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey="benchmark" name="Buy & hold" stroke="var(--mantine-color-gray-5)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" isAnimationActive={false} />
            {spansByScenario.map((spans, i) =>
              signalVisible[i] && spans.map((span, j) => (
                <ReferenceArea
                  key={`${result.scenarios[i].label}-${j}`}
                  x1={span.x1}
                  x2={span.x2}
                  fill={SCENARIO_COLORS[i % SCENARIO_COLORS.length]}
                  fillOpacity={span.opacity}
                  strokeOpacity={0}
                />
              ))
            )}
            {selectionArea}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
});

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BacktestPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { activeAccount } = useApp();
  const color = useAccountColor();

  const [timeframe, setTimeframe] = useState<Timeframe>("intraday");
  const [activePeriod, setActivePeriod] = useState<PeriodPreset | null>(null);
  const [ma50, setMa50] = useState(false);
  const [ma200, setMa200] = useState(false);
  const [signalVisible, setSignalVisible] = useState([true, true, true]);
  const [zoomedRange, setZoomedRange] = useState<[string, string] | null>(null);

  const [scenarios, setScenarios] = useState<ScenarioInputs[]>([
    defaultScenario("A"),
    defaultScenario("B"),
    defaultScenario("C"),
  ]);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (prefilled || !activeAccount) return;
    const s = activeAccount.settings;
    if (s.levelStartingCash == null && s.sellPercentage == null && s.reductionFactor == null) return;
    setScenarios((prev) =>
      prev.map((sc) => ({
        ...sc,
        startingCash: s.levelStartingCash ?? sc.startingCash,
        sellPct: s.sellPercentage ?? sc.sellPct,
        reductionFactor: s.reductionFactor ?? sc.reductionFactor,
      })),
    );
    setPrefilled(true);
  }, [activeAccount, prefilled]);

  function updateScenario(i: number, patch: Partial<ScenarioInputs>) {
    setScenarios((prev) => prev.map((sc, idx) => (idx === i ? { ...sc, ...patch } : sc)));
  }

  function cloneScenario(from: number, to: number) {
    const src = scenarios[from];
    setScenarios((prev) =>
      prev.map((sc, idx) =>
        idx === to ? { ...src, label: sc.label } : sc,
      ),
    );
  }

  function reset() {
    const s = activeAccount?.settings;
    const base = {
      startingCash: (s?.levelStartingCash ?? "") as number | "",
      sellPct: (s?.sellPercentage ?? "") as number | "",
      reductionFactor: (s?.reductionFactor ?? "") as number | "",
    };
    setScenarios([
      { ...defaultScenario("A"), ...base },
      { ...defaultScenario("B"), ...base },
      { ...defaultScenario("C"), ...base },
    ]);
    setResult(null);
    setError(null);
    setZoomedRange(null);
    setActivePeriod(null);
    setTimeframe("intraday");
  }

  const canRun = scenarios.some(
    (s) =>
      typeof s.startingCash === "number" && s.startingCash > 0 &&
      typeof s.sellPct === "number" && s.sellPct > 0 &&
      typeof s.reductionFactor === "number" && s.reductionFactor > 0,
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  async function run() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setZoomedRange(null);
    const valid = scenarios.filter(
      (s) =>
        typeof s.startingCash === "number" && s.startingCash > 0 &&
        typeof s.sellPct === "number" && s.sellPct > 0 &&
        typeof s.reductionFactor === "number" && s.reductionFactor > 0,
    );
    const payload = {
      timeframe,
      startDate: activePeriod?.start ?? undefined,
      endDate: activePeriod?.end ?? undefined,
      scenarios: valid.map((s) => ({
        label: s.label,
        startingCash: s.startingCash,
        sellPct: s.sellPct,
        reductionFactor: s.reductionFactor,
        stepPct: Number(s.stepPct) > 0 ? Number(s.stepPct) : 1,
        levels: Number(s.levels) > 0 ? Number(s.levels) : 88,
        reanchorPct: Number(s.reanchorPct) > 0 ? Number(s.reanchorPct) : 0,
        slippageBps: Number(s.slippageBps) > 0 ? Number(s.slippageBps) : 0,
        maGateEnabled: s.maGateEnabled,
        maStopPeriod: s.maGateEnabled ? Number(s.maStopPeriod) || 200 : undefined,
        maResumePeriod: s.maGateEnabled ? Number(s.maResumePeriod) || 200 : undefined,
        vixGateEnabled: s.vixGateEnabled,
        vixStop: s.vixGateEnabled ? Number(s.vixStop) || 25 : undefined,
        vixResume: s.vixGateEnabled ? Number(s.vixResume) || 20 : undefined,
        balanceGateEnabled: s.balanceGateEnabled,
        balanceGatePct: s.balanceGateEnabled ? Number(s.balanceGatePct) || 85 : undefined,
        balanceResumeReboundPct: s.balanceGateEnabled ? Number(s.balanceResumeReboundPct) || 5 : undefined,
        reserveEnabled: s.reserveEnabled,
        reservePct: s.reserveEnabled ? Number(s.reservePct) || 0 : undefined,
        tranche1Pct: s.reserveEnabled ? Number(s.tranche1Pct) || undefined : undefined,
        tranche2Pct: s.reserveEnabled ? Number(s.tranche2Pct) || undefined : undefined,
      })),
    };
    const cacheKey = JSON.stringify(payload);
    try {
      const cached = cacheGet(cacheKey);
      if (cached) {
        setResult(cached);
        setLoading(false);
        return;
      }
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cacheKey,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          res.status === 401
            ? "Connect to Schwab to pull intraday history (Settings → Connect)."
            : (data.error ?? "Backtest failed."),
        );
        setResult(null);
      } else {
        const r = data as BacktestResponse;
        cacheSet(cacheKey, r);
        setResult(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const chartData = useMemo(() => {
    if (!result) return [];
    type Row = Record<string, string | number>;
    const byDate = new Map<string, Row>();
    for (const p of result.benchmark) byDate.set(p.date, { date: p.date, benchmark: p.value });
    for (const sc of result.scenarios) {
      for (const p of sc.strategy) {
        const row = byDate.get(p.date) ?? { date: p.date };
        row[sc.label] = p.value;
        byDate.set(p.date, row);
      }
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [result]);

  const priceChartData = useMemo(
    () => (result?.tqqqPrice ?? []).map((p) => ({
      date: p.date,
      price: p.value,
      sma50: p.sma50,
      sma200: p.sma200,
    })),
    [result?.tqqqPrice],
  );

  const handleSignalVisibleChange = useCallback((i: number, checked: boolean) => {
    setSignalVisible((prev) => { const next = [...prev]; next[i] = checked; return next; });
  }, []);

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>Backtest</Text>
        <Text size="sm" c="dimmed">
          TQQQ ladder sim — 5-min intraday bars (~2 years) or daily bars back to 2010.
          Run up to 3 scenarios at once — chart shows % return, table shows dollars.
        </Text>
      </Box>

      {/* Timeframe selector */}
      <Box>
        <Text size="xs" c="dimmed" mb={6}>
          Timeframe · {TIMEFRAMES.find((t) => t.value === timeframe)?.note}
        </Text>
        <Group gap="xs" wrap="wrap">
          {TIMEFRAMES.map((tf) => (
            <Button
              key={tf.value}
              size="xs"
              variant={timeframe === tf.value ? "filled" : "light"}
              color={timeframe === tf.value ? color : "gray"}
              onClick={() => { setTimeframe(tf.value); setActivePeriod(null); }}
            >
              {tf.label}
            </Button>
          ))}
        </Group>
      </Box>

      {/* Historical period presets */}
      <Box>
        <Group justify="space-between" mb={6}>
          <Text size="xs" c="dimmed">
            Historical period{activePeriod ? ` · ${activePeriod.start} → ${activePeriod.end}` : ""}
          </Text>
          {activePeriod && (
            <Button size="xs" variant="subtle" color="gray" onClick={() => setActivePeriod(null)}>
              Clear
            </Button>
          )}
        </Group>
        <Group gap="xs" wrap="wrap">
          {PERIOD_PRESETS.map((p) => (
            <Tooltip key={p.label} label={p.desc} withArrow>
              <Button
                size="xs"
                variant={activePeriod?.label === p.label ? "filled" : "light"}
                color={activePeriod?.label === p.label ? color : "gray"}
                onClick={() => { setActivePeriod(p); setTimeframe(p.tf); }}
              >
                {p.label}
              </Button>
            </Tooltip>
          ))}
        </Group>
      </Box>

      {/* Scenario inputs */}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {scenarios.map((sc, i) => (
          <Paper key={i} p="md" radius={CARD_RADIUS} withBorder>
            <Stack gap="xs">
              {/* Card header: label + clone menu */}
              <Group gap="xs" align="flex-end">
                <TextInput
                  label="Label"
                  value={sc.label}
                  onChange={(e) => updateScenario(i, { label: e.currentTarget.value })}
                  size="xs"
                  style={{ flex: 1 }}
                  styles={{ input: { borderColor: SCENARIO_COLORS[i], borderWidth: 1.5 } }}
                />
                <Menu withinPortal position="bottom-end">
                  <Menu.Target>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      rightSection={<IconChevronDown size={12} />}
                      leftSection={<IconCopy size={12} />}
                      mb={1}
                    >
                      Clone
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Copy settings to</Menu.Label>
                    {scenarios
                      .map((other, j) => ({ other, j }))
                      .filter(({ j }) => j !== i)
                      .map(({ other, j }) => (
                        <Menu.Item key={j} onClick={() => cloneScenario(i, j)}>
                          {other.label || `Scenario ${j + 1}`}
                        </Menu.Item>
                      ))}
                  </Menu.Dropdown>
                </Menu>
              </Group>
              <NumberInput
                label="Starting cash"
                value={sc.startingCash}
                onChange={(v) => updateScenario(i, { startingCash: v === "" ? "" : Number(v) })}
                min={0} step={1000} thousandSeparator="," prefix="$" size="xs"
              />
              <NumberInput
                label="Sell target %"
                value={sc.sellPct}
                onChange={(v) => updateScenario(i, { sellPct: v === "" ? "" : Number(v) })}
                min={0} step={0.5} suffix="%" size="xs"
              />
              <NumberInput
                label="Reduction factor"
                value={sc.reductionFactor}
                onChange={(v) => updateScenario(i, { reductionFactor: v === "" ? "" : Number(v) })}
                min={0} max={2} step={0.01} decimalScale={3} size="xs"
              />
              <Group grow gap="xs">
                <NumberInput
                  label="Step %"
                  value={sc.stepPct}
                  onChange={(v) => updateScenario(i, { stepPct: v === "" ? "" : Number(v) })}
                  min={0.1} max={10} step={0.25} decimalScale={2} size="xs" suffix="%"
                />
                <NumberInput
                  label="Levels"
                  value={sc.levels}
                  onChange={(v) => updateScenario(i, { levels: v === "" ? "" : Number(v) })}
                  min={5} max={200} step={1} size="xs"
                />
              </Group>
              <Group grow gap="xs">
                <NumberInput
                  label="Re-anchor above peak"
                  value={sc.reanchorPct}
                  onChange={(v) => updateScenario(i, { reanchorPct: v === "" ? "" : Number(v) })}
                  min={0} max={50} step={0.5} decimalScale={2} size="xs" suffix="%"
                />
                <NumberInput
                  label="Slippage / trade"
                  value={sc.slippageBps}
                  onChange={(v) => updateScenario(i, { slippageBps: v === "" ? "" : Number(v) })}
                  min={0} max={200} step={1} size="xs" suffix=" bps"
                />
              </Group>

              <Divider label="Buy filters" labelPosition="left" />

              {/* MA gate */}
              <StrategySection
                label="MA gate"
                enabled={sc.maGateEnabled}
                onToggle={() => updateScenario(i, { maGateEnabled: !sc.maGateEnabled })}
              >
                <Group grow gap="xs">
                  <NumberInput
                    label="Stop buying below MA"
                    value={sc.maStopPeriod}
                    onChange={(v) => updateScenario(i, { maStopPeriod: v === "" ? "" : Number(v) })}
                    min={5} max={500} step={10} size="xs" suffix="-day"
                  />
                  <NumberInput
                    label="Resume buying above MA"
                    value={sc.maResumePeriod}
                    onChange={(v) => updateScenario(i, { maResumePeriod: v === "" ? "" : Number(v) })}
                    min={5} max={500} step={10} size="xs" suffix="-day"
                  />
                </Group>
              </StrategySection>

              {/* VIX gate */}
              <StrategySection
                label="VIX gate"
                enabled={sc.vixGateEnabled}
                onToggle={() => updateScenario(i, { vixGateEnabled: !sc.vixGateEnabled })}
              >
                <Group grow gap="xs">
                  <NumberInput
                    label="Stop buying above"
                    value={sc.vixStop}
                    onChange={(v) => updateScenario(i, { vixStop: v === "" ? "" : Number(v) })}
                    min={10} max={80} step={1} size="xs" prefix="VIX "
                  />
                  <NumberInput
                    label="Resume buying below"
                    value={sc.vixResume}
                    onChange={(v) => updateScenario(i, { vixResume: v === "" ? "" : Number(v) })}
                    min={10} max={80} step={1} size="xs" prefix="VIX "
                  />
                </Group>
              </StrategySection>

              {/* Balance gate */}
              <StrategySection
                label="Balance gate"
                enabled={sc.balanceGateEnabled}
                onToggle={() => updateScenario(i, { balanceGateEnabled: !sc.balanceGateEnabled })}
              >
                <Group grow gap="xs">
                  <NumberInput
                    label="Stop buying when balance at"
                    value={sc.balanceGatePct}
                    onChange={(v) => updateScenario(i, { balanceGatePct: v === "" ? "" : Number(v) })}
                    min={50} max={99} step={1} size="xs" suffix="% of start"
                  />
                  <NumberInput
                    label="Resume when price rebounds"
                    value={sc.balanceResumeReboundPct}
                    onChange={(v) => updateScenario(i, { balanceResumeReboundPct: v === "" ? "" : Number(v) })}
                    min={1} max={50} step={1} size="xs" suffix="% from low"
                  />
                </Group>
              </StrategySection>

              {/* Reserve tranches */}
              <StrategySection
                label="Reserve tranches"
                enabled={sc.reserveEnabled}
                onToggle={() => updateScenario(i, { reserveEnabled: !sc.reserveEnabled })}
              >
                <NumberInput
                  label="Hold back as reserve"
                  value={sc.reservePct}
                  onChange={(v) => updateScenario(i, { reservePct: v === "" ? "" : Number(v) })}
                  min={0} max={90} step={5} size="xs" suffix="% of start"
                />
                <Group grow gap="xs">
                  <NumberInput
                    label="Deploy ½ at drawdown"
                    value={sc.tranche1Pct}
                    onChange={(v) => updateScenario(i, { tranche1Pct: v === "" ? "" : Number(v) })}
                    min={1} max={90} step={1} size="xs" prefix="−" suffix="%"
                  />
                  <NumberInput
                    label="Deploy rest at drawdown"
                    value={sc.tranche2Pct}
                    onChange={(v) => updateScenario(i, { tranche2Pct: v === "" ? "" : Number(v) })}
                    min={1} max={90} step={1} size="xs" prefix="−" suffix="%"
                  />
                </Group>
              </StrategySection>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>

      <Group justify="flex-end">
        <Button variant="subtle" color="gray" onClick={reset} disabled={loading}>Reset</Button>
        <Button
          color={color}
          leftSection={<IconPlayerPlayFilled size={16} />}
          onClick={run}
          loading={loading}
          disabled={!canRun}
        >
          Run backtest
        </Button>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
          {error}
        </Alert>
      )}

      {loading && (
        <Center py="xl">
          <Group gap="xs">
            <Loader size="sm" color={color} />
            <Text c="dimmed">Pulling intraday history &amp; simulating…</Text>
          </Group>
        </Center>
      )}

      {result && !loading && (
        <>
          {result.span.earliest && result.span.latest && (
            <Text size="sm" c="dimmed">
              {fmtDate(result.span.earliest)} → {fmtDate(result.span.latest)} ·{" "}
              {result.span.tradingDays.toLocaleString()} trading days · {result.span.barFreq ?? "5-min bars"}
            </Text>
          )}

          <ChartPanel
            result={result}
            isMobile={isMobile ?? false}
            color={color}
            priceChartData={priceChartData}
            chartData={chartData}
            ma50={ma50}
            ma200={ma200}
            onMa50Change={setMa50}
            onMa200Change={setMa200}
            signalVisible={signalVisible}
            onSignalVisibleChange={handleSignalVisibleChange}
            zoomedRange={zoomedRange}
            onZoomChange={setZoomedRange}
          />

          <Paper radius={CARD_RADIUS} withBorder>
            <ScrollArea>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Metric</Table.Th>
                    {result.scenarios.map((sc, i) => (
                      <Table.Th key={sc.label} style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}>
                        {sc.label}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {STAT_ROWS.map(({ key, label, fmt }) => (
                    <Table.Tr key={key}>
                      <Table.Td c="dimmed" fz="sm">{label}</Table.Td>
                      {result.scenarios.map((sc) => (
                        <Table.Td key={sc.label} fz="sm">{fmt(sc.stats[key])}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {([
                    { label: "Daily profit", tip: "Realized profit per trading day shown as low · avg · high. The ladder only ever sells at a gain, so these are never negative — losers are held unrealized (see Max drawdown). Low is often $0 (no sells that day).", getValues: (sc: ScenarioResult) => sc.daily.map((r) => r.profit) },
                    { label: "Weekly profit", tip: "Sum of realized profit per calendar week (Mon–Fri) shown as low · avg · high. Realized profit is never negative (losers are held unrealized — see Max drawdown).", getValues: (sc: ScenarioResult) => groupProfits(sc.daily, weekKey) },
                    { label: "Monthly profit", tip: "Sum of realized profit per calendar month shown as low · avg · high. Low is your leanest harvest month, not a loss — realized profit is never negative (see Max drawdown).", getValues: (sc: ScenarioResult) => groupProfits(sc.daily, (d) => d.slice(0, 7)) },
                  ] as const).map(({ label, tip, getValues }) => (
                    <Table.Tr key={label}>
                      <Table.Td c="dimmed" fz="sm">
                        <Group gap={4} wrap="nowrap">
                          {label}
                          <Tooltip label={tip} multiline w={240} withArrow>
                            <IconInfoCircle size={13} style={{ cursor: "help", flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />
                          </Tooltip>
                        </Group>
                      </Table.Td>
                      {result.scenarios.map((sc) => {
                        const { low, avg, high } = profitStats(getValues(sc));
                        return (
                          <Table.Td key={sc.label} fz="xs" style={{ whiteSpace: "nowrap" }}>
                            <span style={{ color: "var(--mantine-color-dimmed)" }}>{usd(low)}</span>
                            {" · "}
                            <span style={{ color: "var(--mantine-color-orange-4)" }}>{usd(avg)}</span>
                            {" · "}
                            <span style={{ color: "var(--mantine-color-teal-4)" }}>{usd(high)}</span>
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                  <Table.Tr>
                    <Table.Td c="dimmed" fz="sm">vs. buy &amp; hold</Table.Td>
                    {result.scenarios.map((sc) => {
                      const bhFinal = result.benchmark.at(-1)?.value ?? 100;
                      const stFinal = sc.strategy.at(-1)?.value ?? 100;
                      const diff = stFinal - bhFinal;
                      return (
                        <Table.Td key={sc.label} fz="sm" c={diff >= 0 ? "teal.4" : "red.4"}>
                          {pctRaw(diff)}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          <Paper radius={CARD_RADIUS} withBorder>
            <Tabs defaultValue={result.scenarios[0]?.label} color={color} keepMounted={false}>
              <Tabs.List px="md" pt="xs">
                {result.scenarios.map((sc, i) => (
                  <Tabs.Tab key={sc.label} value={sc.label} style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}>
                    {sc.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              {result.scenarios.map((sc) => (
                <Tabs.Panel key={sc.label} value={sc.label}>
                  <ScrollArea h={400}>
                    <Table striped stickyHeader stickyHeaderOffset={0} fz="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Date</Table.Th>
                          <Table.Th ta="right">Buys</Table.Th>
                          <Table.Th ta="right">Sells</Table.Th>
                          <Table.Th ta="right">Daily profit</Table.Th>
                          <Table.Th ta="right">Balance</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {sc.daily.map((row) => (
                          <Table.Tr key={row.date}>
                            <Table.Td>{row.date}</Table.Td>
                            <Table.Td ta="right">{row.buys}</Table.Td>
                            <Table.Td ta="right">{row.sells}</Table.Td>
                            <Table.Td ta="right" c={row.profit > 0 ? "teal.4" : row.profit < 0 ? "red.4" : undefined}>
                              {row.profit !== 0 ? usd(row.profit) : "—"}
                            </Table.Td>
                            <Table.Td ta="right">{usd(row.balance)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Tabs.Panel>
              ))}
            </Tabs>
          </Paper>
        </>
      )}
    </Stack>
  );
}
