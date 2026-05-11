"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  TqqqSignals,
  SentimentArticle,
  HoldingSentiment,
  HoldingSignals,
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
  if (score > 0.5) return "green";
  if (score > 0.2) return "lime";
  if (score > -0.2) return "gray";
  if (score > -0.5) return "orange";
  return "red";
}

function sentimentLabel(score: number): string {
  if (score > 0.5) return "Bullish";
  if (score > 0.2) return "Positive";
  if (score > -0.2) return "Neutral";
  if (score > -0.5) return "Negative";
  return "Bearish";
}

function skewColor(skew: number): string {
  if (skew < 115) return "green";
  if (skew < 125) return "lime";
  if (skew < 135) return "yellow";
  if (skew < 145) return "orange";
  return "red";
}

function skewLabel(skew: number): string {
  if (skew < 115) return "Low risk";
  if (skew < 125) return "Normal";
  if (skew < 135) return "Elevated";
  if (skew < 145) return "High";
  return "Extreme";
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



// ── cache age ─────────────────────────────────────────────────────────────

function CacheAge({ cachedAt }: { cachedAt: number }) {
  const mins = Math.floor((Date.now() - cachedAt) / 60000);
  return (
    <Text size="xs" c="dimmed" ta="right" mt={-4}>
      {mins < 1 ? "Updated just now" : `Updated ${mins}m ago`} · refreshes every 20m
    </Text>
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

// ── semicircle gauge ──────────────────────────────────────────────────────

function SemiGauge({ score, color, label }: { score: number; color: string; label: string }) {
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
      <text x={CX} y={CY - 6} textAnchor="middle" fontSize={18} fontWeight="700"
        fill={`var(--mantine-color-${color}-4)`} fontFamily="inherit">
        {label}
      </text>
    </svg>
  );
}

// ── card link wrapper ──────────────────────────────────────────────────────

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block", height: "100%", color: "inherit" }}>
      {children}
    </a>
  );
}

// ── indicator cards ────────────────────────────────────────────────────────

function FearGreedCard({ data }: { data: SentimentData["fearGreed"] }) {
  const color = data ? fgColor(data.current) : "gray";
  const bg = useCardBg(color);

  const href = "https://www.cnn.com/markets/fear-and-greed";

  if (!data) {
    return (
      <CardLink href={href}>
        <Paper p="md" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Fear &amp; Greed</Text>
            <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
          </Stack>
        </Paper>
      </CardLink>
    );
  }

  return (
    <CardLink href={href}>
    <Paper p="xs" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
      <Stack gap="xs">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" hiddenFrom="sm">
          Fear &amp; Greed
        </Text>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" visibleFrom="sm">
          Fear &amp; Greed Index
        </Text>
        <Box style={{ minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Box hiddenFrom="sm">
            <Text style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1 }} c={`${color}.4`}>{data.current}</Text>
          </Box>
          <Box visibleFrom="sm">
            <SemiGauge score={data.current} color={color} label={String(data.current)} />
          </Box>
          <Badge color={color} variant="filled" size="xs">
            {fgLabel(data.current)}
          </Badge>
        </Box>
        <Box visibleFrom="sm">
          <Box style={{ marginInline: "calc(-1 * var(--mantine-spacing-xs))" }}>
            <Sparkline data={data.history} color={color} domain={[0, 100]} />
            <Divider />
          </Box>
          <Stack gap={6} mt="xs">
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Yesterday</Text>
              <Text size="xs" fw={600} c={`${fgColor(data.previousClose)}.4`}>{data.previousClose}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">1 Week ago</Text>
              <Text size="xs" fw={600} c={`${fgColor(data.oneWeekAgo)}.4`}>{data.oneWeekAgo}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">1 Month ago</Text>
              <Text size="xs" fw={600} c={`${fgColor(data.oneMonthAgo)}.4`}>{data.oneMonthAgo}</Text>
            </Group>
          </Stack>
        </Box>
      </Stack>
    </Paper>
    </CardLink>
  );
}

