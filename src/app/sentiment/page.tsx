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
  Button,
  SegmentedControl,
  Progress,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconRefresh,
  IconArrowUp,
  IconArrowDown,
  IconMinus,
} from "@tabler/icons-react";
import { LineChart } from "@mantine/charts";
import type { PredictionPayload, FeatureReading } from "@/app/api/sentiment/route";
import type { MacroEvent } from "@/lib/macroCalendar";
import type { DailyRow, PredictionAccuracy } from "@/lib/predictionHistory";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { useCardBg } from "@/lib/hooks/useCardBg";

// ── helpers ────────────────────────────────────────────────────────────────────

function dirColor(dir: string): string {
  if (dir === "up") return "green";
  if (dir === "down") return "red";
  return "gray";
}

function fmtPct(v: number | null, withSign = true): string {
  if (v == null) return "—";
  const sign = withSign && v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtFraction(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

// ── direction header ───────────────────────────────────────────────────────────

function DirectionHeader({ data }: { data: PredictionPayload }) {
  const color = dirColor(data.direction);
  const bg = useCardBg(color);
  const Icon = data.direction === "up" ? IconArrowUp : data.direction === "down" ? IconArrowDown : IconMinus;
  const label = data.direction === "up" ? "Up" : data.direction === "down" ? "Down" : "Flat";

  return (
    <Paper p="xl" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="xs" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.12em" }}>
          QQQ · {data.predictionDate}
        </Text>

        <Group gap="sm" align="center">
          <Icon size={36} color={`var(--mantine-color-${color}-4)`} />
          <Text style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }} c={`${color}.4`}>
            {label}
          </Text>
        </Group>

        <Group gap="xl" mt="sm" justify="center">
          <Stack gap={4} align="center">
            <Tooltip
              label="Probability that QQQ closes more than +0.5% higher tomorrow, based on logistic regression."
              withArrow multiline maw={280}
            >
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ cursor: "help" }}>
                P(up &gt;0.5%)
              </Text>
            </Tooltip>
            <Text size="xl" fw={700} c={`${color}.4`}>
              {(data.probUp * 100).toFixed(0)}%
            </Text>
            <Progress
              value={data.probUp * 100}
              color={color}
              size="sm"
              w={80}
            />
          </Stack>

          <Stack gap={4} align="center">
            <Tooltip
              label="OLS linear regression estimate of tomorrow's QQQ return. Treat as a directional lean, not a precise target — in-sample MAE is typically 0.8–1.2%."
              withArrow multiline maw={280}
            >
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ cursor: "help" }}>
                Predicted Δ
              </Text>
            </Tooltip>
            <Text size="xl" fw={700} c={`${color}.4`}>
              {fmtPct(data.predictedRet)}
            </Text>
          </Stack>
        </Group>

        {data.noModel && (
          <Text size="xs" c="orange.4" mt="xs" ta="center">
            No model yet — click Retrain to fit the model on historical data.
          </Text>
        )}

        <Text size="xs" c="dimmed" mt={4} ta="center">
          Based on {data.lastTradingDate} close
        </Text>
      </Stack>
    </Paper>
  );
}

// ── retrain button ─────────────────────────────────────────────────────────────

function RetrainButton({ onRetrained }: { onRetrained: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetrain() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/retrain", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Retrain failed");
      } else {
        setResult(
          `Retrained on ${data.trainN} days · direction accuracy ${(data.directionAccuracy * 100).toFixed(1)}% · MAE ${data.magnitudeMae?.toFixed(2)}%`,
        );
        onRetrained();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="xs">
      <Button
        onClick={handleRetrain}
        loading={loading}
        leftSection={<IconRefresh size={16} />}
        variant="light"
        color="blue"
        size="sm"
      >
        Retrain &amp; refresh
      </Button>
      {result && (
        <Text size="xs" c="dimmed" ta="center">{result}</Text>
      )}
      {error && (
        <Text size="xs" c="red.4" ta="center">{error}</Text>
      )}
    </Stack>
  );
}

// ── warning cards ──────────────────────────────────────────────────────────────

function EventWarningCard({ events }: { events: MacroEvent[] }) {
  if (events.length === 0) return null;
  const labels = events.map((e) => e.label).join(" · ");
  return (
    <Paper
      p="md" radius={CARD_RADIUS}
      style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)" }}
    >
      <Group gap="xs">
        <IconAlertTriangle size={16} color="rgb(234,179,8)" />
        <Text size="sm" fw={600} c="yellow.4">
          High-impact event{events.length > 1 ? "s" : ""} this week
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>{labels} — model uncertainty is higher around macro events</Text>
    </Paper>
  );
}

