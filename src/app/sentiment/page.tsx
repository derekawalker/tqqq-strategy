"use client";

import { useEffect, useState } from "react";
import {
  Stack,
  Group,
  Paper,
  Text,
  Badge,
  Skeleton,
  Box,
  Table,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { BarChart } from "@mantine/charts";
import type { VerdictPayload, SignalReading } from "@/app/api/sentiment/route";
import type { AccuracyStats, HistoryRow } from "@/lib/sentimentHistory";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { useCardBg } from "@/lib/hooks/useCardBg";

// ── helpers ────────────────────────────────────────────────────────────────

function verdictColor(verdict: VerdictPayload["verdict"]): string {
  if (verdict === "lean-long") return "green";
  if (verdict === "lean-short") return "red";
  return "gray";
}

function edgeColor(edge: number | null): string {
  if (edge == null) return "gray";
  if (edge > 0.3) return "green";
  if (edge > 0.1) return "lime";
  if (edge > -0.1) return "gray";
  if (edge > -0.3) return "orange";
  return "red";
}

function formatPct(v: number | null, withSign = true): string {
  if (v == null) return "—";
  const sign = withSign && v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function CacheAge({ cachedAt }: { cachedAt: number }) {
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMins(Math.floor((Date.now() - cachedAt) / 60000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [cachedAt]);
  if (mins == null) return null;
  return (
    <Text size="xs" c="dimmed" ta="center">
      {mins < 1 ? "Updated just now" : `Updated ${mins}m ago`} · refreshes every
      20m
    </Text>
  );
}

// ── verdict header ────────────────────────────────────────────────────────

function VerdictHeader({ data }: { data: VerdictPayload }) {
  const color = verdictColor(data.verdict);
  const bg = useCardBg(color);

  return (
    <Paper p="xl" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="xs" align="center">
        <Text
          size="xs"
          c="dimmed"
          tt="uppercase"
          fw={600}
          style={{ letterSpacing: "0.12em" }}
        >
          QQQ 5-day outlook
        </Text>
        <Text
          style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }}
          c={`${color}.4`}
        >
          {data.verdictLabel}
        </Text>

        <Group
          gap="lg"
          mt="sm"
          justify="center"
          wrap="nowrap"
          align="flex-start"
        >
          <Stack gap={4} align="center" style={{ minWidth: 80 }}>
            <Tooltip
              label="Sample-weighted average of historical 5-day QQQ returns across the bins each signal currently sits in. Treat as a directional summary, NOT a forecast of magnitude — backtest pearson with realized 5d return is ~0.02."
              withArrow
              multiline
              maw={280}
            >
              <Text
                size="xs"
                c="dimmed"
                tt="uppercase"
                fw={600}
                h={16}
                style={{ cursor: "help" }}
              >
                Signal mean
              </Text>
            </Tooltip>
            <Text size="xl" fw={700} c={`${color}.4`} ta="center">
              {formatPct(data.expectedReturn5d)}
            </Text>
          </Stack>
          <Stack gap={4} align="center" style={{ minWidth: 80 }}>
            <Tooltip
              label={`Historically (last ${data.yearsHistory} years), QQQ returned ${formatPct(data.baselineAvgReturn5d)} on average every 5 days. The edge shows if today's signals predict better or worse than that average.`}
              multiline
              maw={280}
              withArrow
              radius="md"
            >
              <Stack gap={4} align="center" style={{ cursor: "help" }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} h={16}>
                  Edge vs baseline
                </Text>
                <Text
                  size="xl"
                  fw={700}
                  c={`${edgeColor(data.edge)}.4`}
                  ta="center"
                >
                  {formatPct(data.edge)}
                </Text>
              </Stack>
            </Tooltip>
          </Stack>
          <Stack gap={12} align="center" style={{ minWidth: 80 }}>
            <Tooltip
              label="How many signals agree on direction. More ↑ or ↓ = higher confidence in the verdict. More – = signals are mixed/conflicting."
              withArrow
              multiline
              maw={240}
            >
              <Text
                size="xs"
                c="dimmed"
                tt="uppercase"
                fw={600}
                h={16}
                style={{ cursor: "help" }}
              >
                Agreement
              </Text>
            </Tooltip>
            <Group justify="center" gap={2} hiddenFrom="sm">
              <Badge color="green" variant="light" size="xs">
                {data.agreement.up}↑
              </Badge>
              <Badge color="gray" variant="light" size="xs">
                {data.agreement.neutral}–
              </Badge>
              <Badge color="red" variant="light" size="xs">
                {data.agreement.down}↓
              </Badge>
            </Group>
            <Group justify="center" gap={6} visibleFrom="sm">
              <Badge color="green" variant="light" size="sm">
                {data.agreement.up}↑
              </Badge>
              <Badge color="gray" variant="light" size="sm">
                {data.agreement.neutral}–
              </Badge>
              <Badge color="red" variant="light" size="sm">
                {data.agreement.down}↓
              </Badge>
            </Group>
          </Stack>
        </Group>
        <Text size="xs" c="dimmed" mt="sm" ta="center" maw={560}>
          Bullish/Bearish fires when ≥3 of 8 signals hit extreme-edge bins
          (|edge| &gt; 0.3%) in the same direction. Hit = realized 5d return
          &gt;+1.5% or &lt;−1.5% respectively.
        </Text>
      </Stack>
    </Paper>
  );
}

// ── signal descriptions ───────────────────────────────────────────────────

const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  "VIX / VIX3M":
    "Compares short-term fear (VIX) to longer-term fear (VIX3M). Low value = market is calm. High value = market is panicked. Extreme panic often leads to bounces.",
  "VIX 1-day change":
    "How much fear increased or decreased in one day. Big jumps in fear can be followed by small recoveries. But single-day spikes alone aren't reliable.",
  "QQQ vs 200d MA":
    "How far current price is above/below its 200-day average. Modestly above (0–10%) is the strongest historical bin; far below or far above both underperform.",
  "20d vol percentile":
    "Where today's 20-day realized volatility ranks against the past year. Very calm regimes (bottom 15th pctile) historically had the strongest 5d forward returns.",
  "RSI(2) + trend":
    "Measures how stretched the price is (overbought or oversold) over 2 days. In an uptrend, very stretched-down = good time to bounce back up. In a downtrend = weak.",
  "HYG − SPY (5d)":
    "Compares high-risk bonds (HYG) to stock market (SPY) over 5 days. Bonds falling faster = investors are scared (bearish). Bonds rising faster = investors are confident (bullish).",
  "10y yield 20d Δ":
    "Change in the 10-year Treasury yield over 20 trading days (in percentage points). Rising rates are a headwind for QQQ — the strongest bearish bin in backtest. Falling rates are a tailwind.",
  "TLT 20d return":
    "20-day return of TLT (long-duration Treasury ETF). Bonds rallying means yields are dropping and/or risk-off money is rotating — historically a tailwind for a QQQ bounce.",
};

