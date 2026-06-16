"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import {
  Stack, Group, Text, Paper, Button, NumberInput, Select, SegmentedControl,
  SimpleGrid, Table, Badge, Loader, Center, ThemeIcon, ScrollArea, Switch,
} from "@mantine/core";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { IconFlask, IconPlayerPlayFilled, IconCopy, IconChevronRight } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "@/lib/context/AppContext";
import { fmt } from "@/lib/format";
import type { GridParams } from "@/lib/backtest";

// ── Window presets (recent = intraday; historical = daily bars) ───────────────
interface WindowSpec { interval: string; days: number; range?: { from: string; to: string } }
const WINDOWS: Record<string, { label: string; spec: WindowSpec }> = {
  recent: { label: "Recent ~58d (5m)", spec: { interval: "5m", days: 58 } },
  year: { label: "Past year (1d)", spec: { interval: "1d", days: 365 } },
  bear22: { label: "2022 Bear (1d)", spec: { interval: "1d", days: 60, range: { from: "2022-01-01", to: "2022-12-31" } } },
  covid20: { label: "2020 COVID (1d)", spec: { interval: "1d", days: 60, range: { from: "2020-01-01", to: "2020-12-31" } } },
  chop15: { label: "2015–16 Chop (1d)", spec: { interval: "1d", days: 60, range: { from: "2015-01-01", to: "2016-12-31" } } },
};

// ── Config presets to drop into a scenario ────────────────────────────────────
const PRESETS: Record<string, GridParams> = {
  Balanced: { spacing: 2.5, sell: 4, R: 0.96, regime: "pause", vol: "on" },
  "Chop-max": { spacing: 2, sell: 6, R: 0.94, regime: "pause", vol: "on" },
  Preservation: { spacing: 3, sell: 2, R: 0.98, regime: "pause", vol: "on" },
  "Static 1%": { spacing: 1, sell: 5, R: 0.95, regime: "none", vol: "off" },
};

interface ScenarioOut {
  name: string; params?: GridParams;
  spacingRange?: [number, number]; sellRange?: [number, number];
  totalReturnPct: number; maxDDPct: number; retDD: number; roundTrips: number; realized: number; resets: number;
}
interface Trade { date: string; side: "BUY" | "SELL"; level: number; shares: number; price: number }
interface DayCount { buys: number; sells: number; net: number; trades: Trade[] }
interface TradeDay { date: string; a: DayCount; b: DayCount; diff: boolean }
interface RunResponse {
  meta: { bars: number; interval: string; tqqqStart: number; tqqqEnd: number; riskOffDays: number; totalDays: number };
  results: ScenarioOut[];
  chart: Record<string, string | number>[];
  seriesNames: string[];
  trades: { names: [string, string]; days: TradeDay[]; diffDays: number };
}

const LINE_COLORS: Record<string, string> = {
  A: "var(--mantine-color-indigo-4)",
  B: "var(--mantine-color-grape-4)",
  "Live config": "var(--mantine-color-gray-5)",
  "Buy & Hold": "var(--mantine-color-teal-5)",
};

