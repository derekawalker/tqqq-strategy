"use client";

import { useMemo, useState, Suspense, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import {
  Table, Text, Group, Stack, Skeleton, Center, NumberInput,
  SimpleGrid, Badge, Box, SegmentedControl, Alert, Paper, Divider, Tooltip,
} from "@mantine/core";
import { CARD_RADIUS } from "@/lib/cardStyles";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { IconArrowRight, IconAlertTriangle, IconPlayerPlayFilled } from "@tabler/icons-react";
import { LineChart, Line, LabelList, XAxis, YAxis, ReferenceArea, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import type { OptionPosition, WorkingOrder } from "@/lib/schwab/parse";
import type { Level } from "@/lib/levels";

// ── day change + sparkline banner ──────────────────────────────────────────

function linReg(vals: number[]): { slope: number; intercept: number } {
  const n = vals.length;
  const sumX  = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY  = vals.reduce((a, b) => a + b, 0);
  const sumXY = vals.reduce((s, v, i) => s + i * v, 0);
  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function DayChangeBanner({ closes30, dates30, daysOfWeek30, loading }: { closes30: number[]; dates30: string[]; daysOfWeek30: number[]; loading?: boolean }) {
  if (loading) {
    return (
      <Paper p="md" radius="md" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)", boxShadow: "inset 2px 2px 6px rgba(0,0,0,0.4)", border: "none" }}>
        <Stack gap="xs">
          <Stack gap={2} align="center">
            <Skeleton height={12} width="50%" radius="sm" />
            <Skeleton height={10} width="75%" radius="sm" />
          </Stack>
          <Skeleton height={120} radius="sm" />
          <Skeleton height={1} radius="sm" />
          <Group grow gap="xs">
            {[0, 1, 2].map((i) => (
              <Stack key={i} gap={4} align="center">
                <Skeleton height={9} width="70%" radius="sm" />
                <Skeleton height={12} width="50%" radius="sm" />
              </Stack>
            ))}
          </Group>
        </Stack>
      </Paper>
    );
  }
  const hasHistory = closes30.length > 1;

  // 30-day trendline
  const { slope, intercept } = linReg(closes30);

  // 2-week (last 10 days) trendline — offset to align with global indices
  const n2 = Math.min(10, closes30.length);
  const offset2 = closes30.length - n2;
  const { slope: slope2, intercept: intercept2 } = linReg(closes30.slice(-n2));

  const chartData = closes30.map((v, i) => ({
    date: dates30[i] ?? "",
    v,
    trend:  parseFloat((intercept  + slope  * i).toFixed(2)),
    trend2: i >= offset2 ? parseFloat((intercept2 + slope2 * (i - offset2)).toFixed(2)) : null,
  }));

  const trendUp = slope >= 0;
  const highIdx = closes30.reduce((best, v, i) => v > closes30[best] ? i : best, 0);
  const lowIdx  = closes30.reduce((best, v, i) => v < closes30[best] ? i : best, 0);

  // Week chunks from day-of-week data
  const weekChunks: { x1: string; x2: string }[] = [];
  let weekStart = 0;
  for (let i = 1; i < dates30.length; i++) {
    if (daysOfWeek30[i] === 1) {
      weekChunks.push({ x1: dates30[weekStart], x2: dates30[i - 1] });
      weekStart = i;
    }
  }
  if (weekStart < dates30.length) {
    weekChunks.push({ x1: dates30[weekStart], x2: dates30[dates30.length - 1] });
  }

  // Actual weekly (Mon→end-of-week) moves for stats
  const weeklyMoves = weekChunks.map((chunk) => {
    const si = dates30.indexOf(chunk.x1);
    const ei = dates30.indexOf(chunk.x2);
    return { dollar: closes30[ei] - closes30[si] };
  });
  const avg5Move = weeklyMoves.length ? weeklyMoves.reduce((s, w) => s + Math.abs(w.dollar), 0) / weeklyMoves.length : 0;
  const max5Up   = weeklyMoves.length ? weeklyMoves.reduce((b, w) => w.dollar > b.dollar ? w : b) : { dollar: 0 };
  const max5Down = weeklyMoves.length ? weeklyMoves.reduce((b, w) => w.dollar < b.dollar ? w : b) : { dollar: 0 };

  const trend2Up = slope2 >= 0;
  const trendLineColor = slope >= 0 ? "rgba(20,184,166,0.45)" : "rgba(239,68,68,0.45)";
  const bg = trendUp && trend2Up
    ? "linear-gradient(135deg, rgba(20,184,166,0.15) 0%, rgba(20,184,166,0.05) 100%)"
    : !trendUp && !trend2Up
      ? "linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.05) 100%)"
      : "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)";

  const statLabel = { letterSpacing: "0.04em", fontSize: 9 } as const;

  return (
    <Paper p="md" radius="md" style={{ background: bg, boxShadow: "inset 2px 2px 6px rgba(0,0,0,0.4)", border: "none" }}>
      <Stack gap="xs">
        {hasHistory && (() => {
          if (trendUp && trend2Up) return (
            <Stack gap={2} align="center">
              <Text size="xs" fw={700} ta="center" style={{ color: "rgba(20,184,166,1)" }}>Trending Up — Favor selling puts.</Text>
              <Text size="xs" c="dimmed" ta="center">For best premium, wait for a down day before opening a new position.</Text>
            </Stack>
          );
          if (!trendUp && !trend2Up) return (
            <Stack gap={2} align="center">
              <Text size="xs" fw={700} ta="center" style={{ color: "rgba(239,68,68,1)" }}>Trending Down — Favor selling calls.</Text>
              <Text size="xs" c="dimmed" ta="center">For best premium, sell on a down day when IV is elevated.</Text>
            </Stack>
          );
          return (
            <Stack gap={2} align="center">
              <Text size="xs" fw={700} c="dimmed" ta="center">Composite Trend is Neutral — Calls and puts are both viable.</Text>
              <Text size="xs" c="dimmed" ta="center">Try to sell puts on down days and calls on up days for better premium.</Text>
            </Stack>
          );
        })()}
        {hasHistory && (
          <Box style={{ height: 120 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 16, bottom: 20, left: 16 }}>
                <defs>
                  <linearGradient id="priceLineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(20,184,166,1)" />
                    <stop offset="100%" stopColor="rgba(239,68,68,1)" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <YAxis domain={["dataMin", "dataMax"]} hide />
                {weekChunks.map((chunk, i) => (
                  <ReferenceArea
                    key={chunk.x1}
                    x1={chunk.x1}
                    x2={chunk.x2}
                    fill={i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.07)"}
                    stroke="none"
                  />
                ))}
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const entry = payload.find((p) => p.dataKey === "v") ?? payload[0];
                    const val  = entry.value as number;
                    const date = entry.payload.date as string;
                    const idx  = chartData.findIndex((d) => d.date === date);
                    const pct  = idx > 0 ? ((val - chartData[idx - 1].v) / chartData[idx - 1].v) * 100 : null;
                    return (
                      <Box style={{ background: "var(--mantine-color-dark-7)", border: "1px solid var(--mantine-color-dark-4)", borderRadius: 6, padding: "4px 8px" }}>
                        <Text size="xs" c="dimmed">{date}</Text>
                        <Text size="xs">${val.toFixed(2)}</Text>
                        {pct !== null && (
                          <Text size="xs" style={{ color: pct >= 0 ? "rgba(20,184,166,1)" : "rgba(239,68,68,1)" }}>
                            {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                          </Text>
                        )}
                      </Box>
                    );
                  }}
                />
                <Line type="monotone" dataKey="trend" dot={false} activeDot={false} stroke={trendLineColor} strokeWidth={1.5} strokeDasharray="5 3" isAnimationActive={false} />
                <Line type="monotone" dataKey="trend2" dot={false} activeDot={false} stroke={slope2 >= 0 ? "rgba(20,184,166,0.7)" : "rgba(239,68,68,0.7)"} strokeWidth={1.5} strokeDasharray="3 2" connectNulls={false} isAnimationActive={false} />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="url(#priceLineGradient)"
                  strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                    const isUp = index === 0 || closes30[index] >= closes30[index - 1];
                    return <circle key={index} cx={cx ?? 0} cy={cy ?? 0} r={2} fill={isUp ? "rgba(20,184,166,1)" : "rgba(239,68,68,1)"} stroke="var(--mantine-color-dark-7)" strokeWidth={1} />;
                  }}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="v"
                    content={(props) => {
                      const { x, y, index, value } = props as { x: number; y: number; index: number; value: number };
                      const isHigh = index === highIdx;
                      const isLow  = index === lowIdx;
                      if (!isHigh && !isLow) return null;
                      return (
                        <text key={`hl-${index}`} x={x} y={isHigh ? y - 8 : y + 14} textAnchor="middle" fontSize={9} fontWeight={700} fill={isHigh ? "rgba(20,184,166,1)" : "rgba(239,68,68,1)"}>
                          ${value.toFixed(2)}
                        </text>
                      );
                    }}
                  />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
        {hasHistory && (
          <>
            <Divider label={<Text size="xs" c="dimmed" fw={600} style={{ fontSize: 9, letterSpacing: "0.04em" }}>5 DTE</Text>} labelPosition="left" />
            <Group grow gap="xs">
              <Stack gap={0} align="center">
                <Group gap={4} align="center">
                  <IconPlayerPlayFilled size={7} style={{ color: "rgba(239,68,68,1)" }} />
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={statLabel}>Max Down</Text>
                </Group>
                <Text size="xs" fw={700} style={{ color: "rgba(239,68,68,1)" }}>${max5Down.dollar.toFixed(2)}</Text>
              </Stack>
              <Stack gap={0} align="center">
                <Group gap={4} align="center">
                  <IconPlayerPlayFilled size={7} style={{ color: "rgba(255,255,255,0.6)" }} />
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={statLabel}>Avg Move</Text>
                </Group>
                <Text size="xs" fw={700}>${avg5Move.toFixed(2)}</Text>
              </Stack>
              <Stack gap={0} align="center">
                <Group gap={4} align="center">
                  <IconPlayerPlayFilled size={7} style={{ color: "rgba(20,184,166,1)" }} />
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={statLabel}>Max Up</Text>
                </Group>
                <Text size="xs" fw={700} style={{ color: "rgba(20,184,166,1)" }}>+${max5Up.dollar.toFixed(2)}</Text>
              </Stack>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}

// ── summary stats card ─────────────────────────────────────────────────────

function SummaryStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: "0.04em" }}>{label}</Text>
      <Text size="sm" fw={700} c={valueColor}>{value}</Text>
    </Stack>
  );
}

