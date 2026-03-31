"use client";

import { useMemo, useState } from "react";
import {
  Table,
  Text,
  Badge,
  Group,
  Skeleton,
  Stack,
  ActionIcon,
  Box,
  Paper,
  Center,
} from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useMantineTheme } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS } from "@/lib/cardStyles";
import type { FilledOrder } from "@/lib/schwab/parse";

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

function toDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function fmtDateKey(key: string): string {
  const d = new Date(key + "T12:00:00");
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}


interface ChartPoint {
  timeMs: number;
  price: number;
  side: "BUY" | "SELL";
  sellIndex?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomDot(props: any) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
  const isSell = payload.side === "SELL";
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill={isSell ? "var(--mantine-color-red-6)" : "var(--mantine-color-teal-6)"}
        stroke="none"
      />
      {isSell && payload.sellIndex != null && (
        <text
          x={cx}
          y={cy - 7}
          fontSize={12}
          fontWeight={700}
          textAnchor="middle"
          fill="var(--mantine-color-red-4)"
        >
          {payload.sellIndex}
        </text>
      )}
    </g>
  );
}

function DayChart({ dayOrders, color }: { dayOrders: FilledOrder[]; color: string }) {
  const theme = useMantineTheme();
  const lineColor = theme.colors[color]?.[6] ?? theme.colors.blue[6];
  const gridColor = "var(--mantine-color-dark-4)";

  let sellCount = 0;
  const chartData: ChartPoint[] = [...dayOrders]
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .map((o) => ({
      timeMs: new Date(o.time).getTime(),
      price: o.fillPrice,
      side: o.side,
      sellIndex: o.side === "SELL" ? ++sellCount : undefined,
    }));

  if (chartData.length === 0) {
    return (
      <Box h={160} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Text c="dimmed" size="sm">No orders this day</Text>
      </Box>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 4 }}>
        <XAxis
          dataKey="timeMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          tick={{ fontSize: 11, fill: "var(--mantine-color-dimmed)" }}
          axisLine={{ stroke: gridColor }}
          tickLine={false}
          scale="time"
        />
        <YAxis
          domain={["auto", "auto"]}
          tickFormatter={(v) => `$${v.toFixed(2)}`}
          tick={{ fontSize: 11, fill: "var(--mantine-color-dimmed)" }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip
          formatter={(value) => [`$${fmt(Number(value))}`, "Price"]}
          labelFormatter={(ms) => new Date(Number(ms)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          contentStyle={{
            background: "var(--mantine-color-dark-7)",
            border: "1px solid var(--mantine-color-dark-4)",
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="price"
          stroke={lineColor}
          strokeWidth={2}
          dot={<CustomDot />}
          activeDot={{ r: 6 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function FilledOrdersPage() {
  const { filledOrders, snapshotLoading: loading, activeAccount } = useApp();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const availableDates = useMemo(() => {
    const keys = new Set(filledOrders.map((o) => toDateKey(new Date(o.time))));
    return [...keys].sort();
  }, [filledOrders]);

  const effectiveDate = selectedDate && availableDates.includes(selectedDate)
    ? selectedDate
    : availableDates[availableDates.length - 1] ?? null;

  const currentIdx = effectiveDate ? availableDates.indexOf(effectiveDate) : -1;
  const canBack = currentIdx > 0;
  const canForward = currentIdx < availableDates.length - 1;
  const dayOrders = useMemo(() => {
    if (!effectiveDate) return [];
    return filledOrders.filter((o) => toDateKey(new Date(o.time)) === effectiveDate);
  }, [filledOrders, effectiveDate]);


  const color = activeAccount?.color ?? "blue";
  const bg = useCardBg(color);

  return (
    <Stack gap="md">
      {/* Page title + date nav */}
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">Filled Orders</Text>
        <Group gap={4} align="center">
          <ActionIcon size="sm" variant="subtle" color="gray" disabled={!canBack} onClick={() => setSelectedDate(availableDates[0])}><Text size="xs">«</Text></ActionIcon>
          <ActionIcon size="sm" variant="light" color="gray" disabled={!canBack} onClick={() => setSelectedDate(availableDates[currentIdx - 1])}>
            <IconChevronLeft size={14} />
          </ActionIcon>
          <Text size="sm" w={60} ta="center">{effectiveDate ? fmtDateKey(effectiveDate) : "—"}</Text>
          <ActionIcon size="sm" variant="light" color="gray" disabled={!canForward} onClick={() => setSelectedDate(availableDates[currentIdx + 1])}>
            <IconChevronRight size={14} />
          </ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="gray" disabled={effectiveDate === availableDates[availableDates.length - 1]} onClick={() => setSelectedDate(availableDates[availableDates.length - 1])}><Text size="xs">»</Text></ActionIcon>
        </Group>
      </Group>

      {/* Day chart */}
      {loading ? (
        <Skeleton height={160} radius={CARD_RADIUS} />
      ) : (
        <Paper radius={CARD_RADIUS} style={{ background: bg, overflow: "hidden", padding: "var(--mantine-spacing-md) var(--mantine-spacing-xl) var(--mantine-spacing-xs) 4px" }}>
          <DayChart dayOrders={dayOrders} color={color} />
        </Paper>
      )}

      {loading ? (
        <Table>
          <Table.Thead>
            <Table.Tr>
              {["Time", "Side", "Shares", "Fill Price", "Total"].map((col) => (
                <Table.Th key={col}><Skeleton height={11} width={col.length * 6.5} radius="sm" /></Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <Table.Tr key={i} style={{ opacity: i > 5 ? 0.4 : 1 }}>
                <Table.Td><Skeleton height={13} width={52} radius="sm" /></Table.Td>
                <Table.Td><Skeleton height={20} width={38} radius="xl" /></Table.Td>
                <Table.Td><Skeleton height={13} width={38 + (i % 2) * 12} radius="sm" /></Table.Td>
                <Table.Td><Skeleton height={13} width={55} radius="sm" /></Table.Td>
                <Table.Td className="hide-mobile"><Skeleton height={13} width={65} radius="sm" /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : dayOrders.length === 0 ? (
        <Center h={150}><Text c="dimmed" size="sm">No filled orders on this date.</Text></Center>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Side</Table.Th>
              <Table.Th ta="right">Shares</Table.Th>
              <Table.Th ta="right">Fill Price</Table.Th>
              <Table.Th ta="right" className="hide-mobile">Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dayOrders.map((order) => (
              <Table.Tr key={order.orderId}>
                <Table.Td c="dimmed">{fmtTime(order.time)}</Table.Td>
                <Table.Td>
                  <Badge color={order.side === "BUY" ? "teal" : "red"} variant="light" size="sm">
                    {order.side}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">{order.shares}</Table.Td>
                <Table.Td ta="right">${fmt(order.fillPrice)}</Table.Td>
                <Table.Td ta="right" className="hide-mobile">${fmt(order.total)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
