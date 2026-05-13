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
  SimpleGrid,
  Accordion,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconRefresh,
  IconArrowUp,
  IconArrowDown,
  IconArrowRight,
} from "@tabler/icons-react";
import type {
  PredictionPayload,
  FeatureReading,
} from "@/app/api/sentiment/route";
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

function PredictionCol({
  label,
  forDate,
  direction,
  probUp,
  predictedRet,
  realizedRet,
  basedOnDate,
  noModel,
}: {
  label: string;
  forDate: string;
  direction: "up" | "down" | "flat";
  probUp: number;
  predictedRet: number;
  realizedRet?: number | null;
  basedOnDate: string;
  noModel: boolean;
}) {
  const color = dirColor(direction);
  const bg = useCardBg(color);
  const Icon =
    direction === "up" ? IconArrowUp : direction === "down" ? IconArrowDown : IconArrowRight;
  const dirLabel = direction === "up" ? "Up" : direction === "down" ? "Down" : "Flat";

  return (
    <Paper p="xl" radius={CARD_RADIUS} style={{ background: bg }}>
      <Stack gap="xs" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.12em" }}>
          QQQ · {label} · {forDate}
        </Text>

        <Group gap="sm" align="center">
          <Icon size={36} color={`var(--mantine-color-${color}-4)`} />
          <Text style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }} c={`${color}.4`}>
            {dirLabel}
          </Text>
        </Group>

        <Group gap="xl" mt="sm" justify="center">
          <Stack gap={4} align="center">
            <Tooltip
              label="Probability that QQQ closes more than +0.25% higher, based on logistic regression."
              withArrow
              multiline
              maw={280}
            >
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ cursor: "help" }}>
                P(up &gt;0.25%)
              </Text>
            </Tooltip>
            <Text size="xl" fw={700} c={`${color}.4`}>
              {(probUp * 100).toFixed(0)}%
            </Text>
            <Progress value={probUp * 100} color={color} size="sm" w={80} />
          </Stack>

          <Stack gap={4} align="center">
            <Tooltip
              label="OLS linear regression estimate of QQQ return. Treat as a directional lean, not a precise target."
              withArrow
              multiline
              maw={280}
            >
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ cursor: "help" }}>
                Predicted Δ
              </Text>
            </Tooltip>
            <Text size="xl" fw={700} c={`${color}.4`}>
              {fmtPct(predictedRet)}
            </Text>
          </Stack>

          {realizedRet != null && (
            <Stack gap={4} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Actual Δ
              </Text>
              <Text
                size="xl"
                fw={700}
                c={realizedRet > 0 ? "green.4" : realizedRet < 0 ? "red.4" : "dimmed"}
              >
                {fmtPct(realizedRet)}
              </Text>
            </Stack>
          )}
        </Group>

        {noModel && (
          <Text size="xs" c="orange.4" mt="xs" ta="center">
            No model yet — click Retrain to fit the model on historical data.
          </Text>
        )}

        <Text size="xs" c="dimmed" mt={4} ta="center">
          Based on {basedOnDate} close
        </Text>
      </Stack>
    </Paper>
  );
}

function DirectionHeader({ data }: { data: PredictionPayload }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      {data.todayPrediction ? (
        <PredictionCol
          label="Today"
          forDate={data.todayPrediction.forDate}
          direction={data.todayPrediction.direction}
          probUp={data.todayPrediction.probUp}
          predictedRet={data.todayPrediction.predictedRet}
          realizedRet={data.todayPrediction.realizedRet}
          basedOnDate={data.lastTradingDate}
          noModel={data.noModel}
        />
      ) : (
        <Paper p="xl" radius={CARD_RADIUS} style={{ background: "rgba(26,27,30,0.65)" }}>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.12em" }}>
              QQQ · Today
            </Text>
            <Text size="sm" c="dimmed" ta="center" mt="sm">
              Awaiting previous session data
            </Text>
          </Stack>
        </Paper>
      )}

      <PredictionCol
        label="Tomorrow"
        forDate={data.predictionDate}
        direction={data.direction}
        probUp={data.probUp}
        predictedRet={data.predictedRet}
        basedOnDate={data.lastTradingDate}
        noModel={data.noModel}
      />
    </SimpleGrid>
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
        <Text size="xs" c="dimmed" ta="center">
          {result}
        </Text>
      )}
      {error && (
        <Text size="xs" c="red.4" ta="center">
          {error}
        </Text>
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
      p="md"
      radius={CARD_RADIUS}
      style={{
        background: "rgba(234,179,8,0.08)",
        border: "1px solid rgba(234,179,8,0.3)",
      }}
    >
      <Group gap="xs">
        <IconAlertTriangle size={16} color="rgb(234,179,8)" />
        <Text size="sm" fw={600} c="yellow.4">
          High-impact event{events.length > 1 ? "s" : ""} this week
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        {labels} — model uncertainty is higher around macro events
      </Text>
    </Paper>
  );
}

