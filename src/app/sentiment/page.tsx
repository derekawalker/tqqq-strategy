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
  Badge,
  Alert,
  Center,
  Loader,
  Button,
  RingProgress,
  Divider,
  ThemeIcon,
  Table,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconRefresh,
  IconTrendingUp,
  IconTrendingDown,
  IconWind,
  IconActivity,
  IconStack2,
  IconShieldCheck,
  IconShieldExclamation,
  IconShieldOff,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";
import {
  SIGNAL_SPECS,
  SCORE_MIN,
  SCORE_MAX,
  RISK_ON_MIN,
  NEUTRAL_MIN,
  type Regime,
} from "@/lib/sentiment";

const PANEL_BG =
  "color-mix(in srgb, var(--mantine-color-dark-7) 55%, transparent)";
const SCORE_ITEM_BG =
  "color-mix(in srgb, var(--mantine-color-dark-6) 40%, transparent)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalBase {
  score: number;
  label: string;
}
interface TrendSignal extends SignalBase {
  qqq: number;
  sma50: number | null;
  sma200: number | null;
  vs50Score: number;
  vs200Score: number;
}
interface VolatilitySignal extends SignalBase {
  vix: number | null;
  vixSlope: number | null;
}
interface MomentumSignal extends SignalBase {
  rsi: number;
  return10d: number;
}
interface StressSignal extends SignalBase {
  drawdown20: number;
}
interface SlopeSignal extends SignalBase {
  sma200Slope: number | null;
}
interface TermSignal extends SignalBase {
  ratio: number | null;
  vix3m: number | null;
}

interface HistoryPoint {
  date: string;
  qqq: number;
  sma50: number | null;
  sma200: number | null;
  rsi: number;
  vix: number | null;
  score: number;
  regime?: Regime;
}

interface RegimeStat {
  regime: Regime;
  count: number;
  avgReturn: number;
  winRate: number;
  avgVol: number;
}
interface Backtest {
  horizonDays: number;
  sampleFrom: string;
  stats: RegimeStat[];
}

interface SentimentData {
  asOf: string;
  regime: Regime;
  score: number;
  action: string;
  daysInRegime: number;
  signals: {
    trend: TrendSignal;
    volatility: VolatilitySignal;
    momentum: MomentumSignal;
    stress: StressSignal;
    slope: SlopeSignal;
    term: TermSignal;
  };
  backtest: Backtest;
  history: HistoryPoint[];
}

type ChartMode = "price" | "score" | "rsi" | "vix";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtPrice = (v: number | null) => (v != null ? `$${v.toFixed(2)}` : "—");

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

const fmtNum = (v: number | null, dec = 1) =>
  v != null ? v.toFixed(dec) : "—";

const fmtScore = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function regimeColor(r: Regime): string {
  if (r === "Risk-On") return "teal";
  if (r === "Neutral") return "yellow";
  return "red";
}

