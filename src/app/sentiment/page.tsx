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
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconRefresh,
  IconTrendingUp,
  IconTrendingDown,
  IconWind,
  IconActivity,
  IconShieldCheck,
  IconShieldExclamation,
  IconShieldOff,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ReferenceLine,
} from "recharts";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { fmtDate } from "@/lib/format";

const PANEL_BG = "color-mix(in srgb, var(--mantine-color-dark-7) 55%, transparent)";
const SCORE_ITEM_BG = "color-mix(in srgb, var(--mantine-color-dark-6) 40%, transparent)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalBase { score: number; label: string }
interface TrendSignal extends SignalBase {
  qqq: number; sma50: number | null; sma200: number | null;
  vs50Score: number; vs200Score: number;
}
interface VolatilitySignal extends SignalBase { vix: number | null; vixSlope: number | null }
interface MomentumSignal extends SignalBase { rsi: number; return10d: number }
interface StressSignal extends SignalBase { drawdown20: number }

interface HistoryPoint {
  date: string; qqq: number;
  sma50: number | null; sma200: number | null;
  rsi: number; vix: number | null;
}

interface SentimentData {
  asOf: string;
  regime: "Risk-On" | "Neutral" | "Risk-Off";
  score: number;
  action: string;
  signals: {
    trend: TrendSignal;
    volatility: VolatilitySignal;
    momentum: MomentumSignal;
    stress: StressSignal;
  };
  history: HistoryPoint[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtPrice = (v: number | null) =>
  v != null ? `$${v.toFixed(2)}` : "—";

const fmtPct = (v: number) =>
  `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

const fmtNum = (v: number | null, dec = 1) =>
  v != null ? v.toFixed(dec) : "—";

function regimeColor(r: "Risk-On" | "Neutral" | "Risk-Off"): string {
  if (r === "Risk-On") return "teal";
  if (r === "Neutral") return "yellow";
  return "red";
}

// Score range: −12 (worst) to +8 (best) = 20-point span.
function scoreToRingPct(score: number): number {
  return Math.round(Math.max(0, Math.min(100, ((score + 12) / 20) * 100)));
}

function RegimeIcon({ regime }: { regime: "Risk-On" | "Neutral" | "Risk-Off" }) {
  if (regime === "Risk-On") return <IconShieldCheck size={28} color="var(--mantine-color-teal-4)" />;
  if (regime === "Neutral") return <IconShieldExclamation size={28} color="var(--mantine-color-yellow-4)" />;
  return <IconShieldOff size={28} color="var(--mantine-color-red-4)" />;
}

// Score pill: +2 / -1 etc.
function ScorePill({ score }: { score: number }) {
  const c = score > 0 ? "teal" : score < 0 ? "red" : "gray";
  return (
    <Badge color={c} variant="light" size="xs">
      {score > 0 ? `+${score}` : score}
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
          <Text size="xs" c="dimmed" truncate>{label}</Text>
          <Text size="sm" fw={500} truncate>{value}</Text>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
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
  const [chartMode, setChartMode] = useState<"price" | "rsi" | "vix">("price");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sentiment");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json as SentimentData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sentiment data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const tickFormatter = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  // Normalise QQQ / SMA lines for the price chart (start = 100)
  const chartData = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
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
      "50 SMA": h.sma50 != null ? Math.round((h.sma50 / first) * 1000) / 10 : null,
      "200 SMA": h.sma200 != null ? Math.round((h.sma200 / first) * 1000) / 10 : null,
    }));
  }, [data, chartMode]);

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
      <Alert color="red" icon={<IconAlertTriangle size={16} />} radius={CARD_RADIUS}>
        {error}
      </Alert>
    );
  }

  if (!data) return null;

  const { regime, score, action, signals } = data;
  const rc = regimeColor(regime);
  const heroBg = useCardBg(rc);
  const ringPct = scoreToRingPct(score);

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Box>
          <Text size="xl" fw={700}>Sentiment</Text>
          <Text size="sm" c="dimmed">
            TQQQ regime dashboard · QQQ + VIX · as of {fmtDate(data.asOf)}
          </Text>
        </Box>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconRefresh size={14} />}
          onClick={load}
          loading={loading}
        >
          Refresh
        </Button>
      </Group>

      {/* Hero regime card */}
      <Paper p="xl" radius={CARD_RADIUS} style={{ background: heroBg }}>
        <Group justify="space-between" align="center" wrap={isMobile ? "wrap" : "nowrap"}>
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
                Score: {score > 0 ? `+${score}` : score} / +8
              </Text>
            </Box>
          </Group>
          <Box style={{ maxWidth: isMobile ? "100%" : 340 }}>
            <Text size="sm" c="dimmed" fw={500} mb={4}>Suggested action</Text>
            <Text size="sm">{action}</Text>
          </Box>
        </Group>
      </Paper>

      {/* Signal panels */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {/* Trend */}
        <Paper p="md" radius={CARD_RADIUS} withBorder style={{ background: PANEL_BG }}>
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">Trend</Text>
          <Stack gap="md">
            <SignalRow
              icon={<ThemeIcon variant="light" color={signals.trend.vs200Score > 0 ? "teal" : "red"} size="sm" radius="xl"><IconTrendingUp size={12} /></ThemeIcon>}
              label="QQQ vs 200-day SMA"
              value={fmtPrice(signals.trend.qqq)}
              sub={`200 SMA: ${fmtPrice(signals.trend.sma200)}`}
              score={signals.trend.vs200Score}
            />
            <SignalRow
              icon={<ThemeIcon variant="light" color={signals.trend.vs50Score > 0 ? "teal" : "red"} size="sm" radius="xl"><IconTrendingUp size={12} /></ThemeIcon>}
              label="QQQ vs 50-day SMA"
              value={fmtPrice(signals.trend.qqq)}
              sub={`50 SMA: ${fmtPrice(signals.trend.sma50)}`}
              score={signals.trend.vs50Score}
            />
            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Structure</Text>
              <Badge
                color={signals.trend.label === "Bull" ? "teal" : signals.trend.label === "Caution" ? "yellow" : "red"}
                variant="light"
                size="sm"
              >
                {signals.trend.label}
              </Badge>
            </Group>
          </Stack>
        </Paper>

        {/* Volatility */}
        <Paper p="md" radius={CARD_RADIUS} withBorder style={{ background: PANEL_BG }}>
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">Volatility</Text>
          <Stack gap="md">
            <SignalRow
              icon={<ThemeIcon variant="light" color={signals.volatility.score > 0 ? "teal" : signals.volatility.score < 0 ? "red" : "gray"} size="sm" radius="xl"><IconWind size={12} /></ThemeIcon>}
              label="VIX level"
              value={signals.volatility.vix != null ? signals.volatility.vix.toFixed(1) : "—"}
              sub={signals.volatility.vixSlope != null
                ? `5-day slope: ${signals.volatility.vixSlope > 0 ? "+" : ""}${signals.volatility.vixSlope.toFixed(2)}`
                : undefined}
              score={signals.volatility.score}
            />
            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">VIX trend</Text>
              <Badge
                color={signals.volatility.label === "Falling" ? "teal" : signals.volatility.label === "Stable" ? "gray" : "red"}
                variant="light"
                size="sm"
              >
                {signals.volatility.label}
              </Badge>
            </Group>
          </Stack>
        </Paper>

        {/* Momentum */}
        <Paper p="md" radius={CARD_RADIUS} withBorder style={{ background: PANEL_BG }}>
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">Momentum</Text>
          <Stack gap="md">
            <SignalRow
              icon={<ThemeIcon variant="light" color={signals.momentum.score > 0 ? "teal" : signals.momentum.score < 0 ? "red" : "gray"} size="sm" radius="xl"><IconActivity size={12} /></ThemeIcon>}
              label="RSI (14-day)"
              value={fmtNum(signals.momentum.rsi)}
              sub="40–70 = healthy; <35 = stress"
              score={signals.momentum.score}
            />
            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">10-day return (QQQ)</Text>
              <Text size="sm" fw={500} c={signals.momentum.return10d >= 0 ? "teal.4" : "red.4"}>
                {fmtPct(signals.momentum.return10d)}
              </Text>
            </Group>
          </Stack>
        </Paper>

        {/* Stress */}
        <Paper p="md" radius={CARD_RADIUS} withBorder style={{ background: PANEL_BG }}>
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">Drawdown Stress</Text>
          <Stack gap="md">
            <SignalRow
              icon={<ThemeIcon variant="light" color={signals.stress.score === 0 ? "teal" : signals.stress.score === -1 ? "yellow" : "red"} size="sm" radius="xl"><IconTrendingDown size={12} /></ThemeIcon>}
              label="20-day peak-to-trough"
              value={fmtPct(signals.stress.drawdown20)}
              sub=">−5% = caution; >−10% = danger"
              score={signals.stress.score}
            />
            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Stress level</Text>
              <Badge
                color={signals.stress.label === "Low" ? "teal" : signals.stress.label === "Caution" ? "yellow" : "red"}
                variant="light"
                size="sm"
              >
                {signals.stress.label}
              </Badge>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Chart */}
      <Paper p="md" radius={CARD_RADIUS} withBorder style={{ background: PANEL_BG }}>
        <Group justify="space-between" mb="sm">
          <Text size="sm" fw={500}>1-Year Chart</Text>
          <Group gap="xs">
            {(["price", "rsi", "vix"] as const).map((m) => (
              <Button
                key={m}
                size="xs"
                variant={chartMode === m ? "filled" : "subtle"}
                color={chartMode === m ? color : "gray"}
                onClick={() => setChartMode(m)}
              >
                {m === "price" ? "QQQ + MAs" : m.toUpperCase()}
              </Button>
            ))}
          </Group>
        </Group>
        <Box h={isMobile ? 220 : 300}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
              <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={40} fontSize={11} />
              <YAxis
                fontSize={11}
                width={chartMode === "price" ? 52 : 40}
                tickFormatter={(v) => chartMode === "price" ? `${v.toFixed(0)}%` : String(v.toFixed(0))}
                domain={chartMode === "rsi" ? [0, 100] : ["auto", "auto"]}
              />
              <ChartTooltip
                labelFormatter={(l) => fmtDate(String(l))}
                contentStyle={{ background: "var(--mantine-color-dark-7)", border: "none", borderRadius: 8 }}
              />
              {chartMode === "price" && (
                <>
                  <Line type="monotone" dataKey="QQQ" stroke="var(--mantine-color-blue-4)" dot={false} strokeWidth={1.75} isAnimationActive={false} />
                  <Line type="monotone" dataKey="50 SMA" stroke="var(--mantine-color-orange-4)" dot={false} strokeWidth={1.25} strokeDasharray="4 2" isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="200 SMA" stroke="var(--mantine-color-red-5)" dot={false} strokeWidth={1.25} strokeDasharray="4 2" isAnimationActive={false} connectNulls />
                </>
              )}
              {chartMode === "rsi" && (
                <>
                  <ReferenceLine y={70} stroke="var(--mantine-color-red-5)" strokeDasharray="3 3" label={{ value: "70", fill: "var(--mantine-color-red-4)", fontSize: 10, position: "right" }} />
                  <ReferenceLine y={40} stroke="var(--mantine-color-teal-5)" strokeDasharray="3 3" label={{ value: "40", fill: "var(--mantine-color-teal-4)", fontSize: 10, position: "right" }} />
                  <Line type="monotone" dataKey="RSI" stroke="var(--mantine-color-violet-4)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                </>
              )}
              {chartMode === "vix" && (
                <>
                  <ReferenceLine y={30} stroke="var(--mantine-color-red-5)" strokeDasharray="3 3" label={{ value: "30", fill: "var(--mantine-color-red-4)", fontSize: 10, position: "right" }} />
                  <ReferenceLine y={20} stroke="var(--mantine-color-yellow-5)" strokeDasharray="3 3" label={{ value: "20", fill: "var(--mantine-color-yellow-4)", fontSize: 10, position: "right" }} />
                  <Line type="monotone" dataKey="VIX" stroke="var(--mantine-color-orange-4)" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* Scoring legend */}
      <Paper p="md" radius={CARD_RADIUS} withBorder style={{ background: PANEL_BG }}>
        <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb="sm">Scoring model</Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
          {([
            {
              label: "QQQ vs 200-day SMA",
              tiers: [
                { score: "+2", desc: ">5% above",    color: "teal" },
                { score: "+1", desc: "1–5% above",   color: "teal" },
                { score: "0",  desc: "within ±1%",   color: "gray" },
                { score: "−1", desc: "1–5% below",   color: "red" },
                { score: "−2", desc: ">5% below",    color: "red" },
              ],
            },
            {
              label: "QQQ vs 50-day SMA",
              tiers: [
                { score: "+2", desc: ">5% above",    color: "teal" },
                { score: "+1", desc: "1–5% above",   color: "teal" },
                { score: "0",  desc: "within ±1%",   color: "gray" },
                { score: "−1", desc: "1–5% below",   color: "red" },
                { score: "−2", desc: ">5% below",    color: "red" },
              ],
            },
            {
              label: "VIX level",
              tiers: [
                { score: "+1", desc: "VIX < 15", color: "teal" },
                { score: "0",  desc: "VIX 15–20", color: "gray" },
                { score: "−1", desc: "VIX 20–25 or rising", color: "orange" },
                { score: "−2", desc: "VIX 25–35", color: "red" },
                { score: "−3", desc: "VIX > 35", color: "red" },
              ],
            },
            {
              label: "RSI (14-day)",
              tiers: [
                { score: "+2", desc: "RSI 55–70 (strong)", color: "teal" },
                { score: "+1", desc: "RSI 45–55 or >70", color: "teal" },
                { score: "0",  desc: "RSI 35–45", color: "gray" },
                { score: "−1", desc: "RSI 30–35", color: "orange" },
                { score: "−2", desc: "RSI < 30", color: "red" },
              ],
            },
            {
              label: "20-day drawdown",
              tiers: [
                { score: "+1", desc: "< 1% (stable)", color: "teal" },
                { score: "0",  desc: "1–5%",          color: "gray" },
                { score: "−1", desc: "5–10%",         color: "orange" },
                { score: "−2", desc: "10–20%",        color: "red" },
                { score: "−3", desc: "> 20%",         color: "red" },
              ],
            },
          ] as const).map(({ label, tiers }) => (
            <Box
              key={label}
              p="xs"
              style={{
                background: SCORE_ITEM_BG,
                borderRadius: CARD_RADIUS,
                border: "1px solid var(--mantine-color-dark-4)",
              }}
            >
              <Text size="xs" c="dimmed" fw={500} mb={6}>{label}</Text>
              <Stack gap={3}>
                {tiers.map((t) => (
                  <Group key={t.desc} gap={6} wrap="nowrap">
                    <Badge color={t.color} variant="light" size="xs" w={28} style={{ flexShrink: 0, textAlign: "center" }}>
                      {t.score}
                    </Badge>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>{t.desc}</Text>
                  </Group>
                ))}
              </Stack>
            </Box>
          ))}
        </SimpleGrid>
        <Divider my="sm" />
        <Group gap="md">
          {[
            { label: "+4 to +8 → Risk-On", color: "teal" },
            { label: "0 to +3 → Neutral", color: "yellow" },
            { label: "−12 to −1 → Risk-Off", color: "red" },
          ].map(({ label, color }) => (
            <Badge key={label} color={color} variant="light" size="sm">{label}</Badge>
          ))}
        </Group>
      </Paper>
    </Stack>
  );
}
