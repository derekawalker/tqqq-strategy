"use client";

import { useMemo, useState } from "react";
import { Table, ScrollArea, Text, Center, Skeleton, Stack, Tabs, Group, Paper } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

type Period = "day" | "week" | "month" | "year" | "all";

const PERIODS: { value: Period; label: string; days: number | null }[] = [
  { value: "day",   label: "Daily",    days: 1 },
  { value: "week",  label: "Weekly",   days: 7 },
  { value: "month", label: "Monthly",  days: 30 },
  { value: "year",  label: "Yearly",   days: 365 },
  { value: "all",   label: "All Time", days: null },
];

interface ProfitRow {
  orderId: number;
  time: string;
  shares: number;
  buyPrice: number | null;
  sellPrice: number;
  profit: number | null;
}

export default function ProfitPage() {
  const { filledOrders, snapshotLoading, privacyMode, activeAccount } = useApp();
  const [period, setPeriod] = useState<string>("month");

  const mask = (val: string) => (privacyMode ? "••••" : val);

  const rows = useMemo<ProfitRow[]>(() => {
    const sells = filledOrders.filter((o) => o.side === "SELL");
    const buys  = filledOrders.filter((o) => o.side === "BUY");

    return sells.map((sell) => {
      const sellTime = new Date(sell.time).getTime();
      const matchingBuy = buys
        .filter((b) => b.shares === sell.shares && new Date(b.time).getTime() < sellTime)
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0] ?? null;

      const buyPrice = matchingBuy?.fillPrice ?? null;
      const profit = buyPrice != null ? (sell.fillPrice - buyPrice) * sell.shares : null;

      return { orderId: sell.orderId, time: sell.time, shares: sell.shares, buyPrice, sellPrice: sell.fillPrice, profit };
    }).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [filledOrders]);

  const filteredRows = useMemo(() => {
    const p = PERIODS.find((p) => p.value === period);
    if (!p?.days) return rows;
    const cutoff = Date.now() - p.days * 24 * 60 * 60 * 1000;
    return rows.filter((r) => new Date(r.time).getTime() >= cutoff);
  }, [rows, period]);

  const totalProfit = useMemo(() =>
    filteredRows.reduce((s, r) => s + (r.profit ?? 0), 0),
  [filteredRows]);

  if (snapshotLoading) {
    return (
      <Stack>
        <Skeleton height={40} radius="md" />
        <Skeleton height={300} radius="md" />
      </Stack>
    );
  }

  return (
    <Stack>
      <Tabs value={period} onChange={(v) => setPeriod(v ?? "month")}>
        <Tabs.List>
          {PERIODS.map((p) => (
            <Tabs.Tab key={p.value} value={p.value}>{p.label}</Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group>
        <Paper withBorder p="md" radius="md">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={500}>Total Profit</Text>
            <Text size="xl" fw={700} c={totalProfit >= 0 ? "teal" : "red"}>
              {mask(`${totalProfit >= 0 ? "+" : ""}$${fmt(totalProfit)}`)}
            </Text>
          </Stack>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={500}>Trades</Text>
            <Text size="xl" fw={700} c={activeAccount?.color ?? "blue"}>{filteredRows.length}</Text>
          </Stack>
        </Paper>
      </Group>

      {filteredRows.length === 0 ? (
        <Center h={150}>
          <Text c="dimmed" size="sm">No filled sells in this period.</Text>
        </Center>
      ) : (
        <ScrollArea>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date / Time</Table.Th>
                <Table.Th ta="right">Qty</Table.Th>
                <Table.Th ta="right">Buy Price</Table.Th>
                <Table.Th ta="right">Sell Price</Table.Th>
                <Table.Th ta="right">Profit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredRows.map((row) => (
                <Table.Tr key={row.orderId}>
                  <Table.Td><Text size="sm" c="dimmed">{fmtDate(row.time)}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={600} c={row.profit != null ? (row.profit >= 0 ? "teal" : "red") : "dimmed"}>
                      {row.profit != null ? mask(`${row.profit >= 0 ? "+" : ""}$${fmt(row.profit)}`) : "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
