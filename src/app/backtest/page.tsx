"use client";

import { useState, useEffect, useMemo } from "react";
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
  Select,
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
}

interface TqqqPricePoint {
  date: string;
  value: number;
  sma50: number | null;
  sma200: number | null;
}

interface BacktestResponse {
  span: { earliest: string | null; latest: string | null; tradingDays: number; bars: number };
  benchmark: CurvePoint[];
  tqqqPrice: TqqqPricePoint[];
  scenarios: ScenarioResult[];
}

interface ScenarioInputs {
  label: string;
  startingCash: number | "";
  sellPct: number | "";
  reductionFactor: number | "";
  // Strategy 1 – MA gate
  maEnabled: boolean;
  maPeriod: number | "";
  maSymbol: "TQQQ" | "QQQ";
  // Strategy 2 – VIX gate
  vixEnabled: boolean;
  vixFloor: number | "";
  vixCeiling: number | "";
  // Strategy 3 – ATR-adaptive steps
  atrEnabled: boolean;
  atrPeriod: number | "";
  atrStepMin: number | "";
  atrStepMax: number | "";
  // Strategy 4 – Reserve + tranches
  reserveEnabled: boolean;
  reservePct: number | "";
  tranche1Threshold: number | "";
  tranche2Threshold: number | "";
  // Strategy 5 – Golden Cross
  gcEnabled: boolean;
  gcFastPeriod: number | "";
  gcSlowPeriod: number | "";
}

