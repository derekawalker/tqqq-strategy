"use client";

import { useEffect, useState } from "react";
import {
  Stack,
  Group,
  Paper,
  Text,
  Badge,
  Skeleton,
  SimpleGrid,
  Box,
  Tooltip,
  ThemeIcon,
  Divider,
} from "@mantine/core";
import {
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconAlertTriangle,
  IconNews,
} from "@tabler/icons-react";
import type {
  SentimentData,
  SentimentArticle,
  HoldingSentiment,
  HistoryPoint,
} from "@/app/api/sentiment/route";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { useCardBg } from "@/lib/hooks/useCardBg";
import {
  AreaChart,
  Area,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

// ── helpers ────────────────────────────────────────────────────────────────

function fgColor(score: number): string {
  if (score <= 25) return "red";
  if (score <= 45) return "orange";
  if (score <= 55) return "yellow";
  if (score <= 75) return "lime";
  return "green";
}

function fgLabel(score: number): string {
  if (score <= 25) return "Extreme Fear";
  if (score <= 45) return "Fear";
  if (score <= 55) return "Neutral";
  if (score <= 75) return "Greed";
  return "Extreme Greed";
}

function vixColor(vix: number): string {
  if (vix < 15) return "green";
  if (vix < 20) return "lime";
  if (vix < 25) return "yellow";
  if (vix < 30) return "orange";
  return "red";
}

function rsiColor(rsi: number): string {
  if (rsi < 30) return "blue";
  if (rsi < 45) return "cyan";
  if (rsi < 55) return "teal";
  if (rsi < 70) return "yellow";
  return "orange";
}

function rsiLabel(rsi: number): string {
  if (rsi < 30) return "Oversold";
  if (rsi < 45) return "Weak";
  if (rsi < 55) return "Neutral";
  if (rsi < 70) return "Strong";
  return "Overbought";
}

function sentimentColor(score: number): string {
  if (score > 0.3) return "green";
  if (score > 0) return "lime";
  if (score === 0) return "gray";
  if (score > -0.3) return "orange";
  return "red";
}

function sentimentLabel(score: number): string {
  if (score > 0.5) return "Bullish";
  if (score > 0.2) return "Positive";
  if (score > -0.2) return "Neutral";
  if (score > -0.5) return "Negative";
  return "Bearish";
}

function formatArticleDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function articleSentimentColor(s: SentimentArticle["sentiment"]): string {
  if (s === "positive") return "green";
  if (s === "negative") return "red";
  return "gray";
}

function ChangeChip({
  delta,
  invert = false,
}: {
  delta: number;
  invert?: boolean;
}) {
  // invert=true for VIX: higher VIX = worse sentiment, so negate display
  const effective = invert ? -delta : delta;
  if (Math.abs(delta) < 0.01) {
    return (
      <Badge
        color="gray"
        variant="light"
        size="xs"
        leftSection={<IconMinus size={10} />}
      >
        Flat
      </Badge>
    );
  }
  if (effective > 0) {
    return (
      <Badge
        color="green"
        variant="light"
        size="xs"
        leftSection={<IconTrendingUp size={10} />}
      >
        +{Math.abs(delta).toFixed(1)}
      </Badge>
    );
  }
  return (
    <Badge
      color="red"
      variant="light"
      size="xs"
      leftSection={<IconTrendingDown size={10} />}
    >
      -{Math.abs(delta).toFixed(1)}
    </Badge>
  );
}

// ── sparkline ─────────────────────────────────────────────────────────────

function Sparkline({
  data,
  color,
  domain,
}: {
  data: HistoryPoint[];
  color: string;
  domain?: [number, number];
}) {
  if (data.length < 2) return null;
  const gradientId = `sg-${color}`;
  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={`var(--mantine-color-${color}-5)`} stopOpacity={0.35} />
            <stop offset="95%" stopColor={`var(--mantine-color-${color}-5)`} stopOpacity={0} />
          </linearGradient>
        </defs>
        {domain && <YAxis domain={domain} hide />}
        <Area
          type="monotone"
          dataKey="v"
          stroke={`var(--mantine-color-${color}-5)`}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
        <RechartsTooltip
          cursor={{ stroke: "var(--mantine-color-dark-3)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as HistoryPoint;
            return (
              <Box
                style={{
                  background: "var(--mantine-color-dark-7)",
                  border: "1px solid var(--mantine-color-dark-4)",
                  padding: "4px 8px",
                  borderRadius: 6,
                }}
              >
                <Text size="xs" c="dimmed">{formatArticleDate(point.t)}</Text>
                <Text size="xs" fw={600}>{point.v}</Text>
              </Box>
            );
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── fear & greed semicircle gauge ─────────────────────────────────────────

function FearGreedGauge({ score, color }: { score: number; color: string }) {
  const R = 50;
  const CX = 60, CY = 62;
  const total = Math.PI * R;
  const fill = (score / 100) * total;
  const path = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  return (
    <svg viewBox="0 0 120 70" style={{ width: "100%", maxWidth: 160 }}>
      <path d={path} fill="none" stroke="var(--mantine-color-dark-4)" strokeWidth="10" strokeLinecap="round" />
      <path d={path} fill="none" stroke={`var(--mantine-color-${color}-5)`} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${fill} ${total}`} />
      <text x={CX} y={CY - 6} textAnchor="middle" fontSize="22" fontWeight="700"
        fill={`var(--mantine-color-${color}-4)`} fontFamily="inherit">
        {score}
      </text>
    </svg>
  );
}

// ── indicator cards ────────────────────────────────────────────────────────

function FearGreedCard({ data }: { data: SentimentData["fearGreed"] }) {
  const color = data ? fgColor(data.current) : "gray";
  const bg = useCardBg(color);

  if (!data) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
        <Stack gap="xs" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Fear &amp; Greed</Text>
          <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
        </Stack>
      </Paper>
    );
  }


  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center">
          Fear &amp; Greed Index
        </Text>
        <Box style={{ minHeight: 130, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <FearGreedGauge score={data.current} color={color} />
          <Badge color={color} variant="filled" size="sm">
            {fgLabel(data.current)}
          </Badge>
        </Box>
        <Sparkline data={data.history} color={color} domain={[0, 100]} />
        <Divider />
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Yesterday
            </Text>
            <ChangeChip delta={data.current - data.previousClose} />
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              1 Week ago
            </Text>
            <ChangeChip delta={data.current - data.oneWeekAgo} />
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              1 Month ago
            </Text>
            <ChangeChip delta={data.current - data.oneMonthAgo} />
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}

function VixCard({ data }: { data: SentimentData["vix"] }) {
  const color = data ? vixColor(data.current) : "gray";
  const bg = useCardBg(color);

  if (!data) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
        <Stack gap="xs" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>VIX</Text>
          <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center">
          VIX Volatility Index
        </Text>
        <Box style={{ minHeight: 130, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text
            style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }}
            c={`${color}.4`}
          >
            {data.current.toFixed(1)}
          </Text>
          <Text size="xs" c="dimmed">
            {data.current < 15
              ? "Calm"
              : data.current < 20
                ? "Low"
                : data.current < 25
                  ? "Elevated"
                  : data.current < 30
                    ? "High"
                    : "Extreme"}
          </Text>
        </Box>
        <Sparkline data={data.history} color={color} />
        <Divider />
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Yesterday
            </Text>
            {/* invert: lower VIX = improving sentiment */}
            <ChangeChip delta={data.dayChange} invert />
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              1 Week ago
            </Text>
            <ChangeChip delta={data.weekChange} invert />
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              1 Month ago
            </Text>
            <ChangeChip delta={data.monthChange} invert />
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}

function RsiCard({ data }: { data: SentimentData["rsi"] }) {
  const color = data ? rsiColor(data.value) : "gray";
  const bg = useCardBg(color);

  if (!data) {
    return (
      <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
        <Stack gap="xs" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>TQQQ RSI</Text>
          <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center">
          TQQQ RSI (14)
        </Text>
        <Box style={{ minHeight: 130, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text
            style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }}
            c={`${color}.4`}
          >
            {data.value.toFixed(1)}
          </Text>
          <Badge color={color} variant="filled" size="sm">
            {rsiLabel(data.value)}
          </Badge>
        </Box>
        <Sparkline data={data.history} color={color} domain={[0, 100]} />
        <Divider />
        <Group justify="space-between">
          <Text size="10px" c="dimmed">Oversold &lt;30</Text>
          <Text size="10px" c="dimmed">Neutral</Text>
          <Text size="10px" c="dimmed">&gt;70 Overbought</Text>
        </Group>
      </Stack>
    </Paper>
  );
}

// ── macro signals ─────────────────────────────────────────────────────────

function MacroSignals({ macro }: { macro: SentimentData["macro"] }) {
  const { yieldSpread, putCallRatio, fomc } = macro;

  const spreadColor = !yieldSpread
    ? "gray"
    : yieldSpread.spread < -0.5 ? "red"
    : yieldSpread.spread < 0 ? "orange"
    : yieldSpread.spread < 0.5 ? "yellow"
    : "green";

  const pcColor = !putCallRatio
    ? "gray"
    : putCallRatio > 1.2 ? "red"
    : putCallRatio > 0.9 ? "orange"
    : putCallRatio > 0.7 ? "yellow"
    : "green";

  const fomcColor = !fomc
    ? "gray"
    : fomc.daysUntil <= 7 ? "orange"
    : fomc.daysUntil <= 21 ? "yellow"
    : "gray";

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      {/* FOMC */}
      <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)" }}>
        <Stack gap={6}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Next FOMC</Text>
          {fomc ? (
            <>
              <Box style={{ minHeight: 90, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <Text fw={700} size="sm">{fomc.label}</Text>
                <Badge color={fomcColor} variant="light" size="sm">
                  {fomc.daysUntil === 0 ? "Today" : `In ${fomc.daysUntil} day${fomc.daysUntil === 1 ? "" : "s"}`}
                </Badge>
                <Text size="xs" c="dimmed">Fed rate decision</Text>
              </Box>
              {/* Cycle progress bar */}
              <Box style={{ height: 56, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <Box style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--mantine-color-dark-4)" }}>
                  <Box style={{
                    width: `${Math.round(fomc.daysSinceLast / (fomc.daysSinceLast + fomc.daysUntil) * 100)}%`,
                    height: "100%", borderRadius: 4,
                    background: `var(--mantine-color-${fomcColor}-5)`,
                  }} />
                </Box>
                <Group justify="space-between">
                  <Text size="10px" c="dimmed">Last meeting</Text>
                  <Text size="10px" c="dimmed">Next meeting</Text>
                </Group>
              </Box>
            </>
          ) : (
            <Text size="xs" c="dimmed">Unavailable</Text>
          )}
        </Stack>
      </Paper>

      {/* Yield spread */}
      <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)" }}>
        <Stack gap={6}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Yield Curve (10Y − 3M)</Text>
          {yieldSpread ? (
            <>
              <Box style={{ minHeight: 90, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <Text fw={700} size="xl" c={`${spreadColor}.4`}>
                  {yieldSpread.spread > 0 ? "+" : ""}{yieldSpread.spread.toFixed(2)}%
                </Text>
                <Badge color={spreadColor} variant="light" size="sm">
                  {yieldSpread.spread < 0 ? "Inverted — recession risk" : yieldSpread.spread < 0.5 ? "Flat" : "Normal"}
                </Badge>
                <Text size="xs" c="dimmed">
                  10Y {yieldSpread.tenYear.toFixed(2)}% · 3M {yieldSpread.threeMonth.toFixed(2)}%
                </Text>
              </Box>
              {/* Zone scale: -2 → +3, marker at current spread */}
              <Box style={{ height: 56, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <Box style={{ position: "relative", height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                  {[
                    { color: "red",    flex: 1 },
                    { color: "orange", flex: 1 },
                    { color: "yellow", flex: 0.5 },
                    { color: "lime",   flex: 1 },
                    { color: "green",  flex: 1.5 },
                  ].map((z, i) => (
                    <Box key={i} style={{ flex: z.flex, background: `var(--mantine-color-${z.color}-7)` }} />
                  ))}
                  <Box style={{
                    position: "absolute",
                    left: `${Math.min(Math.max(Math.round(((yieldSpread.spread + 2) / 5) * 100), 1), 98)}%`,
                    top: 0, bottom: 0, width: 3,
                    background: "white",
                    borderRadius: 2,
                  }} />
                </Box>
                <Group justify="space-between">
                  <Text size="10px" c="dimmed">−2% inverted</Text>
                  <Text size="10px" c="dimmed">0</Text>
                  <Text size="10px" c="dimmed">+3% steep</Text>
                </Group>
              </Box>
            </>
          ) : (
            <Text size="xs" c="dimmed">Unavailable</Text>
          )}
        </Stack>
      </Paper>

      {/* Put/Call ratio */}
      <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)" }}>
        <Stack gap={6}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>QQQ Put/Call Ratio</Text>
          {putCallRatio != null ? (
            <>
              <Box style={{ minHeight: 90, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <Text fw={700} size="xl" c={`${pcColor}.4`}>{putCallRatio.toFixed(2)}</Text>
                <Badge color={pcColor} variant="light" size="sm">
                  {putCallRatio > 1.2 ? "Extreme fear"
                    : putCallRatio > 0.9 ? "Bearish lean"
                    : putCallRatio > 0.7 ? "Neutral"
                    : "Bullish lean"}
                </Badge>
                <Text size="xs" c="dimmed">Puts ÷ calls by volume (nearest expiry)</Text>
              </Box>
              {/* Zone scale: 0 → 2.0, marker at current ratio */}
              <Box style={{ height: 56, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                <Box style={{ position: "relative", height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                  {[
                    { label: "Bullish", color: "green",  flex: 0.7 },
                    { label: "Neutral", color: "yellow", flex: 0.2 },
                    { label: "Bearish", color: "orange", flex: 0.15 },
                    { label: "Fear",    color: "red",    flex: 0.95 },
                  ].map((z) => (
                    <Box key={z.label} style={{ flex: z.flex, background: `var(--mantine-color-${z.color}-7)` }} />
                  ))}
                  {/* marker */}
                  <Box style={{
                    position: "absolute",
                    left: `${Math.min(Math.round((putCallRatio / 2) * 100), 98)}%`,
                    top: 0, bottom: 0, width: 3,
                    background: "white",
                    borderRadius: 2,
                  }} />
                </Box>
                <Group justify="space-between">
                  <Text size="10px" c="dimmed">0 (bullish)</Text>
                  <Text size="10px" c="dimmed">1.0</Text>
                  <Text size="10px" c="dimmed">2.0 (fear)</Text>
                </Group>
              </Box>
            </>
          ) : (
            <Text size="xs" c="dimmed">Unavailable</Text>
          )}
        </Stack>
      </Paper>
    </SimpleGrid>
  );
}

// ── aggregate news sentiment ──────────────────────────────────────────────

function AggregateSentiment({ holdings }: { holdings: HoldingSentiment[] }) {
  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? holdings.reduce((s, h) => s + h.score * h.weight, 0) / totalWeight
      : 0;

  const color = sentimentColor(weightedScore);
  const label = sentimentLabel(weightedScore);

  const barWidth = Math.round(((weightedScore + 1) / 2) * 100);

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)" }}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Weighted News Sentiment
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            Averaged by QQQ holding weight across top 9
          </Text>
        </Box>
        <Badge color={color} variant="filled" size="md" style={{ flexShrink: 0 }}>
          {label}
        </Badge>
      </Group>
      <Box mt="sm">
        <Box
          style={{
            height: 8,
            borderRadius: 4,
            background: "var(--mantine-color-dark-4)",
            overflow: "hidden",
          }}
        >
          <Box
            style={{
              width: `${barWidth}%`,
              height: "100%",
              background: `var(--mantine-color-${color}-5)`,
              borderRadius: 4,
              transition: "width 0.4s ease",
            }}
          />
        </Box>
        <Group justify="space-between" mt={4}>
          <Text size="10px" c="dimmed">Bearish</Text>
          <Text size="10px" c="dimmed">Neutral</Text>
          <Text size="10px" c="dimmed">Bullish</Text>
        </Group>
      </Box>
    </Paper>
  );
}

// ── earnings badge ────────────────────────────────────────────────────────

function recColor(mean: number): string {
  if (mean <= 1.5) return "green";
  if (mean <= 2.5) return "lime";
  if (mean <= 3.5) return "yellow";
  if (mean <= 4.5) return "orange";
  return "red";
}

function recLabel(mean: number): string {
  if (mean <= 1.5) return "Strong Buy";
  if (mean <= 2.5) return "Buy";
  if (mean <= 3.5) return "Hold";
  if (mean <= 4.5) return "Underperform";
  return "Sell";
}

function EarningsBadge({ earnings }: { earnings: HoldingSentiment["earnings"] }) {
  const { nextDate, recommendationMean } = earnings;
  if (!nextDate && recommendationMean == null) return null;

  const dateStr = nextDate
    ? new Date(nextDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <Group gap={6} wrap="nowrap">
      {dateStr && (
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="dimmed">Earnings:</Text>
          <Text size="xs" fw={600}>{dateStr}</Text>
        </Group>
      )}
      {recommendationMean != null && (
        <Badge
          color={recColor(recommendationMean)}
          variant="light"
          size="xs"
        >
          {recLabel(recommendationMean)}
        </Badge>
      )}
    </Group>
  );
}

// ── holding card ───────────────────────────────────────────────────────────

function HoldingCard({ holding }: { holding: HoldingSentiment }) {
  const color = sentimentColor(holding.score);
  const label = sentimentLabel(holding.score);

  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{ background: "var(--mantine-color-dark-6)" }}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Box>
            <Group gap={6} align="baseline">
              <Text fw={700} size="sm">
                {holding.symbol}
              </Text>
              <Text size="xs" c="dimmed">
                {holding.weight.toFixed(1)}%
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {holding.name}
            </Text>
          </Box>
          <Badge color={color} variant="filled" size="sm">
            {label}
          </Badge>
        </Group>

        <EarningsBadge earnings={holding.earnings} />

        {holding.articles.length === 0 ? (
          <Text size="xs" c="dimmed">
            No recent news
          </Text>
        ) : (
          <Stack gap={6}>
            {holding.articles.map((article, i) => (
              <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                <ThemeIcon
                  color={articleSentimentColor(article.sentiment)}
                  variant="light"
                  size={16}
                  radius="xl"
                  style={{ flexShrink: 0, marginTop: 2 }}
                >
                  {article.sentiment === "positive" ? (
                    <IconTrendingUp size={10} />
                  ) : article.sentiment === "negative" ? (
                    <IconTrendingDown size={10} />
                  ) : (
                    <IconMinus size={10} />
                  )}
                </ThemeIcon>
                <Tooltip
                  label={article.publisher}
                  withArrow
                  position="top-start"
                >
                  <Text size="xs" style={{ lineHeight: 1.4 }}>
                    <Text span size="xs" c="dimmed" fw={500}>{formatArticleDate(article.providerPublishTime)} · </Text>
                    {article.title}
                  </Text>
                </Tooltip>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function SentimentPage() {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sentiment")
      .then((r) => r.json())
      .then((d: SentimentData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Stack gap="lg">
      <Text fw={700} size="xl" ta="center">
        Market Sentiment
      </Text>

      {/* Indicators */}
      {loading ? (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={200} radius="xl" />
          ))}
        </SimpleGrid>
      ) : error ? (
        <Paper
          p="md"
          radius={CARD_RADIUS}
          style={{ background: "var(--mantine-color-dark-6)" }}
        >
          <Group gap={6} c="red">
            <IconAlertTriangle size={16} />
            <Text size="sm">Failed to load sentiment data: {error}</Text>
          </Group>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <FearGreedCard data={data?.fearGreed ?? null} />
          <VixCard data={data?.vix ?? null} />
          <RsiCard data={data?.rsi ?? null} />
        </SimpleGrid>
      )}

      {/* Aggregate news sentiment */}
      {!loading && !error && data && <MacroSignals macro={data.macro} />}
      {!loading && !error && data && <AggregateSentiment holdings={data.holdings} />}

      {/* Holdings news */}
      <Group gap="xs" align="center">
        <IconNews size={18} />
        <Text fw={600} size="sm">
          QQQ Top Holdings — News Sentiment
        </Text>
      </Group>

      {loading ? (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} height={160} radius="xl" />
          ))}
        </SimpleGrid>
      ) : error ? null : (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {(data?.holdings ?? []).map((holding) => (
            <HoldingCard key={holding.symbol} holding={holding} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
