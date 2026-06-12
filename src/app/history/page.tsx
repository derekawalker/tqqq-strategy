"use client";

import { useState, useMemo } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { Paper, Stack, Text, Group, SegmentedControl, Center } from "@mantine/core";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Customized } from "recharts";
import { useApp } from "@/lib/context/AppContext";
import { useAccountColor } from "@/lib/hooks/useAccountColor";
import { getAccountSeries, type HistoryRange } from "@/lib/balanceHistory";
import { fmt, fmtDateKey, toDateKey, createMask } from "@/lib/format";

const RANGE_OPTIONS: { label: string; value: HistoryRange }[] = [
  { label: "1M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "6M", value: "6m" },
  { label: "1Y", value: "1y" },
  { label: "All", value: "all" },
];

export default function HistoryPage() {
  const { activeAccount, balanceHistory, privacyMode } = useApp();
  const color = useAccountColor();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const mask = createMask(privacyMode);

  const [range, setRange] = useState<HistoryRange>(() => {
    if (typeof window === "undefined") return "3m";
    return (localStorage.getItem("history-range") as HistoryRange) ?? "3m";
  });

  const handleRangeChange = (v: string) => {
    const r = v as HistoryRange;
    setRange(r);
    localStorage.setItem("history-range", r);
  };

  const series = useMemo(() => {
    if (!activeAccount) return [];
    return getAccountSeries(balanceHistory, activeAccount.accountNumber, range, toDateKey(new Date()));
  }, [balanceHistory, activeAccount, range]);

  const { min, max, change, changePercent } = useMemo(() => {
    if (series.length === 0) return { min: 0, max: 100, change: 0, changePercent: 0 };
    const values = series.map((p) => p.value);
    const first = values[0];
    const last = values[values.length - 1];
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      change: last - first,
      changePercent: first !== 0 ? ((last - first) / first) * 100 : 0,
    };
  }, [series]);

  const pad = (max - min) * 0.08;
  const changeColor = change >= 0 ? "teal" : "red";
  const changeSign = change >= 0 ? "+" : "";

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">History</Text>
        <SegmentedControl size="xs" value={range} onChange={handleRangeChange} data={RANGE_OPTIONS} />
      </Group>

      <Paper p={isMobile ? "xs" : "md"}>
        {series.length < 2 ? (
          <Center h={isMobile ? 280 : 360}>
            <Text size="sm" c="dimmed" ta="center">
              Not enough history yet — account value is recorded once per day,
              <br />so check back after a couple of days of use.
            </Text>
          </Center>
        ) : (
          <Stack gap="md">
            <Group justify="space-between" align="flex-end">
              <Text size="xs" c="dimmed">
                {fmtDateKey(series[0].date)} – {fmtDateKey(series[series.length - 1].date)}
              </Text>
              <Text size="sm" fw={700} c={changeColor}>
                {mask(`${changeSign}$${fmt(change, 0)} (${changeSign}${fmt(changePercent, 1)}%)`)}
              </Text>
            </Group>

            <ResponsiveContainer width="100%" height={isMobile ? 280 : 360}>
              <AreaChart data={series} margin={{ top: 10, right: isMobile ? 8 : 16, left: 0, bottom: 0 }}>
                <Customized component={() => (
                  <defs>
                    <linearGradient id="historyAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={`var(--mantine-color-${color}-5)`} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={`var(--mantine-color-${color}-5)`} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                )} />
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDateKey}
                  tick={{ fontSize: 11, fill: "var(--mantine-color-gray-5)" }}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  domain={[min - pad, max + pad]}
                  tickFormatter={(v: number) => mask(`$${fmt(v / 1000, 0)}k`)}
                  tick={{ fontSize: 11, fill: "var(--mantine-color-gray-5)" }}
                  width={isMobile ? 48 : 60}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload as { date: string; value: number };
                    return (
                      <Paper p="xs" withBorder>
                        <Text size="xs" c="dimmed">{fmtDateKey(d.date)}</Text>
                        <Text size="sm" fw={700}>{mask(`$${fmt(d.value, 0)}`)}</Text>
                      </Paper>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={`var(--mantine-color-${color}-5)`}
                  strokeWidth={1.5}
                  fill="url(#historyAreaGrad)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
