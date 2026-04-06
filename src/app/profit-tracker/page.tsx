"use client";

import React, { useMemo, useState, useEffect } from "react";
import { Outfit } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"] });
import { Table, ScrollArea, Text, Center, Skeleton, Stack, Tabs, Group, Paper, SimpleGrid, Divider, Box } from "@mantine/core";
import { useApp } from "@/lib/context/AppContext";
import { useCardBg } from "@/lib/hooks/useCardBg";
import { CARD_RADIUS, CARD_LABEL_STYLE } from "@/lib/cardStyles";

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

interface RealizedOptionTrade {
  id: string;
  symbol: string;
  strike: number;
  contracts: number;
  openPrice: number;        // STO fill price per share
  closePrice: number | null; // BTC fill price per share, null if expired
  net: number;              // net profit (after fees)
  fees: number;             // total fees for this trade (negative)
  time: string;             // close time: BTC fill time or expiration time
  how: "BTC" | "expired" | "STC";
}

interface ProfitRow {
  orderId: number;
  date: string;  // dateKey for grouping — uses buy date when available
  time: string;  // sell time for display
  shares: number;
  buyPrice: number | null;
  sellPrice: number;
  fees: number;   // combined sell + buy fees (negative)
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
  intDivTxns: number;
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
  intDivTxns: number;
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
  intDivTxns: number;
}

