"use client";

import React, { useMemo, useState } from "react";
import { Table, ScrollArea, Text, Center, Skeleton, Stack, Tabs, Group, Paper, SimpleGrid, Divider, Accordion } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

type Period = "day" | "week" | "month" | "year" | "all";

const PERIODS: { value: Period; label: string; days: number | null }[] = [
  { value: "day",   label: "Daily",    days: 7 },
  { value: "week",  label: "Weekly",   days: 84 },
  { value: "month", label: "Monthly",  days: 365 },
  { value: "year",  label: "Yearly",   days: 365 },
  { value: "all",   label: "All Time", days: null },
];

interface ProfitRow {
  orderId: number;
  date: string;  // dateKey for grouping — uses buy date when available
  time: string;  // sell time for display
  shares: number;
  buyPrice: number | null;
  sellPrice: number;
  profit: number | null;
}

// Returns the Sunday of the week containing the given local date string (YYYY-MM-DD)
function weekStart(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() - d.getDay()); // shift back to Sunday
  return d.toLocaleDateString("en-CA");
}

interface DaySummary {
  dateKey: string;   // "2026-03-25"
  label: string;     // "Mar 25"
  dayOfWeek: string; // "Wed"
  equity: number;
  equityTrades: number;
  options: number;
  optionsTrades: number;
  interest: number;
  dividends: number;
}

interface WeekSummary {
  weekKey: string;   // Monday date "2026-03-23"
  label: string;     // "Mar 23–29"
  equity: number;
  equityTrades: number;
  options: number;
  optionsTrades: number;
  interest: number;
  dividends: number;
}

// Returns "YYYY-MM" for a local date string
function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

interface MonthSummary {
  monthKey: string; // "2026-03"
  label: string;    // "Mar 2026"
  equity: number;
  equityTrades: number;
  options: number;
  optionsTrades: number;
  interest: number;
  dividends: number;
}

