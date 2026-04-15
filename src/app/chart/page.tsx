"use client";

import { useState, useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { Paper, Stack, Text, Group, Box, Skeleton, SegmentedControl, Center } from "@mantine/core";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, Customized,
} from "recharts";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { useChartCandles } from "@/lib/hooks/useChartCandles";
import { fmtTime, fmtDateTime } from "@/lib/format";
import type { Candle } from "@/app/api/chart/route";

function PriceTag({ viewBox, value, color, position }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewBox?: any; value: string; color: string; position: "top" | "bottom";
}) {
  if (!viewBox) return null;
  // recharts passes viewBox as { x, y, width, height } where center = x+w/2, y+h/2
  const cx: number = (viewBox.cx ?? viewBox.x + viewBox.width / 2) ?? 0;
  const cy: number = (viewBox.cy ?? viewBox.y + viewBox.height / 2) ?? 0;
  const pad = { x: 5, y: 3 };
  const w = value.length * 6.5 + pad.x * 2;
  const h = 16;
  const yOffset = position === "top" ? -h - 8 : 10;
  return (
    <g>
      <rect x={cx - w / 2} y={cy + yOffset} width={w} height={h} rx={3} fill={color} opacity={0.85} />
      <text x={cx} y={cy + yOffset + h / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={10} fontWeight={600} fill="#fff">
        {value}
      </text>
    </g>
  );
}

function LegendDash({ color }: { color: string }) {
  return <Box style={{ width: 20, height: 2, borderTop: `2px dashed ${color}`, display: "inline-block" }} />;
}

export default function ChartPage() {
  const { quote } = useApp();
  const levelsSummary = useLevels();
  const color = useAccountColor();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [range, setRange] = useState<"1d" | "1w" | "1m">(() => {
    if (typeof window === "undefined") return "1w";
    return (localStorage.getItem("chart-range") as "1d" | "1w" | "1m") ?? "1w";
  });

  const handleRangeChange = (v: string) => {
    const r = v as "1d" | "1w" | "1m";
    setRange(r);
    localStorage.setItem("chart-range", r);
  };

  const { candles: displayCandles, loading } = useChartCandles(range);

  const levels = levelsSummary?.levels ?? [];
  const currentLevel = levelsSummary?.currentLevel ?? -1;
  const currentSellPrice = currentLevel >= 0 ? levels[currentLevel]?.sellPrice ?? null : null;
  const nextBuyPrice = currentLevel >= 0 && currentLevel + 1 < levels.length
    ? levels[currentLevel + 1]?.buyPrice ?? null : null;
  const currentPrice = quote.loading ? null : quote.price;

  const { highPoint, lowPoint } = useMemo(() => {
    if (displayCandles.length === 0) return { highPoint: null, lowPoint: null };
    let high = displayCandles[0], low = displayCandles[0];
    for (const c of displayCandles) {
      if (c.close > high.close) high = c;
      if (c.close < low.close) low = c;
    }
    return { highPoint: high, lowPoint: low };
  }, [displayCandles]);

  // First candle timestamp of each trading day
  const dayBoundaries = useMemo(() => {
    const seen = new Set<string>();
    const result: { time: number; label: string }[] = [];
    for (const c of displayCandles) {
      const d = new Date(c.time);
      const key = d.toLocaleDateString("en-CA");
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ time: c.time, label: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) });
      }
    }
    return result;
  }, [displayCandles]);

  const yDomain = useMemo((): [number, number] => {
    if (displayCandles.length === 0) return [0, 100];
    const all = displayCandles.map((c) => c.close);
    if (currentPrice) all.push(currentPrice);
    if (currentSellPrice) all.push(currentSellPrice);
    if (nextBuyPrice) all.push(nextBuyPrice);
    const min = Math.min(...all);
    const max = Math.max(...all);
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }, [displayCandles, currentPrice, currentSellPrice, nextBuyPrice]);

  if (loading) {
    return <Skeleton height={460} radius="md" />;
  }

  const lineColor = "url(#tqqqLineGradient)";
  const currentColor = "rgba(255,255,255,0.6)";
  const currentLevelColor = "var(--mantine-color-lime-6)";
  const nextLevelColor = "var(--mantine-color-indigo-5)";

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">Chart</Text>
        <SegmentedControl
          size="xs"
          value={range}
          onChange={handleRangeChange}
          data={[{ label: "1D", value: "1d" }, { label: "1W", value: "1w" }, { label: "1M", value: "1m" }]}
        />
      </Group>
      <Paper p={isMobile ? "xs" : "md"}>
        <Text fw={600} size="sm" c="dimmed" ta="center" mb="md">TQQQ — {{ "1d": "1 Day (5 min)", "1w": "1 Week (30 min)", "1m": "1 Month (daily)" }[range]}</Text>

        {displayCandles.length === 0 ? (
          <Center h={isMobile ? 320 : 400}>
            <Text size="sm" c="dimmed">Markets closed — no data for this range</Text>
          </Center>
        ) : <ResponsiveContainer width="100%" height={isMobile ? 320 : 400}>
          <ComposedChart data={displayCandles} margin={{ top: 20, right: isMobile ? 48 : 60, left: isMobile ? 0 : 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTime}
              tick={{ fontSize: 11, fill: "var(--mantine-color-gray-5)" }}
              tickLine={false}
            />
            <YAxis
              domain={yDomain}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              tick={{ fontSize: 11, fill: "var(--mantine-color-gray-5)" }}
              width={isMobile ? 52 : 68}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as Candle;
                return (
                  <Paper p="xs" withBorder>
                    <Text size="xs" c="dimmed">{fmtDateTime(d.time)}</Text>
                    <Text size="sm" fw={700}>${d.close.toFixed(2)}</Text>
                  </Paper>
                );
              }}
            />

            {/* Gradient definition for the price line */}
            <Customized component={() => (
              <defs>
                <linearGradient id="tqqqLineGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--mantine-color-lime-7)" />
                  <stop offset="100%" stopColor="var(--mantine-color-indigo-7)" />
                </linearGradient>
              </defs>
            )} />

            {/* Day boundaries */}
            {dayBoundaries.map(({ time, label }) => (
              <ReferenceLine key={time} x={time} stroke="var(--mantine-color-dark-3)" strokeWidth={1}
                label={range !== "1m" ? { value: label, position: "insideTopRight", fill: "var(--mantine-color-gray-6)", fontSize: 10 } : undefined} />
            ))}

            <Line
              type="monotone"
              dataKey="close"
              stroke={lineColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />

            {/* Current price */}
            {currentPrice && (
              <ReferenceLine y={currentPrice} stroke={currentColor} strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: `$${currentPrice.toFixed(2)}`, position: "right", fill: currentColor, fontSize: 11 }} />
            )}

            {/* Current level buy price */}
            {currentSellPrice && (
              <ReferenceLine y={currentSellPrice} stroke={currentLevelColor} strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: `$${currentSellPrice.toFixed(2)}`, position: "right", fill: currentLevelColor, fontSize: 11 }} />
            )}

            {/* Next level buy price */}
            {nextBuyPrice && (
              <ReferenceLine y={nextBuyPrice} stroke={nextLevelColor} strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: `$${nextBuyPrice.toFixed(2)}`, position: "right", fill: nextLevelColor, fontSize: 11 }} />
            )}

            {/* Week high */}
            {highPoint && (
              <ReferenceDot x={highPoint.time} y={highPoint.close} r={4} fill="var(--mantine-color-lime-7)" stroke="none"
                label={<PriceTag value={`$${highPoint.close.toFixed(2)}`} color="var(--mantine-color-lime-7)" position="top" />} />
            )}

            {/* Week low */}
            {lowPoint && (
              <ReferenceDot x={lowPoint.time} y={lowPoint.close} r={4} fill="var(--mantine-color-indigo-7)" stroke="none"
                label={<PriceTag value={`$${lowPoint.close.toFixed(2)}`} color="var(--mantine-color-indigo-7)" position="bottom" />} />
            )}
          </ComposedChart>
        </ResponsiveContainer>}

        <Group gap="xl" mt="sm" justify="center">
          {currentPrice && <Group gap={6}><LegendDash color={currentColor} /><Text size="xs" c="dimmed">Current</Text></Group>}
          {currentSellPrice && <Group gap={6}><LegendDash color={currentLevelColor} /><Text size="xs" c="dimmed">L{currentLevel} Sell</Text></Group>}
          {nextBuyPrice && <Group gap={6}><LegendDash color={nextLevelColor} /><Text size="xs" c="dimmed">L{currentLevel + 1} Buy</Text></Group>}
        </Group>
      </Paper>
    </Stack>
  );
}
