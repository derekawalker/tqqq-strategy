"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Paper, Stack, Text, Group, SegmentedControl, Center,
  Button, Alert, Loader, Table, Badge,
} from "@mantine/core";
import { IconAlertTriangle, IconHistory } from "@tabler/icons-react";
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

interface BackupEntry {
  date: string;
  balanceHistoryCount: number;
  keys: string[];
}

function RestorePanel({ onRestored }: { onRestored: () => void }) {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/backup");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load backups");
      setBackups(json.backups as BackupEntry[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function restore(date: string) {
    setRestoring(date);
    setError(null);
    try {
      const res = await fetch("/api/settings/backup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, keys: ["balanceHistory"] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Restore failed");
      setSuccess(true);
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(null);
    }
  }

  if (success) {
    return (
      <Alert color="teal" icon={<IconHistory size={16} />} radius="md">
        History restored — reload the page to see it.
      </Alert>
    );
  }

  return (
    <Paper p="md" withBorder radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" fw={600}>Restore from backup</Text>
          <Button size="xs" variant="subtle" color="gray" onClick={load} loading={loading}>
            Refresh
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Daily backups are kept for 30 days. Restoring only overwrites balance history — account
          settings are not affected.
        </Text>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={14} />} radius="sm">
            {error}
          </Alert>
        )}

        {loading && <Center py="sm"><Loader size="sm" /></Center>}

        {backups && backups.length === 0 && (
          <Text size="sm" c="dimmed">No backups found.</Text>
        )}

        {backups && backups.length > 0 && (
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Backup date</Table.Th>
                <Table.Th>Entries</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {backups.map((b) => (
                <Table.Tr key={b.date}>
                  <Table.Td>{b.date}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={b.balanceHistoryCount > 1 ? "teal" : "gray"} size="sm">
                      {b.balanceHistoryCount} day{b.balanceHistoryCount !== 1 ? "s" : ""}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      loading={restoring === b.date}
                      disabled={restoring !== null || b.balanceHistoryCount === 0}
                      onClick={() => restore(b.date)}
                    >
                      Restore
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}

export default function HistoryPage() {
  const { activeAccount, balanceHistory, privacyMode } = useApp();
  const color = useAccountColor();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const mask = createMask(privacyMode);
  const [showRestore, setShowRestore] = useState(false);

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

  const pad = (max - min) * 0.08 || max * 0.05 || 10;
  const changeColor = change >= 0 ? "teal" : "red";
  const changeSign = change >= 0 ? "+" : "";

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">History</Text>
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconHistory size={14} />}
            onClick={() => setShowRestore((v) => !v)}
          >
            {showRestore ? "Hide restore" : "Restore backup"}
          </Button>
          <SegmentedControl size="xs" value={range} onChange={handleRangeChange} data={RANGE_OPTIONS} />
        </Group>
      </Group>

      {showRestore && (
        <RestorePanel onRestored={() => setShowRestore(false)} />
      )}

      <Paper p={isMobile ? "xs" : "md"}>
        {series.length === 0 ? (
          <Center h={isMobile ? 280 : 360}>
            <Stack align="center" gap="sm">
              <Text size="sm" c="dimmed" ta="center">
                Not enough history yet — account value is recorded once per day,
                <br />so check back after a couple of days of use.
              </Text>
              {!showRestore && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconHistory size={14} />}
                  onClick={() => setShowRestore(true)}
                >
                  Restore from backup
                </Button>
              )}
            </Stack>
          </Center>
        ) : (
          <Stack gap="md">
            <Group justify="space-between" align="flex-end">
              <Text size="xs" c="dimmed">
                {series.length === 1
                  ? `${fmtDateKey(series[0].date)} — tracking started`
                  : `${fmtDateKey(series[0].date)} – ${fmtDateKey(series[series.length - 1].date)}`}
              </Text>
              {series.length === 1 ? (
                <Text size="sm" fw={700}>{mask(`$${fmt(series[0].value, 0)}`)}</Text>
              ) : (
                <Text size="sm" fw={700} c={changeColor}>
                  {mask(`${changeSign}$${fmt(change, 0)} (${changeSign}${fmt(changePercent, 1)}%)`)}
                </Text>
              )}
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
                  dot={series.length === 1 ? { r: 4, fill: `var(--mantine-color-${color}-5)`, strokeWidth: 0 } : false}
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