// ── signal table ──────────────────────────────────────────────────────────

function SignalRow({ s }: { s: SignalReading }) {
  const eColor = edgeColor(s.vsBaseline);
  const description = SIGNAL_DESCRIPTIONS[s.name];
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={4} align="flex-start" wrap="nowrap">
          <Text size="sm" fw={600}>
            {s.name}
          </Text>
          {description && (
            <Tooltip label={description} multiline maw={260} withArrow>
              <Box
                style={{
                  cursor: "help",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <IconInfoCircle
                  size={14}
                  style={{ opacity: 0.6, flexShrink: 0 }}
                />
              </Box>
            </Tooltip>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {s.binLabel ?? "—"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" ta="right">
          {s.display}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={600} c={`${eColor}.4`} ta="right">
          {formatPct(s.avgReturn5d)}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={600} c={`${eColor}.4`} ta="right">
          {s.vsBaseline != null ? formatPct(s.vsBaseline) : "—"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed" ta="right">
          {s.hitRateUp != null ? `${s.hitRateUp.toFixed(0)}%` : "—"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} justify="flex-end">
          <Text size="xs" c="dimmed">
            n={s.sampleCount}
          </Text>
          {s.lowConfidence && (
            <Tooltip
              label={`Fewer than 30 samples — treat with caution`}
              withArrow
            >
              <Badge color="orange" variant="light" size="xs">
                low n
              </Badge>
            </Tooltip>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function SignalTable({ signals }: { signals: SignalReading[] }) {
  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{ background: "rgba(26, 27, 30, 0.65)" }}
    >
      <Text
        size="xs"
        c="dimmed"
        tt="uppercase"
        fw={600}
        mb="xs"
        style={{ letterSpacing: "0.12em" }}
      >
        Signals
      </Text>
      <Box style={{ overflowX: "auto" }}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Signal</Table.Th>
              <Table.Th ta="right">Now</Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="Historical avg QQQ 5d return when this signal was in its current bin"
                  withArrow
                  multiline
                  maw={240}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Avg 5d
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="Avg 5d return minus the baseline. Positive = bin historically beat random."
                  withArrow
                  multiline
                  maw={240}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Edge
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="% of historical 5d windows in this bin that closed up"
                  withArrow
                  multiline
                  maw={240}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Hit ↑
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">Samples</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {signals.map((s) => (
              <SignalRow key={s.key} s={s} />
            ))}
          </Table.Tbody>
        </Table>
      </Box>
    </Paper>
  );
}

// ── charts ────────────────────────────────────────────────────────────────

function SignalEdgeChart({ signals }: { signals: SignalReading[] }) {
  const data = signals.map((s) => ({
    signal: s.name,
    edge: s.vsBaseline != null ? Math.round(s.vsBaseline * 100) / 100 : 0,
  }));

  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{ background: "rgba(26, 27, 30, 0.65)" }}
    >
      <Text
        size="xs"
        c="dimmed"
        tt="uppercase"
        fw={600}
        mb="xs"
        style={{ letterSpacing: "0.12em" }}
      >
        Signal edges vs baseline
      </Text>
      <BarChart
        h={180}
        data={data}
        dataKey="signal"
        series={[{ name: "edge", color: "teal" }]}
        orientation="vertical"
        withLegend={false}
        withTooltip={false}
        valueFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
        referenceLines={[{ x: 0, color: "gray.5", strokeDasharray: "4 4" }]}
        getBarColor={(value) => {
          if (value > 0.3) return "green";
          if (value > 0.1) return "lime";
          if (value > -0.1) return "gray";
          if (value > -0.3) return "orange";
          return "red";
        }}
        yAxisProps={{ width: 140 }}
      />
    </Paper>
  );
}

// ── accuracy panel ────────────────────────────────────────────────────────

const VERDICT_META: Record<
  VerdictPayload["verdict"],
  { label: string; color: string }
> = {
  "lean-long": { label: "Bullish", color: "green" },
  "lean-short": { label: "Bearish", color: "red" },
  chop: { label: "Neutral", color: "gray" },
};

function AccuracyPanel({
  accuracy,
  history,
}: {
  accuracy: AccuracyStats;
  history: HistoryRow[];
}) {
  if (accuracy.totalCalls === 0) {
    return (
      <Paper
        p="md"
        radius={CARD_RADIUS}
        style={{ background: "rgba(26, 27, 30, 0.65)" }}
      >
        <Text
          size="xs"
          c="dimmed"
          tt="uppercase"
          fw={600}
          mb="xs"
          style={{ letterSpacing: "0.12em" }}
        >
          Track record
        </Text>
        <Text size="sm" c="dimmed">
          No history yet. Each page load logs today&apos;s verdict. Realized
          returns fill in 5 trading days later.
        </Text>
      </Paper>
    );
  }

  return (
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{ background: "rgba(26, 27, 30, 0.65)" }}
    >
      <Group justify="space-between" align="baseline" mb="xs">
        <Text
          size="xs"
          c="dimmed"
          tt="uppercase"
          fw={600}
          style={{ letterSpacing: "0.12em" }}
        >
          Track record
        </Text>
        <Text size="xs" c="dimmed">
          {accuracy.realizedCalls} of {accuracy.totalCalls} calls have realized
        </Text>
      </Group>

      <Box style={{ overflowX: "auto" }}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Verdict</Table.Th>
              <Table.Th ta="right">N</Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="Average expected QQQ 5d return when this verdict fired"
                  withArrow
                  multiline
                  maw={240}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Predicted
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="Average actual QQQ 5d return that followed"
                  withArrow
                  multiline
                  maw={240}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Realized QQQ
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">Realized TQQQ</Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="Bullish hit = realized 5d QQQ return >+1.5%. Bearish hit = <−1.5%. Neutral hit = within ±1.5%."
                  withArrow
                  multiline
                  maw={260}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Hit rate
                  </Text>
                </Tooltip>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(["lean-long", "chop", "lean-short"] as const).map((v) => {
              const row = accuracy.byVerdict[v];
              const meta = VERDICT_META[v];
              if (row.n === 0)
                return (
                  <Table.Tr key={v}>
                    <Table.Td>
                      <Badge color={meta.color} variant="light" size="sm">
                        {meta.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" c="dimmed">
                        0
                      </Text>
                    </Table.Td>
                    <Table.Td colSpan={4}>
                      <Text size="xs" c="dimmed" ta="right">
                        No realized samples yet
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              return (
                <Table.Tr key={v}>
                  <Table.Td>
                    <Badge color={meta.color} variant="light" size="sm">
                      {meta.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{row.n}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{formatPct(row.avgPredicted)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text
                      size="sm"
                      fw={600}
                      c={`${edgeColor(row.avgRealizedQqq)}.4`}
                    >
                      {formatPct(row.avgRealizedQqq)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" c="dimmed">
                      {formatPct(row.avgRealizedTqqq)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{row.hitRateQqq.toFixed(0)}%</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Box>

      {history.length > 0 && (
        <>
          <Text
            size="xs"
            c="dimmed"
            tt="uppercase"
            fw={600}
            mt="md"
            mb={4}
            style={{ letterSpacing: "0.12em" }}
          >
            Recent calls
          </Text>
          <Box style={{ display: "flex", gap: 2 }}>
            {[...history].reverse().map((h) => {
              {
                console.log(h);
              }

              const meta = VERDICT_META[h.verdict];
              const realized = h.realizedReturn5dQqq;
              const hit =
                realized != null &&
                ((h.verdict === "lean-long" && realized > 1.5) ||
                  (h.verdict === "lean-short" && realized < -1.5) ||
                  (h.verdict === "chop" && Math.abs(realized) <= 1.5));
              return (
                <Tooltip
                  key={h.date}
                  label={`${h.date} · ${meta.label} · predicted ${formatPct(h.expectedReturn5d)} · realized ${realized != null ? formatPct(realized) : "pending"}`}
                  withArrow
                >
                  <Box
                    style={{
                      flex: 1,
                      minWidth: 4,
                      height: 24,
                      borderRadius: 2,
                      textAlign: "center",
                      fontSize: ".65em",
                      lineHeight: "24px",
                      background:
                        realized == null
                          ? "var(--mantine-color-dark-4)"
                          : hit
                            ? "var(--mantine-color-green-6)"
                            : `var(--mantine-color-${meta.color}-8)`,
                      border:
                        realized == null
                          ? "1px dashed var(--mantine-color-dark-3)"
                          : "none",
                    }}
                  >
                    {parseInt(h.date.split("-")[2], 10)}
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
          <Text size="10px" c="dimmed" mt={4}>
            Green = verdict hit · darker = missed · dashed = pending realized
            return
          </Text>
        </>
      )}
    </Paper>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function SentimentPage() {
  const [data, setData] = useState<VerdictPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sentiment")
      .then((r) => r.json())
      .then((d: VerdictPayload & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Stack gap="lg">
      <Text fw={700} size="xl" ta="center">
        QQQ 5-Day Direction
      </Text>

      {loading ? (
        <>
          <Skeleton height={220} radius={CARD_RADIUS} />
          <Skeleton height={360} radius={CARD_RADIUS} />
        </>
      ) : error ? (
        <Paper
          p="md"
          radius={CARD_RADIUS}
          style={{ background: "var(--mantine-color-dark-6)" }}
        >
          <Group gap={6} c="red">
            <IconAlertTriangle size={16} />
            <Text size="sm">Failed to load: {error}</Text>
          </Group>
        </Paper>
      ) : data ? (
        <>
          <VerdictHeader data={data} />
          <SignalTable signals={data.signals} />
          <SignalEdgeChart signals={data.signals} />
          {data.accuracy && (
            <AccuracyPanel
              accuracy={data.accuracy}
              history={data.recentHistory}
            />
          )}
          <Stack gap={2}>
            <CacheAge cachedAt={data.cachedAt} />
            <Text size="xs" c="dimmed" ta="center">
              Backtest: {data.yearsHistory}y ·{" "}
              {data.totalSamples.toLocaleString()} 5d windows · baseline QQQ 5d
              = {formatPct(data.baselineAvgReturn5d)}
            </Text>
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