function ScenarioCard({
  title, color, value, onChange, onClone, cloneLabel,
}: { title: string; color: string; value: GridParams; onChange: (p: GridParams) => void; onClone?: () => void; cloneLabel?: string }) {
  const set = (patch: Partial<GridParams>) => onChange({ ...value, ...patch });
  return (
    <Paper p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Group gap={8}>
          <Badge color={color} variant="filled" radius="sm">{title}</Badge>
          {onClone && (
            <Button size="compact-xs" variant="light" color={color} leftSection={<IconCopy size={13} />} onClick={onClone}>
              {cloneLabel ?? "Clone"}
            </Button>
          )}
        </Group>
        <Group gap={4}>
          {Object.keys(PRESETS).map((name) => (
            <Button key={name} size="compact-xs" variant="subtle" color={color} onClick={() => onChange({ ...PRESETS[name] })}>
              {name}
            </Button>
          ))}
        </Group>
      </Group>
      <SimpleGrid cols={3} spacing="sm">
        <NumberInput label="Spacing %" value={value.spacing} min={0.1} max={10} step={0.25} decimalScale={2}
          onChange={(v) => set({ spacing: Number(v) || 0 })} />
        <NumberInput label="Sell %" value={value.sell} min={0.5} max={30} step={0.5} decimalScale={2}
          onChange={(v) => set({ sell: Number(v) || 0 })} />
        <NumberInput label="R (reduction)" value={value.R} min={0.7} max={0.999} step={0.01} decimalScale={3}
          onChange={(v) => set({ R: Number(v) || 0 })} />
        <Select label="Regime" data={["none", "pause", "widen"]} value={value.regime} allowDeselect={false}
          onChange={(v) => set({ regime: (v as GridParams["regime"]) ?? "none" })} />
        <div>
          <Text size="sm" fw={500} mb={4}>Vol-adaptive</Text>
          <SegmentedControl fullWidth size="xs" data={["off", "on"]} value={value.vol}
            onChange={(v) => set({ vol: v as GridParams["vol"] })} />
        </div>
      </SimpleGrid>
    </Paper>
  );
}

const pct = (n: number) => (n >= 0 ? "+" : "") + fmt(n, 1) + "%";
/** "2.50%" if the value held flat across the run, "2.50–7.50%" if it varied (vol-adaptive / widen). */
const rng = (r?: [number, number], suffix = "") => {
  if (!r) return "—";
  const [a, b] = r;
  return Math.abs(b - a) < 0.005 ? `${fmt(a, 2)}${suffix}` : `${fmt(a, 2)}–${fmt(b, 2)}${suffix}`;
};

function DayCell({ c }: { c: DayCount }) {
  if (c.buys === 0 && c.sells === 0) return <Table.Td><Text size="xs" c="dimmed">—</Text></Table.Td>;
  return (
    <Table.Td>
      <Text size="sm">
        <Text span c="teal">{c.buys}B</Text> · <Text span c="red">{c.sells}S</Text>
      </Text>
      <Text size="xs" c="dimmed">net {c.net >= 0 ? "+" : ""}{c.net.toLocaleString()} sh</Text>
    </Table.Td>
  );
}

/** Individual fills for one scenario on one day (drill-down). */
function TradeList({ label, color, trades, intraday }: { label: string; color: string; trades: Trade[]; intraday: boolean }) {
  const time = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  return (
    <div>
      <Badge color={color} variant="light" mb={4}>{label}</Badge>
      {trades.length === 0 ? (
        <Text size="xs" c="dimmed">no trades</Text>
      ) : (
        <Stack gap={2}>
          {trades.map((t, i) => (
            <Text key={i} size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
              {intraday && <Text span c="dimmed">{time(t.date)} </Text>}
              <Text span c={t.side === "BUY" ? "teal" : "red"} fw={600}>{t.side}</Text>
              {" "}<Text span c="dimmed">L{t.level}</Text>
              {" "}{t.shares.toLocaleString()} sh @ ${fmt(t.price)}
            </Text>
          ))}
        </Stack>
      )}
    </div>
  );
}