function defaultScenario(label: string): ScenarioInputs {
  return {
    label,
    startingCash: "", sellPct: "", reductionFactor: "",
    maEnabled: false, maPeriod: 200, maSymbol: "TQQQ",
    vixEnabled: false, vixFloor: 15, vixCeiling: 35,
    atrEnabled: false, atrPeriod: 14, atrStepMin: 0.5, atrStepMax: 2.5,
    reserveEnabled: false, reservePct: 30, tranche1Threshold: -15, tranche2Threshold: -30,
    gcEnabled: false, gcFastPeriod: 50, gcSlowPeriod: 200,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct = (v: number, decimals = 1) =>
  `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
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
  { key: "peakInvested",  label: "Peak invested",   fmt: pct },
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
  const [selectStart, setSelectStart] = useState<string | null>(null);
  const [selectEnd, setSelectEnd] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

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
        maEnabled: s.maEnabled,
        maPeriod: s.maEnabled ? Number(s.maPeriod) || 200 : undefined,
        maSymbol: s.maEnabled ? s.maSymbol : undefined,
        vixEnabled: s.vixEnabled,
        vixFloor: s.vixEnabled ? Number(s.vixFloor) || 15 : undefined,
        vixCeiling: s.vixEnabled ? Number(s.vixCeiling) || 35 : undefined,
        atrEnabled: s.atrEnabled,
        atrPeriod: s.atrEnabled ? Number(s.atrPeriod) || 14 : undefined,
        atrStepMin: s.atrEnabled ? Number(s.atrStepMin) || 0.5 : undefined,
        atrStepMax: s.atrEnabled ? Number(s.atrStepMax) || 2.5 : undefined,
        reserveEnabled: s.reserveEnabled,
        reservePct: s.reserveEnabled ? Number(s.reservePct) || 30 : undefined,
        tranche1Threshold: s.reserveEnabled ? Number(s.tranche1Threshold) || -15 : undefined,
        tranche2Threshold: s.reserveEnabled ? Number(s.tranche2Threshold) || -30 : undefined,
        gcEnabled: s.gcEnabled,
        gcFastPeriod: s.gcEnabled ? Number(s.gcFastPeriod) || 50 : undefined,
        gcSlowPeriod: s.gcEnabled ? Number(s.gcSlowPeriod) || 200 : undefined,
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

  // Drag-to-zoom handlers (shared by both charts via the same state).
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
      setZoomedRange([a, b]);
    }
    setIsSelecting(false);
    setSelectStart(null);
    setSelectEnd(null);
  };

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

  // The selection highlight for both charts while dragging.
  const selectionArea = isSelecting && selectStart && selectEnd && selectStart !== selectEnd ? (
    <ReferenceArea
      x1={selectStart < selectEnd ? selectStart : selectEnd}
      x2={selectStart < selectEnd ? selectEnd : selectStart}
      fill="var(--mantine-color-blue-5)"
      fillOpacity={0.15}
      strokeOpacity={0}
    />
  ) : null;

  const tickFormatter = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  return (
    <Stack gap="lg">
      <Box>
        <Text size="xl" fw={700}>Backtest</Text>
        <Text size="sm" c="dimmed">
          Intraday TQQQ ladder sim using Schwab 5-min bars (~2 years). Run up to 3 scenarios
          at once — chart shows % return, table shows dollars.
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

              <Divider label="Strategies" labelPosition="left" />

              {/* Strategy 1 — MA Gate */}
              <StrategySection
                label="200-day MA gate"
                enabled={sc.maEnabled}
                onToggle={() => updateScenario(i, { maEnabled: !sc.maEnabled })}
              >
                <Group grow gap="xs">
                  <NumberInput
                    label="Period"
                    value={sc.maPeriod}
                    onChange={(v) => updateScenario(i, { maPeriod: v === "" ? "" : Number(v) })}
                    min={10} max={500} step={10} size="xs"
                  />
                  <Select
                    label="Symbol"
                    value={sc.maSymbol}
                    onChange={(v) => updateScenario(i, { maSymbol: (v as "TQQQ" | "QQQ") ?? "TQQQ" })}
                    data={["TQQQ", "QQQ"]}
                    size="xs"
                  />
                </Group>
              </StrategySection>

              {/* Strategy 2 — VIX Gate */}
              <StrategySection
                label="VIX threshold gate"
                enabled={sc.vixEnabled}
                onToggle={() => updateScenario(i, { vixEnabled: !sc.vixEnabled })}
              >
                <Group grow gap="xs">
                  <NumberInput
                    label="VIX floor (full buys)"
                    value={sc.vixFloor}
                    onChange={(v) => updateScenario(i, { vixFloor: v === "" ? "" : Number(v) })}
                    min={5} max={50} step={1} size="xs"
                  />
                  <NumberInput
                    label="VIX ceiling (no buys)"
                    value={sc.vixCeiling}
                    onChange={(v) => updateScenario(i, { vixCeiling: v === "" ? "" : Number(v) })}
                    min={5} max={80} step={1} size="xs"
                  />
                </Group>
              </StrategySection>

              {/* Strategy 3 — ATR Steps */}
              <StrategySection
                label="ATR-adaptive step size"
                enabled={sc.atrEnabled}
                onToggle={() => updateScenario(i, { atrEnabled: !sc.atrEnabled })}
              >
                <NumberInput
                  label="ATR period"
                  value={sc.atrPeriod}
                  onChange={(v) => updateScenario(i, { atrPeriod: v === "" ? "" : Number(v) })}
                  min={5} max={50} step={1} size="xs"
                />
                <Group grow gap="xs">
                  <NumberInput
                    label="Min step % (calm)"
                    value={sc.atrStepMin}
                    onChange={(v) => updateScenario(i, { atrStepMin: v === "" ? "" : Number(v) })}
                    min={0.1} max={5} step={0.25} decimalScale={2} suffix="%" size="xs"
                  />
                  <NumberInput
                    label="Max step % (volatile)"
                    value={sc.atrStepMax}
                    onChange={(v) => updateScenario(i, { atrStepMax: v === "" ? "" : Number(v) })}
                    min={0.1} max={10} step={0.25} decimalScale={2} suffix="%" size="xs"
                  />
                </Group>
              </StrategySection>

              {/* Strategy 4 — Reserve + Tranches */}
              <StrategySection
                label="Reserve + capital tranches"
                enabled={sc.reserveEnabled}
                onToggle={() => updateScenario(i, { reserveEnabled: !sc.reserveEnabled })}
              >
                <NumberInput
                  label="Reserve %"
                  value={sc.reservePct}
                  onChange={(v) => updateScenario(i, { reservePct: v === "" ? "" : Number(v) })}
                  min={5} max={80} step={5} suffix="%" size="xs"
                />
                <Group grow gap="xs">
                  <NumberInput
                    label="Tranche 1 at drawdown"
                    value={sc.tranche1Threshold}
                    onChange={(v) => updateScenario(i, { tranche1Threshold: v === "" ? "" : Number(v) })}
                    min={-80} max={-1} step={5} suffix="%" size="xs"
                  />
                  <NumberInput
                    label="Tranche 2 at drawdown"
                    value={sc.tranche2Threshold}
                    onChange={(v) => updateScenario(i, { tranche2Threshold: v === "" ? "" : Number(v) })}
                    min={-90} max={-1} step={5} suffix="%" size="xs"
                  />
                </Group>
              </StrategySection>

              {/* Strategy 5 — Golden Cross */}
              <StrategySection
                label="Golden Cross regime"
                enabled={sc.gcEnabled}
                onToggle={() => updateScenario(i, { gcEnabled: !sc.gcEnabled })}
              >
                <Group grow gap="xs">
                  <NumberInput
                    label="Fast MA period"
                    value={sc.gcFastPeriod}
                    onChange={(v) => updateScenario(i, { gcFastPeriod: v === "" ? "" : Number(v) })}
                    min={5} max={200} step={5} size="xs"
                  />
                  <NumberInput
                    label="Slow MA period"
                    value={sc.gcSlowPeriod}
                    onChange={(v) => updateScenario(i, { gcSlowPeriod: v === "" ? "" : Number(v) })}
                    min={10} max={500} step={10} size="xs"
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
              {result.span.tradingDays.toLocaleString()} trading days · {(result.span as { barFreq?: string }).barFreq ?? "5-min bars"}
            </Text>
          )}

          {/* TQQQ price + equity curve — single wrapper, no gap */}
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
                          onChange={(e) => {
                            const checked = e.currentTarget.checked;
                            setSignalVisible((prev) => {
                              const next = [...prev];
                              next[i] = checked;
                              return next;
                            });
                          }}
                          color={SCENARIO_MANTINE_COLORS[i] ?? "gray"}
                        />
                      ) : null
                    )}
                  </Group>
                )}
                <Checkbox label="50 MA" size="xs" checked={ma50} onChange={(e) => setMa50(e.currentTarget.checked)} color="orange" />
                <Checkbox label="200 MA" size="xs" checked={ma200} onChange={(e) => setMa200(e.currentTarget.checked)} color="red" />
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
                    onMouseLeave={() => { setIsSelecting(false); setSelectStart(null); setSelectEnd(null); }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={60} fontSize={10} hide />
                    <YAxis tickFormatter={(v) => `$${v.toFixed(0)}`} fontSize={10} width={48} domain={["auto", "auto"]} />
                    <ChartTooltip
                      labelFormatter={(l) => fmtDate(String(l))}
                      formatter={(v, name) => [`$${Number(v).toFixed(2)}`, name === "price" ? "TQQQ" : name]}
                      contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="price" name="price" stroke="var(--mantine-color-blue-4)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    {ma50 && <Line type="monotone" dataKey="sma50" name="50 MA" stroke="var(--mantine-color-orange-4)" dot={false} strokeWidth={1.25} strokeDasharray="4 2" isAnimationActive={false} connectNulls />}
                    {ma200 && <Line type="monotone" dataKey="sma200" name="200 MA" stroke="var(--mantine-color-red-4)" dot={false} strokeWidth={1.25} strokeDasharray="4 2" isAnimationActive={false} connectNulls />}
                    {result.scenarios.map((sc, i) =>
                      signalVisible[i] && (sc.signalCurve ? throttleSpans(sc.signalCurve) : []).map((span, j) => (
                        <ReferenceArea
                          key={`${sc.label}-${j}`}
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
                <Button size="xs" variant="subtle" color="gray" onClick={() => setZoomedRange(null)}>
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
                  onMouseLeave={() => { setIsSelecting(false); setSelectStart(null); setSelectEnd(null); }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
                  <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
                  <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} fontSize={11} width={52} domain={["auto", "auto"]} />
                  <ChartTooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name]}
                    contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
                  />
                  {result.scenarios.map((sc, i) => (
                    <Line key={sc.label} type="monotone" dataKey={sc.label} name={sc.label} stroke={SCENARIO_COLORS[i % SCENARIO_COLORS.length]} dot={false} strokeWidth={1.75} isAnimationActive={false} />
                  ))}
                  <Line type="monotone" dataKey="benchmark" name="Buy & hold" stroke="var(--mantine-color-gray-5)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" isAnimationActive={false} />
                  {result.scenarios.map((sc, i) =>
                    signalVisible[i] && (sc.signalCurve ? throttleSpans(sc.signalCurve) : []).map((span, j) => (
                      <ReferenceArea
                        key={`${sc.label}-${j}`}
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
                    { label: "Daily profit", tip: "Realized profit per trading day shown as low · avg · high. Low is often $0 (no sells that day).", getValues: (sc: ScenarioResult) => sc.daily.map((r) => r.profit) },
                    { label: "Weekly profit", tip: "Sum of realized profit per calendar week (Mon–Fri) shown as low · avg · high.", getValues: (sc: ScenarioResult) => groupProfits(sc.daily, weekKey) },
                    { label: "Monthly profit", tip: "Sum of realized profit per calendar month shown as low · avg · high. Low is your worst month.", getValues: (sc: ScenarioResult) => groupProfits(sc.daily, (d) => d.slice(0, 7)) },
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
                            <span style={{ color: "var(--mantine-color-red-4)" }}>{usd(low)}</span>
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
            <Tabs defaultValue={result.scenarios[0]?.label} color={color}>
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