function fmtMoney(n: number, showPlus = false) {
  const prefix = n < 0 ? "-" : showPlus && n > 0 ? "+" : "";
  return `${prefix}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DayCard({ day, privacyMode, color, selected, onClick }: { day: DaySummary; privacyMode: boolean; color: string; selected?: boolean; onClick?: () => void }) {
  const total = day.equity + day.options + day.interest + day.dividends;
  const totalTrades = day.equityTrades + day.optionsTrades;
  const hasActivity = totalTrades > 0 || day.interest !== 0 || day.dividends !== 0;
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const c = (n: number) => n < 0 ? "red" : color;
  const bg = useCardBg(color);

  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      onClick={onClick}
      style={{
        minWidth: 110,
        height: "100%",
        opacity: hasActivity ? 1 : 0.5,
        background: bg,
        cursor: onClick ? "pointer" : undefined,
        outline: selected ? `2px solid var(--mantine-color-${color}-5)` : undefined,
      }}
    >
      <Stack gap={4} justify="flex-start">
        <Group justify="space-between" gap={4} wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" fw={500}>{day.dayOfWeek}</Text>
          <Text size="xs" c="dimmed" fw={500}>{day.label.split(" ")[1]}</Text>
        </Group>
        <Text fw={700} ta="right" c={!hasActivity ? "dimmed" : total < 0 ? "red" : "white"} className={outfit.className} style={{ fontSize: "1rem" }}>
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
        {(day.interest !== 0 || day.dividends !== 0) && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            <Text span size="xs" c="dimmed" fw={400}>({day.intDivTxns})</Text>
            <Text span size="xs" c="lime">{mask(fmtMoney(day.interest + day.dividends, true))}</Text>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function WeekCard({ week, privacyMode, color, selected, onClick }: { week: WeekSummary; privacyMode: boolean; color: string; selected?: boolean; onClick?: () => void }) {
  const total = week.equity + week.options + week.interest + week.dividends;
  const hasActivity = week.equityTrades > 0 || week.options !== 0 || week.interest !== 0 || week.dividends !== 0;
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const c = (n: number) => n < 0 ? "red" : color;
  const bg = useCardBg(color);

  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      onClick={onClick}
      style={{
        minWidth: 130,
        flexShrink: 0,
        opacity: hasActivity ? 1 : 0.5,
        background: bg,
        cursor: onClick ? "pointer" : undefined,
        outline: selected ? `2px solid var(--mantine-color-${color}-5)` : undefined,
      }}
    >
      <Stack gap={4} justify="flex-start">
        <Text size="xs" c="dimmed" fw={500} ta="right">{week.label}</Text>
        <Text fw={700} ta="right" c={!hasActivity ? "dimmed" : total < 0 ? "red" : "white"} className={outfit.className} style={{ fontSize: "1rem" }}>
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
        {(week.interest !== 0 || week.dividends !== 0) && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            <Text span size="xs" c="dimmed" fw={400}>({week.intDivTxns})</Text>
            <Text span size="xs" c="lime">{mask(fmtMoney(week.interest + week.dividends, true))}</Text>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function MonthCard({ month, privacyMode, color, selected, onClick }: { month: MonthSummary; privacyMode: boolean; color: string; selected?: boolean; onClick?: () => void }) {
  const total = month.equity + month.options + month.interest + month.dividends;
  const hasActivity = month.equityTrades > 0 || month.options !== 0 || month.interest !== 0 || month.dividends !== 0;
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const c = (n: number) => n < 0 ? "red" : color;
  const bg = useCardBg(color);

  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      onClick={onClick}
      style={{
        minWidth: 130,
        flexShrink: 0,
        opacity: hasActivity ? 1 : 0.5,
        background: bg,
        cursor: onClick ? "pointer" : undefined,
        outline: selected ? `2px solid var(--mantine-color-${color}-5)` : undefined,
      }}
    >
      <Stack gap={4} justify="flex-start">
        <Text size="xs" c="dimmed" fw={500} ta="right">{month.label}</Text>
        <Text fw={700} ta="right" c={!hasActivity ? "dimmed" : total < 0 ? "red" : "white"} className={outfit.className} style={{ fontSize: "1rem" }}>
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
        {(month.interest !== 0 || month.dividends !== 0) && (
          <Group justify="space-between" gap={4} wrap="nowrap">
            <Text span size="xs" c="dimmed" fw={400}>({month.intDivTxns})</Text>
            <Text span size="xs" c="lime">{mask(fmtMoney(month.interest + month.dividends, true))}</Text>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}


export default function ProfitPage() {
  const { filledOrders, filledOptionOrders, expiredOptionOrders, transactions, snapshotLoading, privacyMode, activeAccount, tqqqShares, tqqqAvgPrice, quote } = useApp();
  const summaryBg = useCardBg(activeAccount?.color ?? "blue");

  // Pair each STO with its BTC(s)/expirations FIFO, and each BTO with its STC(s) FIFO.
  const realizedOptionTrades = useMemo((): RealizedOptionTrade[] => {
    const parseStrike = (symbol: string): number => {
      const m = symbol.match(/^.{6}\d{6}[CP](\d{8})$/);
      return m ? parseInt(m[1], 10) / 1000 : 0;
    };

    type StoCloseEvent =
      | { kind: "BTC"; order: typeof filledOptionOrders[number]; contracts: number; time: string }
      | { kind: "expired"; activityId: number; contracts: number; time: string };
    type BtoCloseEvent = { kind: "STC"; order: typeof filledOptionOrders[number]; contracts: number; time: string };

    const bySymbol = new Map<string, {
      stos: typeof filledOptionOrders;
      stoCloses: StoCloseEvent[];
      btos: typeof filledOptionOrders;
      btoCloses: BtoCloseEvent[];
    }>();

    const getEntry = (sym: string) => {
      if (!bySymbol.has(sym)) bySymbol.set(sym, { stos: [], stoCloses: [], btos: [], btoCloses: [] });
      return bySymbol.get(sym)!;
    };

    for (const o of filledOptionOrders) {
      const entry = getEntry(o.symbol);
      if (o.instruction === "SELL_TO_OPEN") {
        entry.stos.push(o);
      } else if (o.instruction === "BUY_TO_CLOSE") {
        entry.stoCloses.push({ kind: "BTC", order: o, contracts: o.contracts, time: o.time });
      } else if (o.instruction === "BUY_TO_OPEN") {
        entry.btos.push(o);
      } else if (o.instruction === "SELL_TO_CLOSE") {
        entry.btoCloses.push({ kind: "STC", order: o, contracts: o.contracts, time: o.time });
      }
    }
    for (const e of expiredOptionOrders) {
      getEntry(e.symbol).stoCloses.push({ kind: "expired", activityId: e.activityId, contracts: e.contracts, time: e.time });
    }

    const trades: RealizedOptionTrade[] = [];

    for (const [symbol, { stos, stoCloses, btos, btoCloses }] of bySymbol) {
      // ── STO → BTC/expired (normal short premium trades) ───────────────────
      const sortedStos = [...stos].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const stoState = sortedStos.map((s) => ({ order: s, remaining: s.contracts }));
      const sortedStoCloses = [...stoCloses].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      let stoIdx = 0;
      for (const close of sortedStoCloses) {
        let remaining = close.contracts;
        const btcPer = close.kind === "BTC" ? close.order.total / close.order.contracts : 0;
        const btcFeePer = close.kind === "BTC" ? close.order.fees / close.order.contracts : 0;
        while (remaining > 0 && stoIdx < stoState.length) {
          const entry = stoState[stoIdx];
          const matched = Math.min(remaining, entry.remaining);
          const stoPer = entry.order.total / entry.order.contracts;
          const stoFeePer = entry.order.fees / entry.order.contracts;
          const id = close.kind === "BTC"
            ? `${close.order.orderId}-${entry.order.orderId}`
            : `exp-${close.activityId}-${entry.order.orderId}`;
          trades.push({
            id, symbol, contracts: matched,
            strike: parseStrike(symbol),
            openPrice: entry.order.fillPrice,
            closePrice: close.kind === "BTC" ? close.order.fillPrice : null,
            net: (stoPer + stoFeePer + btcPer + btcFeePer) * matched,
            fees: (stoFeePer + btcFeePer) * matched,
            time: close.time,
            how: close.kind === "BTC" ? "BTC" : "expired",
          });
          remaining -= matched;
          entry.remaining -= matched;
          if (entry.remaining === 0) stoIdx++;
        }
      }

      // ── BTO → STC (accidental long trades, typically losses) ──────────────
      const sortedBtos = [...btos].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const btoState = sortedBtos.map((b) => ({ order: b, remaining: b.contracts }));
      const sortedBtoCloses = [...btoCloses].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      let btoIdx = 0;
      for (const close of sortedBtoCloses) {
        let remaining = close.contracts;
        const stcPer = close.order.total / close.order.contracts;
        const stcFeePer = close.order.fees / close.order.contracts;
        while (remaining > 0 && btoIdx < btoState.length) {
          const entry = btoState[btoIdx];
          const matched = Math.min(remaining, entry.remaining);
          const btoPer = entry.order.total / entry.order.contracts;
          const btoFeePer = entry.order.fees / entry.order.contracts;
          trades.push({
            id: `${close.order.orderId}-${entry.order.orderId}`,
            symbol, contracts: matched,
            strike: parseStrike(symbol),
            openPrice: entry.order.fillPrice,
            closePrice: close.order.fillPrice,
            net: (btoPer + btoFeePer + stcPer + stcFeePer) * matched,
            fees: (btoFeePer + stcFeePer) * matched,
            time: close.time,
            how: "STC",
          });
          remaining -= matched;
          entry.remaining -= matched;
          if (entry.remaining === 0) btoIdx++;
        }
      }
    }
    return trades;
  }, [filledOptionOrders, expiredOptionOrders]);
  const [period, setPeriod] = useState<string>("month");
  useEffect(() => {
    const saved = localStorage.getItem("tqqq-profit-period");
    if (saved) setPeriod(saved);
  }, []);

  const handlePeriodChange = (v: string | null) => {
    const next = v ?? "month";
    setPeriod(next);
    localStorage.setItem("tqqq-profit-period", next);
  };

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

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
      const combinedFees = sell.fees + (matchingBuy?.fees ?? 0);
      const profit = buyPrice != null
        ? (sell.fillPrice - buyPrice) * sell.shares + combinedFees
        : null;
      const date = new Date(sell.time).toLocaleDateString("en-CA");

      return { orderId: sell.orderId, date, time: sell.time, shares: sell.shares, buyPrice, sellPrice: sell.fillPrice, fees: combinedFees, profit };
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
      const dayOptions = realizedOptionTrades.filter((o) => new Date(o.time).toLocaleDateString("en-CA") === dateKey);
      const options = dayOptions.reduce((s, o) => s + o.net, 0);
      const dayTxns = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA") === dateKey);
      const interest = dayTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
      const dividends = dayTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);

      days.push({
        dateKey, label, dayOfWeek,
        equity, equityTrades: dayRows.length,
        options, optionsTrades: dayOptions.length,
        interest, dividends, intDivTxns: dayTxns.length,
      });
    }
    return days;
  }, [rows, realizedOptionTrades, transactions]);

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
      const weekOptions = realizedOptionTrades.filter((o) => weekStart(new Date(o.time).toLocaleDateString("en-CA")) === wKey);
      const options = weekOptions.reduce((s, o) => s + o.net, 0);
      const weekTxns = transactions.filter((t) => weekStart(new Date(t.time).toLocaleDateString("en-CA")) === wKey);
      const interest = weekTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
      const dividends = weekTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);

      weeks.push({
        weekKey: wKey, label,
        equity, equityTrades: weekRows.length,
        options, optionsTrades: weekOptions.length,
        interest, dividends, intDivTxns: weekTxns.length,
      });
    }
    return weeks;
  }, [rows, realizedOptionTrades, transactions]);

  const last12Months = useMemo<MonthSummary[]>(() => {
    const months: MonthSummary[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = d.toLocaleDateString("en-CA").slice(0, 7);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const monthRows = rows.filter((r) => monthKey(r.date) === mKey);
      const equity = monthRows.reduce((s, r) => s + (r.profit ?? 0), 0);
      const monthOptions = realizedOptionTrades.filter((o) => monthKey(new Date(o.time).toLocaleDateString("en-CA")) === mKey);
      const options = monthOptions.reduce((s, o) => s + o.net, 0);
      const monthTxns = transactions.filter((t) => monthKey(new Date(t.time).toLocaleDateString("en-CA")) === mKey);
      const interest = monthTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
      const dividends = monthTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);
      months.push({
        monthKey: mKey, label,
        equity, equityTrades: monthRows.length,
        options, optionsTrades: monthOptions.length,
        interest, dividends, intDivTxns: monthTxns.length,
      });
    }
    return months;
  }, [rows, realizedOptionTrades, transactions]);

  const allTimeData = useMemo(() => {
    const equityTotal = rows.reduce((s, r) => s + (r.profit ?? 0), 0);
    const optionsTotal = realizedOptionTrades.reduce((s, o) => s + o.net, 0);
    const interestTotal = transactions.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0);
    const dividendsTotal = transactions.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0);
    const total = equityTotal + optionsTotal + interestTotal + dividendsTotal;

    const yearSet = [...new Set([
      ...rows.map((r) => r.date.slice(0, 4)),
      ...realizedOptionTrades.map((o) => new Date(o.time).toLocaleDateString("en-CA").slice(0, 4)),
      ...transactions.map((t) => new Date(t.time).toLocaleDateString("en-CA").slice(0, 4)),
    ])].sort((a, b) => b.localeCompare(a));

    const years = yearSet.map((year) => {
      const yearRows = rows.filter((r) => r.date.startsWith(year));
      const yearOptions = realizedOptionTrades.filter((o) => new Date(o.time).toLocaleDateString("en-CA").startsWith(year));
      const yearTxns = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA").startsWith(year));
      return {
        year,
        equity: yearRows.reduce((s, r) => s + (r.profit ?? 0), 0),
        equityTrades: yearRows.length,
        options: yearOptions.reduce((s, o) => s + o.net, 0),
        optionsTrades: yearOptions.length,
        interest: yearTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0),
        dividends: yearTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0),
      };
    });
    return { total, trades: rows.length, equityTotal, optionsTotal, intDivTotal: interestTotal + dividendsTotal, years };
  }, [rows, realizedOptionTrades, transactions]);

  const yearlyData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearStr = String(currentYear);
    const yearRows = rows.filter((r) => r.date.startsWith(yearStr));
    const yearOptions = realizedOptionTrades.filter((o) => new Date(o.time).toLocaleDateString("en-CA").startsWith(yearStr));
    const yearTxns = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA").startsWith(yearStr));
    const equityTotal = yearRows.reduce((s, r) => s + (r.profit ?? 0), 0);
    const optionsTotal = yearOptions.reduce((s, o) => s + o.net, 0);
    const intDivTotal = yearTxns.reduce((s, t) => s + t.amount, 0);
    const yearTotal = equityTotal + optionsTotal + intDivTotal;

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
        options: mOptions.reduce((s, o) => s + o.net, 0),
        interest: mTxns.filter((t) => t.category === "interest").reduce((s, t) => s + t.amount, 0),
        dividends: mTxns.filter((t) => t.category === "dividend").reduce((s, t) => s + t.amount, 0),
      });
    }
    const intDivTxns = yearTxns.length;
    return {
      year: currentYear, total: yearTotal, months,
      equityTotal, equityTrades: yearRows.length,
      optionsTotal, optionsTrades: yearOptions.length,
      intDivTotal, intDivTxns,
    };
  }, [rows, realizedOptionTrades, transactions]);

  if (snapshotLoading) {
    return (
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Skeleton height={28} width={155} radius="sm" />
          <Group gap={4}>
            {[52, 62, 72, 55, 75].map((w, i) => (
              <Skeleton key={i} height={30} width={w} radius="sm" />
            ))}
          </Group>
        </Group>
        <ScrollArea type="scroll">
          <Group gap="xs" wrap="nowrap" pb={4} pt={2} px={2} align="stretch">
            {Array.from({ length: 7 }).map((_, i) => (
              <Box key={i} style={{ minWidth: 110, flex: "1 0 110px", opacity: i > 4 ? 0.45 : 1 }}>
                <Skeleton height={100} radius="md" />
              </Box>
            ))}
          </Group>
        </ScrollArea>
        <Table>
          <Table.Thead>
            <Table.Tr>
              {[85, 45, 65, 65, 55].map((w, i) => (
                <Table.Th key={i}><Skeleton height={11} width={w} radius="sm" /></Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <Table.Tr key={i} style={{ opacity: i > 5 ? 0.4 : 1 }}>
                {[75, 35, 55, 55, 50].map((w, j) => (
                  <Table.Td key={j}><Skeleton height={13} width={w + (i % 3 === 0 && j === 0 ? 10 : 0)} radius="sm" /></Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    );
  }

  const tqqqTotalCost = tqqqShares * tqqqAvgPrice;
  const tqqqCurrentVal = tqqqShares * quote.price;
  const tqqqUnrealized = tqqqShares > 0 && quote.price > 0 ? tqqqCurrentVal - tqqqTotalCost : null;
  const grandTotal = tqqqUnrealized != null ? tqqqUnrealized + allTimeData.total : null;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">Profit Tracker</Text>
        <Tabs value={period} onChange={handlePeriodChange} color={activeAccount?.color ?? "blue"}>
          <Tabs.List>
            {PERIODS.map((p) => (
              <Tabs.Tab key={p.value} value={p.value} className="profit-tab">{p.label}</Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </Group>

      {period === "day" && (() => {
        const effectiveDay = (selectedDay && last7Days.some((d) => d.dateKey === selectedDay)) ? selectedDay : last7Days[0]?.dateKey ?? null;
        return (
          <ScrollArea type="scroll">
            <Group gap="xs" wrap="nowrap" pb={4} pt={2} px={2} align="stretch">
              {last7Days.map((day) => (
                <Box key={day.dateKey} style={{ minWidth: 110, flex: "1 0 110px" }}>
                  <DayCard
                    day={day}
                    privacyMode={privacyMode}
                    color={activeAccount?.color ?? "blue"}
                    selected={day.dateKey === effectiveDay}
                    onClick={() => setSelectedDay(day.dateKey)}
                  />
                </Box>
              ))}
            </Group>
          </ScrollArea>
        );
      })()}

      {period === "week" && (() => {
        const effectiveWeek = (selectedWeek && last12Weeks.some((w) => w.weekKey === selectedWeek)) ? selectedWeek : last12Weeks[0]?.weekKey ?? null;
        return (
          <ScrollArea type="scroll">
            <Group gap="xs" wrap="nowrap" pb={4} pt={2} px={2} align="stretch">
              {last12Weeks.map((week) => (
                <WeekCard
                  key={week.weekKey}
                  week={week}
                  privacyMode={privacyMode}
                  color={activeAccount?.color ?? "blue"}
                  selected={week.weekKey === effectiveWeek}
                  onClick={() => setSelectedWeek(week.weekKey)}
                />
              ))}
            </Group>
          </ScrollArea>
        );
      })()}

      {period === "day" && (() => {
        const effectiveDay = (selectedDay && last7Days.some((d) => d.dateKey === selectedDay)) ? selectedDay : last7Days[0]?.dateKey ?? null;
        const dayMeta = last7Days.find((d) => d.dateKey === effectiveDay);
        const dayRows = filteredRows.filter((r) => r.date === effectiveDay);
        const dayOptRows = realizedOptionTrades.filter((o) => new Date(o.time).toLocaleDateString("en-CA") === effectiveDay);
        const dayTxnRows = transactions.filter((t) => new Date(t.time).toLocaleDateString("en-CA") === effectiveDay);
        const hasActivity = dayRows.length > 0 || (dayMeta && (dayMeta.options !== 0 || dayMeta.interest !== 0 || dayMeta.dividends !== 0));
        if (!effectiveDay || !hasActivity) return (
          <Center h={150}><Text c="dimmed" size="sm">No activity on this day.</Text></Center>
        );
        const allTableRows: { time: string; el: React.ReactNode }[] = [
          ...dayRows.map((row) => ({
            time: row.time,
            el: (
              <Table.Tr key={`eq-${row.orderId}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(row.time)}</Text></Table.Td>
                <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile"><Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile"><Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile">
                  {row.fees !== 0 ? <Text size="sm" c="dimmed">{mask(fmtMoney(row.fees))}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
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
              <Table.Tr key={`opt-${o.id}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(o.time)}</Text></Table.Td>
                <Table.Td ta="right"><Text size="sm" c="orange">{o.contracts}</Text></Table.Td>
                <Table.Td colSpan={2} className="hide-mobile"><Text size="sm" c="dimmed">${fmt(o.strike)} · ${fmt(o.openPrice)} → {o.closePrice != null ? `$${fmt(o.closePrice)}` : "Expired"}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile">
                  {o.fees !== 0 ? <Text size="sm" c="dimmed">{mask(fmtMoney(o.fees))}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" fw={600} c={o.net < 0 ? "red" : "orange"}>{mask(fmtMoney(o.net, true))}</Text>
                </Table.Td>
              </Table.Tr>
            ),
          })),
          ...dayTxnRows.map((t) => ({
            time: t.time,
            el: (
              <Table.Tr key={`txn-${t.activityId}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(t.time)}</Text></Table.Td>
                <Table.Td />
                <Table.Td colSpan={3} className="hide-mobile"><Text size="sm" c="dimmed">{t.description}</Text></Table.Td>
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
                <Table.Th>Time</Table.Th>
                <Table.Th ta="right">Qty</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Buy Price</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Sell Price</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Fees</Table.Th>
                <Table.Th ta="right">Profit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{allTableRows.map((r) => r.el)}</Table.Tbody>
          </Table>
        );
      })()}

      {period === "week" && (() => {
        const effectiveWeek = (selectedWeek && last12Weeks.some((w) => w.weekKey === selectedWeek)) ? selectedWeek : last12Weeks[0]?.weekKey ?? null;
        const weekMeta = last12Weeks.find((w) => w.weekKey === effectiveWeek);
        const weekRows = filteredRows.filter((r) => weekStart(r.date) === effectiveWeek);
        const weekOptRows = realizedOptionTrades.filter((o) => weekStart(new Date(o.time).toLocaleDateString("en-CA")) === effectiveWeek);
        const weekTxnRows = transactions.filter((t) => weekStart(new Date(t.time).toLocaleDateString("en-CA")) === effectiveWeek);
        const hasActivity = weekRows.length > 0 || (weekMeta && (weekMeta.options !== 0 || weekMeta.interest !== 0 || weekMeta.dividends !== 0));
        if (!effectiveWeek || !hasActivity) return (
          <Center h={150}><Text c="dimmed" size="sm">No activity this week.</Text></Center>
        );
        const allTableRows: { time: string; el: React.ReactNode }[] = [
          ...weekRows.map((row) => ({
            time: row.time,
            el: (
              <Table.Tr key={`eq-${row.orderId}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(row.time)}</Text></Table.Td>
                <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile"><Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile"><Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile">
                  {row.fees !== 0 ? <Text size="sm" c="dimmed">{mask(fmtMoney(row.fees))}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
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
              <Table.Tr key={`opt-${o.id}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(o.time)}</Text></Table.Td>
                <Table.Td ta="right"><Text size="sm" c="orange">{o.contracts}</Text></Table.Td>
                <Table.Td colSpan={2} className="hide-mobile"><Text size="sm" c="dimmed">${fmt(o.strike)} · ${fmt(o.openPrice)} → {o.closePrice != null ? `$${fmt(o.closePrice)}` : "Expired"}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile">
                  {o.fees !== 0 ? <Text size="sm" c="dimmed">{mask(fmtMoney(o.fees))}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" fw={600} c={o.net < 0 ? "red" : "orange"}>{mask(fmtMoney(o.net, true))}</Text>
                </Table.Td>
              </Table.Tr>
            ),
          })),
          ...weekTxnRows.map((t) => ({
            time: t.time,
            el: (
              <Table.Tr key={`txn-${t.activityId}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(t.time)}</Text></Table.Td>
                <Table.Td />
                <Table.Td colSpan={3} className="hide-mobile"><Text size="sm" c="dimmed">{t.description}</Text></Table.Td>
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
                <Table.Th ta="right" className="hide-mobile">Buy Price</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Sell Price</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Fees</Table.Th>
                <Table.Th ta="right">Profit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{allTableRows.map((r) => r.el)}</Table.Tbody>
          </Table>
        );
      })()}

      {period === "month" && (() => {
        const effectiveMonth = (selectedMonth && last12Months.some((m) => m.monthKey === selectedMonth)) ? selectedMonth : last12Months[0]?.monthKey ?? null;
        return (
          <ScrollArea type="scroll">
            <Group gap="xs" wrap="nowrap" pb={4} pt={2} px={2} align="stretch">
              {last12Months.map((month) => (
                <MonthCard
                  key={month.monthKey}
                  month={month}
                  privacyMode={privacyMode}
                  color={activeAccount?.color ?? "blue"}
                  selected={month.monthKey === effectiveMonth}
                  onClick={() => setSelectedMonth(month.monthKey)}
                />
              ))}
            </Group>
          </ScrollArea>
        );
      })()}

      {period === "month" && (() => {
        const effectiveMonth = (selectedMonth && last12Months.some((m) => m.monthKey === selectedMonth)) ? selectedMonth : last12Months[0]?.monthKey ?? null;
        const monthMeta = last12Months.find((m) => m.monthKey === effectiveMonth);
        const monthRows = filteredRows.filter((r) => monthKey(r.date) === effectiveMonth);
        const mOptRows = realizedOptionTrades.filter((o) => monthKey(new Date(o.time).toLocaleDateString("en-CA")) === effectiveMonth);
        const mTxnRows = transactions.filter((t) => monthKey(new Date(t.time).toLocaleDateString("en-CA")) === effectiveMonth);
        const hasActivity = monthRows.length > 0 || (monthMeta && (monthMeta.options !== 0 || monthMeta.interest !== 0 || monthMeta.dividends !== 0));
        if (!effectiveMonth || !hasActivity) return (
          <Center h={150}><Text c="dimmed" size="sm">No activity this month.</Text></Center>
        );
        const allTableRows: { time: string; el: React.ReactNode }[] = [
          ...monthRows.map((row) => ({
            time: row.time,
            el: (
              <Table.Tr key={`eq-${row.orderId}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(row.time)}</Text></Table.Td>
                <Table.Td ta="right"><Text size="sm">{fmt(row.shares, 0)}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile"><Text size="sm">{row.buyPrice != null ? mask(`$${fmt(row.buyPrice)}`) : "—"}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile"><Text size="sm">{mask(`$${fmt(row.sellPrice)}`)}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile">
                  {row.fees !== 0 ? <Text size="sm" c="dimmed">{mask(fmtMoney(row.fees))}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
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
              <Table.Tr key={`opt-${o.id}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(o.time)}</Text></Table.Td>
                <Table.Td ta="right"><Text size="sm" c="orange">{o.contracts}</Text></Table.Td>
                <Table.Td colSpan={2} className="hide-mobile"><Text size="sm" c="dimmed">${fmt(o.strike)} · ${fmt(o.openPrice)} → {o.closePrice != null ? `$${fmt(o.closePrice)}` : "Expired"}</Text></Table.Td>
                <Table.Td ta="right" className="hide-mobile">
                  {o.fees !== 0 ? <Text size="sm" c="dimmed">{mask(fmtMoney(o.fees))}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" fw={600} c={o.net < 0 ? "red" : "orange"}>{mask(fmtMoney(o.net, true))}</Text>
                </Table.Td>
              </Table.Tr>
            ),
          })),
          ...mTxnRows.map((t) => ({
            time: t.time,
            el: (
              <Table.Tr key={`txn-${t.activityId}`}>
                <Table.Td><Text size="sm" c="dimmed">{fmtDate(t.time)}</Text></Table.Td>
                <Table.Td />
                <Table.Td colSpan={3} className="hide-mobile"><Text size="sm" c="dimmed">{t.description}</Text></Table.Td>
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
                <Table.Th ta="right" className="hide-mobile">Buy Price</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Sell Price</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Fees</Table.Th>
                <Table.Th ta="right">Profit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{allTableRows.map((r) => r.el)}</Table.Tbody>
          </Table>
        );
      })()}

      {period === "year" && (
        <Stack>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            {/* Equity */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>Equity</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Trades</Text>
                  <Text size="xs" fw={500} c="white" ta="right">{yearlyData.equityTrades}</Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Avg / trade</Text>
                  <Text size="xs" fw={500} c="white" ta="right">
                    {yearlyData.equityTrades > 0 ? mask(fmtMoney(yearlyData.equityTotal / yearlyData.equityTrades, true)) : "—"}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text fw={700} c={yearlyData.equityTotal < 0 ? "red" : activeAccount?.color ?? "blue"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {yearlyData.equityTrades > 0 ? mask(fmtMoney(yearlyData.equityTotal, true)) : "—"}
                  </Text>
                </Group>
              </Stack>
            </Paper>

            {/* Options */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>Options</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Trades</Text>
                  <Text size="xs" fw={500} c="white" ta="right">{yearlyData.optionsTrades}</Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Avg / trade</Text>
                  <Text size="xs" fw={500} c="white" ta="right">
                    {yearlyData.optionsTrades > 0 ? mask(fmtMoney(yearlyData.optionsTotal / yearlyData.optionsTrades, true)) : "—"}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text fw={700} c={yearlyData.optionsTotal < 0 ? "red" : "orange"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {yearlyData.optionsTrades > 0 ? mask(fmtMoney(yearlyData.optionsTotal, true)) : "—"}
                  </Text>
                </Group>
              </Stack>
            </Paper>

            {/* Int / Div */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>Int / Div</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Payments</Text>
                  <Text size="xs" fw={500} c="white" ta="right">{yearlyData.intDivTxns}</Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Avg / payment</Text>
                  <Text size="xs" fw={500} c="white" ta="right">
                    {yearlyData.intDivTxns > 0 ? mask(fmtMoney(yearlyData.intDivTotal / yearlyData.intDivTxns, true)) : "—"}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text fw={700} c={yearlyData.intDivTotal < 0 ? "red" : "lime"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {yearlyData.intDivTxns > 0 ? mask(fmtMoney(yearlyData.intDivTotal, true)) : "—"}
                  </Text>
                </Group>
              </Stack>
            </Paper>

            {/* Total */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, outline: "1px solid var(--mantine-color-dark-4)", height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>{yearlyData.year} Total</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Equity</Text>
                  <Text size="xs" fw={500} c={yearlyData.equityTotal < 0 ? "red" : activeAccount?.color ?? "blue"} ta="right">
                    {yearlyData.equityTrades > 0 ? mask(fmtMoney(yearlyData.equityTotal, true)) : "—"}
                  </Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Options</Text>
                  <Text size="xs" fw={500} c={yearlyData.optionsTotal < 0 ? "red" : "orange"} ta="right">
                    {yearlyData.optionsTrades > 0 ? mask(fmtMoney(yearlyData.optionsTotal, true)) : "—"}
                  </Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Int / Div</Text>
                  <Text size="xs" fw={500} c="lime" ta="right">
                    {yearlyData.intDivTxns > 0 ? mask(fmtMoney(yearlyData.intDivTotal, true)) : "—"}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text fw={700} c={yearlyData.total < 0 ? "red" : "white"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {mask(fmtMoney(yearlyData.total, true))}
                  </Text>
                </Group>
              </Stack>
            </Paper>
          </SimpleGrid>

          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Month</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Equity</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Options</Table.Th>
                <Table.Th ta="right" className="hide-mobile">Int / Div</Table.Th>
                <Table.Th ta="right" className="show-mobile">Profit</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {yearlyData.months.map((m) => {
                const total = m.equity + m.options + m.interest + m.dividends;
                const hasActivity = m.equityTrades > 0 || m.options !== 0 || m.interest !== 0 || m.dividends !== 0;
                const color = activeAccount?.color ?? "blue";
                const intDiv = m.interest + m.dividends;
                return (
                  <Table.Tr key={m.monthKey} style={{ opacity: hasActivity ? 1 : 0.4 }}>
                    <Table.Td><Text size="sm">{m.label}</Text></Table.Td>
                    <Table.Td ta="right" className="hide-mobile">
                      <Text size="sm" c={!hasActivity ? "dimmed" : m.equity >= 0 ? color : "red"}>
                        {m.equityTrades > 0 ? mask(fmtMoney(m.equity, true)) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" className="hide-mobile">
                      <Text size="sm" c={m.options === 0 ? "dimmed" : m.options < 0 ? "red" : "orange"}>
                        {m.options !== 0 ? mask(fmtMoney(m.options, true)) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" className="hide-mobile">
                      <Text size="sm" c={intDiv === 0 ? "dimmed" : "lime"}>
                        {intDiv !== 0 ? mask(fmtMoney(intDiv, true)) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" className="show-mobile">
                      <Stack gap={2} align="center">
                        {m.equityTrades > 0 && <Text size="sm" c={m.equity >= 0 ? color : "red"}>{mask(fmtMoney(m.equity, true))}</Text>}
                        {m.options !== 0 && <Text size="sm" c={m.options < 0 ? "red" : "orange"}>{mask(fmtMoney(m.options, true))}</Text>}
                        {intDiv !== 0 && <Text size="sm" c="lime">{mask(fmtMoney(intDiv, true))}</Text>}
                        {!hasActivity && <Text size="sm" c="dimmed">—</Text>}
                      </Stack>
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
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            {/* Box 1: TQQQ long position */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>Long Position</Text>

                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Cost: {tqqqShares > 0 ? `${tqqqShares.toLocaleString()} × ${fmt(tqqqAvgPrice)}` : "No shares held"}</Text>
                  <Text size="xs" fw={500} c="white" ta="right">
                    {tqqqShares > 0 && tqqqAvgPrice > 0 ? mask(`$${fmt(tqqqTotalCost, 0)}`) : "—"}
                  </Text>
                </Group>

                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Value: {tqqqShares > 0 && quote.price > 0 ? `${tqqqShares.toLocaleString()} × ${fmt(quote.price)}` : "—"}</Text>
                  <Text size="xs" fw={500} c="white" ta="right">
                    {tqqqShares > 0 && quote.price > 0 ? mask(`$${fmt(tqqqCurrentVal, 0)}`) : "—"}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Gain / loss</Text>
                  <Text fw={700} c={tqqqUnrealized != null && tqqqUnrealized < 0 ? "red" : "white"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {tqqqUnrealized != null ? mask(fmtMoney(tqqqUnrealized, true)) : "—"}
                  </Text>
                </Group>
              </Stack>
            </Paper>

            {/* Box 2: Realized profit breakdown */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>Realized Profit</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Equity ({allTimeData.trades} trades)</Text>
                  <Text size="xs" fw={500} c={allTimeData.equityTotal < 0 ? "red" : activeAccount?.color ?? "blue"} ta="right">
                    {mask(fmtMoney(allTimeData.equityTotal, true))}
                  </Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Options</Text>
                  <Text size="xs" fw={500} c={allTimeData.optionsTotal < 0 ? "red" : "orange"} ta="right">
                    {mask(fmtMoney(allTimeData.optionsTotal, true))}
                  </Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Int / Div</Text>
                  <Text size="xs" fw={500} c="lime" ta="right">
                    {mask(fmtMoney(allTimeData.intDivTotal, true))}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text fw={700} c={allTimeData.total < 0 ? "red" : "white"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {mask(fmtMoney(allTimeData.total, true))}
                  </Text>
                </Group>
              </Stack>
            </Paper>

            {/* Box 3: Grand total */}
            <Paper p="md" radius={CARD_RADIUS} style={{ background: summaryBg, outline: "1px solid var(--mantine-color-dark-4)", height: "100%" }}>
              <Stack gap={4} h="100%">
                <Text c="dimmed" tt="uppercase" fw={600} ta="center" style={CARD_LABEL_STYLE} mb={6}>Grand Total</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Unrealized</Text>
                  <Text size="xs" fw={500} c={tqqqUnrealized != null && tqqqUnrealized < 0 ? "red" : "white"} ta="right">
                    {tqqqUnrealized != null ? mask(fmtMoney(tqqqUnrealized, true)) : "—"}
                  </Text>
                </Group>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Realized</Text>
                  <Text size="xs" fw={500} c={allTimeData.total < 0 ? "red" : "white"} ta="right">
                    {mask(fmtMoney(allTimeData.total, true))}
                  </Text>
                </Group>
                <Divider mt="auto" />
                <Group justify="space-between" gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">Total</Text>
                  <Text fw={700} c={grandTotal != null && grandTotal < 0 ? "red" : "white"} ta="right" className={outfit.className} style={{ fontSize: "1rem" }}>
                    {grandTotal != null ? mask(fmtMoney(grandTotal, true)) : "—"}
                  </Text>
                </Group>
              </Stack>
            </Paper>
          </SimpleGrid>

          {allTimeData.years.length === 0 ? (
            <Center h={150}><Text c="dimmed" size="sm">No data.</Text></Center>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Year</Table.Th>
                  <Table.Th ta="right" className="hide-mobile">Equity</Table.Th>
                  <Table.Th ta="right" className="hide-mobile">Options</Table.Th>
                  <Table.Th ta="right" className="hide-mobile">Int / Div</Table.Th>
                  <Table.Th ta="right" className="show-mobile">Profit</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {allTimeData.years.map((y) => {
                  const total = y.equity + y.options + y.interest + y.dividends;
                  const color = activeAccount?.color ?? "blue";
                  const intDiv = y.interest + y.dividends;
                  return (
                    <Table.Tr key={y.year}>
                      <Table.Td><Text size="sm">{y.year}</Text></Table.Td>
                      <Table.Td ta="right" className="hide-mobile">
                        <Text size="sm" c={y.equityTrades === 0 ? "dimmed" : y.equity >= 0 ? color : "red"}>
                          {y.equityTrades > 0 ? mask(fmtMoney(y.equity, true)) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" className="hide-mobile">
                        <Text size="sm" c={y.options === 0 ? "dimmed" : y.options < 0 ? "red" : "orange"}>
                          {y.options !== 0 ? mask(fmtMoney(y.options, true)) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" className="hide-mobile">
                        <Text size="sm" c={intDiv === 0 ? "dimmed" : "lime"}>
                          {intDiv !== 0 ? mask(fmtMoney(intDiv, true)) : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" className="show-mobile">
                        <Stack gap={2} align="center">
                          {y.equityTrades > 0 && <Text size="sm" c={y.equity >= 0 ? color : "red"}>{mask(fmtMoney(y.equity, true))}</Text>}
                          {y.options !== 0 && <Text size="sm" c={y.options < 0 ? "red" : "orange"}>{mask(fmtMoney(y.options, true))}</Text>}
                          {intDiv !== 0 && <Text size="sm" c="lime">{mask(fmtMoney(intDiv, true))}</Text>}
                        </Stack>
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

    </Stack>
  );
}