// Map a total score onto the ring fill using the real achievable range.
function scoreToRingPct(score: number): number {
  const pct = ((score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

// How far the score is from the next regime up — drives the hero hint.
function regimeHint(score: number, regime: Regime): string {
  if (regime === "Risk-On") return "Full risk-on threshold met.";
  if (regime === "Neutral")
    return `Needs +${RISK_ON_MIN - score} more to reach Risk-On.`;
  return `Needs +${NEUTRAL_MIN - score} more to leave Risk-Off.`;
}

function isStale(asOf: string): boolean {
  const d = new Date(asOf + "T00:00:00Z");
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days > 4; // > a long weekend → likely a data gap
}

function RegimeIcon({ regime }: { regime: Regime }) {
  if (regime === "Risk-On")
    return <IconShieldCheck size={28} color="var(--mantine-color-teal-4)" />;
  if (regime === "Neutral")
    return (
      <IconShieldExclamation size={28} color="var(--mantine-color-yellow-4)" />
    );
  return <IconShieldOff size={28} color="var(--mantine-color-red-4)" />;
}

// Score pill: +2 / -1 etc.
function ScorePill({ score }: { score: number }) {
  const c = score > 0 ? "teal" : score < 0 ? "red" : "gray";
  return (
    <Badge color={c} variant="light" size="xs" style={{ flexShrink: 0 }}>
      {fmtScore(score)}
    </Badge>
  );
}

// A single signal row
function SignalRow({
  icon,
  label,
  value,
  sub,
  score,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  score: number;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        {icon}
        <Box style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" truncate>
            {label}
          </Text>
          <Text size="sm" fw={500} truncate>
            {value}
          </Text>
          {sub && (
            <Text size="xs" c="dimmed">
              {sub}
            </Text>
          )}
        </Box>
      </Group>
      <ScorePill score={score} />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SentimentPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const color = useAccountColor();

  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>(() => {
    if (typeof window === "undefined") return "price";
    const saved = localStorage.getItem("tqqq-sentiment-chart");
    return saved === "score" || saved === "rsi" || saved === "vix" ? saved : "price";
  });

  const handleChartMode = (mode: ChartMode) => {
    setChartMode(mode);
    localStorage.setItem("tqqq-sentiment-chart", mode);
  };

  // Hooks must run unconditionally — keep them above any early return.
  const heroBg = useCardBg(data ? regimeColor(data.regime) : "gray");

  async function load(fresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(fresh ? "/api/sentiment?fresh=1" : "/api/sentiment");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json as SentimentData);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load sentiment data",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const tickFormatter = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });

  // Normalise QQQ / SMA lines for the price chart (start = 100)
  const chartData = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
    if (chartMode === "score") {
      return data.history.map((h) => ({ date: h.date, Score: h.score }));
    }
    if (chartMode === "rsi") {
      return data.history.map((h) => ({ date: h.date, RSI: h.rsi }));
    }
    if (chartMode === "vix") {
      return data.history.map((h) => ({ date: h.date, VIX: h.vix }));
    }
    const first = data.history[0]?.qqq ?? 1;
    return data.history.map((h) => ({
      date: h.date,
      QQQ: Math.round((h.qqq / first) * 1000) / 10,
      "50 SMA":
        h.sma50 != null ? Math.round((h.sma50 / first) * 1000) / 10 : null,
      "200 SMA":
        h.sma200 != null ? Math.round((h.sma200 / first) * 1000) / 10 : null,
    }));
  }, [data, chartMode]);

  // Contiguous Risk-On / Risk-Off stretches, shaded behind every chart mode.
  // Neutral stays unshaded so the extremes stand out.
  const regimeBands = useMemo(() => {
    if (!data) return [];
    const bands: { x1: string; x2: string; regime: Regime }[] = [];
    for (const h of data.history) {
      if (!h.regime) continue;
      const last = bands[bands.length - 1];
      if (last && last.regime === h.regime) last.x2 = h.date;
      else bands.push({ x1: h.date, x2: h.date, regime: h.regime });
    }
    return bands.filter((b) => b.regime !== "Neutral");
  }, [data]);

  if (loading) {
    return (
      <Center py="xl">
        <Group gap="xs">
          <Loader size="sm" color={color} />
          <Text c="dimmed">Loading regime data…</Text>
        </Group>
      </Center>
    );
  }

  if (error) {
    return (
      <Alert
        color="red"
        icon={<IconAlertTriangle size={16} />}
        radius={CARD_RADIUS}
      >
        {error}
      </Alert>
    );
  }

  if (!data) return null;

  const { regime, score, action, signals, backtest } = data;
  const rc = regimeColor(regime);
  const ringPct = scoreToRingPct(score);
  const stale = isStale(data.asOf);

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Box>
          <Text size="xl" fw={700}>
            Sentiment
          </Text>
          <Text size="sm" c="dimmed">
            TQQQ regime dashboard · QQQ + VIX term structure · as of{" "}
            {fmtDate(data.asOf)}
          </Text>
        </Box>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconRefresh size={14} />}
          onClick={() => load(true)}
          loading={loading}
        >
          Refresh
        </Button>
      </Group>

      {stale && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          radius={CARD_RADIUS}
          py="xs"
        >
          Latest data is from {fmtDate(data.asOf)} — markets may be closed or
          the feed is stale.
        </Alert>
      )}

      {/* Hero regime card */}
      <Paper p="xl" radius={CARD_RADIUS} style={{ background: heroBg }}>
        <Group
          justify="space-between"
          align="center"
          wrap={isMobile ? "wrap" : "nowrap"}
        >
          <Group gap="lg" align="center">
            <RingProgress
              size={90}
              thickness={8}
              roundCaps
              sections={[{ value: ringPct, color: `${rc}.5` }]}
              label={
                <Center>
                  <RegimeIcon regime={regime} />
                </Center>
              }
            />
            <Box>
              <Badge color={rc} size="xl" variant="filled" radius="sm" mb={4}>
                {regime}
              </Badge>
              <Text size="xs" c="dimmed" mt={2}>
                Score: {fmtScore(score)} / +{SCORE_MAX} · held{" "}
                {data.daysInRegime}d
              </Text>
              <Text size="xs" c="dimmed">
                {regimeHint(score, regime)}
              </Text>
            </Box>
          </Group>
          <Box style={{ maxWidth: isMobile ? "100%" : 340 }}>
            <Text size="sm" c="dimmed" fw={500} mb={4}>
              Suggested action
            </Text>
            <Text size="sm">{action}</Text>
          </Box>
        </Group>
      </Paper>

      {/* Signal panels — 3 / 2 / 2 rows: trend | volatility | momentum+stress */}
      <Stack gap="md">
        {/* Row 1: Trend signals (3 cols) */}
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {/* 200-day Trend */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              200-Day Trend
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={signals.trend.vs200Score > 0 ? "teal" : "red"}
                    size="sm"
                    radius="xl"
                  >
                    <IconTrendingUp size={12} />
                  </ThemeIcon>
                }
                label="QQQ vs 200-day SMA"
                value={fmtPrice(signals.trend.qqq)}
                sub={`200 SMA: ${fmtPrice(signals.trend.sma200)}`}
                score={signals.trend.vs200Score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Structure
                </Text>
                <Badge
                  color={
                    signals.trend.label === "Bull"
                      ? "teal"
                      : signals.trend.label === "Caution"
                        ? "yellow"
                        : "red"
                  }
                  variant="light"
                  size="sm"
                >
                  {signals.trend.label}
                </Badge>
              </Group>
            </Stack>
          </Paper>

          {/* 50-day Trend */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              50-Day Trend
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={signals.trend.vs50Score > 0 ? "teal" : "red"}
                    size="sm"
                    radius="xl"
                  >
                    <IconTrendingUp size={12} />
                  </ThemeIcon>
                }
                label="QQQ vs 50-day SMA"
                value={fmtPrice(signals.trend.qqq)}
                sub={`50 SMA: ${fmtPrice(signals.trend.sma50)}`}
                score={signals.trend.vs50Score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  vs 50-day
                </Text>
                <Text
                  size="sm"
                  fw={500}
                  c={
                    signals.trend.vs50Score > 0
                      ? "teal.4"
                      : signals.trend.vs50Score < 0
                        ? "red.4"
                        : "dimmed"
                  }
                >
                  {signals.trend.sma50 != null
                    ? `${((signals.trend.qqq / signals.trend.sma50 - 1) * 100).toFixed(1)}%`
                    : "—"}
                </Text>
              </Group>
            </Stack>
          </Paper>

          {/* Trend Direction (200-day slope) */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              Trend Direction
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={
                      signals.slope.score > 0
                        ? "teal"
                        : signals.slope.score < 0
                          ? "red"
                          : "gray"
                    }
                    size="sm"
                    radius="xl"
                  >
                    {signals.slope.score >= 0 ? (
                      <IconTrendingUp size={12} />
                    ) : (
                      <IconTrendingDown size={12} />
                    )}
                  </ThemeIcon>
                }
                label="200-day SMA slope (10d)"
                value={
                  signals.slope.sma200Slope != null
                    ? `${signals.slope.sma200Slope > 0 ? "+" : ""}${signals.slope.sma200Slope.toFixed(2)}%`
                    : "—"
                }
                sub="rising or declining"
                score={signals.slope.score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  200-day direction
                </Text>
                <Badge
                  color={
                    signals.slope.label === "Rising"
                      ? "teal"
                      : signals.slope.label === "Flat"
                        ? "gray"
                        : signals.slope.label === "Slowing"
                          ? "yellow"
                          : "red"
                  }
                  variant="light"
                  size="sm"
                >
                  {signals.slope.label}
                </Badge>
              </Group>
            </Stack>
          </Paper>
        </SimpleGrid>

        {/* Row 2: Volatility signals (2 cols) */}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {/* Volatility */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              Volatility
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={
                      signals.volatility.score > 0
                        ? "teal"
                        : signals.volatility.score < 0
                          ? "red"
                          : "gray"
                    }
                    size="sm"
                    radius="xl"
                  >
                    <IconWind size={12} />
                  </ThemeIcon>
                }
                label="VIX level"
                value={
                  signals.volatility.vix != null
                    ? signals.volatility.vix.toFixed(1)
                    : "—"
                }
                sub={
                  signals.volatility.vixSlope != null
                    ? `5-day slope: ${signals.volatility.vixSlope > 0 ? "+" : ""}${signals.volatility.vixSlope.toFixed(2)}`
                    : undefined
                }
                score={signals.volatility.score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  VIX trend
                </Text>
                <Badge
                  color={
                    signals.volatility.label === "Falling"
                      ? "teal"
                      : signals.volatility.label === "Stable"
                        ? "gray"
                        : "red"
                  }
                  variant="light"
                  size="sm"
                >
                  {signals.volatility.label}
                </Badge>
              </Group>
            </Stack>
          </Paper>

          {/* Term structure */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              VIX Term Structure
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={
                      signals.term.score > 0
                        ? "teal"
                        : signals.term.score < 0
                          ? "red"
                          : "gray"
                    }
                    size="sm"
                    radius="xl"
                  >
                    <IconStack2 size={12} />
                  </ThemeIcon>
                }
                label="VIX ÷ VIX3M ratio"
                value={
                  signals.term.ratio != null
                    ? signals.term.ratio.toFixed(3)
                    : "—"
                }
                sub={
                  signals.term.vix3m != null
                    ? `VIX3M: ${signals.term.vix3m.toFixed(1)}`
                    : "front vs 3-month vol"
                }
                score={signals.term.score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Curve
                </Text>
                <Badge
                  color={
                    signals.term.label === "Contango"
                      ? "teal"
                      : signals.term.label === "Normal"
                        ? "gray"
                        : signals.term.label === "Flattening"
                          ? "yellow"
                          : "red"
                  }
                  variant="light"
                  size="sm"
                >
                  {signals.term.label}
                </Badge>
              </Group>
            </Stack>
          </Paper>
        </SimpleGrid>

        {/* Row 3: Momentum + Stress (2 cols) */}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {/* Momentum */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              Momentum
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={
                      signals.momentum.score > 0
                        ? "teal"
                        : signals.momentum.score < 0
                          ? "red"
                          : "gray"
                    }
                    size="sm"
                    radius="xl"
                  >
                    <IconActivity size={12} />
                  </ThemeIcon>
                }
                label="RSI (14-day)"
                value={fmtNum(signals.momentum.rsi)}
                sub="45–70 = healthy; <35 = stress"
                score={signals.momentum.score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  10-day return (QQQ)
                </Text>
                <Text
                  size="sm"
                  fw={500}
                  c={signals.momentum.return10d >= 0 ? "teal.4" : "red.4"}
                >
                  {fmtPct(signals.momentum.return10d)}
                </Text>
              </Group>
            </Stack>
          </Paper>

          {/* Stress */}
          <Paper
            p="md"
            radius={CARD_RADIUS}
            withBorder
            style={{ background: PANEL_BG }}
          >
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
              Drawdown Stress
            </Text>
            <Stack gap="md">
              <SignalRow
                icon={
                  <ThemeIcon
                    variant="light"
                    color={
                      signals.stress.score >= 0
                        ? "teal"
                        : signals.stress.score === -1
                          ? "yellow"
                          : "red"
                    }
                    size="sm"
                    radius="xl"
                  >
                    <IconTrendingDown size={12} />
                  </ThemeIcon>
                }
                label="20-day peak-to-trough"
                value={fmtPct(signals.stress.drawdown20)}
                sub=">−5% = caution; >−10% = danger"
                score={signals.stress.score}
              />
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Stress level
                </Text>
                <Badge
                  color={
                    signals.stress.label === "Low"
                      ? "teal"
                      : signals.stress.label === "Caution"
                        ? "yellow"
                        : "red"
                  }
                  variant="light"
                  size="sm"
                >
                  {signals.stress.label}
                </Badge>
              </Group>
            </Stack>
          </Paper>
        </SimpleGrid>
      </Stack>

      {/* Backtest — does the regime actually separate good days from bad? */}
      <Paper
        p="md"
        radius={CARD_RADIUS}
        withBorder
        style={{ background: PANEL_BG }}
      >
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={500}>
            Regime backtest
          </Text>
          <Text size="xs" c="dimmed">
            Forward {backtest.horizonDays}-day QQQ return by regime · since{" "}
            {fmtDate(backtest.sampleFrom)}
          </Text>
        </Group>
        <Table
          verticalSpacing="xs"
          horizontalSpacing="md"
          fz="sm"
          withRowBorders={false}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Regime</Table.Th>
              <Table.Th ta="right">Days</Table.Th>
              <Table.Th ta="right">Avg fwd return</Table.Th>
              <Table.Th ta="right">Win rate</Table.Th>
              <Table.Th ta="right">Fwd volatility</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {backtest.stats.map((s) => (
              <Table.Tr key={s.regime}>
                <Table.Td>
                  <Badge
                    color={regimeColor(s.regime)}
                    variant="light"
                    size="sm"
                  >
                    {s.regime}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {s.count}
                </Table.Td>
                <Table.Td
                  ta="right"
                  fw={600}
                  c={s.avgReturn >= 0 ? "teal.4" : "red.4"}
                >
                  {fmtPct(s.avgReturn)}
                </Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {Math.round(s.winRate * 100)}%
                </Table.Td>
                <Table.Td
                  ta="right"
                  fw={600}
                  c={
                    s.avgVol > 0.3
                      ? "red.4"
                      : s.avgVol > 0.2
                        ? "yellow.4"
                        : "teal.4"
                  }
                >
                  {Math.round(s.avgVol * 100)}%
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">
          For a 3x ETF, <b>volatility</b> — not average direction — is the
          threat: Risk-Off days carry far higher forward volatility (decay), and
          win-rate falls, even though average return mean-reverts off washout
          lows. Past behaviour, not a forecast.
        </Text>
      </Paper>

      {/* Chart */}
      <Paper
        p="md"
        radius={CARD_RADIUS}
        withBorder
        style={{ background: PANEL_BG }}
      >
        <Group justify="space-between" mb="sm">
          <Text size="sm" fw={500}>
            1-Year Chart
          </Text>
          <Group gap="xs">
            {(["price", "score", "rsi", "vix"] as const).map((mode) => (
              <Button
                key={mode}
                size="xs"
                variant={chartMode === mode ? "filled" : "subtle"}
                color={chartMode === mode ? color : "gray"}
                onClick={() => handleChartMode(mode)}
              >
                {mode === "price"
                  ? "QQQ + MAs"
                  : mode === "score"
                    ? "Score"
                    : mode.toUpperCase()}
              </Button>
            ))}
          </Group>
        </Group>
        <Box h={isMobile ? 220 : 300}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--mantine-color-dark-4)"
              />
              {regimeBands.map((b) => (
                <ReferenceArea
                  key={b.x1}
                  x1={b.x1}
                  x2={b.x2}
                  fill={`var(--mantine-color-${regimeColor(b.regime)}-5)`}
                  fillOpacity={0.07}
                  stroke="none"
                />
              ))}
              <XAxis
                dataKey="date"
                tickFormatter={tickFormatter}
                minTickGap={40}
                fontSize={11}
              />
              <YAxis
                fontSize={11}
                width={chartMode === "price" ? 52 : 40}
                tickFormatter={(v) =>
                  chartMode === "price"
                    ? `${v.toFixed(0)}%`
                    : String(v.toFixed(0))
                }
                domain={
                  chartMode === "rsi"
                    ? [0, 100]
                    : chartMode === "score"
                      ? [SCORE_MIN, SCORE_MAX]
                      : ["auto", "auto"]
                }
              />
              <ChartTooltip
                labelFormatter={(l) => fmtDate(String(l))}
                contentStyle={{
                  background: "var(--mantine-color-dark-7)",
                  border: "none",
                  borderRadius: 8,
                }}
              />
              {chartMode === "price" && (
                <>
                  <Line
                    type="monotone"
                    dataKey="QQQ"
                    stroke="var(--mantine-color-blue-4)"
                    dot={false}
                    strokeWidth={1.75}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="50 SMA"
                    stroke="var(--mantine-color-orange-4)"
                    dot={false}
                    strokeWidth={1.25}
                    strokeDasharray="4 2"
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="200 SMA"
                    stroke="var(--mantine-color-red-5)"
                    dot={false}
                    strokeWidth={1.25}
                    strokeDasharray="4 2"
                    isAnimationActive={false}
                    connectNulls
                  />
                </>
              )}
              {chartMode === "score" && (
                <>
                  <ReferenceLine
                    y={RISK_ON_MIN}
                    stroke="var(--mantine-color-teal-5)"
                    strokeDasharray="3 3"
                    label={{
                      value: `Risk-On +${RISK_ON_MIN}`,
                      fill: "var(--mantine-color-teal-4)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={NEUTRAL_MIN}
                    stroke="var(--mantine-color-red-5)"
                    strokeDasharray="3 3"
                    label={{
                      value: "Risk-Off",
                      fill: "var(--mantine-color-red-4)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Score"
                    stroke="var(--mantine-color-grape-4)"
                    fill="var(--mantine-color-grape-9)"
                    fillOpacity={0.25}
                    strokeWidth={1.75}
                    isAnimationActive={false}
                  />
                </>
              )}
              {chartMode === "rsi" && (
                <>
                  <ReferenceLine
                    y={70}
                    stroke="var(--mantine-color-red-5)"
                    strokeDasharray="3 3"
                    label={{
                      value: "70",
                      fill: "var(--mantine-color-red-4)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={40}
                    stroke="var(--mantine-color-teal-5)"
                    strokeDasharray="3 3"
                    label={{
                      value: "40",
                      fill: "var(--mantine-color-teal-4)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="RSI"
                    stroke="var(--mantine-color-violet-4)"
                    dot={false}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </>
              )}
              {chartMode === "vix" && (
                <>
                  <ReferenceLine
                    y={30}
                    stroke="var(--mantine-color-red-5)"
                    strokeDasharray="3 3"
                    label={{
                      value: "30",
                      fill: "var(--mantine-color-red-4)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={20}
                    stroke="var(--mantine-color-yellow-5)"
                    strokeDasharray="3 3"
                    label={{
                      value: "20",
                      fill: "var(--mantine-color-yellow-4)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="VIX"
                    stroke="var(--mantine-color-orange-4)"
                    dot={false}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                    connectNulls
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* Scoring legend — generated from the shared tier tables */}
      <Paper
        p="md"
        radius={CARD_RADIUS}
        withBorder
        style={{ background: PANEL_BG }}
      >
        <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">
          Scoring model
        </Text>
        {/* 3+4 layout: trend signals on top, the rest below */}
        {[
          ["vs200", "vs50", "slope"],
          ["vix", "term", "momentum", "stress"],
        ].map((keys, rowIdx) => (
          <SimpleGrid
            key={rowIdx}
            cols={{ base: 1, sm: keys.length as 3 | 4 }}
            spacing="xs"
            mb="xs"
          >
            {SIGNAL_SPECS.filter(({ key }) => keys.includes(key))
              .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))
              .map(({ key, label, tiers }) => (
                <Box
                  key={key}
                  p="xs"
                  style={{
                    background: SCORE_ITEM_BG,
                    borderRadius: CARD_RADIUS,
                    border: "1px solid var(--mantine-color-dark-4)",
                  }}
                >
                  <Text size="xs" c="dimmed" fw={500} mb={6}>
                    {label}
                  </Text>
                  <Stack gap={3}>
                    {tiers.map((t) => (
                      <Group key={t.desc} gap={6} wrap="nowrap">
                        <Badge
                          color={t.color}
                          variant="light"
                          size="xs"
                          w={28}
                          style={{ flexShrink: 0, textAlign: "center" }}
                        >
                          {fmtScore(t.score)}
                        </Badge>
                        <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>
                          {t.desc}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                </Box>
              ))}
          </SimpleGrid>
        ))}
        <Divider my="sm" />
        <Group gap="md">
          {[
            {
              label: `+${RISK_ON_MIN} to +${SCORE_MAX} → Risk-On`,
              color: "teal",
            },
            {
              label: `${NEUTRAL_MIN} to +${RISK_ON_MIN - 1} → Neutral`,
              color: "yellow",
            },
            {
              label: `${SCORE_MIN} to ${NEUTRAL_MIN - 1} → Risk-Off`,
              color: "red",
            },
          ].map(({ label, color }) => (
            <Badge key={label} color={color} variant="light" size="sm">
              {label}
            </Badge>
          ))}
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Regime changes use a 1-point hysteresis band to avoid day-to-day
          whipsaw. Model output, not financial advice.
        </Text>
      </Paper>
    </Stack>
  );
}