function OptionsSummaryCard({
  totalValue, availableLabel, availableValue, color, privacyMode,
}: {
  totalValue: number;
  availableLabel: string;
  availableValue: string;
  color: string;
  privacyMode: boolean;
}) {
  const mask = (v: string) => (privacyMode ? "••••" : v);
  const valueSign = totalValue >= 0 ? "+" : "";
  return (
    <Paper p="sm" radius="md" style={{ background: "var(--mantine-color-dark-6)" }}>
      <Group gap={0} wrap="nowrap">
        <SummaryStat
          label="Open Value"
          value={mask(`${valueSign}$${totalValue.toFixed(2)}`)}
          valueColor={totalValue >= 0 ? `var(--mantine-color-${color}-4)` : "var(--mantine-color-red-4)"}
        />
        <Divider orientation="vertical" mx="md" />
        <SummaryStat label={availableLabel} value={availableValue} />
      </Group>
    </Paper>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function daysUntil(expiry: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((new Date(expiry + "T00:00:00").getTime() - today.getTime()) / 86400000));
}

function progressPct(averagePrice: number, marketValue: number, shortQty: number): number {
  if (averagePrice <= 0 || shortQty <= 0) return 0;
  const currentPerShare = Math.abs(marketValue) / shortQty / 100;
  return Math.max(0, Math.min(100, ((averagePrice - currentPerShare) / averagePrice) * 100));
}

/** Round up to nearest $0.50 — used for calls (sell above current price) */
function callStrikeForLevel(level: Level): number {
  return Math.ceil(level.sellPrice / 0.5) * 0.5;
}

/** Round down to nearest $0.50 — used for puts (buy below current price) */
function putStrikeForLevel(level: Level): number {
  return Math.floor(level.buyPrice / 0.5) * 0.5;
}

/** Find a position whose strike matches within $0.01 */
function matchPosition(positions: OptionPosition[], strike: number): OptionPosition | null {
  return positions.find((p) => Math.abs(p.strike - strike) < 0.01) ?? null;
}

// ── calls allocation ───────────────────────────────────────────────────────

interface CallRow {
  strike: number;
  levelNums: number[];
  ownedShares: number;
  carryIn: number;
  contracts: number;
  carryOut: number;
  inSafeZone: boolean;
  itm: boolean;
  isCurrent: boolean;
  position: OptionPosition | null;
}

function buildCallRows(
  levels: Level[],
  ownedSet: Set<number>,
  currentLevel: number,
  safetyLevels: number,
  positions: OptionPosition[],
  currentPrice: number,
): CallRow[] {
  const maxSafe = currentLevel - safetyLevels;

  const strikeToLevels = new Map<number, number[]>();
  for (let n = 0; n < levels.length; n++) {
    const s = callStrikeForLevel(levels[n]);
    if (!strikeToLevels.has(s)) strikeToLevels.set(s, []);
    strikeToLevels.get(s)!.push(n);
  }

  const highStrike = callStrikeForLevel(levels[0]);
  const lowStrike  = callStrikeForLevel(levels[currentLevel]);
  const safeEdge   = callStrikeForLevel(levels[Math.max(0, maxSafe)]);

  // Always show 2 rows below the ITM boundary; extend further if an open position is ITM
  const itmFirstStrike = Math.floor((currentPrice - 0.001) / 0.5) * 0.5;
  const lowestPositionStrike = positions.reduce<number | null>(
    (min, p) => (min === null ? p.strike : Math.min(min, p.strike)),
    null,
  );
  const itmExtension = lowestPositionStrike !== null && lowestPositionStrike < itmFirstStrike
    ? Math.floor(lowestPositionStrike / 0.5) * 0.5
    : itmFirstStrike;
  const extendedLowStrike = Math.min(itmExtension, itmFirstStrike - 0.5);

  const rows: CallRow[] = [];
  let carryIn = 0;

  for (let s = highStrike; s >= extendedLowStrike - 0.01; s = Math.round((s - 0.5) * 100) / 100) {
    const strike = Math.round(s * 100) / 100;
    const levelNums = strikeToLevels.get(strike) ?? [];
    const inSafeZone = strike >= safeEdge;
    const itm = strike < currentPrice;
    const isCurrent = levelNums.includes(currentLevel);

    const ownedShares = levelNums
      .filter((n) => inSafeZone && n <= maxSafe && ownedSet.has(n))
      .reduce((sum, n) => sum + levels[n].shares, 0);

    const total = ownedShares + carryIn;
    const contracts = inSafeZone ? Math.floor(total / 100) : 0;
    const carryOut  = inSafeZone ? total % 100 : 0;

    rows.push({ strike, levelNums, ownedShares, carryIn, contracts, carryOut, inSafeZone, itm, isCurrent, position: matchPosition(positions, strike) });

    carryIn = carryOut;
  }

  return rows;
}

// ── puts allocation ────────────────────────────────────────────────────────

interface PutRow {
  strike: number;
  levelNums: number[];
  levelShares: number;  // shares from levels landing on this strike
  carryIn: number;
  contracts: number;
  carryOut: number;
  inSafeZone: boolean;
  itm: boolean;
  isCurrent: boolean;
  position: OptionPosition | null;
}

function buildPutRows(
  levels: Level[],
  currentLevel: number,
  safetyLevels: number,
  positions: OptionPosition[],
  currentPrice: number,
): PutRow[] {
  const minSafe = currentLevel + safetyLevels;  // first level index in safe zone

  const strikeToLevels = new Map<number, number[]>();
  for (let n = 0; n < levels.length; n++) {
    const s = putStrikeForLevel(levels[n]);
    if (!strikeToLevels.has(s)) strikeToLevels.set(s, []);
    strikeToLevels.get(s)!.push(n);
  }

  // High put strike: current level; low put strike: last level
  const highStrike = putStrikeForLevel(levels[currentLevel]);
  const lowStrike  = putStrikeForLevel(levels[levels.length - 1]);
  const safeEdge   = putStrikeForLevel(levels[Math.min(minSafe, levels.length - 1)]);

  // Always show 2 rows above the ITM boundary; extend further if an open position is ITM
  const itmNearStrike = Math.ceil((currentPrice + 0.001) / 0.5) * 0.5;
  const highestPositionStrike = positions.reduce<number | null>(
    (max, p) => (max === null ? p.strike : Math.max(max, p.strike)),
    null,
  );
  const itmCeiling = highestPositionStrike !== null && highestPositionStrike > itmNearStrike + 0.5
    ? Math.ceil(highestPositionStrike / 0.5) * 0.5
    : itmNearStrike + 0.5;
  const extendedHighStrike = itmCeiling;

  const rows: PutRow[] = [];
  let carryIn = 0;

  for (let s = extendedHighStrike; s >= lowStrike - 0.01; s = Math.round((s - 0.5) * 100) / 100) {
    const strike = Math.round(s * 100) / 100;
    const levelNums = strikeToLevels.get(strike) ?? [];
    const inSafeZone = strike <= safeEdge;
    const itm = strike > currentPrice;
    const isCurrent = levelNums.includes(currentLevel);

    const levelShares = levelNums
      .filter((n) => inSafeZone && n >= minSafe)
      .reduce((sum, n) => sum + levels[n].shares, 0);

    const total = levelShares + carryIn;
    const contracts = inSafeZone ? Math.floor(total / 100) : 0;
    const carryOut  = inSafeZone ? total % 100 : 0;

    rows.push({ strike, levelNums, levelShares, carryIn, contracts, carryOut, inSafeZone, itm, isCurrent, position: matchPosition(positions, strike) });

    carryIn = carryOut;
  }

  return rows;
}

// ── shared position row renderer ───────────────────────────────────────────

function PositionCells({
  position, color, privacyMode, inSafeZone,
}: { position: OptionPosition | null; color: string; privacyMode: boolean; inSafeZone: boolean }) {
  const mask = (v: string) => (privacyMode ? "••••" : v);

  if (!position) {
    return (
      <>
        <Table.Td ta="right"><Text size="sm" c="dimmed">—</Text></Table.Td>
        <Table.Td ta="right" className="hide-mobile"><Text size="sm" c="dimmed">—</Text></Table.Td>
        <Table.Td style={{ minWidth: 70 }}><Text size="sm" c="dimmed">—</Text></Table.Td>
      </>
    );
  }

  const expiryLabel = position.expiry?.length >= 10
    ? new Date(position.expiry.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" })
    : null;
  const dte = daysUntil(position.expiry);
  const pct = progressPct(position.averagePrice, position.marketValue, position.shortQty);
  const totalDays = position.openedAt
    ? Math.max(1, Math.round((new Date(position.expiry + "T00:00:00").getTime() - new Date(position.openedAt).getTime()) / 86400000))
    : 45;
  const elapsedPct = Math.min(100, Math.max(0, ((totalDays - dte) / totalDays) * 100));
  const dteColor = elapsedPct <= 50
    ? `color-mix(in srgb, var(--mantine-color-yellow-5) ${elapsedPct * 2}%, var(--mantine-color-lime-5) ${100 - elapsedPct * 2}%)`
    : `color-mix(in srgb, var(--mantine-color-red-5) ${(elapsedPct - 50) * 2}%, var(--mantine-color-yellow-5) ${100 - (elapsedPct - 50) * 2}%)`;

  return (
    <>
      <Table.Td ta="center">
        <Group gap={6} justify="center">
          {position.longQty > 0 && (
            <Badge size="sm" color="red" variant="filled" leftSection={<IconAlertTriangle size={10} />}>
              BTO ×{position.longQty}
            </Badge>
          )}
          {position.shortQty > 0 && <Badge size="sm" color={color} variant="light">-{position.shortQty}</Badge>}
          {expiryLabel && <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{expiryLabel}</Text>}
        </Group>
      </Table.Td>
      <Table.Td ta="right" className="hide-mobile">
        {(() => {
          const credit = position.averagePrice * position.shortQty * 100;
          const costToClose = Math.abs(position.marketValue);
          const value = credit - costToClose;
          return (
            <Text size="sm" c={value >= 0 ? color : "red"}>
              {mask(`${value >= 0 ? "+" : ""}$${value.toFixed(2)}`)}
            </Text>
          );
        })()}
      </Table.Td>
      <Table.Td style={{ minWidth: 70 }}>
        <Stack gap={2}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>{totalDays}d</Text>
            <IconArrowRight size={10} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
            <Text size="xs" style={{ color: dteColor, whiteSpace: "nowrap" }}>{dte}d</Text>
          </Group>
          <Box style={{ height: 4, borderRadius: 999, background: "var(--mantine-color-dark-4)", overflow: "hidden" }}>
            <Box style={{
              height: "100%", borderRadius: 999,
              width: `${elapsedPct}%`,
              background: dteColor,
            }} />
          </Box>
          <Box style={{ height: 4, borderRadius: 999, background: "var(--mantine-color-dark-4)", overflow: "hidden" }}>
            <Box style={{
              height: "100%", width: `${pct}%`, borderRadius: 999,
              background: `color-mix(in srgb, var(--mantine-color-gray-6) ${100 - pct}%, var(--mantine-color-${color}-5) ${pct}%)`,
            }} />
          </Box>
          <Box style={{ display: "flex", justifyContent: "space-between" }}>
            <Text size="xs" c="dimmed">{pct.toFixed(0)}%</Text>
            <Text size="xs" c="dimmed">of</Text>
            <Text size="xs" c="dimmed">{mask(`$${(position.averagePrice * position.shortQty * 100).toFixed(2)}`)}</Text>
          </Box>
        </Stack>
      </Table.Td>
    </>
  );
}

// ── calls table ───────────────────────────────────────────────────────────

function CallsTable({
  rows, color, safetyLevels, onSafetyChange, privacyMode,
  totalValue, callsAvailableLabel, btoPositions, riskStrike, riskStrikeAvg,
}: {
  rows: CallRow[];
  color: string;
  safetyLevels: number;
  onSafetyChange: (v: number) => void;
  privacyMode: boolean;
  totalValue: number;
  callsAvailableLabel: string;
  btoPositions: OptionPosition[];
  riskStrike: number | null;
  riskStrikeAvg: number | null;
}) {
  const mask = (v: string) => (privacyMode ? "••••" : v);

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={700} size="sm">Covered Calls</Text>
        <Group gap="xs" align="center">
          <Text size="xs" c="dimmed">Safety Levels</Text>
          <NumberInput
            value={safetyLevels}
            onChange={(v) => onSafetyChange(typeof v === "number" ? v : 0)}
            min={0} max={30} size="xs" w={64}
          />
        </Group>
      </Group>

      <OptionsSummaryCard
        totalValue={totalValue}
        availableLabel="Can Open"
        availableValue={callsAvailableLabel}
        color={color}
        privacyMode={privacyMode}
      />


      {btoPositions.length > 0 && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={600}>Accidental BUY TO OPEN detected</Text>
          <Text size="xs" c="dimmed">
            {btoPositions.map((p) => `$${p.strike.toFixed(2)} call ×${p.longQty}`).join(", ")} — sell to close ASAP
          </Text>
        </Alert>
      )}

      {rows.length === 0 ? (
        <Center h={80}><Text size="sm" c="dimmed">No levels configured.</Text></Center>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Level</Table.Th>
              <Table.Th ta="right">Strike</Table.Th>
              <Table.Th ta="right"><Tooltip label="Recommended number of contracts to sell" withArrow><span style={{ cursor: "default", borderBottom: "1px dotted" }}>Qty</span></Tooltip></Table.Th>
              <Table.Th ta="center">Contracts</Table.Th>
              <Table.Th ta="right" className="hide-mobile">Value</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(() => {
              const lo = rows.length > 0 ? rows[rows.length - 1].strike : 0;
              const hi = rows.length > 0 ? rows[0].strike : 0;
              const closest = (target: number | null) =>
                target != null && rows.length > 0 && target >= lo && target <= hi
                  ? rows.reduce((best, row, i) => Math.abs(row.strike - target) < Math.abs(rows[best].strike - target) ? i : best, 0)
                  : -1;
              const riskIdx = closest(riskStrike);
              const avgIdx  = closest(riskStrikeAvg);
              return rows.map((row, i) => {
              const dim = !row.position && (!row.inSafeZone || row.contracts === 0);
              const isItmBoundary = row.itm && !rows[i - 1]?.itm;
              return (
                <Fragment key={row.strike}>
                  {isItmBoundary && (
                    <Table.Tr bg="rgba(251,146,60,0.15)">
                      <Table.Td colSpan={6} py={2} style={{ textAlign: "center" }}>
                        <Text size="9px" fw={700} c="rgba(251,146,60,0.8)" tt="uppercase" style={{ letterSpacing: "0.08em" }}>▼ ITM ▼</Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                  <Table.Tr
                    bg={row.inSafeZone ? `var(--mantine-color-${color}-light-hover)` : undefined}
                    style={{ opacity: dim ? 0.4 : 1 }}
                  >
                  <Table.Td style={{ position: "relative" }}>
                    {i === riskIdx && (
                      <IconPlayerPlayFilled size={8} style={{ position: "absolute", left: -2, top: "50%", transform: "translateY(-50%)", color: "rgba(20,184,166,1)" }} />
                    )}
                    {i === avgIdx && i !== riskIdx && (
                      <IconPlayerPlayFilled size={8} style={{ position: "absolute", left: -2, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.6)" }} />
                    )}
                    {i === avgIdx && i === riskIdx && (
                      <IconPlayerPlayFilled size={8} style={{ position: "absolute", left: -2, top: "50%", transform: "translateY(-50%)", color: "rgba(20,184,166,1)" }} />
                    )}
                    <Group gap={4}>
                      <Text size="xs" c={row.levelNums.length === 0 ? "dimmed" : undefined}>
                        {row.levelNums.length > 0 ? row.levelNums.join(", ") : "—"}
                      </Text>
                      {row.carryIn > 0 && (
                        <Text size="xs" c="dimmed">(+{row.carryIn})</Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">{mask(`$${row.strike.toFixed(2)}`)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    {row.contracts > 0 ? (
                      <Badge color="gray" variant="light" size="sm">{row.contracts}</Badge>
                    ) : row.inSafeZone && row.ownedShares > 0 ? (
                      <Text size="xs" c="dimmed">{row.ownedShares}sh</Text>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <PositionCells position={row.position} color={color} privacyMode={privacyMode} inSafeZone={row.inSafeZone} />
                </Table.Tr>
                </Fragment>
              );
            });
            })()}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// ── puts table ────────────────────────────────────────────────────────────

function PutsTable({
  rows, color, safetyLevels, onSafetyChange, privacyMode,
  totalValue, availableCash, btoPositions, riskStrike, riskStrikeAvg,
}: {
  rows: PutRow[];
  color: string;
  safetyLevels: number;
  onSafetyChange: (v: number) => void;
  privacyMode: boolean;
  totalValue: number;
  availableCash: number;
  btoPositions: OptionPosition[];
  riskStrike: number | null;
  riskStrikeAvg: number | null;
}) {
  const mask = (v: string) => (privacyMode ? "••••" : v);

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={700} size="sm">Cash Secured Puts</Text>
        <Group gap="xs" align="center">
          <Text size="xs" c="dimmed">Safety Levels</Text>
          <NumberInput
            value={safetyLevels}
            onChange={(v) => onSafetyChange(typeof v === "number" ? v : 0)}
            min={0} max={30} size="xs" w={64}
          />
        </Group>
      </Group>

      <OptionsSummaryCard
        totalValue={totalValue}
        availableLabel="Cash Available"
        availableValue={mask(`$${availableCash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)}
        color={color}
        privacyMode={privacyMode}
      />


      {btoPositions.length > 0 && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={600}>Accidental BUY TO OPEN detected</Text>
          <Text size="xs" c="dimmed">
            {btoPositions.map((p) => `$${p.strike.toFixed(2)} put ×${p.longQty}`).join(", ")} — sell to close ASAP
          </Text>
        </Alert>
      )}

      {rows.length === 0 ? (
        <Center h={80}><Text size="sm" c="dimmed">No levels configured.</Text></Center>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Level</Table.Th>
              <Table.Th ta="right">Strike</Table.Th>
              <Table.Th ta="right"><Tooltip label="Recommended number of contracts to sell" withArrow><span style={{ cursor: "default", borderBottom: "1px dotted" }}>Qty</span></Tooltip></Table.Th>
              <Table.Th ta="center">Contracts</Table.Th>
              <Table.Th ta="right" className="hide-mobile">Value</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(() => {
              const lo = rows.length > 0 ? rows[rows.length - 1].strike : 0;
              const hi = rows.length > 0 ? rows[0].strike : 0;
              const closest = (target: number | null) =>
                target != null && rows.length > 0 && target >= lo && target <= hi
                  ? rows.reduce((best, row, i) => Math.abs(row.strike - target) < Math.abs(rows[best].strike - target) ? i : best, 0)
                  : -1;
              const riskIdx = closest(riskStrike);
              const avgIdx  = closest(riskStrikeAvg);
              return rows.map((row, i) => {
              const dim = !row.position && (!row.inSafeZone || row.contracts === 0);
              const isItmBoundary = !row.itm && rows[i - 1]?.itm;
              return (
                <Fragment key={row.strike}>
                  {isItmBoundary && (
                    <Table.Tr bg="rgba(251,146,60,0.15)">
                      <Table.Td colSpan={6} py={2} style={{ textAlign: "center" }}>
                        <Text size="9px" fw={700} c="rgba(251,146,60,0.8)" tt="uppercase" style={{ letterSpacing: "0.08em" }}>▲ ITM ▲</Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                <Table.Tr
                  bg={row.inSafeZone ? `var(--mantine-color-${color}-light-hover)` : undefined}
                  style={{ opacity: dim ? 0.4 : 1 }}
                >
                  <Table.Td style={{ position: "relative" }}>
                    {i === riskIdx && (
                      <IconPlayerPlayFilled size={8} style={{ position: "absolute", left: -2, top: "50%", transform: "translateY(-50%)", color: "rgba(239,68,68,1)" }} />
                    )}
                    {i === avgIdx && i !== riskIdx && (
                      <IconPlayerPlayFilled size={8} style={{ position: "absolute", left: -2, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.6)" }} />
                    )}
                    {i === avgIdx && i === riskIdx && (
                      <IconPlayerPlayFilled size={8} style={{ position: "absolute", left: -2, top: "50%", transform: "translateY(-50%)", color: "rgba(239,68,68,1)" }} />
                    )}
                    <Group gap={4}>
                      <Text size="xs" c={row.levelNums.length === 0 ? "dimmed" : undefined}>
                        {row.levelNums.length > 0 ? row.levelNums.join(", ") : "—"}
                      </Text>
                      {row.carryIn > 0 && (
                        <Text size="xs" c="dimmed">(+{row.carryIn})</Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">{mask(`$${row.strike.toFixed(2)}`)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    {row.contracts > 0 ? (
                      <Badge color="gray" variant="light" size="sm">{row.contracts}</Badge>
                    ) : row.inSafeZone && row.levelShares > 0 ? (
                      <Text size="xs" c="dimmed">{row.levelShares}sh</Text>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <PositionCells position={row.position} color={color} privacyMode={privacyMode} inSafeZone={row.inSafeZone} />
                </Table.Tr>
                </Fragment>
              );
            });
            })()}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// ── page ──────────────────────────────────────────────────────────────────

function OptionsPageInner() {
  const { optionPositions, snapshotLoading, activeAccount, privacyMode, updateAccountSettings, quote, tqqqShares, workingOrders, balances } = useApp();

  const levelsSummary = useLevels();
  const color = activeAccount?.color ?? "blue";
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileTab, setMobileTab] = useState<"calls" | "puts">("calls");

  const searchParams = useSearchParams();
  const testAlerts = searchParams.has("testalerts");

  const callSafety = activeAccount?.settings.callSafetyLevels ?? 8;
  const putSafety  = activeAccount?.settings.putSafetyLevels  ?? 8;

  const handleCallSafety = (v: number) => {
    if (activeAccount) updateAccountSettings(activeAccount.accountNumber, { callSafetyLevels: v });
  };
  const handlePutSafety = (v: number) => {
    if (activeAccount) updateAccountSettings(activeAccount.accountNumber, { putSafetyLevels: v });
  };

  const calls = useMemo(() => optionPositions.filter((p) => p.putCall === "CALL"), [optionPositions]);
  const puts  = useMemo(() => optionPositions.filter((p) => p.putCall === "PUT"),  [optionPositions]);
  const callBtoPositions = useMemo(() => {
    if (testAlerts) {
      const strike = calls.find((p) => p.shortQty > 0)?.strike ?? 60;
      return [{ accountNumber: "", symbol: "", putCall: "CALL" as const, strike, expiry: "", shortQty: 0, longQty: 2, marketValue: 0, averagePrice: 0, openedAt: null }];
    }
    return calls.filter((p) => p.longQty > 0);
  }, [calls, testAlerts]);
  const putBtoPositions = useMemo(() => {
    if (testAlerts) {
      const strike = puts.find((p) => p.shortQty > 0)?.strike ?? 45;
      return [{ accountNumber: "", symbol: "", putCall: "PUT" as const, strike, expiry: "", shortQty: 0, longQty: 1, marketValue: 0, averagePrice: 0, openedAt: null }];
    }
    return puts.filter((p) => p.longQty > 0);
  }, [puts, testAlerts]);

  const callRows = useMemo(() => {
    const levels = levelsSummary?.levels ?? [];
    const currentLevel = levelsSummary?.currentLevel ?? -1;
    if (levels.length === 0 || currentLevel < 1) return [];
    const ownedSet = new Set(levelsSummary?.ownedLevels.map((l) => l.n) ?? []);
    return buildCallRows(levels, ownedSet, currentLevel, callSafety, calls, quote.price);
  }, [levelsSummary, callSafety, calls, quote.price]);

  const putRows = useMemo(() => {
    const levels = levelsSummary?.levels ?? [];
    const currentLevel = levelsSummary?.currentLevel ?? -1;
    if (levels.length === 0 || currentLevel < 0) return [];
    return buildPutRows(levels, currentLevel, putSafety, puts, quote.price);
  }, [levelsSummary, putSafety, puts, quote.price]);

  const activeBalance = useMemo(
    () => balances.find((b) => b.accountNumber === activeAccount?.accountNumber) ?? null,
    [balances, activeAccount],
  );

  const callsTotalValue = useMemo(
    () => calls.reduce((sum, p) => sum + p.averagePrice * p.shortQty * 100 - Math.abs(p.marketValue), 0),
    [calls],
  );

  const { callsAvailable, callsAvailableShares } = useMemo(() => {
    const existingCallShares = calls.reduce((sum, p) => sum + p.shortQty * 100, 0);
    const queuedSellShares = workingOrders
      .filter((o) => o.side === "SELL" && o.status === "WORKING")
      .reduce((sum, o) => sum + o.shares, 0);
    const net = tqqqShares - existingCallShares - queuedSellShares;
    return {
      callsAvailable: Math.floor(Math.max(0, net) / 100),
      callsAvailableShares: net >= 0 ? net % 100 : net,
    };
  }, [tqqqShares, calls, workingOrders]);

  const putsTotalValue = useMemo(
    () => puts.reduce((sum, p) => sum + p.averagePrice * p.shortQty * 100 - Math.abs(p.marketValue), 0),
    [puts],
  );

  const putsAvailableCash = activeBalance?.cashAvailableForTrading ?? 0;

  const { riskStrikeCall, riskStrikeAvgCall, riskStrikePut, riskStrikeAvgPut } = useMemo(() => {
    const { closes30, dates30, daysOfWeek30, price } = quote;
    if (closes30.length < 2 || price <= 0) return { riskStrikeCall: null, riskStrikeAvgCall: null, riskStrikePut: null, riskStrikeAvgPut: null };
    const weekChunks: { x1: string; x2: string }[] = [];
    let ws = 0;
    for (let i = 1; i < dates30.length; i++) {
      if (daysOfWeek30[i] === 1) { weekChunks.push({ x1: dates30[ws], x2: dates30[i - 1] }); ws = i; }
    }
    if (ws < dates30.length) weekChunks.push({ x1: dates30[ws], x2: dates30[dates30.length - 1] });
    const moves = weekChunks.map((c) => closes30[dates30.indexOf(c.x2)] - closes30[dates30.indexOf(c.x1)]);
    const maxUp   = moves.length ? Math.max(...moves) : 0;
    const maxDown = moves.length ? Math.min(...moves) : 0;
    const avgAbs  = moves.length ? moves.reduce((s, m) => s + Math.abs(m), 0) / moves.length : 0;
    return {
      riskStrikeCall: price + maxUp,
      riskStrikeAvgCall: price + avgAbs,
      riskStrikePut: price + maxDown,
      riskStrikeAvgPut: price - avgAbs,
    };
  }, [quote]);

  const callsAvailableLabel = callsAvailable > 0
    ? `${callsAvailable} contract${callsAvailable !== 1 ? "s" : ""}${callsAvailableShares > 0 ? ` (${callsAvailableShares} sh)` : ""}`
    : `0 contracts${callsAvailableShares !== 0 ? ` (${callsAvailableShares} sh)` : ""}`;

  if (snapshotLoading) {
    const optCols = [45, 50, 35, 40, 45, 70];
    const optRows = [35, 45, 25, 30, 40, 60];
    return (
      <Stack gap="md">
        <Skeleton height={28} width={90} radius="sm" />
        <SimpleGrid cols={isMobile ? 1 : 2} spacing="xl">
          {["Covered Calls", "Cash Secured Puts"].map((label, pi) => (
            <Paper key={label} p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-7)" }}>
              <Stack gap="md">
                <Group justify="space-between" align="flex-end">
                  <Skeleton height={18} width={label.length * 7.5} radius="sm" />
                  <Skeleton height={30} width={90} radius="sm" />
                </Group>
                <Skeleton height={48} radius="md" />
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      {optCols.map((w, i) => (
                        <Table.Th key={i}><Skeleton height={11} width={w} radius="sm" /></Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Table.Tr key={i} style={{ opacity: i > 4 ? 0.4 : 1 }}>
                        {optRows.map((w, j) => (
                          <Table.Td key={j}><Skeleton height={13} width={w + ((i + pi) % 3 === 0 && j > 0 ? 8 : 0)} radius="sm" /></Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  if (isMobile) {
    return (
      <Stack gap="md">
        <Text fw={700} size="xl">Options</Text>
        <DayChangeBanner closes30={quote.closes30} dates30={quote.dates30} daysOfWeek30={quote.daysOfWeek30} loading={quote.loading} />
        <SegmentedControl
          fullWidth
          color={color}
          value={mobileTab}
          onChange={(v) => setMobileTab(v as "calls" | "puts")}
          data={[
            { label: "Covered Calls", value: "calls" },
            { label: "Cash Secured Puts", value: "puts" },
          ]}
          styles={{ root: { height: 44 }, label: { lineHeight: "28px" } }}
        />
          {mobileTab === "calls" ? (
            <CallsTable
              rows={callRows}
              color={color}
              safetyLevels={callSafety}
              onSafetyChange={handleCallSafety}
              privacyMode={privacyMode}
              totalValue={callsTotalValue}
              callsAvailableLabel={callsAvailableLabel}
              btoPositions={callBtoPositions}
              riskStrike={riskStrikeCall}
              riskStrikeAvg={riskStrikeAvgCall}
            />
          ) : (
            <PutsTable
              rows={putRows}
              color={color}
              safetyLevels={putSafety}
              onSafetyChange={handlePutSafety}
              privacyMode={privacyMode}
              totalValue={putsTotalValue}
              availableCash={putsAvailableCash}
              btoPositions={putBtoPositions}
              riskStrike={riskStrikePut}
              riskStrikeAvg={riskStrikeAvgPut}
            />
          )}
      </Stack>
    );
  }

  return (
    <Stack gap="md">
    <Text fw={700} size="xl">Options</Text>
    <DayChangeBanner closes30={quote.closes30} dates30={quote.dates30} daysOfWeek30={quote.daysOfWeek30} loading={quote.loading} />
    <SimpleGrid cols={2} spacing="xl">
      <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-7)" }}>
        <CallsTable
          rows={callRows}
          color={color}
          safetyLevels={callSafety}
          onSafetyChange={handleCallSafety}
          privacyMode={privacyMode}
          totalValue={callsTotalValue}
          callsAvailableLabel={callsAvailableLabel}
          btoPositions={callBtoPositions}
          riskStrike={riskStrikeCall}
          riskStrikeAvg={riskStrikeAvgCall}
        />
      </Paper>
      <Paper p="md" radius={CARD_RADIUS} style={{ background: "var(--mantine-color-dark-7)" }}>
        <PutsTable
          rows={putRows}
          color={color}
          safetyLevels={putSafety}
          onSafetyChange={handlePutSafety}
          privacyMode={privacyMode}
          totalValue={putsTotalValue}
          availableCash={putsAvailableCash}
          btoPositions={putBtoPositions}
          riskStrike={riskStrikePut}
          riskStrikeAvg={riskStrikeAvgPut}
        />
      </Paper>
    </SimpleGrid>
    </Stack>
  );
}

export default function OptionsPage() {
  return <Suspense><OptionsPageInner /></Suspense>;
}
