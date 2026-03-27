"use client";

import { useMemo, useState } from "react";
import {
  Table, Text, Group, Stack, Skeleton, Center, NumberInput,
  SimpleGrid, Badge, Box, SegmentedControl,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useApp } from "@/lib/context/AppContext";
import { useLevels } from "@/lib/hooks/useLevels";
import { IconArrowRight } from "@tabler/icons-react";
import type { OptionPosition } from "@/lib/schwab/parse";
import type { Level } from "@/lib/levels";

// ── sentiment messages ─────────────────────────────────────────────────────

interface SentimentMsg { text: string; good: boolean }

function getCallSentiment(pct: number): SentimentMsg | null {
  if (pct >= 5)  return { text: "Major up day — excellent time to sell calls", good: true };
  if (pct >= 4)  return { text: "Strong up day — great call premium available", good: true };
  if (pct >= 3)  return { text: "Up day — good opportunity to sell calls", good: true };
  if (pct >= 2)  return { text: "Slight up move — consider selling calls", good: true };
  if (pct >= 1)  return { text: "Minor up move — calls have some premium", good: true };
  if (pct <= -5) return { text: "Major down day — do not sell calls", good: false };
  if (pct <= -4) return { text: "Strong down day — avoid selling calls", good: false };
  if (pct <= -3) return { text: "Down day — hold off on calls", good: false };
  if (pct <= -2) return { text: "Down move — wait for a better day to sell calls", good: false };
  if (pct <= -1) return { text: "Minor down move — calls have less premium today", good: false };
  return null;
}

function getPutSentiment(pct: number): SentimentMsg | null {
  if (pct <= -5) return { text: "Major down day — prime time to sell puts", good: true };
  if (pct <= -4) return { text: "Strong down day — excellent put premium", good: true };
  if (pct <= -3) return { text: "Down day — good opportunity to sell puts", good: true };
  if (pct <= -2) return { text: "Slight down move — consider selling puts", good: true };
  if (pct <= -1) return { text: "Minor down move — puts have some premium", good: true };
  if (pct >= 5)  return { text: "Major up day — do not sell puts", good: false };
  if (pct >= 4)  return { text: "Strong up day — avoid selling puts", good: false };
  if (pct >= 3)  return { text: "Up day — hold off on puts", good: false };
  if (pct >= 2)  return { text: "Up move — wait for a down day to sell puts", good: false };
  if (pct >= 1)  return { text: "Minor up move — puts have less premium today", good: false };
  return null;
}

function SentimentBanner({ msg }: { msg: SentimentMsg | null }) {
  if (!msg) return null;
  const bgColor     = msg.good ? "rgba(20,184,166,0.08)" : "rgba(239,68,68,0.08)";
  const borderColor = msg.good ? "var(--mantine-color-teal-6)" : "var(--mantine-color-red-6)";
  const textColor   = msg.good ? "var(--mantine-color-teal-4)" : "var(--mantine-color-red-4)";
  return (
    <Box style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      padding: "6px 10px",
    }}>
      <Text size="xs" style={{ color: textColor }}>{msg.text}</Text>
    </Box>
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
  position: OptionPosition | null;
}