// ── feature table ──────────────────────────────────────────────────────────────

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  qqq1dRet:       "QQQ's return today. Tests short-term mean reversion: large down days may precede bounces.",
  qqq3dRet:       "QQQ return over the last 3 trading days.",
  qqq5dRet:       "QQQ return over the last 5 trading days (one week).",
  vixLevel:       "Current VIX level. Elevated fear often precedes short-term bounces but also signals real risk.",
  vix1dChange:    "How much fear changed today. A big VIX spike often precedes a mean-reversion bounce.",
  vixTerm:        "VIX / VIX3M ratio. Below 1 = contango (calm); above 1 = backwardation (near-term fear spike).",
  pctAbove200ma:  "QQQ % above/below its 200-day moving average. Regime indicator.",
  realizedVol20d: "Annualized 20-day realized volatility. Higher vol = wider expected range tomorrow.",
  tnxMom20d:      "20-day change in the 10-year yield (pp). Rising rates have historically been a headwind for QQQ.",
  skewLevel:      "CBOE SKEW index. Measures the relative price of tail-risk protection vs standard options.",
};

function contribColor(v: number | null): string {
  if (v == null) return "gray";
  if (v > 0.05) return "green";
  if (v > 0.01) return "lime";
  if (v < -0.05) return "red";
  if (v < -0.01) return "orange";
  return "gray";
}