export default function BacktestPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { activeAccount } = useApp();
  const s = activeAccount?.settings;
  const startingCash = s?.levelStartingCash ?? 100_000;
  const liveSell = s?.sellPercentage ?? 5;
  const liveR = s?.reductionFactor ?? 0.95;

  // Scenario A defaults to the live account config (spacing/regime/vol/reset aren't account settings,
  // so they take the live-equivalent defaults). Seed it now and re-sync once settings load from the
  // account context — unless the user has already edited A.
  const liveConfig = (): GridParams => ({ spacing: 1, sell: liveSell, R: liveR, regime: "none", vol: "off" });
  const [windowKey, setWindowKey] = useState<string>("recent");
  const [scenA, setScenA] = useState<GridParams>(liveConfig);
  const [scenB, setScenB] = useState<GridParams>({ ...PRESETS["Chop-max"] });
  const aTouched = useRef(false);
  useEffect(() => {
    if (!aTouched.current) setScenA({ spacing: 1, sell: liveSell, R: liveR, regime: "none", vol: "off" });
  }, [liveSell, liveR]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RunResponse | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleDay = (date: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startingCash, sellPct: liveSell, R: liveR,
          window: WINDOWS[windowKey].spec,
          scenarios: [{ name: "A", params: scenA }, { name: "B", params: scenB }],
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Run failed"); setData(null); }
      else setData(json as RunResponse);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const colorFor = (name: string) =>
    name === "A" ? "indigo" : name === "B" ? "grape" : name === "Live config" ? "gray" : "teal";

  return (
    <Stack gap="md" pb={isMobile ? 80 : 24}>
      <Group gap="sm">
        <ThemeIcon variant="light" color="indigo" size="lg" radius="xl"><IconFlask size={20} /></ThemeIcon>
        <div>
          <Text fw={700} size="xl">Backtest Lab</Text>
          <Text size="xs" c="dimmed">
            Compare two grid configs over one market window vs your live config and buy & hold.
            Starting cash ${fmt(startingCash, 0)} · live sell {fmt(liveSell, 2)}% · R {liveR}.
          </Text>
        </div>
      </Group>

      <Paper p="md" withBorder>
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Select
            label="Market window"
            data={Object.entries(WINDOWS).map(([k, v]) => ({ value: k, label: v.label }))}
            value={windowKey} allowDeselect={false} onChange={(v) => setWindowKey(v ?? "recent")}
            w={220}
          />
          <Button leftSection={<IconPlayerPlayFilled size={16} />} onClick={run} loading={loading} color="indigo">
            Run backtest
          </Button>
        </Group>
      </Paper>

      <SimpleGrid cols={isMobile ? 1 : 2} spacing="md">
        <ScenarioCard title="A" color="indigo" value={scenA}
          onChange={(p) => { aTouched.current = true; setScenA(p); }}
          onClone={() => setScenB({ ...scenA })} cloneLabel="Clone → B" />
        <ScenarioCard title="B" color="grape" value={scenB} onChange={setScenB} />
      </SimpleGrid>

      {error && <Text c="red" size="sm">{error}</Text>}
      {loading && <Center h={120}><Loader /></Center>}

      {data && !loading && (
        <>
          <Paper p="md" withBorder>
            <Text fw={600} mb={4}>Equity curve — cumulative return (%)</Text>
            <Text size="xs" c="dimmed" mb="sm">
              {WINDOWS[windowKey].label} · {data.meta.bars.toLocaleString()} bars · TQQQ ${fmt(data.meta.tqqqStart, 2)} → ${fmt(data.meta.tqqqEnd, 2)} · risk-off {data.meta.riskOffDays}/{data.meta.totalDays} days
            </Text>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--mantine-color-gray-5)" }} tickLine={false} minTickGap={48} />
                <YAxis width={46} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--mantine-color-gray-5)" }}
                  tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} domain={["auto", "auto"]} />
                <ReferenceLine y={0} stroke="var(--mantine-color-gray-6)" />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <Paper p="xs" withBorder>
                      <Text size="xs" c="dimmed" mb={2}>{label}</Text>
                      {payload.map((p) => (
                        <Text key={p.name} size="xs" style={{ color: p.color }}>
                          {p.name}: <Text span fw={700}>{pct(Number(p.value))}</Text>
                        </Text>
                      ))}
                    </Paper>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {data.seriesNames.map((name) => (
                  <Line key={name} type="monotone" dataKey={name} name={name}
                    stroke={LINE_COLORS[name] ?? "var(--mantine-color-blue-5)"}
                    strokeWidth={name === "A" || name === "B" ? 2 : 1.5}
                    strokeDasharray={name === "Buy & Hold" ? "5 3" : undefined}
                    dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Paper>

          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Scenario</Table.Th>
                <Table.Th>Return</Table.Th>
                <Table.Th>Max DD</Table.Th>
                <Table.Th>Ret ÷ DD</Table.Th>
                <Table.Th>Round-trips</Table.Th>
                {!isMobile && <Table.Th>Realized</Table.Th>}
                {!isMobile && <Table.Th>Config</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.results.map((r) => (
                <Table.Tr key={r.name}>
                  <Table.Td><Badge color={colorFor(r.name)} variant="light">{r.name}</Badge></Table.Td>
                  <Table.Td><Text fw={700} c={r.totalReturnPct >= 0 ? "teal" : "red"}>{pct(r.totalReturnPct)}</Text></Table.Td>
                  <Table.Td>{fmt(r.maxDDPct, 1)}%</Table.Td>
                  <Table.Td>{fmt(r.retDD, 2)}</Table.Td>
                  <Table.Td>{r.roundTrips}</Table.Td>
                  {!isMobile && <Table.Td>${fmt(r.realized, 0)}</Table.Td>}
                  {!isMobile && (
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {r.params
                          ? `s=${rng(r.spacingRange, "%")} sell=${rng(r.sellRange, "%")} R=${r.params.R} ${r.params.regime} vol=${r.params.vol}`
                          : "—"}
                      </Text>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {/* Per-day trade activity, A vs B. Days where the two differ are highlighted. */}
          <Paper p="md" withBorder>
            <Group justify="space-between" mb="xs" wrap="wrap">
              <div>
                <Text fw={600}>Trade activity by day — A vs B</Text>
                <Text size="xs" c="dimmed">
                  {data.trades.diffDays} of {data.trades.days.length} active days differ (buy/sell counts or net shares). Each cell: buys·sells, net shares below.
                </Text>
              </div>
              <Switch label="Only differing days" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.currentTarget.checked)} size="sm" />
            </Group>
            {data.trades.days.length === 0 ? (
              <Text size="sm" c="dimmed">Neither scenario traded in this window.</Text>
            ) : (
              <ScrollArea h={360} type="auto">
                <Table stickyHeader withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th><Badge color="indigo" variant="light">A</Badge></Table.Th>
                      <Table.Th><Badge color="grape" variant="light">B</Badge></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.trades.days.filter((d) => !onlyDiff || d.diff).map((d) => {
                      const open = expanded.has(d.date);
                      const tint = d.diff ? { background: "color-mix(in srgb, var(--mantine-color-yellow-9) 16%, transparent)" } : undefined;
                      return (
                        <Fragment key={d.date}>
                          <Table.Tr style={{ ...tint, cursor: "pointer" }} onClick={() => toggleDay(d.date)}>
                            <Table.Td>
                              <Group gap={6} wrap="nowrap">
                                <IconChevronRight size={13}
                                  style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms", color: "var(--mantine-color-gray-5)" }} />
                                <Text size="sm">{d.date}</Text>
                                {d.diff && <Badge size="xs" color="yellow" variant="light">≠</Badge>}
                              </Group>
                            </Table.Td>
                            <DayCell c={d.a} />
                            <DayCell c={d.b} />
                          </Table.Tr>
                          {open && (
                            <Table.Tr style={tint}>
                              <Table.Td />
                              <Table.Td><TradeList label="A" color="indigo" trades={d.a.trades} intraday={data.meta.interval !== "1d"} /></Table.Td>
                              <Table.Td><TradeList label="B" color="grape" trades={d.b.trades} intraday={data.meta.interval !== "1d"} /></Table.Td>
                            </Table.Tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Paper>

          <Text size="xs" c="dimmed">
            Historical windows use daily bars (≤1 round-trip per level per day), so absolute numbers are
            coarser than the intraday recent window — trust the relative ranking. Read-only; nothing here
            touches your tracked positions.
          </Text>
        </>
      )}
    </Stack>
  );
}
