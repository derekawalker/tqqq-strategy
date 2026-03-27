"use client";

import React, { useMemo, useState } from "react";
import {
  Table,
  ScrollArea,
  Text,
  Badge,
  Select,
  Group,
  Skeleton,
  Stack,
  Pagination,
  ActionIcon,
  Button,
  Box,
  Divider,
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
import { useMantineTheme, useComputedColorScheme } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";
import type { FilledOrder } from "@/lib/schwab/parse";
import { dateGroupHeaderCellLeft, dateGroupLastCellLeft, dateGroupLastCellRight, dateGroupHeaderBg } from "@/lib/tableStyles";

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

const DAYS_OPTIONS = ["30", "60", "90"].map((d) => ({ value: d, label: `Last ${d} days` }));
const PAGE_SIZE = 30;

function cutoffMs(days: string) {
  return Date.now() - parseInt(days) * 24 * 60 * 60 * 1000;
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
  const computedColorScheme = useComputedColorScheme("dark");
  const lineColor = theme.colors[color]?.[6] ?? theme.colors.blue[6];
  const gridColor = computedColorScheme === "dark"
    ? "var(--mantine-color-dark-4)"
    : "var(--mantine-color-gray-3)";

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
  const [days, setDays] = useState("60");
  const [page, setPage] = useState(1);
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

  const orders = useMemo(() => {
    const cutoff = cutoffMs(days);
    return filledOrders.filter((o) => new Date(o.time).getTime() >= cutoff);
  }, [filledOrders, days]);

  const totalBuys = orders.filter((o) => o.side === "BUY").length;
  const totalSells = orders.filter((o) => o.side === "SELL").length;
  const totalPages = Math.ceil(orders.length / PAGE_SIZE);
  const safePage = Math.min(page, totalPages || 1);
  const pageOrders = orders.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const color = activeAccount?.color ?? "blue";

  return (
    <Stack gap="md">
      {/* Day chart */}
      {loading ? (
        <Skeleton height={160} radius="sm" />
      ) : (
        <DayChart dayOrders={dayOrders} color={color} />
      )}

      {/* Date navigation */}
      <Group justify="space-between" align="center">
        <Button
          size="xs"
          variant="light"
          color="gray"
          disabled={!canBack}
          onClick={() => setSelectedDate(availableDates[0])}
        >
          Oldest
        </Button>

        <Group gap={4} align="center">
          <ActionIcon
            size="sm"
            variant="light"
            color="gray"
            disabled={!canBack}
            onClick={() => setSelectedDate(availableDates[currentIdx - 1])}
          >
            <IconChevronLeft size={14} />
          </ActionIcon>
          <Text size="sm" w={60} ta="center">
            {effectiveDate ? fmtDateKey(effectiveDate) : "—"}
          </Text>
          <ActionIcon
            size="sm"
            variant="light"
            color="gray"
            disabled={!canForward}
            onClick={() => setSelectedDate(availableDates[currentIdx + 1])}
          >
            <IconChevronRight size={14} />
          </ActionIcon>
        </Group>

        <Button
          size="xs"
          variant="light"
          color="gray"
          disabled={effectiveDate === availableDates[availableDates.length - 1]}
          onClick={() => setSelectedDate(availableDates[availableDates.length - 1])}
        >
          Latest
        </Button>
      </Group>

      <Divider />

      {/* Table header */}
      <Group justify="space-between" align="center">
        <Group gap="xs" align="center">
          {loading ? (
            <Skeleton height={14} width={100} radius="sm" />
          ) : (
            <Text size="sm" c="dimmed">
              <Text span fw={600} c="teal">{totalBuys}</Text>{" buys  "}
              <Text span fw={600} c="red">{totalSells}</Text>{" sells"}
            </Text>
          )}
        </Group>
        <Select
          size="xs"
          value={days}
          onChange={(v) => { setDays(v ?? "60"); setPage(1); }}
          data={DAYS_OPTIONS}
          w={130}
        />
      </Group>

      <ScrollArea>
        <Table className="table-grouped">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Side</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Shares</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>Fill Price</Table.Th>
              <Table.Th style={{ textAlign: "right" }} className="hide-mobile">Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <Table.Tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Table.Td key={j}><Skeleton height={14} radius="sm" /></Table.Td>
                  ))}
                </Table.Tr>
              ))
            ) : orders.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" ta="center" py="xl" size="sm">No filled TQQQ orders in this period</Text>
                </Table.Td>
              </Table.Tr>
            ) : (() => {
              const grouped = new Map<string, typeof pageOrders>();
              for (const o of pageOrders) {
                const key = toDateKey(new Date(o.time));
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(o);
              }
              return [...grouped.entries()].map(([dateKey, dateOrders], gi) => (
                <React.Fragment key={dateKey}>
                  {gi > 0 && (
                    <Table.Tr style={{ height: 10, background: "transparent" }}>
                      <Table.Td colSpan={5} style={{ padding: 0, border: "none" }} />
                    </Table.Tr>
                  )}
                  <Table.Tr bg={dateGroupHeaderBg}>
                    <Table.Td colSpan={5} style={dateGroupHeaderCellLeft}>
                      <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={0.5}>
                        {fmtDateKey(dateKey)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  {dateOrders.map((order, oi) => {
                    const isLast = oi === dateOrders.length - 1;
                    return (
                    <Table.Tr key={order.orderId}>
                      <Table.Td c="dimmed" style={isLast ? dateGroupLastCellLeft : undefined}>{fmtTime(order.time)}</Table.Td>
                      <Table.Td>
                        <Badge
                          color={order.side === "BUY" ? "teal" : "red"}
                          variant="light"
                          size="sm"
                        >
                          {order.side}
                        </Badge>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>{order.shares}</Table.Td>
                      <Table.Td style={{ textAlign: "right", ...(isLast ? dateGroupLastCellRight : {}) }}>${fmt(order.fillPrice)}</Table.Td>
                      <Table.Td style={{ textAlign: "right", ...(isLast ? dateGroupLastCellRight : {}) }} className="hide-mobile">${fmt(order.total)}</Table.Td>
                    </Table.Tr>
                    );
                  })}
                </React.Fragment>
              ));
            })()}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {totalPages > 1 && (
        <Pagination
          value={safePage}
          onChange={setPage}
          total={totalPages}
          size="sm"
          color={color}
        />
      )}
    </Stack>
  );
}