function fmtMoney(n: number, showPlus = false) {
  const prefix = n < 0 ? "-" : showPlus && n > 0 ? "+" : "";
  return `${prefix}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DayCard({ day, privacyMode, color }: { day: DaySummary; privacyMode: boolean; color: string }) {
  const total = day.equity + day.options + day.interest + day.dividends;
  const totalTrades = day.equityTrades + day.optionsTrades;
  const hasActivity = totalTrades > 0 || day.interest !== 0 || day.dividends !== 0;
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const c = (n: number) => n < 0 ? "red" : color;

  return (
    <Paper
      withBorder
      p="xs"
      radius="md"
      style={{
        minWidth: 110,
        height: "100%",
        opacity: hasActivity ? 1 : 0.5,
        borderColor: `var(--mantine-color-${color}-5)`,
        background: `var(--mantine-color-${color}-light)`,
      }}
    >
      <Stack gap={4} justify="flex-start">
        <Group justify="space-between" gap={4} wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" fw={500}>{day.dayOfWeek}</Text>
          <Text size="xs" c="dimmed" fw={500}>{day.label.split(" ")[1]}</Text>
        </Group>
        <Text size="sm" fw={700} ta="right" c={!hasActivity ? "dimmed" : c(total)}>
          {hasActivity ? mask(fmtMoney(total, true)) : "—"}
        </Text>
        <Divider />
        {day.equityTrades > 0 && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            <Text span size="xs" c="dimmed" fw={400}>({day.equityTrades})</Text>
            <Text span size="xs" c={c(day.equity)}>{mask(fmtMoney(day.equity, true))}</Text>
          </Group>
        )}
        {day.options !== 0 && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            {day.optionsTrades > 0 && <Text span size="xs" c="dimmed" fw={400}>({day.optionsTrades})</Text>}
            <Text span size="xs" c={day.options < 0 ? "red" : "orange"} ml="auto">{mask(fmtMoney(day.options, true))}</Text>
          </Group>
        )}
        {day.interest !== 0 && (
          <Text size="xs" ta="right" c="lime">{mask(fmtMoney(day.interest, true))}</Text>
        )}
        {day.dividends !== 0 && (
          <Text size="xs" ta="right" c="lime">{mask(fmtMoney(day.dividends, true))}</Text>
        )}
      </Stack>
    </Paper>
  );
}

function WeekCard({ week, privacyMode, color }: { week: WeekSummary; privacyMode: boolean; color: string }) {
  const total = week.equity + week.options + week.interest + week.dividends;
  const hasActivity = week.equityTrades > 0 || week.options !== 0 || week.interest !== 0 || week.dividends !== 0;
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const c = (n: number) => n < 0 ? "red" : color;

  return (
    <Paper
      withBorder
      p="xs"
      radius="md"
      style={{
        minWidth: 130,
        flexShrink: 0,
        opacity: hasActivity ? 1 : 0.5,
        borderColor: `var(--mantine-color-${color}-5)`,
        background: `var(--mantine-color-${color}-light)`,
      }}
    >
      <Stack gap={4} justify="flex-start">
        <Group justify="space-between" gap={4} wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" fw={500}>wk</Text>
          <Text size="xs" c="dimmed" fw={500}>{week.label}</Text>
        </Group>
        <Text size="sm" fw={700} ta="right" c={!hasActivity ? "dimmed" : c(total)}>
          {hasActivity ? mask(fmtMoney(total, true)) : "—"}
        </Text>
        <Divider />
        {week.equityTrades > 0 && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            <Text span size="xs" c="dimmed" fw={400}>({week.equityTrades})</Text>
            <Text span size="xs" c={c(week.equity)}>{mask(fmtMoney(week.equity, true))}</Text>
          </Group>
        )}
        {week.options !== 0 && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            {week.optionsTrades > 0 && <Text span size="xs" c="dimmed" fw={400}>({week.optionsTrades})</Text>}
            <Text span size="xs" c={week.options < 0 ? "red" : "orange"} ml="auto">{mask(fmtMoney(week.options, true))}</Text>
          </Group>
        )}
        {week.interest !== 0 && (
          <Text size="xs" ta="right" c="lime">{mask(fmtMoney(week.interest, true))}</Text>
        )}
        {week.dividends !== 0 && (
          <Text size="xs" ta="right" c="lime">{mask(fmtMoney(week.dividends, true))}</Text>
        )}
      </Stack>
    </Paper>
  );
}

function MonthCard({ month, privacyMode, color }: { month: MonthSummary; privacyMode: boolean; color: string }) {
  const total = month.equity + month.options + month.interest + month.dividends;
  const hasActivity = month.equityTrades > 0 || month.options !== 0 || month.interest !== 0 || month.dividends !== 0;
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const c = (n: number) => n < 0 ? "red" : color;

  return (
    <Paper
      withBorder
      p="xs"
      radius="md"
      style={{
        minWidth: 130,
        flexShrink: 0,
        opacity: hasActivity ? 1 : 0.5,
        borderColor: `var(--mantine-color-${color}-5)`,
        background: `var(--mantine-color-${color}-light)`,
      }}
    >
      <Stack gap={4} justify="flex-start">
        <Group justify="space-between" gap={4} wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" fw={500}>mo</Text>
          <Text size="xs" c="dimmed" fw={500}>{month.label}</Text>
        </Group>
        <Text size="sm" fw={700} ta="right" c={!hasActivity ? "dimmed" : c(total)}>
          {hasActivity ? mask(fmtMoney(total, true)) : "—"}
        </Text>
        <Divider />
        {month.equityTrades > 0 && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            <Text span size="xs" c="dimmed" fw={400}>({month.equityTrades})</Text>
            <Text span size="xs" c={c(month.equity)}>{mask(fmtMoney(month.equity, true))}</Text>
          </Group>
        )}
        {month.options !== 0 && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            {month.optionsTrades > 0 && <Text span size="xs" c="dimmed" fw={400}>({month.optionsTrades})</Text>}
            <Text span size="xs" c={month.options < 0 ? "red" : "orange"} ml="auto">{mask(fmtMoney(month.options, true))}</Text>
          </Group>
        )}
        {month.interest !== 0 && (
          <Text size="xs" ta="right" c="lime">{mask(fmtMoney(month.interest, true))}</Text>
        )}
        {month.dividends !== 0 && (
          <Text size="xs" ta="right" c="lime">{mask(fmtMoney(month.dividends, true))}</Text>
        )}
      </Stack>
    </Paper>
  );
}

export default function ProfitPage() {
  const { filledOrders, filledOptionOrders, transactions, snapshotLoading, privacyMode, activeAccount } = useApp();
  const [period, setPeriod] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("tqqq-profit-period") ?? "month";
    }
    return "month";
  });

  const handlePeriodChange = (v: string | null) => {
    const next = v ?? "month";
    setPeriod(next);
    localStorage.setItem("tqqq-profit-period", next);
  };

  const mask = (val: string) => (privacyMode ? "••••" : val);

  const rows = useMemo<ProfitRow[]>(() => {
    const sells = filledOrders.filter((o) => o.side === "SELL")
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const availableBuys = filledOrders.filter((o) => o.side === "BUY")
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const usedBuyIds = new Set<number>();

    return sells.map((sell) => {
      const sellTime = new Date(sell.time).getTime();
      const matchingBuy = [...availableBuys]
        .reverse()
        .find((b) => !usedBuyIds.has(b.orderId) && b.shares === sell.shares && new Date(b.time).getTime() < sellTime)
        ?? null;

      if (matchingBuy) usedBuyIds.add(matchingBuy.orderId);

      const buyPrice = matchingBuy?.fillPrice ?? null;
      const profit = buyPrice != null ? (sell.fillPrice - buyPrice) * sell.shares : null;
      const date = new Date(sell.time).toLocaleDateString("en-CA");

      return { orderId: sell.orderId, date, time: sell.time, shares: sell.shares, buyPrice, sellPrice: sell.fillPrice, profit };
    }).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [filledOrders]);

  const filteredRows = useMemo(() => {
    const p = PERIODS.find((p) => p.value === period);
    if (!p?.days) return rows;
    const cutoff = Date.now() - p.days * 24 * 60 * 60 * 1000;
    return rows.filter((r) => new Date(r.date).getTime() >= cutoff);
  }, [rows, period]);

  const last7Days = useMemo<DaySummary[]>(() => {
    const days: DaySummary[] = [];
    const now = new Date();
    for (let i = 0; i <= 6; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateKey = d.toLocaleDateString("en-CA");
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "short" });

      const dayRows = rows.filter((r) => r.date === dateKey);
      const equity = dayRows.reduce((s, r) => s + (r.profit ?? 0), 0);
      const dayOptions = filledOptionOrders.filter((o) => new Date(o.time).toLocaleDateString("en-CA") === dateKey);
      const options = dayOptions.reduce((s, o) => s + o.total, 0);
      const dayTxns = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA") === dateKey);
      const interest = dayTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
      const dividends = dayTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);

      days.push({
        dateKey, label, dayOfWeek,
        equity, equityTrades: dayRows.length,
        options, optionsTrades: dayOptions.length,
        interest, dividends,
      });
    }
    return days;
  }, [rows, filledOptionOrders, transactions]);

  const last12Weeks = useMemo<WeekSummary[]>(() => {
    const weeks: WeekSummary[] = [];
    const todayKey = new Date().toLocaleDateString("en-CA");
    const currentWeekStart = weekStart(todayKey);

    for (let i = 0; i < 12; i++) {
      const sunday = new Date(currentWeekStart + "T00:00:00");
      sunday.setDate(sunday.getDate() - i * 7);
      const wKey = sunday.toLocaleDateString("en-CA");

      const saturday = new Date(sunday);
      saturday.setDate(saturday.getDate() + 6);
      const label = `${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${saturday.toLocaleDateString("en-US", { day: "numeric" })}`;

      const weekRows = rows.filter((r) => weekStart(r.date) === wKey);
      const equity = weekRows.reduce((s, r) => s + (r.profit ?? 0), 0);
      const weekOptions = filledOptionOrders.filter((o) => weekStart(new Date(o.time).toLocaleDateString("en-CA")) === wKey);
      const options = weekOptions.reduce((s, o) => s + o.total, 0);
      const weekTxns = transactions.filter((t) => weekStart(new Date(t.time).toLocaleDateString("en-CA")) === wKey);
      const interest = weekTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
      const dividends = weekTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);

      weeks.push({
        weekKey: wKey, label,
        equity, equityTrades: weekRows.length,
        options, optionsTrades: weekOptions.length,
        interest, dividends,
      });
    }
    return weeks;
  }, [rows, filledOptionOrders, transactions]);

  const last12Months = useMemo<MonthSummary[]>(() => {
    const months: MonthSummary[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = d.toLocaleDateString("en-CA").slice(0, 7);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const monthRows = rows.filter((r) => monthKey(r.date) === mKey);
      const equity = monthRows.reduce((s, r) => s + (r.profit ?? 0), 0);
      const monthOptions = filledOptionOrders.filter((o) => monthKey(new Date(o.time).toLocaleDateString("en-CA")) === mKey);
      const options = monthOptions.reduce((s, o) => s + o.total, 0);
      const monthTxns = transactions.filter((t) => monthKey(new Date(t.time).toLocaleDateString("en-CA")) === mKey);
      const interest = monthTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
      const dividends = monthTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);
      months.push({
        monthKey: mKey, label,
        equity, equityTrades: monthRows.length,
        options, optionsTrades: monthOptions.length,
        interest, dividends,
      });
    }
    return months;
  }, [rows, filledOptionOrders, transactions]);

  const allTimeData = useMemo(() => {
    const equityTotal = rows.reduce((s, r) => s + (r.profit ?? 0), 0);
    const optionsTotal = filledOptionOrders.reduce((s, o) => s + o.total, 0);
    const interestTotal = transactions.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
    const dividendsTotal = transactions.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);
    const total = equityTotal + optionsTotal + interestTotal + dividendsTotal;

    const yearSet = [...new Set([
      ...rows.map((r) => r.date.slice(0, 4)),
      ...filledOptionOrders.map((o) => new Date(o.time).toLocaleDateString("en-CA").slice(0, 4)),
      ...transactions.map((t) => new Date(t.time).toLocaleDateString("en-CA").slice(0, 4)),
    ])].sort((a, b) => b.localeCompare(a));

    const years = yearSet.map((year) => {
      const yearRows = rows.filter((r) => r.date.startsWith(year));
      const yearOptions = filledOptionOrders.filter((o) => new Date(o.time).toLocaleDateString("en-CA").startsWith(year));
      const yearTxns = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA").startsWith(year));
      return {
        year,
        equity: yearRows.reduce((s, r) => s + (r.profit ?? 0), 0),
        equityTrades: yearRows.length,
        options: yearOptions.reduce((s, o) => s + o.total, 0),
        optionsTrades: yearOptions.length,
        interest: yearTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0),
        dividends: yearTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0),
      };
    });
    return { total, trades: rows.length, years };
  }, [rows, filledOptionOrders, transactions]);

  const yearlyData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearStr = String(currentYear);
    const yearRows = rows.filter((r) => r.date.startsWith(yearStr));
    const yearOptions = filledOptionOrders.filter((o) => new Date(o.time).toLocaleDateString("en-CA").startsWith(yearStr));
    const yearTxns = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA").startsWith(yearStr));
    const yearTotal = yearRows.reduce((s, r) => s + (r.profit ?? 0), 0)
      + yearOptions.reduce((s, o) => s + o.total, 0)
      + yearTxns.reduce((s, t) => s + t.amount, 0);

    const months: { monthKey: string; label: string; equity: number; equityTrades: number; options: number; interest: number; dividends: number }[] = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(currentYear, m, 1);
      const mKey = `${currentYear}-${String(m + 1).padStart(2, "0")}`;
      const mRows = yearRows.filter((r) => monthKey(r.date) === mKey);
      const mOptions = yearOptions.filter((o) => monthKey(new Date(o.time).toLocaleDateString("en-CA")) === mKey);
      const mTxns = yearTxns.filter((t) => monthKey(new Date(t.time).toLocaleDateString("en-CA")) === mKey);
      months.push({
        monthKey: mKey,
        label: d.toLocaleDateString("en-US", { month: "long" }),
        equity: mRows.reduce((s, r) => s + (r.profit ?? 0), 0),
        equityTrades: mRows.length,
        options: mOptions.reduce((s, o) => s + o.total, 0),
        interest: mTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0),
        dividends: mTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0),
      });
    }
    return { year: currentYear, total: yearTotal, trades: yearRows.length, months };
  }, [rows, filledOptionOrders, transactions]);

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
      <Tabs value={period} onChange={handlePeriodChange} color={activeAccount?.color ?? "blue"}>
        <Tabs.List>
          {PERIODS.map((p) => (
            <Tabs.Tab key={p.value} value={p.value}>{p.label}</Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {period === "day" && (
        <SimpleGrid cols={7} spacing="xs">
          {last7Days.map((day) => (
            <DayCard key={day.dateKey} day={day} privacyMode={privacyMode} color={activeAccount?.color ?? "blue"} />
          ))}
        </SimpleGrid>
      )}

      {period === "week" && (
        <ScrollArea type="scroll">
          <Group gap="xs" wrap="nowrap" pb={4} align="stretch">
            {last12Weeks.map((week) => (
              <WeekCard
                key={week.weekKey}
                week={week}
                privacyMode={privacyMode}
                color={activeAccount?.color ?? "blue"}
              />
            ))}
          </Group>
        </ScrollArea>
      )}

      {period === "week" && (
        filteredRows.length === 0 && last12Weeks.every((w) => w.options === 0 && w.interest === 0 && w.dividends === 0) ? (
          <Center h={150}>
            <Text c="dimmed" size="sm">No activity in this period.</Text>
          </Center>
        ) : (
          <Accordion multiple defaultValue={[last12Weeks[0]?.weekKey]} variant="separated">
            {last12Weeks.map((week) => {
              const weekRows = filteredRows.filter((r) => weekStart(r.date) === week.weekKey);
              const hasActivity = weekRows.length > 0 || week.options !== 0 || week.interest !== 0 || week.dividends !== 0;
              if (!hasActivity) return null;
              const weekEquity = weekRows.reduce((s, r) => s + (r.profit ?? 0), 0);
              const weekTotal = weekEquity + week.options + week.interest + week.dividends;
              return (
                <Accordion.Item key={week.weekKey} value={week.weekKey}>
                  <Accordion.Control>
                    <Group justify="space-between" pr="md">
                      <Text size="sm" fw={700}>{week.label}</Text>
                      <Text size="sm" fw={700} c="white">
                        {mask(`${weekTotal >= 0 ? "+" : ""}$${fmt(weekTotal)}`)}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {(() => {
                      const weekOptRows = filledOptionOrders.filter((o) => weekStart(new Date(o.time).toLocaleDateString("en-CA")) === week.weekKey);
                      const weekTxnRows = transactions.filter((t) => weekStart(new Date(t.time).toLocaleDateString("en-CA")) === week.weekKey);
                      const allRows: { time: string; el: React.ReactNode }[] = [
                        ...weekRows.map((row) => ({
                          time: row.time,
                          el: (
                            <Table.Tr key={`eq-${row.orderId}`}>
                              <Table.Td><Text size="sm" c="dimmed">{fmtDate(row.time)}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text></Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" fw={600} c={row.profit != null ? (row.profit >= 0 ? activeAccount?.color ?? "blue" : "red") : "dimmed"}>
                                  {row.profit != null ? mask(`${row.profit >= 0 ? "+" : ""}$${fmt(row.profit)}`) : "—"}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ),
                        })),
                        ...weekOptRows.map((o) => ({
                          time: o.time,
                          el: (
                            <Table.Tr key={`opt-${o.orderId}`}>
                              <Table.Td><Text size="sm" c="dimmed">{fmtDate(o.time)}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm" c="orange">{o.contracts}c</Text></Table.Td>
                              <Table.Td colSpan={2}><Text size="sm" c="dimmed">{o.instruction === "SELL_TO_OPEN" ? "STO" : "BTC"}</Text></Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" fw={600} c={o.total < 0 ? "red" : "orange"}>{mask(fmtMoney(o.total, true))}</Text>
                              </Table.Td>
                            </Table.Tr>
                          ),
                        })),
                        ...weekTxnRows.map((t) => ({
                          time: t.time,
                          el: (
                            <Table.Tr key={`txn-${t.activityId}`}>
                              <Table.Td><Text size="sm" c="dimmed">{fmtDate(t.time)}</Text></Table.Td>
                              <Table.Td colSpan={3}><Text size="sm" c="dimmed">{t.description}</Text></Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" fw={600} c="lime">{mask(fmtMoney(t.amount, true))}</Text>
                              </Table.Td>
                            </Table.Tr>
                          ),
                        })),
                      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
                      return (
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
                          <Table.Tbody>{allRows.map((r) => r.el)}</Table.Tbody>
                        </Table>
                      );
                    })()}
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )
      )}

      {period === "month" && (
        <ScrollArea type="scroll">
          <Group gap="xs" wrap="nowrap" pb={4} align="stretch">
            {last12Months.map((month) => (
              <MonthCard key={month.monthKey} month={month} privacyMode={privacyMode} color={activeAccount?.color ?? "blue"} />
            ))}
          </Group>
        </ScrollArea>
      )}

      {period === "month" && (
        filteredRows.length === 0 && last12Months.every((m) => m.options === 0 && m.interest === 0 && m.dividends === 0) ? (
          <Center h={150}>
            <Text c="dimmed" size="sm">No activity in this period.</Text>
          </Center>
        ) : (
          <Accordion multiple defaultValue={[last12Months[0]?.monthKey]} variant="separated">
            {last12Months.map((month) => {
              const monthRows = filteredRows.filter((r) => monthKey(r.date) === month.monthKey);
              const hasActivity = monthRows.length > 0 || month.options !== 0 || month.interest !== 0 || month.dividends !== 0;
              if (!hasActivity) return null;
              const monthEquity = monthRows.reduce((s, r) => s + (r.profit ?? 0), 0);
              const monthTotal = monthEquity + month.options + month.interest + month.dividends;
              return (
                <Accordion.Item key={month.monthKey} value={month.monthKey}>
                  <Accordion.Control>
                    <Group justify="space-between" pr="md">
                      <Text size="sm" fw={700}>{month.label}</Text>
                      <Text size="sm" fw={700} c="white">
                        {mask(`${monthTotal >= 0 ? "+" : ""}$${fmt(monthTotal)}`)}
                      </Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    {(() => {
                      const mOptRows = filledOptionOrders.filter((o) => monthKey(new Date(o.time).toLocaleDateString("en-CA")) === month.monthKey);
                      const mTxnRows = transactions.filter((t) => monthKey(new Date(t.time).toLocaleDateString("en-CA")) === month.monthKey);
                      const allRows: { time: string; el: React.ReactNode }[] = [
                        ...monthRows.map((row) => ({
                          time: row.time,
                          el: (
                            <Table.Tr key={`eq-${row.orderId}`}>
                              <Table.Td><Text size="sm" c="dimmed">{fmtDate(row.time)}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text></Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" fw={600} c={row.profit != null ? (row.profit >= 0 ? activeAccount?.color ?? "blue" : "red") : "dimmed"}>
                                  {row.profit != null ? mask(`${row.profit >= 0 ? "+" : ""}$${fmt(row.profit)}`) : "—"}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ),
                        })),
                        ...mOptRows.map((o) => ({
                          time: o.time,
                          el: (
                            <Table.Tr key={`opt-${o.orderId}`}>
                              <Table.Td><Text size="sm" c="dimmed">{fmtDate(o.time)}</Text></Table.Td>
                              <Table.Td ta="right"><Text size="sm" c="orange">{o.contracts}c</Text></Table.Td>
                              <Table.Td colSpan={2}><Text size="sm" c="dimmed">{o.instruction === "SELL_TO_OPEN" ? "STO" : "BTC"}</Text></Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" fw={600} c={o.total < 0 ? "red" : "orange"}>{mask(fmtMoney(o.total, true))}</Text>
                              </Table.Td>
                            </Table.Tr>
                          ),
                        })),
                        ...mTxnRows.map((t) => ({
                          time: t.time,
                          el: (
                            <Table.Tr key={`txn-${t.activityId}`}>
                              <Table.Td><Text size="sm" c="dimmed">{fmtDate(t.time)}</Text></Table.Td>
                              <Table.Td colSpan={3}><Text size="sm" c="dimmed">{t.description}</Text></Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" fw={600} c="lime">{mask(fmtMoney(t.amount, true))}</Text>
                              </Table.Td>
                            </Table.Tr>
                          ),
                        })),
                      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
                      return (
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
                          <Table.Tbody>{allRows.map((r) => r.el)}</Table.Tbody>
                        </Table>
                      );
                    })()}
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )
      )}

      {period === "year" && (
        <Stack>
          <Paper
            withBorder
            p="md"
            radius="md"
            style={{
              borderColor: `var(--mantine-color-${activeAccount?.color ?? "blue"}-5)`,
              background: `var(--mantine-color-${activeAccount?.color ?? "blue"}-light)`,
            }}
          >
            <Group justify="space-between">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" fw={500}>{yearlyData.year}</Text>
                <Text size="xl" fw={700} c={yearlyData.total >= 0 ? activeAccount?.color ?? "blue" : "red"}>
                  {mask(fmtMoney(yearlyData.total, true))}
                </Text>
              </Stack>
              <Text size="sm" c="dimmed">{yearlyData.trades} equity trades</Text>
            </Group>
          </Paper>

          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Month</Table.Th>
                <Table.Th ta="right">Equity</Table.Th>
                <Table.Th ta="right">Options</Table.Th>
                <Table.Th ta="right">Int / Div</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {yearlyData.months.map((m) => {
                const total = m.equity + m.options + m.interest + m.dividends;
                const hasActivity = m.equityTrades > 0 || m.options !== 0 || m.interest !== 0 || m.dividends !== 0;
                const color = activeAccount?.color ?? "blue";
                return (
                  <Table.Tr key={m.monthKey} style={{ opacity: hasActivity ? 1 : 0.4 }}>
                    <Table.Td><Text size="sm">{m.label}</Text></Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" c={!hasActivity ? "dimmed" : m.equity >= 0 ? color : "red"}>
                        {m.equityTrades > 0 ? mask(fmtMoney(m.equity, true)) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" c={m.options === 0 ? "dimmed" : m.options < 0 ? "red" : "orange"}>
                        {m.options !== 0 ? mask(fmtMoney(m.options, true)) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" c={(m.interest + m.dividends) === 0 ? "dimmed" : "lime"}>
                        {(m.interest + m.dividends) !== 0 ? mask(fmtMoney(m.interest + m.dividends, true)) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600} c={!hasActivity ? "dimmed" : total >= 0 ? color : "red"}>
                        {hasActivity ? mask(fmtMoney(total, true)) : "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      )}

      {period === "all" && (
        <Stack>
          <Paper
            withBorder
            p="md"
            radius="md"
            style={{
              borderColor: `var(--mantine-color-${activeAccount?.color ?? "blue"}-5)`,
              background: `var(--mantine-color-${activeAccount?.color ?? "blue"}-light)`,
            }}
          >
            <Group justify="space-between">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" fw={500}>All Time</Text>
                <Text size="xl" fw={700} c={allTimeData.total >= 0 ? activeAccount?.color ?? "blue" : "red"}>
                  {mask(fmtMoney(allTimeData.total, true))}
                </Text>
              </Stack>
              <Text size="sm" c="dimmed">{allTimeData.trades} equity trades</Text>
            </Group>
          </Paper>

          {allTimeData.years.length === 0 ? (
            <Center h={150}><Text c="dimmed" size="sm">No data.</Text></Center>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Year</Table.Th>
                  <Table.Th ta="right">Equity</Table.Th>
                  <Table.Th ta="right">Options</Table.Th>
                  <Table.Th ta="right">Int / Div</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {allTimeData.years.map((y) => {
                  const total = y.equity + y.options + y.interest + y.dividends;
                  const color = activeAccount?.color ?? "blue";
                  return (
                    <Table.Tr key={y.year}>
                      <Table.Td><Text size="sm">{y.year}</Text></Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" c={y.equityTrades === 0 ? "dimmed" : y.equity >= 0 ? color : "red"}>
                          {y.equityTrades > 0 ? mask(fmtMoney(y.equity, true)) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" c={y.options === 0 ? "dimmed" : y.options < 0 ? "red" : "orange"}>
                          {y.options !== 0 ? mask(fmtMoney(y.options, true)) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" c={(y.interest + y.dividends) === 0 ? "dimmed" : "lime"}>
                          {(y.interest + y.dividends) !== 0 ? mask(fmtMoney(y.interest + y.dividends, true)) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={600} c={total >= 0 ? color : "red"}>
                          {mask(fmtMoney(total, true))}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      )}

      {period === "day" && (
        <ScrollArea>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th ta="right">Qty</Table.Th>
                <Table.Th ta="right">Buy Price</Table.Th>
                <Table.Th ta="right">Sell Price</Table.Th>
                <Table.Th ta="right">Profit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {last7Days.flatMap((day) => {
                const dayRows = filteredRows.filter((r) => r.date === day.dateKey);
                const dayOptRows = filledOptionOrders.filter((o) => new Date(o.time).toLocaleDateString("en-CA") === day.dateKey);
                const dayTxnRows = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA") === day.dateKey);
                if (dayRows.length === 0 && dayOptRows.length === 0 && dayTxnRows.length === 0) return [];
                const dayTotal = day.equity + day.options + day.interest + day.dividends;
                const allDayRows: { time: string; el: React.ReactNode }[] = [
                  ...dayRows.map((row) => ({
                    time: row.time,
                    el: (
                      <Table.Tr key={`eq-${row.orderId}`}>
                        <Table.Td><Text size="sm" c="dimmed">{new Date(row.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</Text></Table.Td>
                        <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                        <Table.Td ta="right"><Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text></Table.Td>
                        <Table.Td ta="right"><Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text></Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" fw={600} c={row.profit != null ? (row.profit >= 0 ? activeAccount?.color ?? "blue" : "red") : "dimmed"}>
                            {row.profit != null ? mask(`${row.profit >= 0 ? "+" : ""}$${fmt(row.profit)}`) : "—"}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ),
                  })),
                  ...dayOptRows.map((o) => ({
                    time: o.time,
                    el: (
                      <Table.Tr key={`opt-${o.orderId}`}>
                        <Table.Td><Text size="sm" c="dimmed">{new Date(o.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</Text></Table.Td>
                        <Table.Td ta="right"><Text size="sm" c="orange">{o.contracts}c</Text></Table.Td>
                        <Table.Td colSpan={2}><Text size="sm" c="dimmed">{o.instruction === "SELL_TO_OPEN" ? "STO" : "BTC"}</Text></Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" fw={600} c={o.total < 0 ? "red" : "orange"}>{mask(fmtMoney(o.total, true))}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ),
                  })),
                  ...dayTxnRows.map((t) => ({
                    time: t.time,
                    el: (
                      <Table.Tr key={`txn-${t.activityId}`}>
                        <Table.Td><Text size="sm" c="dimmed">{new Date(t.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</Text></Table.Td>
                        <Table.Td colSpan={3}><Text size="sm" c="dimmed">{t.description}</Text></Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" fw={600} c="lime">{mask(fmtMoney(t.amount, true))}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ),
                  })),
                ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
                return [
                  <Table.Tr key={`hdr-${day.dateKey}`} style={{ background: "var(--mantine-color-dark-6)" }}>
                    <Table.Td colSpan={4}>
                      <Text size="sm" fw={700}>
                        {new Date(day.dateKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={700} c="white">{mask(fmtMoney(dayTotal, true))}</Text>
                    </Table.Td>
                  </Table.Tr>,
                  ...allDayRows.map((r) => r.el),
                ];
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