function FeatureTable({ features }: { features: FeatureReading[] }) {
  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: "rgba(26,27,30,0.65)" }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb="xs" style={{ letterSpacing: "0.12em" }}>
        Today&apos;s inputs
      </Text>
      <Box style={{ overflowX: "auto" }}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Feature</Table.Th>
              <Table.Th ta="right">Value</Table.Th>
              <Table.Th ta="right">
                <Tooltip label="Z-score vs training mean. 0 = neutral, ±2 = significant." withArrow multiline maw={200}>
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>Z-score</Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip label="How much this feature pushes the OLS magnitude prediction (in %)." withArrow multiline maw={220}>
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>Contribution</Text>
                </Tooltip>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {features.map((f) => {
              const desc = FEATURE_DESCRIPTIONS[f.key];
              const cc = contribColor(f.olsContribution);
              return (
                <Table.Tr key={f.key}>
                  <Table.Td>
                    <Group gap={4} align="flex-start" wrap="nowrap">
                      <Text size="sm" fw={600}>{f.name}</Text>
                      {desc && (
                        <Tooltip label={desc} multiline maw={260} withArrow>
                          <Box style={{ cursor: "help", display: "flex", alignItems: "center" }}>
                            <Text size="xs" c="dimmed">(?)</Text>
                          </Box>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right">{f.display}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right" c={f.normalizedValue != null && Math.abs(f.normalizedValue) > 1.5 ? "yellow.4" : undefined}>
                      {f.normalizedValue != null ? f.normalizedValue.toFixed(2) : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right" fw={600} c={`${cc}.4`}>
                      {f.olsContribution != null ? fmtPct(f.olsContribution) : "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Box>
    </Paper>
  );
}

// ── accuracy panel ─────────────────────────────────────────────────────────────

function AccuracyPanel({
  accuracy,
  history,
  model,
}: {
  accuracy: PredictionAccuracy;
  history: DailyRow[];
  model: { fittedAt: string | null; trainN: number | null; dirAcc: number | null; mae: number | null; pearson: number | null };
}) {
  const [range, setRange] = useState("1mo");
  const RANGE_DAYS: Record<string, number> = { "1mo": 21, "3mo": 63, "6mo": 126, "1yr": 252 };
  const days = RANGE_DAYS[range] ?? 63;
  const slice = [...history].slice(0, days).reverse();

  const chartData = slice.map((h) => {
    const [, mm, dd] = h.date.split("-");
    return {
      date: `${parseInt(mm)}/${parseInt(dd)}`,
      "Predicted %": h.predicted1dRet != null ? Math.round(h.predicted1dRet * 100) / 100 : null,
      "Realized %":  h.realized1dRet != null  ? Math.round(Math.max(-5, Math.min(5, h.realized1dRet)) * 100) / 100 : null,
    };
  });

  const dirColorMap: Record<string, string> = { up: "green", down: "red", flat: "gray" };

  return (
    <Paper p="md" radius={CARD_RADIUS} style={{ background: "rgba(26,27,30,0.65)" }}>
      <Group justify="space-between" align="baseline" mb="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.12em" }}>
          Track record
        </Text>
        <Text size="xs" c="dimmed">
          {accuracy.realizedCalls} of {accuracy.totalCalls} calls realized
        </Text>
      </Group>

      {accuracy.totalCalls === 0 ? (
        <Text size="sm" c="dimmed">
          No history yet. Load the page each day to log predictions. Realized returns fill in the next trading day.
        </Text>
      ) : (
        <>
          <Group gap="xl" mb="md" wrap="wrap">
            {accuracy.directionAccuracy != null && (
              <Tooltip label="Fraction of calls where predicted direction matched actual direction (up/down/flat at ±0.5% threshold)." withArrow multiline maw={260}>
                <Stack gap={2} style={{ cursor: "help" }}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Direction accuracy</Text>
                  <Text size="lg" fw={700}>{fmtFraction(accuracy.directionAccuracy)}</Text>
                </Stack>
              </Tooltip>
            )}
            {accuracy.magnitudeMae != null && (
              <Tooltip label="Mean absolute error of the predicted vs realized 1-day QQQ return." withArrow multiline maw={240}>
                <Stack gap={2} style={{ cursor: "help" }}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>MAE</Text>
                  <Text size="lg" fw={700}>{fmtPct(accuracy.magnitudeMae, false)}</Text>
                </Stack>
              </Tooltip>
            )}
            {accuracy.magnitudeBias != null && (
              <Tooltip label="Mean(predicted − realized). Positive = bullish-biased." withArrow multiline maw={240}>
                <Stack gap={2} style={{ cursor: "help" }}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Bias</Text>
                  <Text size="lg" fw={700} c={accuracy.magnitudeBias > 0 ? "green.4" : "red.4"}>
                    {fmtPct(accuracy.magnitudeBias)}
                  </Text>
                </Stack>
              </Tooltip>
            )}
            {accuracy.magnitudePearson != null && (
              <Tooltip label="Live pearson(predicted, realized). >0 = some signal present." withArrow multiline maw={240}>
                <Stack gap={2} style={{ cursor: "help" }}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Pearson</Text>
                  <Text size="lg" fw={700}>{accuracy.magnitudePearson.toFixed(2)}</Text>
                </Stack>
              </Tooltip>
            )}
          </Group>

          {Object.keys(accuracy.byDirection).length > 0 && (
            <Box style={{ overflowX: "auto" }} mb="md">
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Called</Table.Th>
                    <Table.Th ta="right">N</Table.Th>
                    <Table.Th ta="right">Hit rate</Table.Th>
                    <Table.Th ta="right">Avg realized</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(["up", "flat", "down"] as const).map((dir) => {
                    const row = accuracy.byDirection[dir];
                    if (!row) return null;
                    return (
                      <Table.Tr key={dir}>
                        <Table.Td>
                          <Badge color={dirColorMap[dir]} variant="light" size="sm">
                            {dir.charAt(0).toUpperCase() + dir.slice(1)}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right"><Text size="sm">{row.n}</Text></Table.Td>
                        <Table.Td ta="right"><Text size="sm">{fmtFraction(row.hitRate)}</Text></Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" fw={600} c={`${row.avgRealized > 0 ? "green" : row.avgRealized < 0 ? "red" : "gray"}.4`}>
                            {fmtPct(row.avgRealized)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Box>
          )}

          {chartData.length > 0 && (
            <>
              <Group justify="space-between" align="center" mb={4}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.12em" }}>
                  Predicted vs realized
                </Text>
                <SegmentedControl size="xs" value={range} onChange={setRange} data={["1mo", "3mo", "6mo", "1yr"]} />
              </Group>
              <LineChart
                h={200}
                data={chartData}
                dataKey="date"
                series={[
                  { name: "Realized %", color: "teal.4" },
                  { name: "Predicted %", color: "blue.4" },
                ]}
                withDots={false}
                curveType="monotone"
                connectNulls={false}
                strokeWidth={1.5}
                valueFormatter={(v) => fmtPct(v)}
                yAxisProps={{ domain: [-4, 4] }}
                referenceLines={[{ y: 0, color: "gray.6", strokeDasharray: "4 4" }]}
                withLegend
              />
              <Text size="10px" c="dimmed" mt={4}>Realized clipped to ±5%</Text>
            </>
          )}
        </>
      )}

      {model.fittedAt && (
        <Text size="xs" c="dimmed" mt="sm">
          Model fitted {model.fittedAt.slice(0, 10)} on {model.trainN?.toLocaleString()} training days ·
          in-sample direction accuracy {model.dirAcc != null ? fmtFraction(model.dirAcc) : "—"} ·
          MAE {model.mae != null ? fmtPct(model.mae, false) : "—"}
        </Text>
      )}
    </Paper>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function PredictionPage() {
  const [data, setData] = useState<PredictionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(force = false) {
    setLoading(true);
    setError(null);
    fetch(force ? "/api/sentiment?force=1" : "/api/sentiment")
      .then((r) => r.json())
      .then((d: PredictionPayload & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">QQQ Tomorrow</Text>
        <RetrainButton onRetrained={() => load(true)} />
      </Group>

      {loading ? (
        <>
          <Skeleton height={240} radius={CARD_RADIUS} />
          <Skeleton height={320} radius={CARD_RADIUS} />
        </>
      ) : error ? (
        <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-6)" }}>
          <Group gap={6} c="red">
            <IconAlertTriangle size={16} />
            <Text size="sm">Failed to load: {error}</Text>
          </Group>
        </Paper>
      ) : data ? (
        <>
          <DirectionHeader data={data} />
          <EventWarningCard events={data.upcomingEvents} />
          <FeatureTable features={data.features} />
          {data.accuracy && (
            <AccuracyPanel
              accuracy={data.accuracy}
              history={data.recentHistory}
              model={{
                fittedAt: data.modelFittedAt,
                trainN: data.modelTrainN,
                dirAcc: data.modelDirectionAccuracy,
                mae: data.modelMagnitudeMae,
                pearson: data.modelMagnitudePearson,
              }}
            />
          )}
          <Text size="xs" c="dimmed" ta="center">
            Updated {Math.floor((Date.now() - data.cachedAt) / 60000)}m ago · refreshes every 20m ·
            direction threshold ±0.5%
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