function VixCard({ data }: { data: SentimentData["vix"] }) {
  const color = data ? vixColor(data.current) : "gray";
  const bg = useCardBg(color);

  const href = "https://www.cboe.com/tradable_products/vix/";

  if (!data) {
    return (
      <CardLink href={href}>
        <Paper p="md" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>VIX</Text>
            <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
          </Stack>
        </Paper>
      </CardLink>
    );
  }

  return (
    <CardLink href={href}>
      <Paper p="xs" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" hiddenFrom="sm">VIX</Text>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" visibleFrom="sm">VIX Volatility Index</Text>
          <Box style={{ minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Box hiddenFrom="sm">
              <Text style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1 }} c={`${color}.4`}>
                {data.current.toFixed(1)}
              </Text>
            </Box>
            <Box visibleFrom="sm">
              <SemiGauge
                score={Math.round(Math.max(0, Math.min(100, (data.current - 10) / 30 * 100)))}
                color={color}
                label={data.current.toFixed(1)}
              />
            </Box>
            <Badge color={color} variant="filled" size="xs">
              {data.current < 15 ? "Calm" : data.current < 20 ? "Low" : data.current < 25 ? "Elevated" : data.current < 30 ? "High" : "Extreme"}
            </Badge>
          </Box>
          <Box visibleFrom="sm">
            <Box style={{ marginInline: "calc(-1 * var(--mantine-spacing-xs))" }}>
              <Sparkline data={data.history} color={color} />
              <Divider />
            </Box>
            <Stack gap={6} mt="xs">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Yesterday</Text>
                <Text size="xs" fw={600} c={`${vixColor(data.current - data.dayChange)}.4`}>{(data.current - data.dayChange).toFixed(1)}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">1 Week ago</Text>
                <Text size="xs" fw={600} c={`${vixColor(data.current - data.weekChange)}.4`}>{(data.current - data.weekChange).toFixed(1)}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">1 Month ago</Text>
                <Text size="xs" fw={600} c={`${vixColor(data.current - data.monthChange)}.4`}>{(data.current - data.monthChange).toFixed(1)}</Text>
              </Group>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </CardLink>
  );
}

function RsiCard({ data }: { data: SentimentData["rsi"] }) {
  const color = data ? rsiColor(data.value) : "gray";
  const bg = useCardBg(color);
  const href = "https://www.tradingview.com/chart/?symbol=TQQQ";

  if (!data) {
    return (
      <CardLink href={href}>
        <Paper p="md" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>TQQQ RSI</Text>
            <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
          </Stack>
        </Paper>
      </CardLink>
    );
  }

  return (
    <CardLink href={href}>
      <Paper p="xs" radius={CARD_RADIUS} style={{ background: bg, height: "100%" }}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" hiddenFrom="sm">TQQQ RSI</Text>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" visibleFrom="sm">TQQQ RSI (14)</Text>
          <Box style={{ minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Box hiddenFrom="sm">
              <Text style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1 }} c={`${color}.4`}>
                {data.value.toFixed(1)}
              </Text>
            </Box>
            <Box visibleFrom="sm">
              <SemiGauge score={data.value} color={color} label={data.value.toFixed(1)} />
            </Box>
            <Badge color={color} variant="filled" size="xs">
              {rsiLabel(data.value)}
            </Badge>
          </Box>
          <Box visibleFrom="sm">
            <Box style={{ marginInline: "calc(-1 * var(--mantine-spacing-xs))" }}>
              <Sparkline data={data.history} color={color} domain={[0, 100]} />
              <Divider />
            </Box>
            <Group justify="space-between" mt="xs">
              <Text size="10px" c="dimmed">Oversold &lt;30</Text>
              <Text size="10px" c="dimmed">Neutral</Text>
              <Text size="10px" c="dimmed">&gt;70 Overbought</Text>
            </Group>
          </Box>
        </Stack>
      </Paper>
    </CardLink>
  );
}

// ── skew card ─────────────────────────────────────────────────────────────

