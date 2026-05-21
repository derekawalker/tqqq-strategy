"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Stack,
  Group,
  Paper,
  Text,
  Badge,
  Skeleton,
  Box,
  Table,
  Tooltip,
  Button,
  ActionIcon,
  SegmentedControl,
  SimpleGrid,
  Accordion,
  Chip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconRefresh,
  IconCheck,
  IconX,
  IconTrendingUp,
  IconTrendingDown,
  IconArrowBounce,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  Tooltip as RechartsTooltip,
} from "recharts";
import type {
  PredictionPayload,
  FeatureReading,
} from "@/app/api/sentiment/route";
import type { MacroEvent } from "@/lib/macroCalendar";
import type { DailyRow, PredictionAccuracy } from "@/lib/predictionHistory";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { useCardBg } from "@/lib/hooks/useCardBg";
import {
  computeBottomIndicators,
  computeVerdict,
  scoreVerdict,
  type Verdict,
  type BottomIndicator,
  type VerdictInputs,
  type VerdictOutcome,
} from "@/lib/verdict";

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, withSign = true): string {
  if (v == null) return "—";
  const sign = withSign && v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtFraction(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

// Wilson 95% interval for a binomial rate. With small n, the "right rate"
// number alone is misleading — show the lower bound so a 65% on n=12 doesn't
// look more convincing than a 60% on n=200.
function wilsonInterval(
  successes: number,
  n: number,
): { lo: number; hi: number } | null {
  if (n === 0) return null;
  const p = successes / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: (center - margin) / denom, hi: (center + margin) / denom };
}

function featureValue(features: FeatureReading[], key: string): number | null {
  return features.find((f) => f.key === key)?.value ?? null;
}

// ── verdict logic ──────────────────────────────────────────────────────────────

function verdictInputsFromFeatures(features: FeatureReading[]): VerdictInputs {
  return {
    rsi14: featureValue(features, "rsi14"),
    vixLevel: featureValue(features, "vixLevel"),
    vix1dChange: featureValue(features, "vix1dChange"),
    qqq5dRet: featureValue(features, "qqq5dRet"),
    daysSinceHigh: featureValue(features, "daysSinceHigh"),
    vixTerm: featureValue(features, "vixTerm"),
    realizedVol20d: featureValue(features, "realizedVol20d"),
    tnxMom20d: featureValue(features, "tnxMom20d"),
    hyIefMom20d: featureValue(features, "hyIefMom20d"),
  };
}

function verdictInputsFromRow(row: DailyRow): VerdictInputs {
  return {
    rsi14: row.rsi14,
    vixLevel: row.vixLevel,
    vix1dChange: row.vix1dChange,
    qqq5dRet: row.qqq5dRet,
    daysSinceHigh: row.daysSinceHigh,
    vixTerm: row.vixTerm,
    realizedVol20d: row.realizedVol20d,
    tnxMom20d: row.tnxMom20d,
    hyIefMom20d: row.hyIefMom20d,
  };
}

const VERDICT_META: Record<
  Verdict,
  { label: string; color: string; Icon: typeof IconTrendingUp; sub: string }
> = {
  dca: {
    label: "BUY",
    color: "green",
    Icon: IconTrendingUp,
    sub: "Operate as usual",
  },
  skip: {
    label: "PAUSE",
    color: "orange",
    Icon: IconTrendingDown,
    sub: "Pause buying — drop likely",
  },
  catchup: {
    label: "BOTTOM",
    color: "violet",
    Icon: IconArrowBounce,
    sub: "Bottom is in — resume buying",
  },
};

// ── price sparkline ────────────────────────────────────────────────────────────

function PriceSparkline({
  prices,
  verdictColor,
  realizedRet,
}: {
  prices: PredictionPayload["recentPrices"];
  verdictColor: string;
  realizedRet?: number | null;
}) {
  const lastActualClose = prices.filter((p) => !p.predicted).at(-1)?.close ?? null;
  const actualOutcomeClose =
    lastActualClose != null && realizedRet != null
      ? Math.round(lastActualClose * (1 + realizedRet / 100) * 100) / 100
      : null;

  const allCloses = [
    ...prices.map((p) => p.close),
    ...(actualOutcomeClose != null ? [actualOutcomeClose] : []),
  ];
  const min = Math.min(...allCloses);
  const max = Math.max(...allCloses);
  const pad = (max - min) * 0.08 || 0.5;
  const domain: [number, number] = [min - pad, max + pad];

  // `actual`: solid line for historical closes
  // `projected`: dashed colored line from last actual → predicted
  // `outcome`: single dot at the predicted date showing where price actually landed
  const chartData = prices.map((p, i) => ({
    date: p.date,
    actual: p.predicted ? null : p.close,
    projected: (p.predicted || i === prices.length - 2) ? p.close : null,
    outcome: p.predicted ? actualOutcomeClose : null,
    // Bridge for outcome line: last actual close + outcome, so the line connects
    outcomeBridge: (p.predicted || i === prices.length - 2) ? (p.predicted ? actualOutcomeClose : p.close) : null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltipContent = (props: any) => {
    const d = props?.payload?.[0]?.payload as (typeof chartData)[0] | undefined;
    if (!d) return null;
    const close = d.actual ?? d.projected;
    const isPredicted = d.actual == null && d.projected != null;
    return (
      <Box
        style={{
          background: "rgba(26,27,30,0.92)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "4px 8px",
        }}
      >
        <Text size="xs" c="dimmed">{d.date}</Text>
        <Text size="xs" fw={600} c={isPredicted ? `${verdictColor}.4` : "gray.2"}>
          ${close?.toFixed(2)}{isPredicted ? " (proj)" : ""}
        </Text>
        {d.outcome != null && (
          <Text size="xs" fw={600} c={d.outcome >= (lastActualClose ?? d.outcome) ? "green.4" : "red.4"}>
            ${d.outcome.toFixed(2)} (actual)
          </Text>
        )}
      </Box>
    );
  };

  return (
    <Box style={{ width: "100%", height: 72 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
          <YAxis domain={domain} hide />
          <RechartsTooltip content={tooltipContent} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />

          {/* Solid line: actual closes */}
          <Line
            type="monotone"
            dataKey="actual"
            dot={{ r: 2, fill: "rgba(150,150,150,0.7)", strokeWidth: 0 }}
            activeDot={{ r: 3 }}
            stroke="rgba(150,150,150,0.6)"
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />

          {/* Dashed line: last actual → projected, tacked onto the solid line */}
          <Line
            type="monotone"
            dataKey="projected"
            dot={(props) => {
              const { cx, cy, index } = props as { cx: number; cy: number; index: number };
              if (index < chartData.length - 1) return <g key={`pd-${index}`} />;
              return (
                <circle
                  key="proj-dot"
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={`var(--mantine-color-${verdictColor}-5)`}
                  stroke={`var(--mantine-color-${verdictColor}-3)`}
                  strokeWidth={1.5}
                />
              );
            }}
            stroke={`var(--mantine-color-${verdictColor}-5)`}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            connectNulls={false}
            isAnimationActive={false}
          />

          {/* Solid line + dot + label: last actual → actual outcome */}
          {actualOutcomeClose != null && (
            <Line
              type="monotone"
              dataKey="outcomeBridge"
              dot={(props) => {
                const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                if (index < chartData.length - 1) return <g key={`ob-${index}`} />;
                const up = actualOutcomeClose >= (lastActualClose ?? actualOutcomeClose);
                return (
                  <circle
                    key="outcome-dot"
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={up ? "var(--mantine-color-green-5)" : "var(--mantine-color-red-5)"}
                    stroke={up ? "var(--mantine-color-green-3)" : "var(--mantine-color-red-3)"}
                    strokeWidth={1.5}
                  />
                );
              }}
              activeDot={false}
              stroke={actualOutcomeClose >= (lastActualClose ?? actualOutcomeClose)
                ? "var(--mantine-color-green-6)"
                : "var(--mantine-color-red-6)"}
              strokeWidth={1.5}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

// ── verdict card ───────────────────────────────────────────────────────────────

function VerdictCard({
  verdict,
  reason,
  predictedRet,
  predictionDate,
  recentPrices,
  realizedRet,
  outcome,
  onPrev,
  onNext,
  onFirst,
  onLast,
  canPrev,
  canNext,
}: {
  verdict: Verdict;
  reason: string;
  predictedRet: number;
  predictionDate: string;
  recentPrices?: PredictionPayload["recentPrices"];
  realizedRet?: number | null;
  outcome?: VerdictOutcome | null;
  onPrev?: () => void;
  onNext?: () => void;
  onFirst?: () => void;
  onLast?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}) {
  const meta = VERDICT_META[verdict];
  const bg = useCardBg(meta.color);
  const Icon = meta.Icon;

  return (
    <Paper p="xl" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="md" align="center">
        <Group justify="space-between" w="100%">
          <Group gap={2}>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={!canPrev}
              onClick={onLast}
              aria-label="Oldest"
            >
              <IconChevronsLeft size={18} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={!canPrev}
              onClick={onPrev}
              aria-label="Previous day"
            >
              <IconChevronLeft size={18} />
            </ActionIcon>
          </Group>
          <Text
            size="xs"
            c="dimmed"
            tt="uppercase"
            fw={600}
            style={{ letterSpacing: "0.12em" }}
          >
            Verdict for {predictionDate}
          </Text>
          <Group gap={2}>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={!canNext}
              onClick={onNext}
              aria-label="Next day"
            >
              <IconChevronRight size={18} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={!canNext}
              onClick={onFirst}
              aria-label="Latest"
            >
              <IconChevronsRight size={18} />
            </ActionIcon>
          </Group>
        </Group>

        <Group gap="md" align="center">
          <Icon size={56} color={`var(--mantine-color-${meta.color}-4)`} />
          <Stack gap={0}>
            <Text
              style={{ fontSize: "3rem", fontWeight: 800, lineHeight: 1 }}
              c={`${meta.color}.4`}
            >
              {meta.label}
            </Text>
            <Text size="sm" c="dimmed" mt={4}>
              {meta.sub}
            </Text>
          </Stack>
        </Group>

        <Text size="sm" ta="center" maw={520} c="gray.3">
          {reason}
        </Text>

        {recentPrices && recentPrices.length > 0 && (
          <Box style={{ width: "100%", maxWidth: 360 }}>
            <PriceSparkline prices={recentPrices} verdictColor={meta.color} realizedRet={realizedRet} />
          </Box>
        )}

        <Group gap="xl" mt="xs">
          <Stack gap={2} align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Predicted Δ
            </Text>
            <Text
              size="lg"
              fw={700}
              c={
                predictedRet > 0
                  ? "green.4"
                  : predictedRet < 0
                    ? "red.4"
                    : "dimmed"
              }
            >
              {fmtPct(predictedRet)}
            </Text>
          </Stack>
          {realizedRet != null && (
            <Stack gap={2} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Realized Δ
              </Text>
              <Text
                size="lg"
                fw={700}
                c={
                  realizedRet > 0
                    ? "green.4"
                    : realizedRet < 0
                      ? "red.4"
                      : "dimmed"
                }
              >
                {fmtPct(realizedRet)}
              </Text>
            </Stack>
          )}
          {outcome && (
            <Stack gap={2} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Outcome
              </Text>
              <Badge
                color={
                  outcome === "right"
                    ? "green"
                    : outcome === "wrong"
                      ? "red"
                      : "gray"
                }
                variant="light"
              >
                {outcome}
              </Badge>
            </Stack>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

// ── bottom-indicator checklist ─────────────────────────────────────────────────

function BottomChecklist({
  indicators,
  hits,
}: {
  indicators: BottomIndicator[];
  hits: number;
}) {
  const tone = hits >= 2 ? "violet" : hits >= 1 ? "yellow" : "gray";
  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{ background: "rgba(26,27,30,0.65)" }}
    >
      <Group justify="space-between" align="baseline" mb="sm">
        <Text
          size="xs"
          c="dimmed"
          tt="uppercase"
          fw={600}
          style={{ letterSpacing: "0.12em" }}
        >
          Bottom indicators
        </Text>
        <Badge color={tone} variant="light">
          {hits} of {indicators.length} triggered
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        When 3+ trigger together, the bottom looks in — resume buying even if
        the next-day prediction is still negative.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {indicators.map((ind) => (
          <Tooltip
            key={ind.label}
            label={ind.hint}
            multiline
            maw={260}
            withArrow
          >
            <Group
              gap="xs"
              wrap="nowrap"
              p="xs"
              style={{
                borderRadius: 8,
                background: ind.hit
                  ? "rgba(139,92,246,0.10)"
                  : "rgba(255,255,255,0.02)",
                border: ind.hit
                  ? "1px solid rgba(139,92,246,0.35)"
                  : "1px solid rgba(255,255,255,0.06)",
                cursor: "help",
              }}
            >
              {ind.hit ? (
                <IconCheck size={16} color="var(--mantine-color-violet-4)" />
              ) : (
                <IconX size={16} color="var(--mantine-color-dark-2)" />
              )}
              <Text size="sm" fw={600} style={{ flex: 1 }}>
                {ind.label}
              </Text>
              <Text size="sm" c={ind.hit ? "violet.3" : "dimmed"} fw={600}>
                {ind.detail}
              </Text>
            </Group>
          </Tooltip>
        ))}
      </SimpleGrid>
    </Paper>
  );
}

// ── retrain button ─────────────────────────────────────────────────────────────

function RetrainButton({ onRetrained }: { onRetrained: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetrain() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/retrain", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Retrain failed");
      } else {
        setResult(
          `Retrained on ${data.trainN} days · direction accuracy ${(data.directionAccuracy * 100).toFixed(1)}% · MAE ${data.magnitudeMae?.toFixed(2)}%`,
        );
        onRetrained();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="xs">
      <Button
        onClick={handleRetrain}
        loading={loading}
        leftSection={<IconRefresh size={16} />}
        variant="light"
        color="blue"
        size="sm"
      >
        Retrain &amp; refresh
      </Button>
      {result && (
        <Text size="xs" c="dimmed" ta="center">
          {result}
        </Text>
      )}
      {error && (
        <Text size="xs" c="red.4" ta="center">
          {error}
        </Text>
      )}
    </Stack>
  );
}

// ── warning cards ──────────────────────────────────────────────────────────────

function EventWarningCard({ events }: { events: MacroEvent[] }) {
  if (events.length === 0) return null;
  const labels = events.map((e) => e.label).join(" · ");
  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{
        background: "rgba(234,179,8,0.08)",
        border: "1px solid rgba(234,179,8,0.3)",
      }}
    >
      <Group gap="xs">
        <IconAlertTriangle size={16} color="rgb(234,179,8)" />
        <Text size="sm" fw={600} c="yellow.4">
          High-impact event{events.length > 1 ? "s" : ""} this week
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        {labels} — model uncertainty is higher around macro events
      </Text>
    </Paper>
  );
}

// ── feature table ──────────────────────────────────────────────────────────────

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  qqq1dRet:
    "QQQ's return today. Tests short-term mean reversion: large down days may precede bounces.",
  qqq3dRet: "QQQ return over the last 3 trading days.",
  qqq5dRet: "QQQ return over the last 5 trading days (one week).",
  vixLevel:
    "Current VIX level. Elevated fear often precedes short-term bounces but also signals real risk.",
  vix1dChange:
    "How much fear changed today. A big VIX spike often precedes a mean-reversion bounce.",
  vixTerm:
    "VIX / VIX3M ratio. Below 1 = contango (calm); above 1 = backwardation (near-term fear spike).",
  pctAbove200ma:
    "QQQ % above/below its 200-day moving average. Regime indicator.",
  realizedVol20d:
    "Annualized 20-day realized volatility. Higher vol = wider expected range tomorrow.",
  tnxMom20d:
    "20-day change in the 10-year yield (pp). Rising rates have historically been a headwind for QQQ.",
  volRatio:
    "Today's QQQ volume vs the 20-day average. High volume confirms moves.",
  rsi14: "14-day RSI on QQQ. <30 oversold, >70 overbought.",
  daysSinceHigh:
    "Trading days since QQQ's 20-day closing high. 0 = today is the high.",
  hyIefMom20d:
    "20-day % change in HYG/IEF ratio. HYG = high-yield corporate bonds, IEF = Treasuries. Falling = credit spreads widening = risk-off; often leads equity selloffs.",
  moveLevel:
    "ICE BofA MOVE index — implied volatility of Treasury options. Often leads VIX regime shifts; elevated MOVE precedes equity vol expansion.",
};

function FeatureTable({ features }: { features: FeatureReading[] }) {
  return (
    <Box style={{ overflowX: "auto" }}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Feature</Table.Th>
            <Table.Th ta="right">Value</Table.Th>
            <Table.Th ta="right">
              <Tooltip
                label="Z-score vs training mean. 0 = neutral, ±2 = significant."
                withArrow
                multiline
                maw={200}
              >
                <Text size="xs" fw={600} style={{ cursor: "help" }}>
                  Z-score
                </Text>
              </Tooltip>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {features.map((f) => {
            const desc = FEATURE_DESCRIPTIONS[f.key];
            return (
              <Table.Tr key={f.key}>
                <Table.Td>
                  <Group gap={4} align="flex-start" wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {f.name}
                    </Text>
                    {desc && (
                      <Tooltip label={desc} multiline maw={260} withArrow>
                        <Box
                          style={{
                            cursor: "help",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <Text size="xs" c="dimmed">
                            (?)
                          </Text>
                        </Box>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" ta="right">
                    {f.display}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text
                    size="sm"
                    ta="right"
                    c={
                      f.normalizedValue != null &&
                      Math.abs(f.normalizedValue) > 1.5
                        ? "yellow.4"
                        : undefined
                    }
                  >
                    {f.normalizedValue != null
                      ? f.normalizedValue.toFixed(2)
                      : "—"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

// ── accuracy panel ─────────────────────────────────────────────────────────────

function AccuracyPanel({
  accuracy,
  history,
  fullHistory,
  model,
}: {
  accuracy: PredictionAccuracy;
  history: DailyRow[];
  fullHistory: DailyRow[];
  model: {
    fittedAt: string | null;
    trainN: number | null;
  };
}) {
  const [range, setRange] = useState("1mo");
  const [verdictFilter, setVerdictFilter] = useState<Verdict[]>(["dca", "skip", "catchup"]);
  const [outcomeFilter, setOutcomeFilter] = useState<VerdictOutcome[]>(["right", "wrong", "neutral"]);
  const RANGE_DAYS: Record<string, number> = {
    "1mo": 21,
    "3mo": 63,
    "6mo": 126,
    "1yr": 252,
  };
  const days = RANGE_DAYS[range] ?? 21;

  interface ScoredRow {
    row: DailyRow;
    verdict: Verdict | null;
    outcome: VerdictOutcome | null;
  }

  function scoreRows(rows: DailyRow[]): ScoredRow[] {
    return rows.map((row) => {
      if (row.predicted1dRet == null)
        return { row, verdict: null, outcome: null };
      const inputs = verdictInputsFromRow(row);
      const hits = computeBottomIndicators(inputs).filter((i) => i.hit).length;
      const { verdict } = computeVerdict(
        row.predicted1dRet,
        hits,
        null,
        row.qqq5dRet,
        row.realizedVol20d,
        row.tnxMom20d,
      );
      const outcome =
        row.realized1dRet != null
          ? scoreVerdict(verdict, row.realized1dRet)
          : null;
      return { row, verdict, outcome };
    });
  }

  // Stats use full history so small-N buckets aren't misleading.
  const allScored: ScoredRow[] = scoreRows(fullHistory);
  // Grid also uses full history so the 1yr range (252 days) isn't capped at 120.
  // fullHistory is already newest-first from the API (loadRecentPredictions).
  void history;
  const scored: ScoredRow[] = allScored;

  const realizedScored = allScored.filter((s) => s.verdict && s.outcome);
  const rightCount = realizedScored.filter((s) => s.outcome === "right").length;
  const verdictRightRate =
    realizedScored.length > 0 ? rightCount / realizedScored.length : null;
  const verdictRightCI = wilsonInterval(rightCount, realizedScored.length);

  const byVerdict: Record<
    Verdict,
    {
      n: number;
      right: number;
      wrong: number;
      neutral: number;
      avgRealized: number;
    }
  > = {
    dca: { n: 0, right: 0, wrong: 0, neutral: 0, avgRealized: 0 },
    skip: { n: 0, right: 0, wrong: 0, neutral: 0, avgRealized: 0 },
    catchup: { n: 0, right: 0, wrong: 0, neutral: 0, avgRealized: 0 },
  };
  for (const s of realizedScored) {
    const v = s.verdict!;
    const bucket = byVerdict[v];
    bucket.n += 1;
    if (s.outcome === "right") bucket.right += 1;
    else if (s.outcome === "wrong") bucket.wrong += 1;
    else bucket.neutral += 1;
    bucket.avgRealized += s.row.realized1dRet!;
  }
  for (const v of Object.keys(byVerdict) as Verdict[]) {
    if (byVerdict[v].n > 0) byVerdict[v].avgRealized /= byVerdict[v].n;
  }

  const slice = scored
    .slice(0, days)
    .filter((s) => s.verdict == null || verdictFilter.includes(s.verdict))
    .filter((s) => s.outcome == null || outcomeFilter.includes(s.outcome));

  return (
    <Stack gap="lg">
      <Paper
        p="md"
        radius={CARD_RADIUS}
        style={{ background: "rgba(26,27,30,0.65)" }}
      >
        <Group justify="space-between" align="baseline" mb="sm">
          <Text
            size="xs"
            c="dimmed"
            tt="uppercase"
            fw={600}
            style={{ letterSpacing: "0.12em" }}
          >
            Track record
          </Text>
          <Text size="xs" c="dimmed">
            {accuracy.realizedCalls} of {accuracy.totalCalls} calls realized
          </Text>
        </Group>

        {accuracy.totalCalls === 0 ? (
          <Text size="sm" c="dimmed">
            No history yet. Load the page each day to log predictions. Realized
            returns fill in the next trading day.
          </Text>
        ) : (
          <>
            <Group gap="xl" mb="md" wrap="wrap">
              {verdictRightRate != null && (
                <Stack gap={2}>
                  <Tooltip
                    label="Wilson 95% confidence interval — with small samples, the true rate could lie anywhere in this range."
                    multiline
                    maw={260}
                    withArrow
                  >
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ cursor: "help" }}>
                      Verdict right rate
                    </Text>
                  </Tooltip>
                  <Text size="lg" fw={700}>
                    {fmtFraction(verdictRightRate)}
                  </Text>
                  {verdictRightCI && (
                    <Text size="xs" c="dimmed">
                      95% CI {(verdictRightCI.lo * 100).toFixed(0)}–{(verdictRightCI.hi * 100).toFixed(0)}%
                      {" · n="}{realizedScored.length}
                    </Text>
                  )}
                </Stack>
              )}
              {accuracy.magnitudeMae != null && (
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    MAE
                  </Text>
                  <Text size="lg" fw={700}>
                    {fmtPct(accuracy.magnitudeMae, false)}
                  </Text>
                </Stack>
              )}
              {accuracy.magnitudeBias != null && (
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Bias
                  </Text>
                  <Text
                    size="lg"
                    fw={700}
                    c={accuracy.magnitudeBias > 0 ? "green.4" : "red.4"}
                  >
                    {fmtPct(accuracy.magnitudeBias)}
                  </Text>
                </Stack>
              )}
            </Group>

            {realizedScored.length > 0 && (
              <Box style={{ overflowX: "auto" }}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Verdict</Table.Th>
                      <Table.Th ta="right">N</Table.Th>
                      <Table.Th ta="right">Right</Table.Th>
                      <Table.Th ta="right">Neutral</Table.Th>
                      <Table.Th ta="right">Wrong</Table.Th>
                      <Table.Th ta="right">Avg next-day</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(["dca", "skip", "catchup"] as const).map((v) => {
                      const stats = byVerdict[v];
                      const meta = VERDICT_META[v];
                      const empty = stats.n === 0;
                      return (
                        <Table.Tr key={v} style={empty ? { opacity: 0.45 } : undefined}>
                          <Table.Td>
                            <Badge
                              color={meta.color}
                              variant="light"
                              size="sm"
                              leftSection={<meta.Icon size={11} />}
                            >
                              {meta.label}
                            </Badge>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm">{stats.n}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm" c={empty ? "dimmed" : "green.4"} fw={600}>
                              {empty ? "—" : fmtFraction(stats.right / stats.n)}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm" c="dimmed">
                              {empty ? "—" : fmtFraction(stats.neutral / stats.n)}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm" c={empty ? "dimmed" : "red.4"} fw={600}>
                              {empty ? "—" : fmtFraction(stats.wrong / stats.n)}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text
                              size="sm"
                              fw={600}
                              c={
                                empty
                                  ? "dimmed"
                                  : `${stats.avgRealized > 0 ? "green" : stats.avgRealized < 0 ? "red" : "gray"}.4`
                              }
                            >
                              {empty ? "—" : fmtPct(stats.avgRealized)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Box>
            )}
          </>
        )}

        {model.fittedAt && (
          <Text size="xs" c="dimmed" mt="md">
            Model fitted {model.fittedAt.slice(0, 10)} on{" "}
            {model.trainN?.toLocaleString()} training days
          </Text>
        )}
      </Paper>

      {scored.length > 0 && (
        <Paper
          p="md"
          radius={CARD_RADIUS}
          style={{ background: "rgba(26,27,30,0.65)" }}
        >
          <Group justify="space-between" align="center" mb="md" wrap="wrap">
            <Text
              size="xs"
              c="dimmed"
              tt="uppercase"
              fw={600}
              style={{ letterSpacing: "0.12em" }}
            >
              Verdict history
            </Text>
            <Group gap="xs">
              <Chip.Group
                multiple
                value={verdictFilter}
                onChange={(v) => setVerdictFilter(v as Verdict[])}
              >
                {(["dca", "skip", "catchup"] as const).map((v) => {
                  const meta = VERDICT_META[v];
                  return (
                    <Chip
                      key={v}
                      value={v}
                      size="xs"
                      color={meta.color}
                      icon={<meta.Icon size={10} />}
                    >
                      {meta.label}
                    </Chip>
                  );
                })}
              </Chip.Group>
              <Chip.Group
                multiple
                value={outcomeFilter}
                onChange={(v) => setOutcomeFilter(v as VerdictOutcome[])}
              >
                {(["right", "wrong", "neutral"] as const).map((o) => (
                  <Chip
                    key={o}
                    value={o}
                    size="xs"
                    color={o === "right" ? "green" : o === "wrong" ? "red" : "gray"}
                  >
                    {o}
                  </Chip>
                ))}
              </Chip.Group>
              <SegmentedControl
                size="xs"
                value={range}
                onChange={setRange}
                data={["1mo", "3mo", "6mo", "1yr"]}
              />
            </Group>
          </Group>
          {slice.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              No verdicts match the selected filters.
            </Text>
          ) : (
          <Box style={{ overflowX: "auto" }}>
            <Box
              style={{
                display: "inline-flex",
                gap: 2,
                alignItems: "flex-start",
              }}
            >
              {slice.map(({ row, verdict, outcome }) => {
                const meta = verdict ? VERDICT_META[verdict] : null;
                const [, mm, dd] = row.date.split("-");
                const bg =
                  outcome === "right"
                    ? "rgba(74,222,128,0.30)"
                    : outcome === "wrong"
                      ? "rgba(248,113,113,0.30)"
                      : outcome === "neutral"
                        ? "rgba(150,150,150,0.18)"
                        : "transparent";
                const border =
                  outcome === "right"
                    ? "1px solid rgba(74,222,128,0.5)"
                    : outcome === "wrong"
                      ? "1px solid rgba(248,113,113,0.5)"
                      : outcome === "neutral"
                        ? "1px solid rgba(150,150,150,0.35)"
                        : "1px solid rgba(255,255,255,0.08)";
                const realized = row.realized1dRet;
                const realizedColor =
                  realized == null
                    ? "dimmed"
                    : realized > 0
                      ? "green.4"
                      : realized < 0
                        ? "red.4"
                        : "dimmed";
                return (
                  <Stack
                    key={row.date}
                    gap={0}
                    align="center"
                    style={{ minWidth: 44 }}
                  >
                    <Text
                      size="9px"
                      c="dimmed"
                      ta="center"
                      style={{ height: 18, lineHeight: "18px" }}
                    >
                      {`${parseInt(mm)}/${parseInt(dd)}`}
                    </Text>
                    <Box
                      style={{
                        width: 40,
                        borderRadius: 2,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2,
                        padding: "4px 0",
                        background: bg,
                        border,
                      }}
                    >
                      <Text
                        size="9px"
                        c={
                          row.predicted1dRet == null
                            ? "dimmed"
                            : row.predicted1dRet > 0
                              ? "green.4"
                              : row.predicted1dRet < 0
                                ? "red.4"
                                : "dimmed"
                        }
                        lh={1}
                      >
                        {row.predicted1dRet != null
                          ? `${row.predicted1dRet > 0 ? "+" : ""}${row.predicted1dRet.toFixed(2)}`
                          : "—"}
                      </Text>
                      {meta ? (
                        <meta.Icon
                          size={13}
                          color={`var(--mantine-color-${meta.color}-4)`}
                        />
                      ) : (
                        <Text size="11px" c="dimmed" lh={1}>
                          ·
                        </Text>
                      )}
                    </Box>
                    <Text size="9px" c="dimmed" lh={1} mt={4}>
                      actual:
                    </Text>
                    <Box
                      style={{
                        height: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text size="9px" c={realizedColor} lh={1}>
                        {realized != null
                          ? `${realized > 0 ? "+" : ""}${realized.toFixed(2)}`
                          : "—"}
                      </Text>
                    </Box>
                  </Stack>
                );
              })}
            </Box>
          </Box>
          )}
          <Group gap="lg" mt="sm" wrap="wrap">
            {(["dca", "skip", "catchup"] as const).map((v) => {
              const meta = VERDICT_META[v];
              return (
                <Group key={v} gap={4}>
                  <meta.Icon
                    size={13}
                    color={`var(--mantine-color-${meta.color}-4)`}
                  />
                  <Text size="xs" c="dimmed">
                    {meta.label}
                  </Text>
                </Group>
              );
            })}
            <Text size="xs" c="dimmed">
              ·
            </Text>
            {(["right", "wrong", "neutral"] as const).map((o) => (
              <Group key={o} gap={4}>
                <Box
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background:
                      o === "right"
                        ? "rgba(74,222,128,0.45)"
                        : o === "wrong"
                          ? "rgba(248,113,113,0.45)"
                          : "rgba(150,150,150,0.25)",
                  }}
                />
                <Text size="xs" c="dimmed">
                  {o}
                </Text>
              </Group>
            ))}
            <Text size="xs" c="dimmed">
              · box: predicted Δ + verdict · actual: realized Δ
            </Text>
          </Group>
        </Paper>
      )}
    </Stack>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

function nextWeekdayDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function PredictionPage() {
  const [data, setData] = useState<PredictionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);

  function load(force = false) {
    setLoading(true);
    setError(null);
    fetch(force ? "/api/sentiment?force=1" : "/api/sentiment")
      .then((r) => r.json())
      .then((d: PredictionPayload & { error?: string }) => {
        if (d.error) setError(d.error);
        else {
          setData(d);
          setNow(Date.now());
          setHistoryOffset(0);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { indicators, hits, verdictInfo } = useMemo(() => {
    if (!data) return { indicators: [] as BottomIndicator[], hits: 0, verdictInfo: null };
    const inputs = verdictInputsFromFeatures(data.features);
    const ind = computeBottomIndicators(inputs);
    const h = ind.filter((i) => i.hit).length;
    const v = computeVerdict(
      data.predictedRet,
      h,
      data.predictionDate,
      inputs.qqq5dRet,
      inputs.realizedVol20d,
      inputs.tnxMom20d,
    );
    return { indicators: ind, hits: h, verdictInfo: v };
  }, [data]);

  // Historical verdict for pager (offset 0 = live)
  const maxOffset = data ? data.fullHistory.length : 0;
  const histRow =
    data && historyOffset > 0 ? data.fullHistory[historyOffset - 1] : null;
  const { histVerdict, histOutcome } = useMemo(() => {
    if (histRow?.predicted1dRet == null) return { histVerdict: null, histOutcome: null };
    const inputs = verdictInputsFromRow(histRow);
    const h = computeBottomIndicators(inputs).filter((i) => i.hit).length;
    const v = computeVerdict(
      histRow.predicted1dRet,
      h,
      nextWeekdayDate(histRow.date),
      histRow.qqq5dRet,
      histRow.realizedVol20d,
      histRow.tnxMom20d,
    );
    const o =
      histRow.realized1dRet != null
        ? scoreVerdict(v.verdict, histRow.realized1dRet)
        : null;
    return { histVerdict: v, histOutcome: o };
  }, [histRow]);

  const displayVerdict = historyOffset === 0 ? verdictInfo : histVerdict;
  const displayPredictedRet =
    historyOffset === 0
      ? (data?.predictedRet ?? 0)
      : (histRow?.predicted1dRet ?? 0);
  const displayPredictionDate =
    historyOffset === 0
      ? (data?.predictionDate ?? "")
      : histRow
        ? nextWeekdayDate(histRow.date)
        : "";
  const displayRealizedRet =
    historyOffset === 0 ? null : (histRow?.realized1dRet ?? null);
  const displayOutcome = historyOffset === 0 ? null : histOutcome;

  // Sparkline for historical days: 5 rows before histRow + projected close
  const histRecentPrices: PredictionPayload["recentPrices"] | undefined =
    histRow && data
      ? (() => {
          const idx = historyOffset - 1; // index in fullHistory (newest-first)
          // fullHistory is newest-first; rows after idx are older
          const prev5 = data.fullHistory
            .slice(idx, idx + 5)
            .reverse()
            .map((r) => ({ date: r.date, close: r.qqqClose }));
          const projClose = histRow.predicted1dRet != null
            ? Math.round(histRow.qqqClose * (1 + histRow.predicted1dRet / 100) * 100) / 100
            : null;
          return [
            ...prev5,
            ...(projClose != null
              ? [{ date: nextWeekdayDate(histRow.date), close: projClose, predicted: true as const }]
              : []),
          ];
        })()
      : undefined;

  const displayRecentPrices =
    historyOffset === 0 ? data?.recentPrices : histRecentPrices;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Stack gap={0}>
          <Text fw={700} size="xl">
            Buy / Pause / Bottom
          </Text>
        </Stack>
        <RetrainButton onRetrained={() => load(true)} />
      </Group>

      {loading ? (
        <>
          <Skeleton height={260} radius={CARD_RADIUS} />
          <Skeleton height={220} radius={CARD_RADIUS} />
        </>
      ) : error ? (
        <Paper
          p="md"
          radius={CARD_RADIUS}
          style={{ background: "var(--mantine-color-dark-6)" }}
        >
          <Group gap={6} c="red">
            <IconAlertTriangle size={16} />
            <Text size="sm">Failed to load: {error}</Text>
          </Group>
        </Paper>
      ) : data && verdictInfo ? (
        <>
          {data.noModel && (
            <Paper
              p="md"
              radius={CARD_RADIUS}
              style={{
                background: "rgba(234,179,8,0.08)",
                border: "1px solid rgba(234,179,8,0.3)",
              }}
            >
              <Text size="sm" c="orange.4">
                No model fitted yet — click Retrain to fit on historical data.
                The bottom-indicator checklist works without a model.
              </Text>
            </Paper>
          )}

          {displayVerdict && (
            <VerdictCard
              verdict={displayVerdict.verdict}
              reason={displayVerdict.reason}
              predictedRet={displayPredictedRet}
              predictionDate={displayPredictionDate}
              recentPrices={displayRecentPrices}
              realizedRet={displayRealizedRet}
              outcome={displayOutcome}
              canPrev={historyOffset < maxOffset - 1}
              canNext={historyOffset > 0}
              onPrev={() => setHistoryOffset((o) => o + 1)}
              onNext={() => setHistoryOffset((o) => o - 1)}
              onFirst={() => setHistoryOffset(0)}
              onLast={() => setHistoryOffset(maxOffset - 1)}
            />
          )}

          <BottomChecklist indicators={indicators} hits={hits} />

          <EventWarningCard events={data.upcomingEvents} />

          <Accordion variant="separated" radius={CARD_RADIUS}>
            <Accordion.Item value="features">
              <Accordion.Control>Today&apos;s model inputs</Accordion.Control>
              <Accordion.Panel>
                <FeatureTable features={data.features} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          {data.accuracy && (
            <AccuracyPanel
              accuracy={data.accuracy}
              history={data.recentHistory}
              fullHistory={data.fullHistory}
              model={{
                fittedAt: data.modelFittedAt,
                trainN: data.modelTrainN,
              }}
            />
          )}

          <Text size="xs" c="dimmed" ta="center">
            Updated {Math.floor((now - data.cachedAt) / 60000)}m ago · refreshes
            every 20m · BOTTOM if 3+ of 6 bottom indicators trigger
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