// ── feature table ──────────────────────────────────────────────────────────────

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  qqq1dRet:
    "QQQ's return today. Tests short-term mean reversion: large down days may precede bounces.",
  qqq3dRet: "QQQ return over the last 3 trading days.",
  qqq5dRet: "QQQ return over the last 5 trading days (one week).",
  vixLevel:
    "Current VIX level. Elevated fear often precedes short-term bounces but also signals real risk.",
  vix1dChange:
    "How much fear changed today. A big VIX spike often precedes a mean-reversion bounce.",
  vixTerm:
    "VIX / VIX3M ratio. Below 1 = contango (calm); above 1 = backwardation (near-term fear spike).",
  pctAbove200ma:
    "QQQ % above/below its 200-day moving average. Regime indicator.",
  realizedVol20d:
    "Annualized 20-day realized volatility. Higher vol = wider expected range tomorrow.",
  tnxMom20d:
    "20-day change in the 10-year yield (pp). Rising rates have historically been a headwind for QQQ.",
  skewLevel:
    "CBOE SKEW index. Measures the relative price of tail-risk protection vs standard options.",
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
    <Paper
      p="md"
      radius={CARD_RADIUS}
      style={{ background: "rgba(26,27,30,0.65)" }}
    >
      <Text
        size="xs"
        c="dimmed"
        tt="uppercase"
        fw={600}
        mb="xs"
        style={{ letterSpacing: "0.12em" }}
      >
        Today&apos;s inputs
      </Text>
      <Box style={{ overflowX: "auto" }}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Feature</Table.Th>
              <Table.Th ta="right">Value</Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="Z-score vs training mean. 0 = neutral, ±2 = significant."
                  withArrow
                  multiline
                  maw={200}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Z-score
                  </Text>
                </Tooltip>
              </Table.Th>
              <Table.Th ta="right">
                <Tooltip
                  label="How much this feature pushes the OLS magnitude prediction (in %)."
                  withArrow
                  multiline
                  maw={220}
                >
                  <Text size="xs" fw={600} style={{ cursor: "help" }}>
                    Contribution
                  </Text>
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
                      <Text size="sm" fw={600}>
                        {f.name}
                      </Text>
                      {desc && (
                        <Tooltip label={desc} multiline maw={260} withArrow>
                          <Box
                            style={{
                              cursor: "help",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <Text size="xs" c="dimmed">
                              (?)
                            </Text>
                          </Box>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right">
                      {f.display}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      ta="right"
                      c={
                        f.normalizedValue != null &&
                        Math.abs(f.normalizedValue) > 1.5
                          ? "yellow.4"
                          : undefined
                      }
                    >
                      {f.normalizedValue != null
                        ? f.normalizedValue.toFixed(2)
                        : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ta="right" fw={600} c={`${cc}.4`}>
                      {f.olsContribution != null
                        ? fmtPct(f.olsContribution)
                        : "—"}
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
  model: {
    fittedAt: string | null;
    trainN: number | null;
    dirAcc: number | null;
    mae: number | null;
    pearson: number | null;
  };
}) {
  const [range, setRange] = useState("1mo");
  const RANGE_DAYS: Record<string, number> = {
    "1mo": 21,
    "3mo": 63,
    "6mo": 126,
    "1yr": 252,
  };
  const days = RANGE_DAYS[range] ?? 21;

  const actualDir = (ret: number | null) =>
    ret == null ? null : ret > 0.25 ? "up" : ret < -0.25 ? "down" : "flat";

  const slice = [...history].slice(0, days).reverse();

  const dirColorMap: Record<string, string> = {
    up: "green",
    down: "red",
    flat: "gray",
  };

  const DirCell = ({
    dir,
    pct,
  }: {
    dir: string | null;
    pct: number | null;
  }) => {
    const color =
      dir === "up" ? "green.4" : dir === "down" ? "red.4" : "dimmed";
    const arrow =
      dir === "up" ? "↑" : dir === "down" ? "↓" : dir === "flat" ? "→" : "·";
    const pctStr = pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(2)}` : "";
    return (
      <Group gap={1} wrap="nowrap" justify="center">
        <Text size="9px" c={color} fw={700} lh={1}>
          {arrow}
        </Text>
        {pctStr && (
          <Text size="8px" c={color} lh={1}>
            {pctStr}
          </Text>
        )}
      </Group>
    );
  };

  return (
    <Stack gap="lg">
      <Paper
        p="md"
        radius={CARD_RADIUS}
        style={{ background: "rgba(26,27,30,0.65)" }}
      >
        <Group justify="space-between" align="baseline" mb="sm">
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
            {accuracy.realizedCalls} of {accuracy.totalCalls} calls realized
          </Text>
        </Group>

        {accuracy.totalCalls === 0 ? (
          <Text size="sm" c="dimmed">
            No history yet. Load the page each day to log predictions. Realized
            returns fill in the next trading day.
          </Text>
        ) : (
          <>
            <Group gap="xl" mb="md" wrap="wrap">
              {accuracy.directionAccuracy != null && (
                <Tooltip
                  label="Fraction of calls where predicted direction matched actual direction (up/down/flat at ±0.25% threshold)."
                  withArrow
                  multiline
                  maw={260}
                >
                  <Stack gap={2} style={{ cursor: "help" }}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Direction accuracy
                    </Text>
                    <Text size="lg" fw={700}>
                      {fmtFraction(accuracy.directionAccuracy)}
                    </Text>
                  </Stack>
                </Tooltip>
              )}
              {accuracy.magnitudeMae != null && (
                <Tooltip
                  label="Mean absolute error of the predicted vs realized 1-day QQQ return."
                  withArrow
                  multiline
                  maw={240}
                >
                  <Stack gap={2} style={{ cursor: "help" }}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      MAE
                    </Text>
                    <Text size="lg" fw={700}>
                      {fmtPct(accuracy.magnitudeMae, false)}
                    </Text>
                  </Stack>
                </Tooltip>
              )}
              {accuracy.magnitudeBias != null && (
                <Tooltip
                  label="Mean(predicted − realized). Positive = bullish-biased."
                  withArrow
                  multiline
                  maw={240}
                >
                  <Stack gap={2} style={{ cursor: "help" }}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Bias
                    </Text>
                    <Text
                      size="lg"
                      fw={700}
                      c={accuracy.magnitudeBias > 0 ? "green.4" : "red.4"}
                    >
                      {fmtPct(accuracy.magnitudeBias)}
                    </Text>
                  </Stack>
                </Tooltip>
              )}
              {accuracy.magnitudePearson != null && (
                <Tooltip
                  label="Live pearson(predicted, realized). >0 = some signal present."
                  withArrow
                  multiline
                  maw={240}
                >
                  <Stack gap={2} style={{ cursor: "help" }}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Pearson
                    </Text>
                    <Text size="lg" fw={700}>
                      {accuracy.magnitudePearson.toFixed(2)}
                    </Text>
                  </Stack>
                </Tooltip>
              )}
            </Group>

            {Object.keys(accuracy.byDirection).length > 0 && (
              <Box style={{ overflowX: "auto" }}>
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
                            <Badge
                              color={dirColorMap[dir]}
                              variant="light"
                              size="sm"
                            >
                              {dir.charAt(0).toUpperCase() + dir.slice(1)}
                            </Badge>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm">{row.n}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm">{fmtFraction(row.hitRate)}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text
                              size="sm"
                              fw={600}
                              c={`${row.avgRealized > 0 ? "green" : row.avgRealized < 0 ? "red" : "gray"}.4`}
                            >
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
          </>
        )}

        {model.fittedAt && (
          <Text size="xs" c="dimmed" mt="md">
            Model fitted {model.fittedAt.slice(0, 10)} on{" "}
            {model.trainN?.toLocaleString()} training days · in-sample direction
            accuracy {model.dirAcc != null ? fmtFraction(model.dirAcc) : "—"} ·
            MAE {model.mae != null ? fmtPct(model.mae, false) : "—"}
          </Text>
        )}
      </Paper>

      {slice.length > 0 && (
        <Paper
          p="md"
          radius={CARD_RADIUS}
          style={{ background: "rgba(26,27,30,0.65)" }}
        >
          <Group justify="space-between" align="center" mb="md">
            <Text
              size="xs"
              c="dimmed"
              tt="uppercase"
              fw={600}
              style={{ letterSpacing: "0.12em" }}
            >
              Calls
            </Text>
            <SegmentedControl
              size="xs"
              value={range}
              onChange={setRange}
              data={["1mo", "3mo", "6mo", "1yr"]}
            />
          </Group>
          <Box style={{ overflowX: "auto" }}>
            <Box
              style={{
                display: "inline-flex",
                gap: 2,
                alignItems: "flex-start",
              }}
            >
              {/* Label column */}
              <Stack gap={0} style={{ marginRight: 4, paddingTop: 18 }}>
                {["Pred", "Act", ""].map((label) => (
                  <Box
                    key={label}
                    style={{
                      height: label === "" ? 20 : 22,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      size="9px"
                      c="dimmed"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {label}
                    </Text>
                  </Box>
                ))}
              </Stack>
              {/* Data columns */}
              {slice.reverse().map((row) => {
                const actual = actualDir(row.realized1dRet ?? null);
                const predicted = actualDir(row.predicted1dRet ?? null);
                const isGreen =
                  (predicted === "up" && actual === "up") ||
                  (predicted === "flat" && actual === "up") ||
                  (predicted === "flat" && actual === "flat") ||
                  (predicted === "down" && actual === "down");
                const absDiff = Math.abs((row.realized1dRet ?? 0) - (row.predicted1dRet ?? 0));
                const isRed =
                  (predicted === "up" && actual === "down") ||
                  (predicted === "down" && actual === "up") ||
                  (predicted === "flat" && actual === "down" && absDiff > 0.5);
                const mc =
                  predicted != null && actual != null
                    ? isGreen
                      ? "green"
                      : isRed
                        ? "red"
                        : "gray"
                    : null;
                const [, mm, dd] = row.date.split("-");
                return (
                  <Stack
                    key={row.date}
                    gap={0}
                    align="center"
                    style={{ minWidth: 44 }}
                  >
                    <Text
                      size="9px"
                      c="dimmed"
                      ta="center"
                      style={{ height: 18, lineHeight: "18px" }}
                    >
                      {`${parseInt(mm)}/${parseInt(dd)}`}
                    </Text>
                    <Box
                      style={{
                        height: 22,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <DirCell
                        dir={predicted}
                        pct={row.predicted1dRet}
                      />
                    </Box>
                    <Box
                      style={{
                        height: 22,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <DirCell
                        dir={actual}
                        pct={row.realized1dRet ?? null}
                      />
                    </Box>
                    <Box
                      style={{
                        width: 40,
                        height: 20,
                        borderRadius: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background:
                          mc === "green"
                            ? "rgba(74,222,128,0.35)"
                            : mc === "red"
                              ? "rgba(248,113,113,0.35)"
                              : mc === "gray"
                                ? "rgba(150,150,150,0.2)"
                                : "transparent",
                        border:
                          mc === "green"
                            ? "1px solid rgba(74,222,128,0.5)"
                            : mc === "red"
                              ? "1px solid rgba(248,113,113,0.5)"
                              : mc === "gray"
                                ? "1px solid rgba(150,150,150,0.35)"
                                : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {row.realized1dRet != null &&
                        row.predicted1dRet != null &&
                        (() => {
                          const absDiff = Math.abs(row.realized1dRet - row.predicted1dRet);
                          const opacity = Math.min(1, absDiff / 2);
                          const colorMap = {
                            green: `rgba(74, 222, 128, ${0.4 + opacity * 0.6})`,
                            red: `rgba(248, 113, 113, ${0.4 + opacity * 0.6})`,
                            gray: `rgba(150, 150, 150, ${0.3 + opacity * 0.4})`,
                          };
                          return (
                            <Text
                              size="8px"
                              fw={600}
                              style={{ lineHeight: 1, color: colorMap[mc || "gray"] }}
                            >
                              {absDiff.toFixed(1)}
                            </Text>
                          );
                        })()}
                    </Box>
                  </Stack>
                );
              })}
            </Box>
          </Box>
        </Paper>
      )}
    </Stack>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function PredictionPage() {
  const [data, setData] = useState<PredictionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  function load(force = false) {
    setLoading(true);
    setError(null);
    fetch(force ? "/api/sentiment?force=1" : "/api/sentiment")
      .then((r) => r.json())
      .then((d: PredictionPayload & { error?: string }) => {
        if (d.error) setError(d.error);
        else { setData(d); setNow(Date.now()); }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetch("/api/sentiment")
      .then((r) => r.json())
      .then((d: PredictionPayload & { error?: string }) => {
        if (d.error) setError(d.error);
        else { setData(d); setNow(Date.now()); }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Text fw={700} size="xl">
          QQQ Tomorrow
        </Text>
        <RetrainButton onRetrained={() => load(true)} />
      </Group>

      {loading ? (
        <>
          <Skeleton height={240} radius={CARD_RADIUS} />
          <Skeleton height={320} radius={CARD_RADIUS} />
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
          <DirectionHeader data={data} />
          <EventWarningCard events={data.upcomingEvents} />
          <Accordion>
            <Accordion.Item value="features">
              <Accordion.Control>Today&apos;s inputs</Accordion.Control>
              <Accordion.Panel>
                <FeatureTable features={data.features} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
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
            Updated {Math.floor((now - data.cachedAt) / 60000)}m ago ·
            refreshes every 20m · direction threshold ±0.25%
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