function SkewCard({ skew }: { skew: SentimentData["skew"] }) {
  const sc = skew != null ? skewColor(skew.current) : "gray";
  const href = "https://www.cboe.com/us/indices/dashboard/skew/";

  if (!skew) {
    return (
      <CardLink href={href}>
        <Paper p="xs" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)", height: "100%" }}>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>SKEW</Text>
            <Group gap={4} c="dimmed"><IconAlertTriangle size={14} /><Text size="xs">Unavailable</Text></Group>
          </Stack>
        </Paper>
      </CardLink>
    );
  }

  const markerPct = Math.min(Math.max(Math.round(((skew.current - 100) / 60) * 100), 1), 98);

  return (
    <CardLink href={href}>
      <Paper p="xs" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)", height: "100%" }}>
        <Stack gap={6} style={{ height: "100%" }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" hiddenFrom="sm">SKEW</Text>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" visibleFrom="sm">CBOE SKEW Index</Text>
          <Box style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Text fw={700} size="xl" ta="center" c={`${sc}.4`}>{skew.current.toFixed(1)}</Text>
            <Badge color={sc} variant="light" size="xs">{skewLabel(skew.current)}</Badge>
            <Text size="xs" c="dimmed" visibleFrom="sm">Tail risk perception (smart money)</Text>
          </Box>
          <Box visibleFrom="sm" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
            <Box style={{ position: "relative", height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
              {[
                { color: "green" }, { color: "lime" }, { color: "yellow" },
                { color: "orange" }, { color: "red" },
              ].map((z, i) => (
                <Box key={i} style={{ flex: 1, background: `var(--mantine-color-${z.color}-7)` }} />
              ))}
              <Box style={{
                position: "absolute",
                left: `${markerPct}%`,
                top: 0, bottom: 0, width: 3,
                background: "white",
                borderRadius: 2,
              }} />
            </Box>
            <Group justify="space-between">
              <Text size="10px" c="dimmed">100 (calm)</Text>
              <Text size="10px" c="dimmed">160 (extreme)</Text>
            </Group>
          </Box>
        </Stack>
      </Paper>
    </CardLink>
  );
}

// ── macro signals ─────────────────────────────────────────────────────────

function MacroSignals({ macro, skew }: { macro: SentimentData["macro"]; skew: SentimentData["skew"] }) {
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
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
      {/* FOMC */}
      <CardLink href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm">
        <Paper p="xs" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)", height: "100%" }}>
          <Stack gap={6} style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center">Next FOMC</Text>
            {fomc ? (
              <>
                <Box style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Text fw={700} size="xl" hiddenFrom="sm" c={fomcColor === "gray" ? "dimmed" : `${fomcColor}.4`}>
                    {new Date(fomc.nextDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })}
                  </Text>
                  <Text fw={700} size="sm" visibleFrom="sm">{fomc.label}</Text>
                  <Badge color={fomcColor} variant="light" size="xs">
                    {fomc.daysUntil === 0 ? "Today" : `In ${fomc.daysUntil}d`}
                  </Badge>
                  <Text size="xs" c="dimmed" visibleFrom="sm">Fed rate decision</Text>
                </Box>
                <Box visibleFrom="sm" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                  <Box style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--mantine-color-dark-4)" }}>
                    <Box style={{
                      width: `${Math.round(fomc.daysSinceLast / (fomc.daysSinceLast + fomc.daysUntil) * 100)}%`,
                      height: "100%", borderRadius: 4,
                      background: `var(--mantine-color-${fomcColor}-5)`,
                    }} />
                  </Box>
                  <Group justify="space-between">
                    <Text size="10px" c="dimmed">Last</Text>
                    <Text size="10px" c="dimmed">Next</Text>
                  </Group>
                </Box>
              </>
            ) : (
              <Text size="xs" c="dimmed">Unavailable</Text>
            )}
          </Stack>
        </Paper>
      </CardLink>

      {/* Yield spread */}
      <CardLink href="https://fred.stlouisfed.org/series/T10Y3M">
        <Paper p="xs" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)", height: "100%" }}>
          <Stack gap={6} style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" hiddenFrom="sm">Yield Curve</Text>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" visibleFrom="sm">Yield Curve (10Y − 3M)</Text>
            {yieldSpread ? (
              <>
                <Box style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Text fw={700} size="xl" ta="center" c={`${spreadColor}.4`}>
                    {yieldSpread.spread > 0 ? "+" : ""}{yieldSpread.spread.toFixed(2)}%
                  </Text>
                  <Badge color={spreadColor} variant="light" size="xs">
                    {yieldSpread.spread < 0 ? "Inverted" : yieldSpread.spread < 0.5 ? "Flat" : "Normal"}
                  </Badge>
                  <Text size="xs" c="dimmed" visibleFrom="sm">
                    10Y {yieldSpread.tenYear.toFixed(2)}% · 3M {yieldSpread.threeMonth.toFixed(2)}%
                  </Text>
                </Box>
                <Box visibleFrom="sm" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
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
                    <Text size="10px" c="dimmed">+3% steep</Text>
                  </Group>
                </Box>
              </>
            ) : (
              <Text size="xs" c="dimmed">Unavailable</Text>
            )}
          </Stack>
        </Paper>
      </CardLink>

      {/* Put/Call ratio */}
      <CardLink href="https://www.cboe.com/us/options/market_statistics/daily/">
        <Paper p="xs" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)", height: "100%" }}>
          <Stack gap={6} style={{ height: "100%" }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" hiddenFrom="sm">Put/Call</Text>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center" visibleFrom="sm">QQQ Put/Call Ratio</Text>
            {putCallRatio != null ? (
              <>
                <Box style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Text fw={700} size="xl" ta="center" c={`${pcColor}.4`}>{putCallRatio.toFixed(2)}</Text>
                  <Badge color={pcColor} variant="light" size="xs">
                    {putCallRatio > 1.2 ? "Extreme fear"
                      : putCallRatio > 0.9 ? "Bearish lean"
                      : putCallRatio > 0.7 ? "Neutral"
                      : "Bullish lean"}
                  </Badge>
                  <Text size="xs" c="dimmed" visibleFrom="sm">Puts ÷ calls by volume (nearest expiry)</Text>
                </Box>
                <Box visibleFrom="sm" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                  <Box style={{ position: "relative", height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                    {[
                      { label: "Bullish", color: "green",  flex: 0.7 },
                      { label: "Neutral", color: "yellow", flex: 0.2 },
                      { label: "Bearish", color: "orange", flex: 0.15 },
                      { label: "Fear",    color: "red",    flex: 0.95 },
                    ].map((z) => (
                      <Box key={z.label} style={{ flex: z.flex, background: `var(--mantine-color-${z.color}-7)` }} />
                    ))}
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
                    <Text size="10px" c="dimmed">2.0 (fear)</Text>
                  </Group>
                </Box>
              </>
            ) : (
              <Text size="xs" c="dimmed">Unavailable</Text>
            )}
          </Stack>
        </Paper>
      </CardLink>

      {/* SKEW index */}
      <SkewCard skew={skew} />
    </SimpleGrid>
  );
}

// ── overall sentiment ─────────────────────────────────────────────────────

function computeOverallSentiment(data: SentimentData) {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const ws: { label: string; value: number; w: number }[] = [];
  if (data.fearGreed)
    ws.push({ label: "Fear & Greed", value: clamp((data.fearGreed.current - 50) / 50), w: 0.22 });
  if (data.vix)
    ws.push({ label: "VIX", value: clamp((20 - data.vix.current) / 15), w: 0.22 });
  if (data.rsi)
    ws.push({ label: "RSI", value: clamp((data.rsi.value - 50) / 30), w: 0.14 });
  if (data.macro.yieldSpread)
    ws.push({ label: "Yield Curve", value: clamp(data.macro.yieldSpread.spread / 2), w: 0.02 });
  if (data.macro.putCallRatio != null)
    ws.push({ label: "Put/Call", value: clamp((1 - data.macro.putCallRatio) / 0.5), w: 0.15 });
  if (data.tqqqSignals?.momentum5d != null)
    ws.push({ label: "TQQQ 5d", value: clamp(data.tqqqSignals.momentum5d / 8), w: 0.08 });
  // SKEW: 120=neutral/0, 100=low risk/+1, 145+=extreme/-1
  if (data.skew)
    ws.push({ label: "SKEW", value: clamp((120 - data.skew.current) / 25), w: 0.05 });
  // FOMC proximity: upcoming meeting introduces uncertainty drag
  const fomcDays = data.macro.fomc?.daysUntil ?? 999;
  if (fomcDays <= 7) {
    const drag = fomcDays <= 2 ? -0.5 : fomcDays <= 5 ? -0.25 : -0.1;
    ws.push({ label: "FOMC Risk", value: drag, w: 0.05 });
  }
  const holdingsTotalWeight = data.holdings.reduce((s, h) => s + h.weight, 0);
  if (holdingsTotalWeight > 0) {
    const holdingsScore = data.holdings.reduce((s, h) => s + h.score * h.weight, 0) / holdingsTotalWeight;
    ws.push({ label: "Holdings", value: holdingsScore, w: 0.25 });
  }
  const totalW = ws.reduce((s, sig) => s + sig.w, 0);
  const score = totalW > 0 ? ws.reduce((s, sig) => s + sig.value * sig.w, 0) / totalW : 0;
  return { signals: ws, score };
}

function OverallSentiment({ data }: { data: SentimentData }) {
  const { signals, score: overall } = computeOverallSentiment(data);

  const color = sentimentColor(overall);
  const label = sentimentLabel(overall);
  const markerPct = Math.round(((overall + 1) / 2) * 100);

  return (
    <Box p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} ta="center">Overall Market Sentiment</Text>
      <Text style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1.1 }} ta="center" mt={4}>{label}</Text>

      <Box mt="md">
        <Box style={{ position: "relative", paddingTop: 28 }}>
          {/* numeric score floats above the marker */}
          <Box style={{
            position: "absolute",
            top: 0,
            left: `${Math.min(Math.max(markerPct, 5), 95)}%`,
            transform: "translateX(-50%)",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}>
            <Text size="sm" fw={700} c={`${color}.4`}>{(overall >= 0 ? "+" : "")}{(overall * 100).toFixed(0)}</Text>
          </Box>
          <Box style={{ position: "relative", height: 8, margin: "5px 0" }}>
            <Box style={{ position: "absolute", inset: 0, borderRadius: 4, overflow: "hidden", display: "flex" }}>
              {[
                { color: "red",    flex: 1 },
                { color: "orange", flex: 1 },
                { color: "gray",   flex: 0.8 },
                { color: "lime",   flex: 1 },
                { color: "green",  flex: 1 },
              ].map((z, i) => (
                <Box key={i} style={{ flex: z.flex, background: `var(--mantine-color-${z.color}-7)` }} />
              ))}
            </Box>
            <Box style={{
              position: "absolute",
              left: `${Math.min(Math.max(markerPct, 1), 98)}%`,
              top: -5, bottom: -5, width: 3,
              transform: "translateX(-50%)",
              background: "white",
              borderRadius: 2,
            }} />
          </Box>
        </Box>
        <Group justify="space-between" mt={4}>
          <Text size="10px" c="dimmed">Bearish</Text>
          <Text size="10px" c="dimmed">Neutral</Text>
          <Text size="10px" c="dimmed">Bullish</Text>
        </Group>
      </Box>

      <Box mt="md" mb="md" style={{ display: "flex", flexWrap: "nowrap", justifyContent: "space-between", gap: 4, overflowX: "auto" }}>
        {signals.map((sig) => {
          const sigColor = sentimentColor(sig.value);
          return (
            <Box key={sig.label} style={{ textAlign: "center", flexShrink: 0 }}>
              <Text size="10px" c="dimmed" tt="uppercase" fw={600}>{sig.label}</Text>
              <Badge color={sigColor} variant="light" size="xs" mt={2}>
                {sig.value >= 0 ? "+" : ""}{(sig.value * 100).toFixed(0)}
              </Badge>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ── TQQQ short-term momentum row ──────────────────────────────────────────

function TqqqMomentumRow({ signals, earningsRiskCount }: { signals: TqqqSignals | null; earningsRiskCount: number }) {
  const items = signals ? [
    {
      label: "5-Day Return",
      value: signals.momentum5d,
      format: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
      color: (v: number) => v >= 3 ? "green" : v >= 0 ? "lime" : v >= -3 ? "orange" : "red",
      tooltip: "TQQQ price change over the last 5 trading days",
    },
    {
      label: "20-Day Return",
      value: signals.momentum20d,
      format: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
      color: (v: number) => v >= 8 ? "green" : v >= 0 ? "lime" : v >= -8 ? "orange" : "red",
      tooltip: "TQQQ price change over the last 20 trading days (~1 month)",
    },
    {
      label: "vs 20d MA",
      value: signals.priceVs20dMa,
      format: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
      color: (v: number) => v >= 5 ? "green" : v >= 0 ? "lime" : v >= -5 ? "orange" : "red",
      tooltip: "How far TQQQ's current price is above or below its 20-day moving average",
    },
  ] : [];

  return (
    <SimpleGrid cols={{ base: earningsRiskCount >= 2 ? 2 : 3, sm: earningsRiskCount >= 2 ? 4 : 3 }} spacing="xs">
      {items.map((item) => {
        if (item.value == null) return null;
        const color = item.color(item.value);
        return (
          <Tooltip key={item.label} label={item.tooltip} withArrow position="top">
            <Paper p="xs" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)", textAlign: "center", cursor: "default" }}>
              <Text size="10px" c="dimmed" tt="uppercase" fw={600}>{item.label}</Text>
              <Text fw={700} size="lg" c={`${color}.4`} mt={2}>{item.format(item.value)}</Text>
              <Badge color={color} variant="light" size="xs" mt={2}>
                {item.value >= 0 ? "Above" : "Below"}
              </Badge>
            </Paper>
          </Tooltip>
        );
      })}
      {earningsRiskCount >= 2 && (
        <Tooltip label={`${earningsRiskCount} top QQQ holdings have earnings in the next 10 days — expect elevated volatility regardless of direction`} withArrow position="top" multiline maw={260}>
          <Paper p="xs" radius={CARD_RADIUS} style={{ background: "color-mix(in srgb, var(--mantine-color-orange-9) 30%, var(--mantine-color-dark-6))", textAlign: "center", cursor: "default", border: "1px solid var(--mantine-color-orange-7)" }}>
            <Text size="10px" c="dimmed" tt="uppercase" fw={600}>Earnings Risk</Text>
            <Text fw={700} size="lg" c="orange.4" mt={2}>{earningsRiskCount} stocks</Text>
            <Badge color="orange" variant="light" size="xs" mt={2}>Next 10 days</Badge>
          </Paper>
        </Tooltip>
      )}
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
    <Paper p="md" radius={CARD_RADIUS} style={{ background: "color-mix(in srgb, var(--mantine-color-dark-6) 25%, transparent)" }}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Weighted News Sentiment
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            Averaged by QQQ holding weight across top 12
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

// ── signal badges ─────────────────────────────────────────────────────────

function SignalBadges({ signals }: { signals: HoldingSignals }) {
  type SignalItem = { label: string; color: string; tooltip: string };
  const items: SignalItem[] = [];

  if (signals.goldenCross != null) {
    items.push({
      label: signals.goldenCross ? "Golden Cross" : "Death Cross",
      color: signals.goldenCross ? "green" : "red",
      tooltip: signals.goldenCross
        ? "50-day MA is above 200-day MA (bullish)"
        : "50-day MA is below 200-day MA (bearish)",
    });
  }

  if (signals.volumeRatio != null) {
    const vr = signals.volumeRatio;
    items.push({
      label: `Vol ${vr.toFixed(1)}×`,
      color: vr >= 2 ? "green" : vr >= 1.4 ? "lime" : vr >= 1.1 ? "yellow" : "gray",
      tooltip: `Today's volume is ${vr.toFixed(1)}× the 3-month average${vr >= 1.5 ? " — elevated activity" : ""}`,
    });
  }

  if (signals.priceVs50dPct != null) {
    const p = signals.priceVs50dPct;
    items.push({
      label: `vs 50d: ${p >= 0 ? "+" : ""}${p.toFixed(1)}%`,
      color: p >= 10 ? "green" : p >= 0 ? "lime" : p >= -10 ? "orange" : "red",
      tooltip: `Price is ${p >= 0 ? "+" : ""}${p.toFixed(1)}% vs 50-day moving average`,
    });
  }

  if (signals.shortFloatPct != null) {
    const s = signals.shortFloatPct;
    items.push({
      label: `SI ${s.toFixed(1)}%`,
      color: s >= 15 ? "red" : s >= 8 ? "orange" : "gray",
      tooltip: `Short interest is ${s.toFixed(1)}% of float${signals.shortRatio != null ? ` (${signals.shortRatio.toFixed(1)}d to cover)` : ""}`,
    });
  }

  if (signals.insiderBuys90d > 0 || signals.insiderSells90d > 0) {
    const net = signals.insiderBuys90d - signals.insiderSells90d;
    items.push({
      label: `${signals.insiderBuys90d}B / ${signals.insiderSells90d}S`,
      color: net > 1 ? "green" : net > 0 ? "lime" : net < -1 ? "red" : "orange",
      tooltip: `Insider transactions (90d): ${signals.insiderBuys90d} purchases, ${signals.insiderSells90d} sales`,
    });
  }

  if (signals.epsRevision30d != null) {
    const r = signals.epsRevision30d;
    const upDown =
      signals.epsRevisionsUp30d != null && signals.epsRevisionsDown30d != null
        ? ` · ${signals.epsRevisionsUp30d}↑ ${signals.epsRevisionsDown30d}↓ analysts`
        : "";
    items.push({
      label: `${r >= 0 ? "+" : ""}${r.toFixed(1)}% EPS`,
      color: r >= 3 ? "green" : r >= 0 ? "lime" : r >= -3 ? "orange" : "red",
      tooltip: `Current-quarter EPS estimate changed ${r >= 0 ? "+" : ""}${r.toFixed(1)}% vs 30 days ago${upDown}`,
    });
  }

  if (items.length === 0) return null;

  return (
    <SimpleGrid cols={3} spacing={4}>
      {items.map((item, idx) => (
        <Tooltip key={idx} label={item.tooltip} withArrow position="top" multiline maw={220}>
          <Badge
            variant="light"
            color={item.color}
            size="xs"
            style={{ width: "100%", cursor: "default", display: "block", opacity: 0.7 }}
          >
            {item.label}
          </Badge>
        </Tooltip>
      ))}
    </SimpleGrid>
  );
}

// ── holding card ───────────────────────────────────────────────────────────

function HoldingCard({ holding }: { holding: HoldingSentiment }) {
  const color = sentimentColor(holding.score);
  const label = sentimentLabel(holding.score);
  const bg = useCardBg(color);

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: "color-mix(in srgb, var(--mantine-color-dark-6) 25%, transparent)" }}>
    <Stack gap="sm">
      <Box style={{
        background: bg,
        margin: "calc(-1 * var(--mantine-spacing-md))",
        marginBottom: 0,
        padding: "var(--mantine-spacing-md)",
        borderRadius: "24px 24px 0 0",
      }}>
        <Group justify="space-between" wrap="nowrap">
          <Box>
            <Group gap={6} align="baseline">
              <Text fw={700} size="sm">{holding.symbol}</Text>
              {holding.dayChangePercent != null && (
                <Text size="xs" fw={600} c={holding.dayChangePercent >= 0 ? "green" : "red"}>
                  {holding.dayChangePercent >= 0 ? "+" : ""}{holding.dayChangePercent.toFixed(2)}%
                </Text>
              )}
            </Group>
            <Group gap={4} align="baseline">
              <Text size="xs" c="dimmed">{holding.name}</Text>
              <Text size="xs" c="dimmed">· {holding.weight.toFixed(1)}%</Text>
            </Group>
          </Box>
          <Badge color={color} variant="filled" size="sm">{label}</Badge>
        </Group>
      </Box>

      {(holding.earnings.nextDate != null || holding.earnings.recommendationMean != null) && (
        <EarningsBadge earnings={holding.earnings} />
      )}

      <SignalBadges signals={holding.signals} />

      <Divider />

      {holding.articles.length === 0 ? (
        <Text size="xs" c="dimmed">No recent news</Text>
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
              <Tooltip label={article.publisher} withArrow position="top-start">
                <Text size="xs" style={{ lineHeight: 1.4 }}>
                  <Text span size="xs" c="dimmed" fw={500}>{formatArticleDate(article.providerPublishTime)} · </Text>
                  {article.link ? (
                    <Text span component="a" href={article.link} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline", textDecorationColor: "var(--mantine-color-dimmed)", textUnderlineOffset: 2 }}>
                      {article.title}
                    </Text>
                  ) : (
                    <Text span>{article.title}</Text>
                  )}
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
  const overallScore = data ? computeOverallSentiment(data).score : 0;
  const overallBg = useCardBg(sentimentColor(overallScore));

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

      {loading ? (
        <>
          <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-7)" }}>
            <Stack gap="xs">
              <Skeleton height={140} radius={CARD_RADIUS} />
              <SimpleGrid cols={3} spacing="xs">
                {[0, 1, 2].map((i) => <Skeleton key={i} height={250} radius={CARD_RADIUS} />)}
              </SimpleGrid>
              <SimpleGrid cols={3} spacing="xs">
                {[0, 1, 2].map((i) => <Skeleton key={i} height={160} radius={CARD_RADIUS} />)}
              </SimpleGrid>
            </Stack>
          </Paper>
          <Skeleton height={28} radius="md" width="40%" mx="auto" />
          <Skeleton height={70} radius={CARD_RADIUS} />
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
            {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} height={200} radius={CARD_RADIUS} />)}
          </SimpleGrid>
        </>
      ) : error ? (
        <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)" }}>
          <Group gap={6} c="red">
            <IconAlertTriangle size={16} />
            <Text size="sm">Failed to load sentiment data: {error}</Text>
          </Group>
        </Paper>
      ) : (
        <>
          <Paper p="md" radius={CARD_RADIUS} style={{ background: overallBg }}>
            <Stack gap="xs">
              <OverallSentiment data={data!} />
              <SimpleGrid cols={3} spacing="xs">
                <FearGreedCard data={data?.fearGreed ?? null} />
                <VixCard data={data?.vix ?? null} />
                <RsiCard data={data?.rsi ?? null} />
              </SimpleGrid>
              <MacroSignals macro={data!.macro} skew={data!.skew} />
            </Stack>
          </Paper>
          <TqqqMomentumRow signals={data!.tqqqSignals} earningsRiskCount={data!.earningsRiskCount} />
          {data!.cachedAt > 0 && (
            <CacheAge cachedAt={data!.cachedAt} />
          )}
          <Group gap="xs" align="center" justify="center">
            <IconNews size={18} />
            <Text fw={600} size="sm">QQQ Top Holdings — News Sentiment</Text>
          </Group>
          <AggregateSentiment holdings={data!.holdings} />
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
            {data!.holdings.map((holding) => (
              <HoldingCard key={holding.symbol} holding={holding} />
            ))}
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