function buildCallRows(
  levels: Level[],
  ownedSet: Set<number>,
  currentLevel: number,
  safetyLevels: number,
  positions: OptionPosition[],
): CallRow[] {
  const maxSafe = currentLevel - safetyLevels;

  const strikeToLevels = new Map<number, number[]>();
  for (let n = 0; n <= currentLevel; n++) {
    const s = callStrikeForLevel(levels[n]);
    if (!strikeToLevels.has(s)) strikeToLevels.set(s, []);
    strikeToLevels.get(s)!.push(n);
  }

  const highStrike = callStrikeForLevel(levels[0]);
  const lowStrike  = callStrikeForLevel(levels[currentLevel]);
  const safeEdge   = callStrikeForLevel(levels[Math.max(0, maxSafe)]);

  const rows: CallRow[] = [];
  let carryIn = 0;

  for (let s = highStrike; s >= lowStrike - 0.01; s = Math.round((s - 0.5) * 100) / 100) {
    const strike = Math.round(s * 100) / 100;
    const levelNums = strikeToLevels.get(strike) ?? [];
    const inSafeZone = strike >= safeEdge;

    const ownedShares = levelNums
      .filter((n) => inSafeZone && n <= maxSafe && ownedSet.has(n))
      .reduce((sum, n) => sum + levels[n].shares, 0);

    const total = ownedShares + carryIn;
    const contracts = inSafeZone ? Math.floor(total / 100) : 0;
    const carryOut  = inSafeZone ? total % 100 : 0;

    rows.push({ strike, levelNums, ownedShares, carryIn, contracts, carryOut, inSafeZone, position: matchPosition(positions, strike) });

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
  position: OptionPosition | null;
}

function buildPutRows(
  levels: Level[],
  currentLevel: number,
  safetyLevels: number,
  positions: OptionPosition[],
): PutRow[] {
  const minSafe = currentLevel + safetyLevels;  // first level index in safe zone

  const strikeToLevels = new Map<number, number[]>();
  for (let n = currentLevel; n < levels.length; n++) {
    const s = putStrikeForLevel(levels[n]);
    if (!strikeToLevels.has(s)) strikeToLevels.set(s, []);
    strikeToLevels.get(s)!.push(n);
  }

  // High put strike: current level; low put strike: last level
  const highStrike = putStrikeForLevel(levels[currentLevel]);
  const lowStrike  = putStrikeForLevel(levels[levels.length - 1]);
  const safeEdge   = putStrikeForLevel(levels[Math.min(minSafe, levels.length - 1)]);

  const rows: PutRow[] = [];
  let carryIn = 0;

  for (let s = highStrike; s >= lowStrike - 0.01; s = Math.round((s - 0.5) * 100) / 100) {
    const strike = Math.round(s * 100) / 100;
    const levelNums = strikeToLevels.get(strike) ?? [];
    // Safe zone for puts: at or below the safe edge price
    const inSafeZone = strike <= safeEdge;

    const levelShares = levelNums
      .filter((n) => inSafeZone && n >= minSafe)
      .reduce((sum, n) => sum + levels[n].shares, 0);

    const total = levelShares + carryIn;
    const contracts = inSafeZone ? Math.floor(total / 100) : 0;
    const carryOut  = inSafeZone ? total % 100 : 0;

    rows.push({ strike, levelNums, levelShares, carryIn, contracts, carryOut, inSafeZone, position: matchPosition(positions, strike) });

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
    ? new Date(position.expiry.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })
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
      <Table.Td ta="right">
        <Group gap={6} justify="flex-end" wrap="nowrap">
          <Badge size="sm" color={color} variant="light">{position.shortQty}</Badge>
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
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{totalDays}d</Text>
            <IconArrowRight size={10} style={{ color: "var(--mantine-color-dimmed)" }} />
            <Text size="xs" style={{ color: dteColor }}>{dte}d</Text>
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
  rows, color, safetyLevels, onSafetyChange, privacyMode, currentLevel, changePercent,
}: {
  rows: CallRow[];
  color: string;
  safetyLevels: number;
  onSafetyChange: (v: number) => void;
  privacyMode: boolean;
  currentLevel: number;
  changePercent: number;
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

      <SentimentBanner msg={getCallSentiment(changePercent)} />

      {rows.length === 0 ? (
        <Center h={80}><Text size="sm" c="dimmed">No levels configured.</Text></Center>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Level</Table.Th>
              <Table.Th ta="right">Strike</Table.Th>
              <Table.Th ta="right">Qty</Table.Th>
              <Table.Th ta="right">Held</Table.Th>
              <Table.Th ta="right" className="hide-mobile">Value</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const dim = !row.position && (!row.inSafeZone || row.contracts === 0);
              const isCurrent = row.levelNums.includes(currentLevel);
              return (
                <Table.Tr
                  key={row.strike}
                  bg={isCurrent ? "dark.4" : row.inSafeZone ? `var(--mantine-color-${color}-light-hover)` : undefined}
                  style={{
                    opacity: dim && !isCurrent ? 0.4 : 1,
                    ...(isCurrent ? { borderLeft: `3px solid var(--mantine-color-${color}-5)` } : {}),
                  }}
                >
                  <Table.Td>
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
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// ── puts table ────────────────────────────────────────────────────────────

function PutsTable({
  rows, color, safetyLevels, onSafetyChange, privacyMode, currentLevel, changePercent,
}: {
  rows: PutRow[];
  color: string;
  safetyLevels: number;
  onSafetyChange: (v: number) => void;
  privacyMode: boolean;
  currentLevel: number;
  changePercent: number;
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

      <SentimentBanner msg={getPutSentiment(changePercent)} />

      {rows.length === 0 ? (
        <Center h={80}><Text size="sm" c="dimmed">No levels configured.</Text></Center>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Level</Table.Th>
              <Table.Th ta="right">Strike</Table.Th>
              <Table.Th ta="right">Qty</Table.Th>
              <Table.Th ta="right">Held</Table.Th>
              <Table.Th ta="right" className="hide-mobile">Value</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const dim = !row.position && (!row.inSafeZone || row.contracts === 0);
              const isCurrent = row.levelNums.includes(currentLevel);
              return (
                <Table.Tr
                  key={row.strike}
                  bg={isCurrent ? "dark.4" : row.inSafeZone ? `var(--mantine-color-${color}-light-hover)` : undefined}
                  style={{
                    opacity: dim && !isCurrent ? 0.4 : 1,
                    ...(isCurrent ? { borderLeft: `3px solid var(--mantine-color-${color}-5)` } : {}),
                  }}
                >
                  <Table.Td>
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
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// ── page ──────────────────────────────────────────────────────────────────

export default function OptionsPage() {
  const { optionPositions, snapshotLoading, activeAccount, privacyMode, updateAccountSettings, quote } = useApp();
  const changePercent = quote.loading ? 0 : quote.changePercent;
  const levelsSummary = useLevels();
  const color = activeAccount?.color ?? "blue";
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileTab, setMobileTab] = useState<"calls" | "puts">("calls");

  const callSafety = activeAccount?.settings.callSafetyLevels ?? 6;
  const putSafety  = activeAccount?.settings.putSafetyLevels  ?? 8;

  const handleCallSafety = (v: number) => {
    if (activeAccount) updateAccountSettings(activeAccount.accountNumber, { callSafetyLevels: v });
  };
  const handlePutSafety = (v: number) => {
    if (activeAccount) updateAccountSettings(activeAccount.accountNumber, { putSafetyLevels: v });
  };

  const calls = useMemo(() => optionPositions.filter((p) => p.putCall === "CALL"), [optionPositions]);
  const puts  = useMemo(() => optionPositions.filter((p) => p.putCall === "PUT"),  [optionPositions]);

  const callRows = useMemo(() => {
    const levels = levelsSummary?.levels ?? [];
    const currentLevel = levelsSummary?.currentLevel ?? -1;
    if (levels.length === 0 || currentLevel < 1) return [];
    const ownedSet = new Set(levelsSummary?.ownedLevels.map((l) => l.n) ?? []);
    return buildCallRows(levels, ownedSet, currentLevel, callSafety, calls);
  }, [levelsSummary, callSafety, calls]);

  const putRows = useMemo(() => {
    const levels = levelsSummary?.levels ?? [];
    const currentLevel = levelsSummary?.currentLevel ?? -1;
    if (levels.length === 0 || currentLevel < 0) return [];
    return buildPutRows(levels, currentLevel, putSafety, puts);
  }, [levelsSummary, putSafety, puts]);

  if (snapshotLoading) {
    return (
      <Stack>
        <Skeleton height={40} radius="md" />
        <Skeleton height={200} radius="md" />
      </Stack>
    );
  }

  if (isMobile) {
    return (
      <Stack>
        <SegmentedControl
          fullWidth
          value={mobileTab}
          onChange={(v) => setMobileTab(v as "calls" | "puts")}
          data={[
            { label: "Covered Calls", value: "calls" },
            { label: "Cash Secured Puts", value: "puts" },
          ]}
        />
          {mobileTab === "calls" ? (
            <CallsTable
              rows={callRows}
              color={color}
              safetyLevels={callSafety}
              onSafetyChange={handleCallSafety}
              privacyMode={privacyMode}
              currentLevel={levelsSummary?.currentLevel ?? -1}
              changePercent={changePercent}
            />
          ) : (
            <PutsTable
              rows={putRows}
              color={color}
              safetyLevels={putSafety}
              onSafetyChange={handlePutSafety}
              privacyMode={privacyMode}
              currentLevel={levelsSummary?.currentLevel ?? -1}
              changePercent={changePercent}
            />
          )}
      </Stack>
    );
  }

  return (
    <SimpleGrid cols={2} spacing="xl">
      <CallsTable
        rows={callRows}
        color={color}
        safetyLevels={callSafety}
        onSafetyChange={handleCallSafety}
        privacyMode={privacyMode}
        currentLevel={levelsSummary?.currentLevel ?? -1}
        changePercent={changePercent}
      />
      <PutsTable
        rows={putRows}
        color={color}
        safetyLevels={putSafety}
        onSafetyChange={handlePutSafety}
        privacyMode={privacyMode}
        currentLevel={levelsSummary?.currentLevel ?? -1}
        changePercent={changePercent}
      />
    </SimpleGrid>
  );
}
